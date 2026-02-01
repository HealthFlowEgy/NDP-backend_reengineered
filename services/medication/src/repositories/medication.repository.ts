import { FHIRGatewayClient } from '../../../../shared/clients/fhir-gateway.client.js';
import { MedicationRecord, NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';
import { MedicationKnowledge } from '../../../../shared/types/fhir.types.js';

export class MedicationRepository {
  private client: FHIRGatewayClient;

  constructor() {
    this.client = new FHIRGatewayClient('MedicationKnowledge');
  }

  async findByEdaCode(edaCode: string): Promise<MedicationRecord | null> {
    const response = await this.client.search<MedicationKnowledge>({ code: edaCode }, 'SYSTEM_TOKEN');
    if (!response.entry || response.entry.length === 0) return null;
    return this.mapFHIRToRecord(response.entry[0].resource);
  }

  async findById(id: string): Promise<MedicationRecord | null> {
    const resource = await this.client.getById<MedicationKnowledge>(id, 'SYSTEM_TOKEN');
    if (!resource) return null;
    return this.mapFHIRToRecord(resource);
  }

  async search(params: { query?: string; edaCode?: string; status?: string; limit?: number; offset?: number }): Promise<{ records: MedicationRecord[]; total: number }> {
    const query: Record<string, string> = {};
    
    // Mapping our search params to FHIR search params
    if (params.edaCode) query['code'] = params.edaCode;
    if (params.status) query['status'] = params.status;
    if (params.query) {
      // FHIR 'name' search usually covers text/display
      // HAPI supports fuzzy matching on string fields
      query['code:text'] = params.query; 
    }
    
    // Pagination (HAPI uses _count and _offset)
    if (params.limit) query['_count'] = params.limit.toString();
    if (params.offset) query['_offset'] = params.offset.toString();

    const response = await this.client.search<MedicationKnowledge>(query, 'SYSTEM_TOKEN');
    
    const records = (response.entry || []).map(e => this.mapFHIRToRecord(e.resource));
    return { records, total: response.total || records.length };
  }

  async updateStatus(edaCode: string, status: string, reason?: string): Promise<MedicationRecord | null> {
    // 1. Find the resource first
    const current = await this.findByEdaCode(edaCode);
    if (!current) return null;

    // 2. Update status
    const resource = current.fhirResource;
    resource.status = status as 'active' | 'inactive' | 'entered-in-error';
    
    // Store reason in extension if needed, for now just status
    
    const updated = await this.client.update<MedicationKnowledge>(current.id, resource, 'SYSTEM_TOKEN');
    return this.mapFHIRToRecord(updated);
  }

  // Helper to map FHIR back to our legacy internal record
  private mapFHIRToRecord(resource: MedicationKnowledge): MedicationRecord {
    // Extract EDA code from coding
    const edaCode = resource.code?.coding?.find(c => c.system?.includes('eda'))?.code || resource.code?.coding?.[0]?.code || '';
    
    return {
      id: resource.id || '',
      edaCode,
      fhirResource: resource,
      commercialName: resource.code?.text || '',
      genericName: resource.synonym?.[0],
      manufacturer: resource.manufacturer?.display,
      doseForm: resource.doseForm?.text,
      // strength: resource.amount?, // Complex mapping, skipped for brevity in MVP
      status: (resource.status === 'entered-in-error' ? 'recalled' : resource.status) as any,
      createdAt: new Date(resource.meta?.lastUpdated || Date.now()),
      updatedAt: new Date(resource.meta?.lastUpdated || Date.now()),
    };
  }
}

export const medicationRepository = new MedicationRepository();
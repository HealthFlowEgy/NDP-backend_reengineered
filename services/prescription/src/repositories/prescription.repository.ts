import { FHIRGatewayClient } from '../../../../shared/clients/fhir-gateway.client.js';
import { PrescriptionRecord, PrescriptionStatus, SignatureRecord, AIValidationResult } from '../../../../shared/types/ndp.types.js';
import { MedicationRequest } from '../../../../shared/types/fhir.types.js';
import { createLogger, NDPError, ErrorCodes } from '../../../../shared/utils/index.js';

const logger = createLogger('prescription-service:repository');

export interface CreatePrescriptionData {
  patientNationalId: string;
  patientName?: string;
  prescriberLicense: string;
  prescriberName?: string;
  facilityId?: string;
  facilityName?: string;
  allowedDispenses: number;
  expiresAt?: Date;
  fhirResource: MedicationRequest;
  aiValidation?: AIValidationResult;
}

export interface SearchPrescriptionsParams {
  patientNationalId?: string;
  prescriptionNumber?: string;
  prescriberLicense?: string;
  status?: PrescriptionStatus | PrescriptionStatus[];
  facilityId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export class PrescriptionRepository {
  private client: FHIRGatewayClient;

  constructor() {
    this.client = new FHIRGatewayClient('MedicationRequest');
  }

  async create(data: CreatePrescriptionData): Promise<PrescriptionRecord> {
    // We send the pure FHIR resource to the Gateway.
    // The Gateway/HAPI will persist it.
    const createdResource = await this.client.create<MedicationRequest>(data.fhirResource, 'SYSTEM_TOKEN'); // TODO: Pass real token
    return this.mapFHIRToRecord(createdResource, data.aiValidation);
  }

  async findById(id: string): Promise<PrescriptionRecord | null> {
    const resource = await this.client.getById<MedicationRequest>(id, 'SYSTEM_TOKEN');
    if (!resource) return null;
    return this.mapFHIRToRecord(resource);
  }

  async findByNumber(prescriptionNumber: string): Promise<PrescriptionRecord | null> {
    const response = await this.client.search<MedicationRequest>({ identifier: prescriptionNumber }, 'SYSTEM_TOKEN');
    if (!response.entry || response.entry.length === 0) return null;
    return this.mapFHIRToRecord(response.entry[0].resource);
  }

  async search(params: SearchPrescriptionsParams): Promise<{ records: PrescriptionRecord[]; total: number }> {
    const query: Record<string, string> = {};
    if (params.patientNationalId) query['subject'] = params.patientNationalId; // Ideally identifier search
    if (params.prescriptionNumber) query['identifier'] = params.prescriptionNumber;
    if (params.prescriberLicense) query['requester'] = params.prescriberLicense;
    if (params.status) query['status'] = Array.isArray(params.status) ? params.status.join(',') : params.status;
    
    // Date handling logic for FHIR search would go here (e.g. authoredon=ge2023...)
    
    const response = await this.client.search<MedicationRequest>(query, 'SYSTEM_TOKEN');
    
    const records = (response.entry || []).map(e => this.mapFHIRToRecord(e.resource));
    return { records, total: response.total || records.length };
  }

  async update(id: string, updates: Partial<PrescriptionRecord> & { fhirResource?: MedicationRequest }): Promise<PrescriptionRecord | null> {
    // Fetch current to merge if fhirResource not fully provided (though Service usually provides full)
    let resource = updates.fhirResource;
    if (!resource) {
      resource = await this.client.getById<MedicationRequest>(id, 'SYSTEM_TOKEN');
      if (!resource) return null;
    }

    // Apply updates to resource if needed (e.g. status)
    if (updates.status) {
      resource.status = updates.status as any; // Map back to FHIR status if needed
    }

    const updatedResource = await this.client.update<MedicationRequest>(id, resource, 'SYSTEM_TOKEN');
    return this.mapFHIRToRecord(updatedResource);
  }

  async findActiveByPatient(patientNationalId: string): Promise<PrescriptionRecord[]> {
    // FHIR Search: status=active,on-hold & subject=...
    const response = await this.client.search<MedicationRequest>({
      status: 'active,on-hold',
      subject: patientNationalId
    }, 'SYSTEM_TOKEN');
    
    return (response.entry || []).map(e => this.mapFHIRToRecord(e.resource));
  }

  async decrementDispenses(id: string, updateStatus?: PrescriptionStatus): Promise<PrescriptionRecord | null> {
    const resource = await this.client.getById<MedicationRequest>(id, 'SYSTEM_TOKEN');
    if (!resource) return null;

    if (resource.dispenseRequest) {
      resource.dispenseRequest.numberOfRepeatsAllowed = (resource.dispenseRequest.numberOfRepeatsAllowed || 0) - 1;
    }

    if (updateStatus) {
      resource.status = updateStatus as any;
    }

    const updated = await this.client.update<MedicationRequest>(id, resource, 'SYSTEM_TOKEN');
    return this.mapFHIRToRecord(updated);
  }

  // Helper to map FHIR back to our legacy internal record
  private mapFHIRToRecord(resource: MedicationRequest, aiValidation?: AIValidationResult): PrescriptionRecord {
    const id = resource.id || '';
    const prescriptionNumber = resource.identifier?.find(i => i.system?.includes('prescription-id'))?.value || resource.identifier?.[0]?.value || '';
    
    // Extract Extensions
    const aiValExt = resource.extension?.find(e => e.url?.includes('ai-validation'));
    // If we passed aiValidation explicitly (create), use it. Otherwise try to parse from extension if we store it there.
    // For now, we might lose aiValidation if not stored in FHIR. 
    // Ideally, AI Validation results should be stored as a Provenance or RiskAssessment resource linked to this.
    // For MVP refactor, we accept it might be missing on fetch if not persisted in FHIR.

    return {
      id,
      prescriptionNumber,
      fhirResource: resource,
      status: resource.status as PrescriptionStatus,
      patientNationalId: resource.subject?.identifier?.value || 'UNKNOWN',
      patientName: resource.subject?.display,
      prescriberLicense: resource.requester?.identifier?.value || '',
      prescriberName: resource.requester?.display,
      allowedDispenses: resource.dispenseRequest?.numberOfRepeatsAllowed || 1,
      remainingDispenses: resource.dispenseRequest?.numberOfRepeatsAllowed || 0, // This logic needs to be robust (calculated field?)
      createdAt: new Date(resource.authoredOn || Date.now()),
      updatedAt: new Date(resource.meta?.lastUpdated || Date.now()),
      expiresAt: resource.dispenseRequest?.validityPeriod?.end ? new Date(resource.dispenseRequest.validityPeriod.end) : undefined,
      aiValidation: aiValidation // Temporary
    };
  }
}

export const prescriptionRepository = new PrescriptionRepository();
import { medicationRepository } from '../repositories/medication.repository.js';
import { MedicationRecord, NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';
import { paginate } from '../../../../shared/utils/index.js';

export class MedicationService {
  
  async getMedication(edaCode: string): Promise<MedicationRecord> {
    const med = await medicationRepository.findByEdaCode(edaCode);
    if (!med) throw new NDPError(ErrorCodes.MEDICATION_NOT_FOUND, 'Medication not found', 404);
    return med;
  }
  
  async getMedicationById(id: string): Promise<MedicationRecord> {
    const med = await medicationRepository.findById(id);
    if (!med) throw new NDPError(ErrorCodes.MEDICATION_NOT_FOUND, 'Medication not found', 404);
    return med;
  }
  
  async searchMedications(params: { query?: string; edaCode?: string; status?: string; limit?: number; offset?: number }) {
    const { records, total } = await medicationRepository.search(params);
    return paginate(records, total, params.limit || 20, params.offset || 0);
  }
  
  async validateMedications(edaCodes: string[]): Promise<{ valid: boolean; medications: MedicationRecord[]; errors: string[] }> {
    // In efficient implementation, we'd search WHERE code IN (...)
    // For now, loop (HAPI supports comma-separated token search, repository could be optimized)
    const medications: MedicationRecord[] = [];
    
    // TODO: Optimize to single bulk query
    for (const code of edaCodes) {
      const med = await medicationRepository.findByEdaCode(code);
      if (med) medications.push(med);
    }

    const foundCodes = new Set(medications.map(m => m.edaCode));
    const errors: string[] = [];
    
    for (const code of edaCodes) {
      if (!foundCodes.has(code)) errors.push(`Medication ${code} not found`);
    }
    
    for (const med of medications) {
      if (med.status === 'recalled') errors.push(`Medication ${med.edaCode} (${med.commercialName}) has been recalled`);
      if (med.status === 'inactive') errors.push(`Medication ${med.edaCode} (${med.commercialName}) is inactive`);
    }
    
    return { valid: errors.length === 0, medications, errors };
  }
  
  async recallMedication(edaCode: string, reason: string, batchNumbers?: string[]): Promise<MedicationRecord> {
    // Logic: Status -> entered-in-error (or similar for recall in FHIR)
    const med = await medicationRepository.updateStatus(edaCode, 'entered-in-error', reason);
    if (!med) throw new NDPError(ErrorCodes.MEDICATION_NOT_FOUND, 'Medication not found', 404);
    return med;
  }
  
  async reactivateMedication(edaCode: string): Promise<MedicationRecord> {
    const med = await medicationRepository.updateStatus(edaCode, 'active');
    if (!med) throw new NDPError(ErrorCodes.MEDICATION_NOT_FOUND, 'Medication not found', 404);
    return med;
  }
}

export const medicationService = new MedicationService();

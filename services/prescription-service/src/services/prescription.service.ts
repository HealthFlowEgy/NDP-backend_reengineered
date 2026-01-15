/**
 * Prescription Service - Business Logic
 */

import { 
  PrescriptionRecord, 
  CreatePrescriptionRequest, 
  CreatePrescriptionResponse,
  SignPrescriptionResponse,
  SearchPrescriptionsRequest,
  AIValidationResult,
  NDPError,
  ErrorCodes,
  AuthUser
} from '../../../../shared/types/ndp.types.js';
import { MedicationRequest } from '../../../../shared/types/fhir.types.js';
import { EgyptianConstants } from '../../../../shared/config/index.js';
import { 
  createLogger, 
  assertValidNationalId, 
  assertValidEdaCode,
  toFHIRInstant,
  addDays,
  hashDocument,
  paginate,
  sanitizeForLogging
} from '../../../../shared/utils/index.js';
import { 
  prescriptionRepository, 
  CreatePrescriptionData,
  SearchPrescriptionsParams 
} from '../repositories/prescription.repository.js';
import { 
  buildMedicationRequest, 
  updateMedicationRequestStatus,
  addSignatureToMedicationRequest,
  MedicationInfo 
} from '../builders/medication-request.builder.js';

const logger = createLogger('prescription-service:service');

export class PrescriptionService {
  
  /**
   * Create a new prescription (draft status)
   */
  async createPrescription(
    request: CreatePrescriptionRequest,
    prescriber: AuthUser
  ): Promise<CreatePrescriptionResponse> {
    logger.info('Creating prescription', sanitizeForLogging({ 
      patientNationalId: request.patientNationalId,
      medicationCount: request.medications.length,
      prescriberLicense: prescriber.license
    }));
    
    // Validate patient national ID
    assertValidNationalId(request.patientNationalId);
    
    // Validate medications
    if (!request.medications || request.medications.length === 0) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'At least one medication is required', 400);
    }
    
    // Validate each medication EDA code
    for (const med of request.medications) {
      assertValidEdaCode(med.edaCode);
    }
    
    // TODO: Fetch medication details from medication directory service
    // For now, use provided data
    const medicationInfos: MedicationInfo[] = request.medications.map(med => ({
      edaCode: med.edaCode,
      commercialName: med.medicationName || med.edaCode,
    }));
    
    // TODO: Call AI validation service if enabled
    let aiValidation: AIValidationResult | undefined;
    if (!request.skipAIValidation) {
      // aiValidation = await this.validateWithAI(request.medications, request.patientNationalId);
    }
    
    // Generate prescription number
    const prescriptionNumber = `RX-${new Date().getFullYear()}-${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
    
    // Build FHIR MedicationRequest
    const fhirResource = buildMedicationRequest({
      prescriptionNumber,
      request,
      prescriber,
      medications: medicationInfos,
    });
    
    // Calculate expiry date
    const validityDays = request.validityDays || EgyptianConstants.DEFAULT_PRESCRIPTION_VALIDITY_DAYS;
    const expiresAt = addDays(new Date(), validityDays);
    
    // Create prescription record
    const createData: CreatePrescriptionData = {
      patientNationalId: request.patientNationalId,
      patientName: request.patientName,
      prescriberLicense: prescriber.license,
      prescriberName: prescriber.name,
      facilityId: prescriber.facilityId,
      facilityName: prescriber.facilityName,
      allowedDispenses: request.allowedDispenses || EgyptianConstants.DEFAULT_ALLOWED_DISPENSES,
      expiresAt,
      fhirResource,
      aiValidation,
    };
    
    const record = await prescriptionRepository.create(createData);
    
    logger.info('Prescription created', { 
      id: record.id, 
      prescriptionNumber: record.prescriptionNumber,
      status: record.status 
    });
    
    // TODO: Publish event to Kafka
    // await this.publishEvent('prescription.created', record);
    
    return {
      id: record.id,
      prescriptionNumber: record.prescriptionNumber,
      status: record.status,
      fhirResource: record.fhirResource,
      aiValidation: record.aiValidation,
      createdAt: record.createdAt.toISOString(),
    };
  }
  
  /**
   * Sign a prescription (changes status from draft to active)
   */
  async signPrescription(
    prescriptionId: string,
    prescriber: AuthUser
  ): Promise<SignPrescriptionResponse> {
    logger.info('Signing prescription', { prescriptionId, prescriberLicense: prescriber.license });
    
    // Get prescription
    const prescription = await prescriptionRepository.findById(prescriptionId);
    if (!prescription) {
      throw new NDPError(ErrorCodes.PRESCRIPTION_NOT_FOUND, 'Prescription not found', 404);
    }
    
    // Verify prescriber owns this prescription
    if (prescription.prescriberLicense !== prescriber.license) {
      throw new NDPError(ErrorCodes.FORBIDDEN, 'You can only sign your own prescriptions', 403);
    }
    
    // Verify prescription is in draft status
    if (prescription.status !== 'draft') {
      throw new NDPError(
        ErrorCodes.PRESCRIPTION_ALREADY_SIGNED, 
        `Prescription is already ${prescription.status}`, 
        400
      );
    }
    
    // Generate document hash
    const documentHash = hashDocument(prescription.fhirResource);
    
    // TODO: Call Sunbird RC signing service
    // For now, simulate signing
    const signedAt = toFHIRInstant(new Date());
    const signatureData = {
      data: Buffer.from(`SIGNATURE:${documentHash}:${prescriber.license}:${signedAt}`).toString('base64'),
      algorithm: 'RS256',
      signerLicense: prescriber.license,
      signerName: prescriber.name,
      signedAt,
    };
    
    // Update FHIR resource with signature
    const signedFhirResource = addSignatureToMedicationRequest(
      prescription.fhirResource,
      signatureData
    );
    
    // Update prescription in database
    const signatureRecord = {
      signatureData: signatureData.data,
      algorithm: signatureData.algorithm,
      certificateId: `CERT-${prescriber.license}`,
      signedAt: signatureData.signedAt,
      signerLicense: prescriber.license,
      signerName: prescriber.name,
      documentHash,
    };
    
    const updated = await prescriptionRepository.update(prescriptionId, {
      status: 'active',
      signature: signatureRecord,
      signedAt: new Date(),
      fhirResource: signedFhirResource,
    });
    
    if (!updated) {
      throw new NDPError(ErrorCodes.INTERNAL_ERROR, 'Failed to update prescription', 500);
    }
    
    logger.info('Prescription signed', { 
      id: updated.id, 
      prescriptionNumber: updated.prescriptionNumber,
      status: updated.status 
    });
    
    // TODO: Publish event to Kafka
    // await this.publishEvent('prescription.signed', updated);
    
    return {
      id: updated.id,
      prescriptionNumber: updated.prescriptionNumber,
      status: updated.status,
      signature: signatureRecord,
      signedAt: signatureRecord.signedAt,
    };
  }
  
  /**
   * Get prescription by ID
   */
  async getPrescription(prescriptionId: string): Promise<PrescriptionRecord> {
    const prescription = await prescriptionRepository.findById(prescriptionId);
    if (!prescription) {
      throw new NDPError(ErrorCodes.PRESCRIPTION_NOT_FOUND, 'Prescription not found', 404);
    }
    return prescription;
  }
  
  /**
   * Get prescription by prescription number
   */
  async getPrescriptionByNumber(prescriptionNumber: string): Promise<PrescriptionRecord> {
    const prescription = await prescriptionRepository.findByNumber(prescriptionNumber);
    if (!prescription) {
      throw new NDPError(ErrorCodes.PRESCRIPTION_NOT_FOUND, 'Prescription not found', 404);
    }
    return prescription;
  }
  
  /**
   * Search prescriptions
   */
  async searchPrescriptions(params: SearchPrescriptionsRequest) {
    const searchParams: SearchPrescriptionsParams = {
      patientNationalId: params.patientNationalId,
      prescriptionNumber: params.prescriptionNumber,
      prescriberLicense: params.prescriberLicense,
      status: params.status,
      fromDate: params.fromDate ? new Date(params.fromDate) : undefined,
      toDate: params.toDate ? new Date(params.toDate) : undefined,
      limit: params.limit || 20,
      offset: params.offset || 0,
    };
    
    const { records, total } = await prescriptionRepository.search(searchParams);
    
    return paginate(records, total, searchParams.limit!, searchParams.offset!);
  }
  
  /**
   * Get active prescriptions for a patient (for pharmacist dispensing)
   */
  async getActivePrescriptionsForPatient(patientNationalId: string): Promise<PrescriptionRecord[]> {
    assertValidNationalId(patientNationalId);
    return prescriptionRepository.findActiveByPatient(patientNationalId);
  }
  
  /**
   * Cancel a prescription
   */
  async cancelPrescription(
    prescriptionId: string,
    prescriber: AuthUser,
    reason?: string
  ): Promise<PrescriptionRecord> {
    logger.info('Cancelling prescription', { prescriptionId, prescriberLicense: prescriber.license });
    
    const prescription = await prescriptionRepository.findById(prescriptionId);
    if (!prescription) {
      throw new NDPError(ErrorCodes.PRESCRIPTION_NOT_FOUND, 'Prescription not found', 404);
    }
    
    // Verify prescriber owns this prescription
    if (prescription.prescriberLicense !== prescriber.license) {
      throw new NDPError(ErrorCodes.FORBIDDEN, 'You can only cancel your own prescriptions', 403);
    }
    
    // Can only cancel draft or active prescriptions
    if (!['draft', 'active'].includes(prescription.status)) {
      throw new NDPError(
        ErrorCodes.INVALID_REQUEST, 
        `Cannot cancel prescription with status ${prescription.status}`, 
        400
      );
    }
    
    // Update FHIR resource
    const updatedFhirResource = updateMedicationRequestStatus(prescription.fhirResource, 'cancelled');
    
    const updated = await prescriptionRepository.update(prescriptionId, {
      status: 'cancelled',
      fhirResource: updatedFhirResource,
    });
    
    if (!updated) {
      throw new NDPError(ErrorCodes.INTERNAL_ERROR, 'Failed to cancel prescription', 500);
    }
    
    logger.info('Prescription cancelled', { id: updated.id, prescriptionNumber: updated.prescriptionNumber });
    
    // TODO: Publish event to Kafka
    // await this.publishEvent('prescription.cancelled', updated);
    
    return updated;
  }
  
  /**
   * Verify prescription can be dispensed
   */
  async verifyDispensable(prescriptionId: string): Promise<{ 
    canDispense: boolean; 
    reason?: string; 
    prescription?: PrescriptionRecord 
  }> {
    const prescription = await prescriptionRepository.findById(prescriptionId);
    
    if (!prescription) {
      return { canDispense: false, reason: 'Prescription not found' };
    }
    
    if (prescription.status !== 'active' && prescription.status !== 'on-hold') {
      return { canDispense: false, reason: `Prescription status is ${prescription.status}` };
    }
    
    if (prescription.remainingDispenses <= 0) {
      return { canDispense: false, reason: 'No dispenses remaining' };
    }
    
    if (prescription.expiresAt && prescription.expiresAt < new Date()) {
      return { canDispense: false, reason: 'Prescription has expired' };
    }
    
    return { canDispense: true, prescription };
  }
  
  /**
   * Decrement dispenses after successful dispense
   */
  async recordDispense(prescriptionId: string, isPartial: boolean): Promise<PrescriptionRecord> {
    const newStatus = isPartial ? 'on-hold' : undefined;
    const updated = await prescriptionRepository.decrementDispenses(prescriptionId, newStatus);
    
    if (!updated) {
      throw new NDPError(ErrorCodes.PRESCRIPTION_NOT_FOUND, 'Prescription not found', 404);
    }
    
    return updated;
  }
}

export const prescriptionService = new PrescriptionService();

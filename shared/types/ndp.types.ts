/**
 * NDP-Specific Type Definitions
 * National Digital Prescription Platform - Egypt
 */

import { 
  MedicationRequest, 
  MedicationDispense, 
  MedicationKnowledge,
  Provenance,
  Signature,
  CodeableConcept,
  Reference,
  FHIRDateTime,
  FHIRInstant
} from './fhir.types.js';

// ============================================================================
// Prescription Status Lifecycle
// ============================================================================

export type PrescriptionStatus = 
  | 'draft'        // Created but not signed
  | 'active'       // Signed and ready for dispensing
  | 'on-hold'      // Partially dispensed, awaiting next dispense
  | 'completed'    // All dispenses completed
  | 'cancelled'    // Cancelled by prescriber
  | 'entered-in-error'; // Rejected by AI or regulator

export type DispenseStatus =
  | 'preparation'  // Being prepared
  | 'in-progress'  // Dispensing in progress
  | 'completed'    // Dispense completed
  | 'cancelled'    // Dispense cancelled
  | 'declined';    // Pharmacist declined

// ============================================================================
// Database Models
// ============================================================================

export interface PrescriptionRecord {
  id: string;
  prescriptionNumber: string;
  fhirResource: MedicationRequest;
  status: PrescriptionStatus;
  patientNationalId: string;
  patientName?: string;
  prescriberLicense: string;
  prescriberName?: string;
  facilityId?: string;
  facilityName?: string;
  allowedDispenses: number;
  remainingDispenses: number;
  signature?: SignatureRecord;
  aiValidation?: AIValidationResult;
  createdAt: Date;
  updatedAt: Date;
  signedAt?: Date;
  expiresAt?: Date;
}

export interface DispenseRecord {
  id: string;
  prescriptionId: string;
  prescriptionNumber: string;
  fhirResource: MedicationDispense;
  status: DispenseStatus;
  pharmacistLicense: string;
  pharmacistName?: string;
  pharmacyId: string;
  pharmacyName?: string;
  dispenseNumber: number;
  isPartial: boolean;
  dispensedItems: DispensedItem[];
  signature?: SignatureRecord;
  createdAt: Date;
  completedAt?: Date;
}

export interface MedicationRecord {
  id: string;
  edaCode: string;
  fhirResource: MedicationKnowledge;
  commercialName: string;
  genericName?: string;
  manufacturer?: string;
  doseForm?: string;
  strength?: string;
  packagingInfo?: string;
  status: 'active' | 'inactive' | 'recalled';
  recalledAt?: Date;
  recallReason?: string;
  recallBatchNumbers?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SignatureRecord {
  signatureData: string;
  algorithm: string;
  certificateId: string;
  signedAt: FHIRInstant;
  signerLicense: string;
  signerName: string;
  documentHash: string;
}

export interface DispensedItem {
  medicationCode: string;
  medicationName: string;
  prescribedQuantity: number;
  dispensedQuantity: number;
  remainingQuantity: number;
  batchNumber?: string;
  expiryDate?: string;
  notes?: string;
}

// ============================================================================
// AI Validation
// ============================================================================

export interface AIValidationResult {
  validated: boolean;
  validatedAt: FHIRDateTime;
  overallScore: number;
  passed: boolean;
  warnings: AIValidationWarning[];
  errors: AIValidationError[];
  drugInteractions: DrugInteraction[];
  dosingAlerts: DosingAlert[];
}

export interface AIValidationWarning {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  medicationCodes?: string[];
}

export interface AIValidationError {
  code: string;
  message: string;
  medicationCodes?: string[];
}

export interface DrugInteraction {
  drug1Code: string;
  drug1Name: string;
  drug2Code: string;
  drug2Name: string;
  severity: 'minor' | 'moderate' | 'major' | 'contraindicated';
  description: string;
  recommendation: string;
}

export interface DosingAlert {
  medicationCode: string;
  medicationName: string;
  alertType: 'overdose' | 'underdose' | 'frequency' | 'duration' | 'renal' | 'hepatic' | 'age';
  message: string;
  recommendedDose?: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreatePrescriptionRequest {
  patientNationalId: string;
  patientName?: string;
  medications: PrescriptionMedication[];
  diagnosis?: CodeableConcept[];
  notes?: string;
  allowedDispenses?: number;
  validityDays?: number;
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  skipAIValidation?: boolean;
}

export interface PrescriptionMedication {
  edaCode: string;
  medicationName?: string;
  quantity: number;
  unit: string;
  dosageInstruction: string;
  frequency?: string;
  duration?: string;
  route?: string;
  asNeeded?: boolean;
  notes?: string;
}

export interface CreatePrescriptionResponse {
  id: string;
  prescriptionNumber: string;
  status: PrescriptionStatus;
  fhirResource: MedicationRequest;
  aiValidation?: AIValidationResult;
  createdAt: string;
}

export interface SignPrescriptionRequest {
  prescriptionId: string;
}

export interface SignPrescriptionResponse {
  id: string;
  prescriptionNumber: string;
  status: PrescriptionStatus;
  signature: SignatureRecord;
  signedAt: string;
}

export interface CreateDispenseRequest {
  prescriptionId?: string;
  prescriptionNumber?: string;
  patientNationalId?: string;
  pharmacyId: string;
  pharmacyName?: string;
  dispensedItems: DispenseItemRequest[];
  notes?: string;
}

export interface DispenseItemRequest {
  medicationCode: string;
  dispensedQuantity: number;
  batchNumber?: string;
  expiryDate?: string;
  substitutedFor?: string;
  notes?: string;
}

export interface CreateDispenseResponse {
  id: string;
  prescriptionId: string;
  prescriptionNumber: string;
  dispenseNumber: number;
  status: DispenseStatus;
  isPartial: boolean;
  fhirResource: MedicationDispense;
  prescriptionStatus: PrescriptionStatus;
  remainingDispenses: number;
  createdAt: string;
}

export interface SearchPrescriptionsRequest {
  patientNationalId?: string;
  prescriptionNumber?: string;
  prescriberLicense?: string;
  status?: PrescriptionStatus | PrescriptionStatus[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface SearchMedicationsRequest {
  query?: string;
  edaCode?: string;
  name?: string;
  status?: 'active' | 'inactive' | 'recalled';
  limit?: number;
  offset?: number;
}

export interface RecallMedicationRequest {
  edaCode: string;
  reason: string;
  batchNumbers?: string[];
  effectiveDate?: string;
}

// ============================================================================
// Authentication & Authorization
// ============================================================================

export interface AuthUser {
  id: string;
  license: string;
  name: string;
  role: UserRole;
  specialty?: string;
  facilityId?: string;
  facilityName?: string;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
}

export type UserRole = 
  | 'physician'
  | 'pharmacist'
  | 'nurse'
  | 'regulator'
  | 'admin'
  | 'integrator';

export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
}

// ============================================================================
// Event Types (Kafka)
// ============================================================================

export interface PrescriptionEvent {
  eventType: 'prescription.created' | 'prescription.signed' | 'prescription.cancelled' | 'prescription.expired';
  prescriptionId: string;
  prescriptionNumber: string;
  patientNationalId: string;
  prescriberLicense: string;
  status: PrescriptionStatus;
  timestamp: FHIRInstant;
  metadata?: Record<string, unknown>;
}

export interface DispenseEvent {
  eventType: 'dispense.created' | 'dispense.completed' | 'dispense.cancelled';
  dispenseId: string;
  prescriptionId: string;
  prescriptionNumber: string;
  pharmacistLicense: string;
  pharmacyId: string;
  dispenseNumber: number;
  isPartial: boolean;
  timestamp: FHIRInstant;
  metadata?: Record<string, unknown>;
}

export interface MedicationEvent {
  eventType: 'medication.created' | 'medication.updated' | 'medication.recalled' | 'medication.reactivated';
  medicationId: string;
  edaCode: string;
  commercialName: string;
  status: 'active' | 'inactive' | 'recalled';
  timestamp: FHIRInstant;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent {
  eventType: string;
  action: 'C' | 'R' | 'U' | 'D'; // Create, Read, Update, Delete
  outcome: 'success' | 'failure';
  userId: string;
  userRole: UserRole;
  resourceType: string;
  resourceId?: string;
  patientNationalId?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: FHIRInstant;
  details?: Record<string, unknown>;
}

// ============================================================================
// API Error Types
// ============================================================================

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
  path?: string;
  requestId?: string;
}

export class NDPError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number = 400, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'NDPError';
  }
}

// Error codes
export const ErrorCodes = {
  // Validation errors
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_PATIENT_ID: 'INVALID_PATIENT_ID',
  INVALID_MEDICATION: 'INVALID_MEDICATION',
  MEDICATION_NOT_FOUND: 'MEDICATION_NOT_FOUND',
  MEDICATION_RECALLED: 'MEDICATION_RECALLED',
  
  // Prescription errors
  PRESCRIPTION_NOT_FOUND: 'PRESCRIPTION_NOT_FOUND',
  PRESCRIPTION_ALREADY_SIGNED: 'PRESCRIPTION_ALREADY_SIGNED',
  PRESCRIPTION_NOT_ACTIVE: 'PRESCRIPTION_NOT_ACTIVE',
  PRESCRIPTION_EXPIRED: 'PRESCRIPTION_EXPIRED',
  PRESCRIPTION_NO_DISPENSES_LEFT: 'PRESCRIPTION_NO_DISPENSES_LEFT',
  
  // Dispense errors
  DISPENSE_NOT_FOUND: 'DISPENSE_NOT_FOUND',
  DISPENSE_INVALID_QUANTITY: 'DISPENSE_INVALID_QUANTITY',
  DISPENSE_ALREADY_COMPLETED: 'DISPENSE_ALREADY_COMPLETED',
  
  // Auth errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  
  // Signature errors
  SIGNATURE_FAILED: 'SIGNATURE_FAILED',
  SIGNATURE_VERIFICATION_FAILED: 'SIGNATURE_VERIFICATION_FAILED',
  CERTIFICATE_NOT_FOUND: 'CERTIFICATE_NOT_FOUND',
  CERTIFICATE_EXPIRED: 'CERTIFICATE_EXPIRED',
  
  // AI Validation errors
  AI_VALIDATION_FAILED: 'AI_VALIDATION_FAILED',
  AI_SERVICE_UNAVAILABLE: 'AI_SERVICE_UNAVAILABLE',
  DRUG_INTERACTION_DETECTED: 'DRUG_INTERACTION_DETECTED',
  
  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/**
 * FHIR MedicationRequest Builder
 * Constructs FHIR-compliant prescription resources
 */

import { 
  MedicationRequest, 
  Dosage, 
  CodeableConcept,
  Reference,
  Identifier,
  Annotation
} from '../../../../shared/types/fhir.types.js';
import { 
  CreatePrescriptionRequest, 
  PrescriptionMedication,
  AuthUser 
} from '../../../../shared/types/ndp.types.js';
import { 
  EgyptianConstants 
} from '../../../../shared/config/index.js';
import {
  generateUUID,
  toFHIRDateTime,
  addDays,
  createFHIRReference,
  createFHIRCodeableConcept,
  createFHIRIdentifier,
  createFHIRQuantity,
} from '../../../../shared/utils/index.js';

export interface BuildMedicationRequestParams {
  prescriptionNumber: string;
  request: CreatePrescriptionRequest;
  prescriber: AuthUser;
  medications: MedicationInfo[];
}

export interface MedicationInfo {
  edaCode: string;
  commercialName: string;
  genericName?: string;
  doseForm?: string;
  strength?: string;
}

/**
 * Build a FHIR MedicationRequest resource from prescription request
 */
export function buildMedicationRequest(params: BuildMedicationRequestParams): MedicationRequest {
  const { prescriptionNumber, request, prescriber, medications } = params;
  const now = new Date();
  const validityDays = request.validityDays || EgyptianConstants.DEFAULT_PRESCRIPTION_VALIDITY_DAYS;
  const expiresAt = addDays(now, validityDays);
  
  // Build identifiers
  const identifiers: Identifier[] = [
    createFHIRIdentifier(
      EgyptianConstants.CODING_SYSTEMS.NDP_PRESCRIPTION,
      prescriptionNumber,
      'official'
    ),
  ];
  
  // Build subject (patient) reference
  const subject: Reference = {
    type: 'Patient',
    identifier: createFHIRIdentifier(
      'http://mohp.gov.eg/national-id',
      request.patientNationalId,
      'official'
    ),
    display: request.patientName,
  };
  
  // Build requester (prescriber) reference
  const requester: Reference = createFHIRReference(
    'Practitioner',
    prescriber.license,
    prescriber.name
  );
  
  // Build medication and dosage instructions
  const medicationCodeableConcept = buildMedicationCoding(request.medications, medications);
  const dosageInstructions = buildDosageInstructions(request.medications, medications);
  
  // Build dispense request
  const dispenseRequest = {
    validityPeriod: {
      start: toFHIRDateTime(now),
      end: toFHIRDateTime(expiresAt),
    },
    numberOfRepeatsAllowed: (request.allowedDispenses || EgyptianConstants.DEFAULT_ALLOWED_DISPENSES) - 1,
    quantity: {
      value: request.medications.reduce((sum, m) => sum + m.quantity, 0),
      unit: 'unit',
    },
    expectedSupplyDuration: {
      value: validityDays,
      unit: 'd',
      system: EgyptianConstants.CODING_SYSTEMS.UCUM,
      code: 'd',
    },
  };
  
  // Build notes
  const notes: Annotation[] = [];
  if (request.notes) {
    notes.push({
      time: toFHIRDateTime(now),
      text: request.notes,
      authorReference: requester,
    });
  }
  
  // Build reason codes (diagnosis)
  const reasonCode: CodeableConcept[] = request.diagnosis || [];
  
  // Construct the MedicationRequest
  const medicationRequest: MedicationRequest = {
    resourceType: 'MedicationRequest',
    id: generateUUID(),
    meta: {
      profile: ['http://ndp.egypt.gov.eg/fhir/StructureDefinition/NDPMedicationRequest'],
      lastUpdated: toFHIRDateTime(now),
    },
    identifier: identifiers,
    status: 'draft',
    intent: 'order',
    priority: request.priority || 'routine',
    medicationCodeableConcept,
    subject,
    authoredOn: toFHIRDateTime(now),
    requester,
    reasonCode,
    note: notes.length > 0 ? notes : undefined,
    dosageInstruction: dosageInstructions,
    dispenseRequest,
    substitution: {
      allowedBoolean: true,
      reason: createFHIRCodeableConcept(
        'http://terminology.hl7.org/CodeSystem/v3-ActReason',
        'FP',
        'Formulary Policy'
      ),
    },
  };
  
  return medicationRequest;
}

/**
 * Build medication coding for multiple medications
 */
function buildMedicationCoding(
  requestMeds: PrescriptionMedication[],
  medicationInfos: MedicationInfo[]
): CodeableConcept {
  const codings = requestMeds.map((med, index) => {
    const info = medicationInfos[index];
    return {
      system: EgyptianConstants.CODING_SYSTEMS.EDA,
      code: med.edaCode,
      display: info?.commercialName || med.medicationName || med.edaCode,
    };
  });
  
  const primaryMed = medicationInfos[0];
  const text = requestMeds.length === 1
    ? primaryMed?.commercialName || requestMeds[0]?.medicationName
    : `${requestMeds.length} medications`;
  
  return { coding: codings, text };
}

/**
 * Build dosage instructions for each medication
 */
function buildDosageInstructions(
  requestMeds: PrescriptionMedication[],
  medicationInfos: MedicationInfo[]
): Dosage[] {
  return requestMeds.map((med, index) => {
    const dosage: Dosage = {
      sequence: index + 1,
      text: med.dosageInstruction,
      patientInstruction: med.notes,
    };
    
    if (med.frequency) {
      dosage.timing = parseFrequencyToTiming(med.frequency);
    }
    
    if (med.duration) {
      if (!dosage.timing) dosage.timing = {};
      dosage.timing.repeat = { ...dosage.timing.repeat, ...parseDurationToRepeat(med.duration) };
    }
    
    if (med.route) {
      dosage.route = parseRouteToCodeableConcept(med.route);
    }
    
    if (med.asNeeded) {
      dosage.asNeededBoolean = true;
    }
    
    dosage.doseAndRate = [{
      type: createFHIRCodeableConcept(
        'http://terminology.hl7.org/CodeSystem/dose-rate-type',
        'ordered',
        'Ordered'
      ),
      doseQuantity: createFHIRQuantity(med.quantity, med.unit),
    }];
    
    return dosage;
  });
}

/**
 * Parse frequency string to FHIR Timing
 */
function parseFrequencyToTiming(frequency: string): { repeat?: Record<string, unknown>; code?: CodeableConcept } {
  const freqLower = frequency.toLowerCase();
  
  const patterns: Record<string, { frequency: number; period: number; periodUnit: string; code: string; display: string }> = {
    'once daily': { frequency: 1, period: 1, periodUnit: 'd', code: 'QD', display: 'Once daily' },
    'qd': { frequency: 1, period: 1, periodUnit: 'd', code: 'QD', display: 'Once daily' },
    'twice daily': { frequency: 2, period: 1, periodUnit: 'd', code: 'BID', display: 'Twice daily' },
    'bid': { frequency: 2, period: 1, periodUnit: 'd', code: 'BID', display: 'Twice daily' },
    'three times daily': { frequency: 3, period: 1, periodUnit: 'd', code: 'TID', display: 'Three times daily' },
    'tid': { frequency: 3, period: 1, periodUnit: 'd', code: 'TID', display: 'Three times daily' },
    'four times daily': { frequency: 4, period: 1, periodUnit: 'd', code: 'QID', display: 'Four times daily' },
    'qid': { frequency: 4, period: 1, periodUnit: 'd', code: 'QID', display: 'Four times daily' },
    'every 4 hours': { frequency: 1, period: 4, periodUnit: 'h', code: 'Q4H', display: 'Every 4 hours' },
    'every 6 hours': { frequency: 1, period: 6, periodUnit: 'h', code: 'Q6H', display: 'Every 6 hours' },
    'every 8 hours': { frequency: 1, period: 8, periodUnit: 'h', code: 'Q8H', display: 'Every 8 hours' },
    'every 12 hours': { frequency: 1, period: 12, periodUnit: 'h', code: 'Q12H', display: 'Every 12 hours' },
    'weekly': { frequency: 1, period: 1, periodUnit: 'wk', code: 'QW', display: 'Weekly' },
    'as needed': { frequency: 1, period: 1, periodUnit: 'd', code: 'PRN', display: 'As needed' },
    'prn': { frequency: 1, period: 1, periodUnit: 'd', code: 'PRN', display: 'As needed' },
  };
  
  const match = patterns[freqLower];
  if (match) {
    return {
      repeat: { frequency: match.frequency, period: match.period, periodUnit: match.periodUnit },
      code: createFHIRCodeableConcept('http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation', match.code, match.display),
    };
  }
  
  return { code: { text: frequency } };
}

/**
 * Parse duration string to timing repeat
 */
function parseDurationToRepeat(duration: string): { boundsPeriod?: { start: string; end: string } } {
  const match = duration.toLowerCase().match(/(\d+)\s*(day|days|week|weeks|month|months)/);
  if (match) {
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    
    let days = value;
    if (unit.startsWith('week')) days = value * 7;
    else if (unit.startsWith('month')) days = value * 30;
    
    const now = new Date();
    return {
      boundsPeriod: { start: toFHIRDateTime(now), end: toFHIRDateTime(addDays(now, days)) },
    };
  }
  return {};
}

/**
 * Parse route string to CodeableConcept
 */
function parseRouteToCodeableConcept(route: string): CodeableConcept {
  const routes: Record<string, { code: string; display: string }> = {
    'oral': { code: '26643006', display: 'Oral route' },
    'po': { code: '26643006', display: 'Oral route' },
    'iv': { code: '47625008', display: 'Intravenous route' },
    'intravenous': { code: '47625008', display: 'Intravenous route' },
    'im': { code: '78421000', display: 'Intramuscular route' },
    'intramuscular': { code: '78421000', display: 'Intramuscular route' },
    'sc': { code: '34206005', display: 'Subcutaneous route' },
    'subcutaneous': { code: '34206005', display: 'Subcutaneous route' },
    'topical': { code: '6064005', display: 'Topical route' },
    'inhalation': { code: '447694001', display: 'Respiratory tract route' },
    'rectal': { code: '37161004', display: 'Rectal route' },
    'sublingual': { code: '37839007', display: 'Sublingual route' },
    'ophthalmic': { code: '54485002', display: 'Ophthalmic route' },
    'otic': { code: '10547007', display: 'Otic route' },
    'nasal': { code: '46713006', display: 'Nasal route' },
  };
  
  const match = routes[route.toLowerCase()];
  if (match) {
    return createFHIRCodeableConcept(EgyptianConstants.CODING_SYSTEMS.SNOMED_CT, match.code, match.display);
  }
  return { text: route };
}

/**
 * Update MedicationRequest status
 */
export function updateMedicationRequestStatus(
  resource: MedicationRequest,
  status: MedicationRequest['status']
): MedicationRequest {
  return {
    ...resource,
    status,
    meta: { ...resource.meta, lastUpdated: toFHIRDateTime(new Date()) },
  };
}

/**
 * Add signature to MedicationRequest as extension
 */
export function addSignatureToMedicationRequest(
  resource: MedicationRequest,
  signature: { data: string; algorithm: string; signerLicense: string; signerName: string; signedAt: string }
): MedicationRequest {
  const signatureExtension = {
    url: 'http://ndp.egypt.gov.eg/fhir/StructureDefinition/prescription-signature',
    valueSignature: {
      type: [{ system: 'urn:iso-astm:E1762-95:2013', code: '1.2.840.10065.1.12.1.1', display: 'Author\'s Signature' }],
      when: signature.signedAt,
      who: createFHIRReference('Practitioner', signature.signerLicense, signature.signerName),
      sigFormat: 'application/jose',
      data: signature.data,
    },
  };
  
  return {
    ...resource,
    status: 'active',
    meta: { ...resource.meta, lastUpdated: toFHIRDateTime(new Date()) },
    extension: [...(resource.extension || []), signatureExtension],
  };
}

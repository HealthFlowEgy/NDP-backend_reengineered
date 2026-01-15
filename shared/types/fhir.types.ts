/**
 * FHIR R4 Type Definitions for NDP Backend
 * National Digital Prescription Platform - Egypt
 * 
 * Simplified types for prescription workflow only
 */

// ============================================================================
// FHIR Primitive Types
// ============================================================================

export type FHIRId = string;
export type FHIRInstant = string;
export type FHIRDateTime = string;
export type FHIRDate = string;
export type FHIRUri = string;
export type FHIRCode = string;
export type FHIRDecimal = number;
export type FHIRPositiveInt = number;
export type FHIRBase64Binary = string;

// ============================================================================
// FHIR Complex Types
// ============================================================================

export interface Identifier {
  use?: 'usual' | 'official' | 'temp' | 'secondary' | 'old';
  type?: CodeableConcept;
  system?: FHIRUri;
  value?: string;
  period?: Period;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Coding {
  system?: FHIRUri;
  version?: string;
  code?: FHIRCode;
  display?: string;
}

export interface Reference {
  reference?: string;
  type?: FHIRUri;
  identifier?: Identifier;
  display?: string;
}

export interface Period {
  start?: FHIRDateTime;
  end?: FHIRDateTime;
}

export interface Quantity {
  value?: FHIRDecimal;
  unit?: string;
  system?: FHIRUri;
  code?: FHIRCode;
}

export interface SimpleQuantity extends Quantity {}

export interface Ratio {
  numerator?: Quantity;
  denominator?: Quantity;
}

export interface Range {
  low?: SimpleQuantity;
  high?: SimpleQuantity;
}

export interface Duration extends Quantity {}

export interface Annotation {
  authorReference?: Reference;
  authorString?: string;
  time?: FHIRDateTime;
  text: string;
}

export interface Dosage {
  sequence?: number;
  text?: string;
  additionalInstruction?: CodeableConcept[];
  patientInstruction?: string;
  timing?: Timing;
  asNeededBoolean?: boolean;
  site?: CodeableConcept;
  route?: CodeableConcept;
  method?: CodeableConcept;
  doseAndRate?: DosageAndRate[];
  maxDosePerPeriod?: Ratio;
  maxDosePerAdministration?: SimpleQuantity;
}

export interface Timing {
  event?: FHIRDateTime[];
  repeat?: TimingRepeat;
  code?: CodeableConcept;
}

export interface TimingRepeat {
  boundsPeriod?: Period;
  count?: FHIRPositiveInt;
  countMax?: FHIRPositiveInt;
  duration?: FHIRDecimal;
  durationUnit?: 's' | 'min' | 'h' | 'd' | 'wk' | 'mo' | 'a';
  frequency?: FHIRPositiveInt;
  frequencyMax?: FHIRPositiveInt;
  period?: FHIRDecimal;
  periodUnit?: 's' | 'min' | 'h' | 'd' | 'wk' | 'mo' | 'a';
  dayOfWeek?: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
  timeOfDay?: string[];
  when?: string[];
}

export interface DosageAndRate {
  type?: CodeableConcept;
  doseRange?: Range;
  doseQuantity?: SimpleQuantity;
  rateRatio?: Ratio;
  rateQuantity?: SimpleQuantity;
}

export interface Signature {
  type: Coding[];
  when: FHIRInstant;
  who: Reference;
  onBehalfOf?: Reference;
  targetFormat?: FHIRCode;
  sigFormat?: FHIRCode;
  data?: FHIRBase64Binary;
}

// ============================================================================
// FHIR Resource Base
// ============================================================================

export interface Meta {
  versionId?: FHIRId;
  lastUpdated?: FHIRInstant;
  source?: FHIRUri;
  profile?: string[];
  security?: Coding[];
  tag?: Coding[];
}

export interface Resource {
  resourceType: string;
  id?: FHIRId;
  meta?: Meta;
}

// ============================================================================
// MedicationRequest (Prescription)
// ============================================================================

export type MedicationRequestStatus = 
  | 'draft'
  | 'active'
  | 'on-hold'
  | 'cancelled'
  | 'completed'
  | 'entered-in-error'
  | 'stopped'
  | 'unknown';

export type MedicationRequestIntent = 
  | 'proposal'
  | 'plan'
  | 'order'
  | 'original-order'
  | 'reflex-order'
  | 'filler-order'
  | 'instance-order'
  | 'option';

export interface MedicationRequest extends Resource {
  resourceType: 'MedicationRequest';
  identifier?: Identifier[];
  status: MedicationRequestStatus;
  statusReason?: CodeableConcept;
  intent: MedicationRequestIntent;
  category?: CodeableConcept[];
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  doNotPerform?: boolean;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  subject: Reference;
  encounter?: Reference;
  supportingInformation?: Reference[];
  authoredOn?: FHIRDateTime;
  requester?: Reference;
  performer?: Reference;
  performerType?: CodeableConcept;
  recorder?: Reference;
  reasonCode?: CodeableConcept[];
  reasonReference?: Reference[];
  instantiatesCanonical?: string[];
  instantiatesUri?: string[];
  basedOn?: Reference[];
  groupIdentifier?: Identifier;
  courseOfTherapyType?: CodeableConcept;
  insurance?: Reference[];
  note?: Annotation[];
  dosageInstruction?: Dosage[];
  dispenseRequest?: MedicationRequestDispenseRequest;
  substitution?: MedicationRequestSubstitution;
  priorPrescription?: Reference;
  detectedIssue?: Reference[];
  eventHistory?: Reference[];
}

export interface MedicationRequestDispenseRequest {
  initialFill?: {
    quantity?: SimpleQuantity;
    duration?: Duration;
  };
  dispenseInterval?: Duration;
  validityPeriod?: Period;
  numberOfRepeatsAllowed?: FHIRPositiveInt;
  quantity?: SimpleQuantity;
  expectedSupplyDuration?: Duration;
  performer?: Reference;
}

export interface MedicationRequestSubstitution {
  allowedBoolean?: boolean;
  allowedCodeableConcept?: CodeableConcept;
  reason?: CodeableConcept;
}

// ============================================================================
// MedicationDispense
// ============================================================================

export type MedicationDispenseStatus =
  | 'preparation'
  | 'in-progress'
  | 'cancelled'
  | 'on-hold'
  | 'completed'
  | 'entered-in-error'
  | 'stopped'
  | 'declined'
  | 'unknown';

export interface MedicationDispense extends Resource {
  resourceType: 'MedicationDispense';
  identifier?: Identifier[];
  partOf?: Reference[];
  status: MedicationDispenseStatus;
  statusReasonCodeableConcept?: CodeableConcept;
  statusReasonReference?: Reference;
  category?: CodeableConcept;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  subject?: Reference;
  context?: Reference;
  supportingInformation?: Reference[];
  performer?: MedicationDispensePerformer[];
  location?: Reference;
  authorizingPrescription?: Reference[];
  type?: CodeableConcept;
  quantity?: SimpleQuantity;
  daysSupply?: SimpleQuantity;
  whenPrepared?: FHIRDateTime;
  whenHandedOver?: FHIRDateTime;
  destination?: Reference;
  receiver?: Reference[];
  note?: Annotation[];
  dosageInstruction?: Dosage[];
  substitution?: MedicationDispenseSubstitution;
  detectedIssue?: Reference[];
  eventHistory?: Reference[];
}

export interface MedicationDispensePerformer {
  function?: CodeableConcept;
  actor: Reference;
}

export interface MedicationDispenseSubstitution {
  wasSubstituted: boolean;
  type?: CodeableConcept;
  reason?: CodeableConcept[];
  responsibleParty?: Reference[];
}

// ============================================================================
// MedicationKnowledge (Drug Directory)
// ============================================================================

export type MedicationKnowledgeStatus = 'active' | 'inactive' | 'entered-in-error';

export interface MedicationKnowledge extends Resource {
  resourceType: 'MedicationKnowledge';
  code?: CodeableConcept;
  status?: MedicationKnowledgeStatus;
  manufacturer?: Reference;
  doseForm?: CodeableConcept;
  amount?: SimpleQuantity;
  synonym?: string[];
  relatedMedicationKnowledge?: MedicationKnowledgeRelatedMedicationKnowledge[];
  associatedMedication?: Reference[];
  productType?: CodeableConcept[];
  monograph?: MedicationKnowledgeMonograph[];
  ingredient?: MedicationKnowledgeIngredient[];
  preparationInstruction?: string;
  intendedRoute?: CodeableConcept[];
  cost?: MedicationKnowledgeCost[];
  monitoringProgram?: MedicationKnowledgeMonitoringProgram[];
  administrationGuidelines?: MedicationKnowledgeAdministrationGuidelines[];
  medicineClassification?: MedicationKnowledgeMedicineClassification[];
  packaging?: MedicationKnowledgePackaging;
  drugCharacteristic?: MedicationKnowledgeDrugCharacteristic[];
  contraindication?: Reference[];
  regulatory?: MedicationKnowledgeRegulatory[];
  kinetics?: MedicationKnowledgeKinetics[];
}

export interface MedicationKnowledgeRelatedMedicationKnowledge {
  type: CodeableConcept;
  reference: Reference[];
}

export interface MedicationKnowledgeMonograph {
  type?: CodeableConcept;
  source?: Reference;
}

export interface MedicationKnowledgeIngredient {
  itemCodeableConcept?: CodeableConcept;
  itemReference?: Reference;
  isActive?: boolean;
  strength?: Ratio;
}

export interface MedicationKnowledgeCost {
  type: CodeableConcept;
  source?: string;
  cost: { value: number; currency: string };
}

export interface MedicationKnowledgeMonitoringProgram {
  type?: CodeableConcept;
  name?: string;
}

export interface MedicationKnowledgeAdministrationGuidelines {
  dosage?: MedicationKnowledgeDosage[];
  indicationCodeableConcept?: CodeableConcept;
  indicationReference?: Reference;
  patientCharacteristics?: MedicationKnowledgePatientCharacteristics[];
}

export interface MedicationKnowledgeDosage {
  type: CodeableConcept;
  dosage: Dosage[];
}

export interface MedicationKnowledgePatientCharacteristics {
  characteristicCodeableConcept?: CodeableConcept;
  characteristicQuantity?: SimpleQuantity;
  value?: string[];
}

export interface MedicationKnowledgeMedicineClassification {
  type: CodeableConcept;
  classification?: CodeableConcept[];
}

export interface MedicationKnowledgePackaging {
  type?: CodeableConcept;
  quantity?: SimpleQuantity;
}

export interface MedicationKnowledgeDrugCharacteristic {
  type?: CodeableConcept;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
  valueQuantity?: SimpleQuantity;
  valueBase64Binary?: string;
}

export interface MedicationKnowledgeRegulatory {
  regulatoryAuthority: Reference;
  substitution?: MedicationKnowledgeSubstitution[];
  schedule?: MedicationKnowledgeSchedule[];
  maxDispense?: MedicationKnowledgeMaxDispense;
}

export interface MedicationKnowledgeSubstitution {
  type: CodeableConcept;
  allowed: boolean;
}

export interface MedicationKnowledgeSchedule {
  schedule: CodeableConcept;
}

export interface MedicationKnowledgeMaxDispense {
  quantity: SimpleQuantity;
  period?: Duration;
}

export interface MedicationKnowledgeKinetics {
  areaUnderCurve?: SimpleQuantity[];
  lethalDose50?: SimpleQuantity[];
  halfLifePeriod?: Duration;
}

// ============================================================================
// Provenance (Digital Signature Metadata)
// ============================================================================

export interface Provenance extends Resource {
  resourceType: 'Provenance';
  target: Reference[];
  occurredPeriod?: Period;
  occurredDateTime?: FHIRDateTime;
  recorded: FHIRInstant;
  policy?: string[];
  location?: Reference;
  reason?: CodeableConcept[];
  activity?: CodeableConcept;
  agent: ProvenanceAgent[];
  entity?: ProvenanceEntity[];
  signature?: Signature[];
}

export interface ProvenanceAgent {
  type?: CodeableConcept;
  role?: CodeableConcept[];
  who: Reference;
  onBehalfOf?: Reference;
}

export interface ProvenanceEntity {
  role: 'derivation' | 'revision' | 'quotation' | 'source' | 'removal';
  what: Reference;
  agent?: ProvenanceAgent[];
}

// ============================================================================
// OperationOutcome (Error Response)
// ============================================================================

export interface OperationOutcome extends Resource {
  resourceType: 'OperationOutcome';
  issue: OperationOutcomeIssue[];
}

export interface OperationOutcomeIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  code: string;
  details?: CodeableConcept;
  diagnostics?: string;
  location?: string[];
  expression?: string[];
}

// ============================================================================
// Bundle
// ============================================================================

export type BundleType = 
  | 'document'
  | 'message'
  | 'transaction'
  | 'transaction-response'
  | 'batch'
  | 'batch-response'
  | 'history'
  | 'searchset'
  | 'collection';

export interface Bundle extends Resource {
  resourceType: 'Bundle';
  identifier?: Identifier;
  type: BundleType;
  timestamp?: FHIRInstant;
  total?: number;
  link?: BundleLink[];
  entry?: BundleEntry[];
  signature?: Signature;
}

export interface BundleLink {
  relation: string;
  url: string;
}

export interface BundleEntry {
  link?: BundleLink[];
  fullUrl?: string;
  resource?: Resource;
  search?: {
    mode?: 'match' | 'include' | 'outcome';
    score?: number;
  };
  request?: {
    method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    ifNoneMatch?: string;
    ifModifiedSince?: string;
    ifMatch?: string;
    ifNoneExist?: string;
  };
  response?: {
    status: string;
    location?: string;
    etag?: string;
    lastModified?: string;
    outcome?: Resource;
  };
}

// ============================================================================
// Egypt NDP Extensions
// ============================================================================

export interface NDPPrescriptionExtension {
  url: 'http://ndp.egypt.gov.eg/fhir/StructureDefinition/prescription-signature';
  valueSignature?: Signature;
}

export interface NDPAIValidationExtension {
  url: 'http://ndp.egypt.gov.eg/fhir/StructureDefinition/ai-validation-result';
  extension?: Array<{
    url: string;
    valueBoolean?: boolean;
    valueString?: string;
    valueCodeableConcept?: CodeableConcept;
  }>;
}

export interface NDPRecallExtension {
  url: 'http://ndp.egypt.gov.eg/fhir/StructureDefinition/medication-recall';
  extension?: Array<{
    url: string;
    valueDateTime?: FHIRDateTime;
    valueString?: string;
    valueBoolean?: boolean;
  }>;
}

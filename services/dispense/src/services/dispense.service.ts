import { DispenseRepository } from '../repositories/dispense.repository.js';
import { MedicationDispense } from '../../../../shared/types/fhir.types.js';
import { CreateDispenseRequest, AuthUser, NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';
import { createFHIRIdentifier, toFHIRDateTime, createFHIRReference, generateUUID } from '../../../../shared/utils/index.js';
import { EgyptianConstants } from '../../../../shared/config/index.js';

export class DispenseService {
  private repo: DispenseRepository;

  constructor() {
    this.repo = new DispenseRepository();
  }

  async createDispense(request: CreateDispenseRequest, pharmacist: AuthUser, token: string): Promise<MedicationDispense> {
    // 1. Business Logic: Validate Dispense Request (Basic Check)
    if (!request.prescriptionId) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Prescription ID is required', 400);
    }

    // 2. Construct FHIR Resource
    // In a real scenario, we'd fetch the Prescription first to validate status/remaining dispenses.
    // For now, we trust the input and let the FHIR Gateway/HAPI enforce referential integrity if configured.
    
    const fhirResource: MedicationDispense = {
      resourceType: 'MedicationDispense',
      id: generateUUID(),
      meta: {
        profile: ['http://ndp.egypt.gov.eg/fhir/StructureDefinition/NDPMedicationDispense'],
        lastUpdated: toFHIRDateTime(new Date()),
      },
      status: 'completed',
      medicationCodeableConcept: {
        coding: request.dispensedItems.map(item => ({
          system: EgyptianConstants.CODING_SYSTEMS.EDA,
          code: item.medicationCode,
          display: item.medicationCode // Ideally fetch name
        }))
      },
      subject: {
        identifier: createFHIRIdentifier('http://mohp.gov.eg/national-id', request.patientNationalId || 'UNKNOWN', 'official')
      },
      authorizingPrescription: [{
        reference: `MedicationRequest/${request.prescriptionId}`
      }],
      performer: [{
        actor: createFHIRReference('Practitioner', pharmacist.license, pharmacist.name)
      }],
      location: {
        reference: `Location/${request.pharmacyId}`,
        display: request.pharmacyName
      },
      quantity: {
        value: request.dispensedItems.reduce((acc, item) => acc + item.dispensedQuantity, 0),
        unit: 'unit'
      },
      whenHandedOver: toFHIRDateTime(new Date())
    };

    // 3. Persist via Gateway
    return this.repo.create(fhirResource, token);
  }

  async getDispense(id: string, token: string): Promise<MedicationDispense> {
    const dispense = await this.repo.getById(id, token);
    if (!dispense) {
      throw new NDPError(ErrorCodes.DISPENSE_NOT_FOUND, 'Dispense not found', 404);
    }
    return dispense;
  }

  async searchDispenses(query: any, token: string) {
    const params = new URLSearchParams();
    if (query.patient) params.append('patient', query.patient);
    if (query.prescription) params.append('prescription', query.prescription);
    
    return this.repo.search(params, token);
  }
}

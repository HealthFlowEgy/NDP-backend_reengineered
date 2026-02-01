import { MedicationDispense } from '../../../../shared/types/fhir.types.js';
import { FHIRGatewayClient } from '../../../../shared/clients/fhir-gateway.client.js';

export class DispenseRepository {
  private client: FHIRGatewayClient;

  constructor() {
    this.client = new FHIRGatewayClient('MedicationDispense');
  }

  async create(dispense: MedicationDispense, token: string): Promise<MedicationDispense> {
    return this.client.create<MedicationDispense>(dispense, token);
  }

  async search(params: URLSearchParams, token: string): Promise<any> {
    return this.client.search<MedicationDispense>(params, token);
  }

  async getById(id: string, token: string): Promise<MedicationDispense | null> {
    return this.client.getById<MedicationDispense>(id, token);
  }
}
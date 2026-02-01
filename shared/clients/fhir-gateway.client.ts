import { NDPError, ErrorCodes } from '../types/ndp.types.js';

const DEFAULT_GATEWAY_URL = 'http://fhir-gateway:3011';

export class FHIRGatewayClient {
  private baseUrl: string;
  private resourceType: string;

  constructor(resourceType: string, gatewayUrl?: string) {
    this.resourceType = resourceType;
    this.baseUrl = gatewayUrl || process.env.FHIR_GATEWAY_URL || DEFAULT_GATEWAY_URL;
  }

  /**
   * Create a resource
   */
  async create<T>(resource: T, token: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${this.resourceType}`, {
      method: 'POST',
      headers: this.getHeaders(token),
      body: JSON.stringify(resource),
    });

    return this.handleResponse<T>(response);
  }

  /**
   * Read a resource by ID
   */
  async getById<T>(id: string, token: string): Promise<T | null> {
    const response = await fetch(`${this.baseUrl}/${this.resourceType}/${id}`, {
      method: 'GET',
      headers: this.getHeaders(token),
    });

    if (response.status === 404) return null;

    return this.handleResponse<T>(response);
  }

  /**
   * Search for resources
   */
  async search<T>(params: URLSearchParams | Record<string, string>, token: string): Promise<{ entry: { resource: T }[]; total?: number }> {
    const queryString = new URLSearchParams(params).toString();
    const response = await fetch(`${this.baseUrl}/${this.resourceType}?${queryString}`, {
      method: 'GET',
      headers: this.getHeaders(token),
    });

    return this.handleResponse(response);
  }

  /**
   * Update a resource
   */
  async update<T>(id: string, resource: T, token: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${this.resourceType}/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(token),
      body: JSON.stringify(resource),
    });

    return this.handleResponse<T>(response);
  }

  /**
   * Delete a resource (or cancel/invalidate)
   */
  async delete(id: string, token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${this.resourceType}/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(token),
    });

    if (!response.ok && response.status !== 404) {
      await this.handleResponse(response);
    }
  }

  /**
   * Helper: Get standard headers
   */
  private getHeaders(token: string): HeadersInit {
    return {
      'Content-Type': 'application/fhir+json',
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    };
  }

  /**
   * Helper: Handle response and errors
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let errorMessage = `FHIR Gateway Error: ${response.status} ${response.statusText}`;
      let errorCode = ErrorCodes.INTERNAL_ERROR;

      try {
        const errorBody = await response.json();
        // Parse FHIR OperationOutcome if present
        if (errorBody.resourceType === 'OperationOutcome' && errorBody.issue?.length > 0) {
          errorMessage = errorBody.issue.map((i: any) => i.diagnostics || i.code).join('; ');
          errorCode = ErrorCodes.INVALID_REQUEST; // Generic mapping, could be refined
        }
      } catch (e) {
        // Ignore JSON parse error, use default message
      }

      throw new NDPError(errorCode, errorMessage, response.status);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }
}

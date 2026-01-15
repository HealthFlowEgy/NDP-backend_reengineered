/**
 * Signing Service Client
 * Communicates with the signing service for PKI operations
 */

import { createLogger, hashDocument } from '../../../../shared/utils/index.js';
import { NDPError, ErrorCodes, SignatureRecord, AuthUser } from '../../../../shared/types/ndp.types.js';
import { MedicationRequest, Provenance, Signature } from '../../../../shared/types/fhir.types.js';

const logger = createLogger('prescription-service:signing-client');

const SIGNING_SERVICE_URL = process.env['SIGNING_SERVICE_URL'] || 'http://localhost:3005';

export interface SignPrescriptionResult {
  signatureRecord: SignatureRecord;
  fhirSignature: Signature;
  fhirProvenance: Provenance;
}

export class SigningClient {
  private baseUrl: string;

  constructor(baseUrl: string = SIGNING_SERVICE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Sign a prescription document
   */
  async signPrescription(
    prescription: MedicationRequest,
    prescriptionId: string,
    user: AuthUser
  ): Promise<SignPrescriptionResult> {
    // Generate canonical hash of the prescription
    const documentHash = this.generateDocumentHash(prescription);

    try {
      const response = await fetch(`${this.baseUrl}/api/signatures/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentHash,
          documentType: 'MedicationRequest',
          documentId: prescriptionId,
          signerLicense: user.license,
          signerName: user.name,
          purpose: 'author',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new NDPError(
          ErrorCodes.SIGNATURE_FAILED,
          error.error?.message || 'Failed to sign prescription',
          response.status
        );
      }

      const result = await response.json();

      logger.info('Prescription signed', {
        prescriptionId,
        signatureId: result.signatureId,
        signerLicense: user.license,
      });

      return {
        signatureRecord: {
          signatureData: result.signature,
          algorithm: result.algorithm,
          certificateId: result.certificateId,
          signedAt: result.signedAt,
          signerLicense: result.signerLicense,
          signerName: result.signerName,
          documentHash: result.documentHash,
        },
        fhirSignature: result.fhirSignature,
        fhirProvenance: result.fhirProvenance,
      };
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Signing service error', error);
      throw new NDPError(ErrorCodes.SIGNATURE_FAILED, 'Signing service unavailable', 503);
    }
  }

  /**
   * Verify a prescription signature
   */
  async verifyPrescriptionSignature(
    prescription: MedicationRequest,
    signature: string,
    signerLicense: string
  ): Promise<{ valid: boolean; reason?: string; signedAt?: string }> {
    const documentHash = this.generateDocumentHash(prescription);

    try {
      const response = await fetch(`${this.baseUrl}/api/signatures/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentHash,
          signature,
          signerLicense,
        }),
      });

      if (!response.ok) {
        return { valid: false, reason: 'Verification service error' };
      }

      return await response.json();
    } catch (error) {
      logger.error('Signature verification error', error);
      return { valid: false, reason: 'Verification service unavailable' };
    }
  }

  /**
   * Get certificate information for a practitioner
   */
  async getCertificateInfo(license: string): Promise<{
    certificateId: string;
    subjectLicense: string;
    subjectName: string;
    issuer: string;
    issuedAt: string;
    expiresAt: string;
    status: string;
  } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/certificates/${license}`);

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      logger.error('Get certificate error', error);
      return null;
    }
  }

  /**
   * Generate canonical hash of a FHIR resource
   */
  private generateDocumentHash(resource: MedicationRequest): string {
    // Create a canonical representation
    const canonical = this.canonicalize(resource);
    return hashDocument(canonical);
  }

  /**
   * Create canonical form of resource for consistent hashing
   */
  private canonicalize(resource: MedicationRequest): object {
    // Remove volatile fields that shouldn't affect signature
    const { meta, ...rest } = resource;
    
    // Sort keys recursively for consistent ordering
    return this.sortObject(rest);
  }

  /**
   * Recursively sort object keys
   */
  private sortObject(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObject(item));
    }

    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    
    for (const key of keys) {
      sorted[key] = this.sortObject((obj as Record<string, unknown>)[key]);
    }

    return sorted;
  }
}

// Singleton instance
export const signingClient = new SigningClient();

/**
 * Mock signing for development when signing service is unavailable
 */
export class MockSigningClient extends SigningClient {
  async signPrescription(
    prescription: MedicationRequest,
    prescriptionId: string,
    user: AuthUser
  ): Promise<SignPrescriptionResult> {
    const documentHash = hashDocument(prescription);
    const signedAt = new Date().toISOString();
    const signatureData = Buffer.from(
      `MOCK_SIG:${documentHash}:${user.license}:${signedAt}`
    ).toString('base64');

    const signatureRecord: SignatureRecord = {
      signatureData,
      algorithm: 'RS256',
      certificateId: `MOCK-CERT-${user.license}`,
      signedAt,
      signerLicense: user.license,
      signerName: user.name,
      documentHash,
    };

    const fhirSignature: Signature = {
      type: [{
        system: 'urn:iso-astm:E1762-95:2013',
        code: '1.2.840.10065.1.12.1.1',
        display: "Author's Signature",
      }],
      when: signedAt,
      who: {
        reference: `Practitioner/${user.license}`,
        display: user.name,
      },
      sigFormat: 'application/jose',
      data: signatureData,
    };

    const fhirProvenance: Provenance = {
      resourceType: 'Provenance',
      id: `prov-${prescriptionId}`,
      target: [{
        reference: `MedicationRequest/${prescriptionId}`,
      }],
      recorded: signedAt,
      agent: [{
        who: {
          reference: `Practitioner/${user.license}`,
          display: user.name,
        },
      }],
      signature: [fhirSignature],
    };

    logger.info('Mock signature created', { prescriptionId, signerLicense: user.license });

    return { signatureRecord, fhirSignature, fhirProvenance };
  }

  async verifyPrescriptionSignature(): Promise<{ valid: boolean }> {
    return { valid: true };
  }
}

// Use mock client in development if signing service is not available
export function createSigningClient(): SigningClient {
  if (process.env['NODE_ENV'] === 'development' && process.env['USE_MOCK_SIGNING'] === 'true') {
    logger.warn('Using mock signing client');
    return new MockSigningClient();
  }
  return new SigningClient();
}

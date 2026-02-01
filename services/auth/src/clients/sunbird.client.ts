import { SUNBIRD_RC_CONFIG } from '../config/index.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';
import { createLogger } from '../../../../shared/utils/index.js';

const logger = createLogger('auth-service:sunbird');

export interface SunbirdCredential {
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: {
    id: string;
    name: string;
    licenseNumber: string;
    specialty?: string;
    qualifications?: string[];
    facilityId?: string;
    facilityName?: string;
    status: 'active' | 'suspended' | 'revoked' | 'expired';
  };
}

export interface PractitionerInfo {
  license: string;
  name: string;
  nameArabic?: string;
  specialty?: string;
  qualifications?: string[];
  facilityId?: string;
  facilityName?: string;
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  credentialId: string;
  issuedAt: string;
  expiresAt?: string;
}

export interface SignatureRequest {
  documentHash: string;
  documentType: 'prescription' | 'dispense';
  practitionerLicense: string;
}

export interface SignatureResponse {
  signature: string;
  algorithm: string;
  certificateId: string;
  signedAt: string;
  signerLicense: string;
  signerName: string;
}

export class SunbirdRCClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = SUNBIRD_RC_CONFIG.url;
  }

  async getPractitionerInfo(licenseNumber: string): Promise<PractitionerInfo | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}${SUNBIRD_RC_CONFIG.hprEndpoint}/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: {
              licenseNumber: { eq: licenseNumber },
            },
          }),
        }
      );

      if (!response.ok) return null;

      const results = await response.json();
      if (results.length === 0) return null;

      const practitioner = results[0];
      return {
        license: practitioner.licenseNumber,
        name: practitioner.name,
        nameArabic: practitioner.nameArabic,
        specialty: practitioner.specialty,
        qualifications: practitioner.qualifications,
        facilityId: practitioner.facilityId,
        facilityName: practitioner.facilityName,
        status: practitioner.status || 'active',
        credentialId: practitioner.credentialId,
        issuedAt: practitioner.issuedAt,
        expiresAt: practitioner.expiresAt,
      };
    } catch (error) {
      logger.error('Get practitioner info error', error);
      return null;
    }
  }

  async verifyCredential(credentialId: string): Promise<{ verified: boolean; reason?: string }> {
    try {
      const response = await fetch(
        `${this.baseUrl}${SUNBIRD_RC_CONFIG.credentialEndpoint}/${credentialId}/verify`,
        { method: 'POST' }
      );

      if (!response.ok) return { verified: false, reason: 'Verification request failed' };

      const result = await response.json();
      return {
        verified: result.verified === true,
        reason: result.reason,
      };
    } catch (error) {
      logger.error('Credential verification error', error);
      return { verified: false, reason: 'Verification service unavailable' };
    }
  }

  async signDocument(request: SignatureRequest): Promise<SignatureResponse> {
    try {
      const response = await fetch(
        `${this.baseUrl}${SUNBIRD_RC_CONFIG.signingEndpoint}/sign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentHash: request.documentHash,
            documentType: request.documentType,
            signerLicense: request.practitionerLicense,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new NDPError(ErrorCodes.SIGNATURE_FAILED, error.message || 'Signing failed', 400);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Document signing error', error);
      throw new NDPError(ErrorCodes.SIGNATURE_FAILED, 'Signing service unavailable', 503);
    }
  }

  async verifySignature(
    documentHash: string,
    signature: string,
    signerLicense: string
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      const response = await fetch(
        `${this.baseUrl}${SUNBIRD_RC_CONFIG.signingEndpoint}/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentHash, signature, signerLicense }),
        }
      );

      const result = await response.json();
      return {
        valid: result.valid === true,
        reason: result.reason,
      };
    } catch (error) {
      logger.error('Signature verification error', error);
      return { valid: false, reason: 'Verification service unavailable' };
    }
  }
}

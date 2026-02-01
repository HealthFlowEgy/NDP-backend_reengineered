import crypto from 'crypto';
import { certificateStore, signatureStore, CertificateInfo } from '../utils/stores.js';
import { generateUUID, toFHIRInstant } from '../../../../shared/utils/index.js';
import { NDPError, ErrorCodes, SignatureRecord } from '../../../../shared/types/ndp.types.js';
import { Signature, Provenance } from '../../../../shared/types/fhir.types.js';
import { createLogger } from '../../../../shared/utils/index.js';

const logger = createLogger('signing-service:logic');

export interface SigningRequest {
  documentHash: string;
  documentType: 'MedicationRequest' | 'MedicationDispense';
  documentId: string;
  signerLicense: string;
  signerName: string;
  purpose: 'author' | 'witness' | 'co-signer';
}

export interface SigningResult {
  signatureId: string;
  signature: string;
  signatureB64: string;
  algorithm: string;
  certificateId: string;
  signedAt: string;
  signerLicense: string;
  signerName: string;
  documentHash: string;
  fhirSignature: Signature;
  fhirProvenance: Provenance;
}

export interface VerificationRequest {
  documentHash: string;
  signature: string;
  signerLicense: string;
}

export interface VerificationResult {
  valid: boolean;
  signedAt?: string;
  signerLicense?: string;
  signerName?: string;
  certificateStatus?: string;
  reason?: string;
}

export class SigningService {
  async signDocument(request: SigningRequest): Promise<SigningResult> {
    const { documentHash, documentType, documentId, signerLicense, signerName, purpose } = request;

    const certValidation = certificateStore.isValid(signerLicense);
    if (!certValidation.valid) {
      throw new NDPError(ErrorCodes.CERTIFICATE_EXPIRED, certValidation.reason || 'Certificate is not valid', 403);
    }

    const cert = certificateStore.getCertificate(signerLicense)!;
    const privateKey = certificateStore.getPrivateKey(signerLicense);

    if (!privateKey) {
      throw new NDPError(ErrorCodes.SIGNATURE_FAILED, 'Private key not available', 500);
    }

    const signatureId = generateUUID();
    const signedAt = toFHIRInstant(new Date());
    const algorithm = 'RS256';

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(documentHash);
    const signature = signer.sign(privateKey, 'base64');

    const fhirSignature: Signature = {
      type: [{
        system: 'urn:iso-astm:E1762-95:2013',
        code: this.getPurposeCode(purpose),
        display: this.getPurposeDisplay(purpose),
      }],
      when: signedAt,
      who: { reference: `Practitioner/${signerLicense}`, display: signerName },
      targetFormat: 'application/fhir+json',
      sigFormat: 'application/jose',
      data: signature,
    };

    const fhirProvenance: Provenance = {
      resourceType: 'Provenance',
      id: signatureId,
      meta: { lastUpdated: signedAt },
      target: [{ reference: `${documentType}/${documentId}` }],
      recorded: signedAt,
      activity: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-DocumentCompletion',
          code: 'LA',
          display: 'Legally authenticated',
        }],
      },
      agent: [{
        type: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type',
            code: purpose === 'author' ? 'author' : 'attester',
            display: purpose === 'author' ? 'Author' : 'Attester',
          }],
        },
        who: { reference: `Practitioner/${signerLicense}`, display: signerName },
      }],
      signature: [fhirSignature],
    };

    signatureStore.store({
      signatureId,
      documentHash,
      documentType,
      documentId,
      signature,
      algorithm,
      certificateId: cert.certificateId,
      signerLicense,
      signerName,
      signedAt,
      purpose,
    });

    logger.info('Document signed', { signatureId, documentType, documentId, signerLicense });

    return {
      signatureId,
      signature,
      signatureB64: signature,
      algorithm,
      certificateId: cert.certificateId,
      signedAt,
      signerLicense,
      signerName,
      documentHash,
      fhirSignature,
      fhirProvenance,
    };
  }

  async verifySignature(request: VerificationRequest): Promise<VerificationResult> {
    const { documentHash, signature, signerLicense } = request;
    const cert = certificateStore.getCertificate(signerLicense);

    if (!cert) return { valid: false, reason: 'Signer certificate not found' };
    if (cert.status === 'revoked') return { valid: false, certificateStatus: 'revoked', reason: 'Certificate revoked' };
    if (new Date(cert.expiresAt) < new Date()) return { valid: false, certificateStatus: 'expired', reason: 'Certificate expired' };

    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(documentHash);
      const isValid = verifier.verify(cert.publicKey, signature, 'base64');

      if (!isValid) return { valid: false, reason: 'Signature verification failed' };

      const storedSig = signatureStore.findByHashAndSigner(documentHash, signerLicense);
      return {
        valid: true,
        signedAt: storedSig?.signedAt,
        signerLicense: cert.subjectLicense,
        signerName: cert.subjectName,
        certificateStatus: cert.status,
      };
    } catch (error) {
      logger.error('Signature verification error', error);
      return { valid: false, reason: 'Verification error' };
    }
  }

  getCertificateInfo(license: string): CertificateInfo | null {
    return certificateStore.getCertificate(license);
  }

  getDocumentSignatures(documentId: string) {
    return signatureStore.getByDocument(documentId);
  }

  private getPurposeCode(purpose: string): string {
    switch (purpose) {
      case 'author': return '1.2.840.10065.1.12.1.1';
      case 'witness': return '1.2.840.10065.1.12.1.5';
      case 'co-signer': return '1.2.840.10065.1.12.1.7';
      default: return '1.2.840.10065.1.12.1.1';
    }
  }

  private getPurposeDisplay(purpose: string): string {
    switch (purpose) {
      case 'author': return "Author's Signature";
      case 'witness': return 'Witness Signature';
      case 'co-signer': return 'Co-signature';
      default: return "Author's Signature";
    }
  }
}

export const signingService = new SigningService();

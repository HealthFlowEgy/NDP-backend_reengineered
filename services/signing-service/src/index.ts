/**
 * Digital Signature Service
 * PKI-based document signing for prescriptions and dispenses
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import crypto from 'crypto';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';

import { loadConfig } from '../../../shared/config/index.js';
import { 
  createLogger, 
  generateUUID, 
  toFHIRInstant,
  hashDocument 
} from '../../../shared/utils/index.js';
import { NDPError, ErrorCodes, SignatureRecord } from '../../../shared/types/ndp.types.js';
import { Signature, Provenance } from '../../../shared/types/fhir.types.js';

const config = loadConfig('signing-service');
const logger = createLogger('signing-service', config.logLevel);

// ============================================================================
// Types
// ============================================================================

interface CertificateInfo {
  certificateId: string;
  subjectLicense: string;
  subjectName: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  publicKey: string;
  status: 'active' | 'revoked' | 'expired';
}

interface SigningRequest {
  documentHash: string;
  documentType: 'MedicationRequest' | 'MedicationDispense';
  documentId: string;
  signerLicense: string;
  signerName: string;
  purpose: 'author' | 'witness' | 'co-signer';
}

interface SigningResult {
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

interface VerificationRequest {
  documentHash: string;
  signature: string;
  signerLicense: string;
}

interface VerificationResult {
  valid: boolean;
  signedAt?: string;
  signerLicense?: string;
  signerName?: string;
  certificateStatus?: string;
  reason?: string;
}

// ============================================================================
// Certificate Store (In production, this would be HSM/Vault backed)
// ============================================================================

class CertificateStore {
  private certificates: Map<string, { cert: CertificateInfo; privateKey: string }> = new Map();

  constructor() {
    // In development, generate test certificates
    if (config.env === 'development') {
      this.generateTestCertificates();
    }
  }

  /**
   * Generate test certificates for development
   */
  private generateTestCertificates() {
    const testUsers = [
      { license: 'EMS-12345', name: 'Dr. Ahmed Mohamed', role: 'physician' },
      { license: 'EMS-67890', name: 'Dr. Fatima Hassan', role: 'physician' },
      { license: 'PH-11111', name: 'Dr. Omar Pharmacy', role: 'pharmacist' },
      { license: 'PH-22222', name: 'Dr. Sara Dispensary', role: 'pharmacist' },
    ];

    for (const user of testUsers) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const certId = `CERT-${user.license}-${Date.now()}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

      this.certificates.set(user.license, {
        cert: {
          certificateId: certId,
          subjectLicense: user.license,
          subjectName: user.name,
          issuer: 'NDP Certificate Authority',
          issuedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          publicKey,
          status: 'active',
        },
        privateKey,
      });
    }

    logger.info(`Generated ${testUsers.length} test certificates`);
  }

  /**
   * Get certificate by license number
   */
  getCertificate(license: string): CertificateInfo | null {
    const entry = this.certificates.get(license);
    return entry?.cert || null;
  }

  /**
   * Get private key for signing (in production, HSM would do this)
   */
  getPrivateKey(license: string): string | null {
    const entry = this.certificates.get(license);
    return entry?.privateKey || null;
  }

  /**
   * Register new certificate
   */
  registerCertificate(
    license: string,
    name: string,
    publicKey: string,
    privateKey: string
  ): CertificateInfo {
    const certId = `CERT-${license}-${Date.now()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const cert: CertificateInfo = {
      certificateId: certId,
      subjectLicense: license,
      subjectName: name,
      issuer: 'NDP Certificate Authority',
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      publicKey,
      status: 'active',
    };

    this.certificates.set(license, { cert, privateKey });
    return cert;
  }

  /**
   * Revoke certificate
   */
  revokeCertificate(license: string): boolean {
    const entry = this.certificates.get(license);
    if (!entry) return false;

    entry.cert.status = 'revoked';
    return true;
  }

  /**
   * Check if certificate is valid
   */
  isValid(license: string): { valid: boolean; reason?: string } {
    const cert = this.getCertificate(license);
    if (!cert) {
      return { valid: false, reason: 'Certificate not found' };
    }

    if (cert.status === 'revoked') {
      return { valid: false, reason: 'Certificate has been revoked' };
    }

    if (new Date(cert.expiresAt) < new Date()) {
      return { valid: false, reason: 'Certificate has expired' };
    }

    return { valid: true };
  }
}

// ============================================================================
// Signature Store (Audit trail of all signatures)
// ============================================================================

interface StoredSignature {
  signatureId: string;
  documentHash: string;
  documentType: string;
  documentId: string;
  signature: string;
  algorithm: string;
  certificateId: string;
  signerLicense: string;
  signerName: string;
  signedAt: string;
  purpose: string;
}

class SignatureStore {
  private signatures: Map<string, StoredSignature> = new Map();
  private byDocument: Map<string, string[]> = new Map(); // documentId -> signatureIds

  /**
   * Store signature
   */
  store(sig: StoredSignature): void {
    this.signatures.set(sig.signatureId, sig);

    const existing = this.byDocument.get(sig.documentId) || [];
    existing.push(sig.signatureId);
    this.byDocument.set(sig.documentId, existing);
  }

  /**
   * Get signature by ID
   */
  getById(signatureId: string): StoredSignature | null {
    return this.signatures.get(signatureId) || null;
  }

  /**
   * Get signatures for document
   */
  getByDocument(documentId: string): StoredSignature[] {
    const ids = this.byDocument.get(documentId) || [];
    return ids.map(id => this.signatures.get(id)!).filter(Boolean);
  }

  /**
   * Find signature by hash and signer
   */
  findByHashAndSigner(documentHash: string, signerLicense: string): StoredSignature | null {
    for (const sig of this.signatures.values()) {
      if (sig.documentHash === documentHash && sig.signerLicense === signerLicense) {
        return sig;
      }
    }
    return null;
  }
}

// ============================================================================
// Signing Service
// ============================================================================

const certificateStore = new CertificateStore();
const signatureStore = new SignatureStore();

class SigningService {
  /**
   * Sign a document
   */
  async signDocument(request: SigningRequest): Promise<SigningResult> {
    const { documentHash, documentType, documentId, signerLicense, signerName, purpose } = request;

    // Validate certificate
    const certValidation = certificateStore.isValid(signerLicense);
    if (!certValidation.valid) {
      throw new NDPError(
        ErrorCodes.CERTIFICATE_EXPIRED,
        certValidation.reason || 'Certificate is not valid',
        403
      );
    }

    const cert = certificateStore.getCertificate(signerLicense)!;
    const privateKey = certificateStore.getPrivateKey(signerLicense);

    if (!privateKey) {
      throw new NDPError(ErrorCodes.SIGNATURE_FAILED, 'Private key not available', 500);
    }

    // Create signature
    const signatureId = generateUUID();
    const signedAt = toFHIRInstant(new Date());
    const algorithm = 'RS256';

    // Sign the hash using RSA-SHA256
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(documentHash);
    const signature = signer.sign(privateKey, 'base64');

    // Create FHIR Signature resource
    const fhirSignature: Signature = {
      type: [{
        system: 'urn:iso-astm:E1762-95:2013',
        code: this.getPurposeCode(purpose),
        display: this.getPurposeDisplay(purpose),
      }],
      when: signedAt,
      who: {
        reference: `Practitioner/${signerLicense}`,
        display: signerName,
      },
      targetFormat: 'application/fhir+json',
      sigFormat: 'application/jose',
      data: signature,
    };

    // Create FHIR Provenance resource
    const fhirProvenance: Provenance = {
      resourceType: 'Provenance',
      id: signatureId,
      meta: {
        lastUpdated: signedAt,
      },
      target: [{
        reference: `${documentType}/${documentId}`,
      }],
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
        who: {
          reference: `Practitioner/${signerLicense}`,
          display: signerName,
        },
      }],
      signature: [fhirSignature],
    };

    // Store signature for audit
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

    logger.info('Document signed', {
      signatureId,
      documentType,
      documentId,
      signerLicense,
      certificateId: cert.certificateId,
    });

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

  /**
   * Verify a signature
   */
  async verifySignature(request: VerificationRequest): Promise<VerificationResult> {
    const { documentHash, signature, signerLicense } = request;

    // Get certificate
    const cert = certificateStore.getCertificate(signerLicense);
    if (!cert) {
      return {
        valid: false,
        reason: 'Signer certificate not found',
      };
    }

    // Check certificate status
    if (cert.status === 'revoked') {
      return {
        valid: false,
        signerLicense: cert.subjectLicense,
        signerName: cert.subjectName,
        certificateStatus: 'revoked',
        reason: 'Signer certificate has been revoked',
      };
    }

    if (new Date(cert.expiresAt) < new Date()) {
      return {
        valid: false,
        signerLicense: cert.subjectLicense,
        signerName: cert.subjectName,
        certificateStatus: 'expired',
        reason: 'Signer certificate has expired',
      };
    }

    // Verify signature
    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(documentHash);
      const isValid = verifier.verify(cert.publicKey, signature, 'base64');

      if (!isValid) {
        return {
          valid: false,
          signerLicense: cert.subjectLicense,
          signerName: cert.subjectName,
          certificateStatus: cert.status,
          reason: 'Signature verification failed - document may have been tampered with',
        };
      }

      // Look up stored signature for additional info
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
      return {
        valid: false,
        reason: 'Signature verification error',
      };
    }
  }

  /**
   * Get certificate info
   */
  getCertificateInfo(license: string): CertificateInfo | null {
    return certificateStore.getCertificate(license);
  }

  /**
   * Get signatures for a document
   */
  getDocumentSignatures(documentId: string): StoredSignature[] {
    return signatureStore.getByDocument(documentId);
  }

  /**
   * Create signature record for storage
   */
  createSignatureRecord(result: SigningResult): SignatureRecord {
    return {
      signatureData: result.signature,
      algorithm: result.algorithm,
      certificateId: result.certificateId,
      signedAt: result.signedAt,
      signerLicense: result.signerLicense,
      signerName: result.signerName,
      documentHash: result.documentHash,
    };
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

const signingService = new SigningService();

// ============================================================================
// Validation Schemas
// ============================================================================

const SignDocumentSchema = z.object({
  documentHash: z.string().min(1, 'Document hash is required'),
  documentType: z.enum(['MedicationRequest', 'MedicationDispense']),
  documentId: z.string().min(1, 'Document ID is required'),
  signerLicense: z.string().min(1, 'Signer license is required'),
  signerName: z.string().min(1, 'Signer name is required'),
  purpose: z.enum(['author', 'witness', 'co-signer']).default('author'),
});

const VerifySignatureSchema = z.object({
  documentHash: z.string().min(1),
  signature: z.string().min(1),
  signerLicense: z.string().min(1),
});

// ============================================================================
// Routes
// ============================================================================

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'signing-service', timestamp: new Date().toISOString() });
});

// Sign document
router.post('/api/signatures/sign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = SignDocumentSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }

    const result = await signingService.signDocument(validation.data);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// Verify signature
router.post('/api/signatures/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = VerifySignatureSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }

    const result = await signingService.verifySignature(validation.data);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get certificate info
router.get('/api/certificates/:license', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cert = signingService.getCertificateInfo(req.params.license!);
    if (!cert) {
      throw new NDPError(ErrorCodes.CERTIFICATE_NOT_FOUND, 'Certificate not found', 404);
    }

    // Don't return private key info
    const { publicKey, ...safeInfo } = cert;
    res.json(safeInfo);
  } catch (error) {
    next(error);
  }
});

// Get document signatures
router.get('/api/documents/:documentId/signatures', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signatures = signingService.getDocumentSignatures(req.params.documentId!);
    res.json(signatures);
  } catch (error) {
    next(error);
  }
});

// FHIR: Create Provenance
router.post('/fhir/Provenance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Extract signing info from Provenance resource
    const provenance = req.body;
    
    if (!provenance.target?.[0]?.reference) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Target reference is required', 400);
    }

    const [documentType, documentId] = provenance.target[0].reference.split('/');
    const agent = provenance.agent?.[0];
    const signerRef = agent?.who?.reference?.split('/')?.[1];

    if (!signerRef) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Signer reference is required', 400);
    }

    // Get document hash from extension or generate
    const documentHash = provenance.entity?.[0]?.what?.display || 
                        hashDocument({ id: documentId, type: documentType });

    const result = await signingService.signDocument({
      documentHash,
      documentType: documentType as 'MedicationRequest' | 'MedicationDispense',
      documentId,
      signerLicense: signerRef,
      signerName: agent?.who?.display || signerRef,
      purpose: agent?.type?.coding?.[0]?.code === 'author' ? 'author' : 'witness',
    });

    res.status(201).json(result.fhirProvenance);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Error Handler
// ============================================================================

function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Signing error', error, { method: req.method, path: req.path });

  if (error instanceof NDPError) {
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  logger.info('Starting Signing Service', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());
  app.use('/fhir', (req, res, next) => { res.setHeader('Content-Type', 'application/fhir+json'); next(); });
  app.use('/', router);
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(`Signing Service listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

export { signingService, certificateStore, signatureStore };

import crypto from 'crypto';
import { loadConfig } from '../../../../shared/config/index.js';
import { createLogger } from '../../../../shared/utils/index.js';

const config = loadConfig('signing-service');
const logger = createLogger('signing-service:stores');

export interface CertificateInfo {
  certificateId: string;
  subjectLicense: string;
  subjectName: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  publicKey: string;
  status: 'active' | 'revoked' | 'expired';
}

export class CertificateStore {
  private certificates: Map<string, { cert: CertificateInfo; privateKey: string }> = new Map();

  constructor() {
    if (config.env === 'development') {
      this.generateTestCertificates();
    }
  }

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
      const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

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

  getCertificate(license: string): CertificateInfo | null {
    const entry = this.certificates.get(license);
    return entry?.cert || null;
  }

  getPrivateKey(license: string): string | null {
    const entry = this.certificates.get(license);
    return entry?.privateKey || null;
  }

  isValid(license: string): { valid: boolean; reason?: string } {
    const cert = this.getCertificate(license);
    if (!cert) return { valid: false, reason: 'Certificate not found' };
    if (cert.status === 'revoked') return { valid: false, reason: 'Certificate has been revoked' };
    if (new Date(cert.expiresAt) < new Date()) return { valid: false, reason: 'Certificate has expired' };
    return { valid: true };
  }
}

export interface StoredSignature {
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

export class SignatureStore {
  private signatures: Map<string, StoredSignature> = new Map();
  private byDocument: Map<string, string[]> = new Map();

  store(sig: StoredSignature): void {
    this.signatures.set(sig.signatureId, sig);
    const existing = this.byDocument.get(sig.documentId) || [];
    existing.push(sig.signatureId);
    this.byDocument.set(sig.documentId, existing);
  }

  getById(signatureId: string): StoredSignature | null {
    return this.signatures.get(signatureId) || null;
  }

  getByDocument(documentId: string): StoredSignature[] {
    const ids = this.byDocument.get(documentId) || [];
    return ids.map(id => this.signatures.get(id)!).filter(Boolean);
  }

  findByHashAndSigner(documentHash: string, signerLicense: string): StoredSignature | null {
    for (const sig of this.signatures.values()) {
      if (sig.documentHash === documentHash && sig.signerLicense === signerLicense) {
        return sig;
      }
    }
    return null;
  }
}

export const certificateStore = new CertificateStore();
export const signatureStore = new SignatureStore();

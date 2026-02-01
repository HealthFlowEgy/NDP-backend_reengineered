import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { signingService } from '../services/signing.service.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';
import { hashDocument } from '../../../../shared/utils/index.js';

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

export class SigningController {
  async sign(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = SignDocumentSchema.safeParse(req.body);
      if (!validation.success) {
        throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
      }
      const result = await signingService.signDocument(validation.data);
      res.status(201).json(result);
    } catch (error) { next(error); }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = VerifySignatureSchema.safeParse(req.body);
      if (!validation.success) {
        throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
      }
      const result = await signingService.verifySignature(validation.data);
      res.json(result);
    } catch (error) { next(error); }
  }

  async getCertificate(req: Request, res: Response, next: NextFunction) {
    try {
      const cert = signingService.getCertificateInfo(req.params.license!);
      if (!cert) throw new NDPError(ErrorCodes.CERTIFICATE_NOT_FOUND, 'Certificate not found', 404);
      const { publicKey, ...safeInfo } = cert;
      res.json(safeInfo);
    } catch (error) { next(error); }
  }

  async getDocumentSignatures(req: Request, res: Response, next: NextFunction) {
    try {
      const signatures = signingService.getDocumentSignatures(req.params.documentId!);
      res.json(signatures);
    } catch (error) { next(error); }
  }

  async createProvenance(req: Request, res: Response, next: NextFunction) {
    try {
      const provenance = req.body;
      if (!provenance.target?.[0]?.reference) throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Target reference is required', 400);

      const [documentType, documentId] = provenance.target[0].reference.split('/');
      const agent = provenance.agent?.[0];
      const signerRef = agent?.who?.reference?.split('/')?.[1];

      if (!signerRef) throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Signer reference is required', 400);

      const documentHash = provenance.entity?.[0]?.what?.display || hashDocument({ id: documentId, type: documentType });

      const result = await signingService.signDocument({
        documentHash,
        documentType: documentType as any,
        documentId,
        signerLicense: signerRef,
        signerName: agent?.who?.display || signerRef,
        purpose: agent?.type?.coding?.[0]?.code === 'author' ? 'author' : 'witness',
      });

      res.status(201).json(result.fhirProvenance);
    } catch (error) { next(error); }
  }
}

export const signingController = new SigningController();

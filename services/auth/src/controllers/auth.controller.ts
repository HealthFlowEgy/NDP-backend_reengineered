import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';

const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const SignDocumentSchema = z.object({
  documentHash: z.string().min(1, 'Document hash is required'),
  documentType: z.enum(['prescription', 'dispense']),
});

const VerifySignatureSchema = z.object({
  documentHash: z.string().min(1),
  signature: z.string().min(1),
  signerLicense: z.string().min(1),
});

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = LoginSchema.safeParse(req.body);
      if (!validation.success) {
        throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
      }
      const token = await authService.login(validation.data.username, validation.data.password);
      res.json(token);
    } catch (error) { next(error); }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = RefreshSchema.safeParse(req.body);
      if (!validation.success) {
        throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
      }
      const token = await authService.refreshToken(validation.data.refreshToken);
      res.json(token);
    } catch (error) { next(error); }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Missing authorization header', 401);
      }
      const token = authHeader.substring(7);
      const user = authService.verifyToken(token);
      res.json({ valid: true, user });
    } catch (error) { next(error); }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      if (refreshToken) await authService.logout(refreshToken);
      res.json({ success: true });
    } catch (error) { next(error); }
  }

  async getPractitionerInfo(req: Request, res: Response, next: NextFunction) {
    try {
      const info = await authService.getPractitionerInfo(req.params.license!);
      res.json(info);
    } catch (error) { next(error); }
  }

  async sign(req: Request, res: Response, next: NextFunction) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Missing authorization header', 401);
      }
      const token = authHeader.substring(7);
      const user = authService.verifyToken(token);

      const validation = SignDocumentSchema.safeParse(req.body);
      if (!validation.success) {
        throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
      }

      const signature = await authService.signDocument(
        validation.data.documentHash,
        validation.data.documentType,
        user
      );
      res.json(signature);
    } catch (error) { next(error); }
  }

  async verifySignature(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = VerifySignatureSchema.safeParse(req.body);
      if (!validation.success) {
        throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
      }
      const result = await authService.verifySignature(
        validation.data.documentHash,
        validation.data.signature,
        validation.data.signerLicense
      );
      res.json(result);
    } catch (error) { next(error); }
  }
}

export const authController = new AuthController();

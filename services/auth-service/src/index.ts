/**
 * Auth Service - Authentication & Authorization
 * Integrates with Keycloak SSO and Sunbird RC HPR
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import crypto from 'crypto';
import { z } from 'zod';

import { loadConfig } from '../../../shared/config/index.js';
import { 
  createLogger, 
  generateUUID, 
  toFHIRInstant,
  hashString 
} from '../../../shared/utils/index.js';
import { AuthUser, AuthToken, UserRole, NDPError, ErrorCodes } from '../../../shared/types/ndp.types.js';

const config = loadConfig('auth-service');
const logger = createLogger('auth-service', config.logLevel);

// ============================================================================
// Configuration
// ============================================================================

const KEYCLOAK_CONFIG = {
  url: config.auth.keycloakUrl,
  realm: config.auth.keycloakRealm,
  clientId: config.auth.keycloakClientId,
  clientSecret: config.auth.keycloakClientSecret,
};

const SUNBIRD_RC_CONFIG = {
  url: config.auth.sunbirdRcUrl,
  hprEndpoint: '/api/v1/HealthcareProfessional',
  credentialEndpoint: '/api/v1/credentials',
  signingEndpoint: '/api/v1/signatures',
};

const JWT_CONFIG = {
  secret: config.auth.jwtSecret,
  expiresIn: config.auth.jwtExpiresIn,
  refreshExpiresIn: config.auth.refreshTokenExpiresIn,
  algorithm: 'HS256' as const,
};

// ============================================================================
// Types
// ============================================================================

interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
  scope: string;
}

interface KeycloakUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  preferred_username: string;
  name: string;
  given_name: string;
  family_name: string;
  realm_access?: {
    roles: string[];
  };
}

interface SunbirdCredential {
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
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
  proof?: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws: string;
  };
}

interface PractitionerInfo {
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

interface SignatureRequest {
  documentHash: string;
  documentType: 'prescription' | 'dispense';
  practitionerLicense: string;
}

interface SignatureResponse {
  signature: string;
  algorithm: string;
  certificateId: string;
  signedAt: string;
  signerLicense: string;
  signerName: string;
}

// ============================================================================
// Keycloak Client
// ============================================================================

class KeycloakClient {
  private baseUrl: string;
  private realm: string;
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.baseUrl = KEYCLOAK_CONFIG.url;
    this.realm = KEYCLOAK_CONFIG.realm;
    this.clientId = KEYCLOAK_CONFIG.clientId;
    this.clientSecret = KEYCLOAK_CONFIG.clientSecret;
  }

  private get tokenEndpoint(): string {
    return `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`;
  }

  private get userInfoEndpoint(): string {
    return `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/userinfo`;
  }

  private get certsEndpoint(): string {
    return `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/certs`;
  }

  /**
   * Authenticate user with username/password
   */
  async authenticate(username: string, password: string): Promise<KeycloakTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username,
      password,
      scope: 'openid profile email',
    });

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      if (!response.ok) {
        const error = await response.json();
        logger.error('Keycloak authentication failed', { error });
        throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Invalid credentials', 401);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Keycloak connection error', error);
      throw new NDPError(ErrorCodes.SERVICE_UNAVAILABLE, 'Authentication service unavailable', 503);
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<KeycloakTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      if (!response.ok) {
        throw new NDPError(ErrorCodes.TOKEN_EXPIRED, 'Refresh token expired', 401);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Token refresh error', error);
      throw new NDPError(ErrorCodes.SERVICE_UNAVAILABLE, 'Authentication service unavailable', 503);
    }
  }

  /**
   * Get user info from access token
   */
  async getUserInfo(accessToken: string): Promise<KeycloakUserInfo> {
    try {
      const response = await fetch(this.userInfoEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new NDPError(ErrorCodes.INVALID_TOKEN, 'Invalid access token', 401);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Get user info error', error);
      throw new NDPError(ErrorCodes.SERVICE_UNAVAILABLE, 'Authentication service unavailable', 503);
    }
  }

  /**
   * Verify token (introspection)
   */
  async verifyToken(token: string): Promise<boolean> {
    const params = new URLSearchParams({
      token,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    try {
      const response = await fetch(
        `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token/introspect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        }
      );

      const result = await response.json();
      return result.active === true;
    } catch (error) {
      logger.error('Token verification error', error);
      return false;
    }
  }

  /**
   * Logout (revoke tokens)
   */
  async logout(refreshToken: string): Promise<void> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });

    try {
      await fetch(
        `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/logout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        }
      );
    } catch (error) {
      logger.error('Logout error', error);
    }
  }
}

// ============================================================================
// Sunbird RC Client (Healthcare Professional Registry)
// ============================================================================

class SunbirdRCClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = SUNBIRD_RC_CONFIG.url;
  }

  /**
   * Get practitioner credential by license number
   */
  async getPractitionerCredential(licenseNumber: string): Promise<SunbirdCredential | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}${SUNBIRD_RC_CONFIG.credentialEndpoint}/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: {
              'credentialSubject.licenseNumber': { eq: licenseNumber },
            },
          }),
        }
      );

      if (!response.ok) {
        logger.warn('Sunbird RC credential search failed', { licenseNumber });
        return null;
      }

      const results = await response.json();
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      logger.error('Sunbird RC connection error', error);
      return null;
    }
  }

  /**
   * Verify practitioner credential
   */
  async verifyCredential(credentialId: string): Promise<{ verified: boolean; reason?: string }> {
    try {
      const response = await fetch(
        `${this.baseUrl}${SUNBIRD_RC_CONFIG.credentialEndpoint}/${credentialId}/verify`,
        { method: 'POST' }
      );

      if (!response.ok) {
        return { verified: false, reason: 'Verification request failed' };
      }

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

  /**
   * Get practitioner info from HPR
   */
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

      if (!response.ok) {
        return null;
      }

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

  /**
   * Sign document using practitioner's certificate
   */
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
        throw new NDPError(
          ErrorCodes.SIGNATURE_FAILED,
          error.message || 'Signing failed',
          400
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Document signing error', error);
      throw new NDPError(ErrorCodes.SIGNATURE_FAILED, 'Signing service unavailable', 503);
    }
  }

  /**
   * Verify document signature
   */
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
          body: JSON.stringify({
            documentHash,
            signature,
            signerLicense,
          }),
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

// ============================================================================
// JWT Token Service (Internal tokens with Sunbird RC data)
// ============================================================================

class TokenService {
  private secret: string;
  private expiresIn: number;
  private refreshExpiresIn: number;

  constructor() {
    this.secret = JWT_CONFIG.secret;
    this.expiresIn = this.parseExpiry(JWT_CONFIG.expiresIn);
    this.refreshExpiresIn = this.parseExpiry(JWT_CONFIG.refreshExpiresIn);
  }

  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 3600;

    const value = parseInt(match[1]!, 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 3600;
    }
  }

  /**
   * Generate internal JWT token with practitioner info
   */
  generateToken(user: AuthUser): AuthToken {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: user.id,
      license: user.license,
      name: user.name,
      role: user.role,
      specialty: user.specialty,
      facilityId: user.facilityId,
      facilityName: user.facilityName,
      scopes: user.scopes,
      iat: now,
      exp: now + this.expiresIn,
    };

    const header = { alg: JWT_CONFIG.algorithm, typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const accessToken = `${headerB64}.${payloadB64}.${signature}`;

    // Generate refresh token
    const refreshPayload = {
      sub: user.id,
      type: 'refresh',
      iat: now,
      exp: now + this.refreshExpiresIn,
    };
    const refreshPayloadB64 = Buffer.from(JSON.stringify(refreshPayload)).toString('base64url');
    const refreshSignature = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerB64}.${refreshPayloadB64}`)
      .digest('base64url');

    const refreshToken = `${headerB64}.${refreshPayloadB64}.${refreshSignature}`;

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      scope: user.scopes.join(' '),
    };
  }

  /**
   * Verify and decode JWT token
   */
  verifyToken(token: string): AuthUser | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signature] = parts;

      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', this.secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

      if (signature !== expectedSignature) {
        logger.warn('Invalid token signature');
        return null;
      }

      // Decode payload
      const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());

      // Check expiration
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        logger.warn('Token expired');
        return null;
      }

      return {
        id: payload.sub,
        license: payload.license,
        name: payload.name,
        role: payload.role,
        specialty: payload.specialty,
        facilityId: payload.facilityId,
        facilityName: payload.facilityName,
        scopes: payload.scopes || [],
        issuedAt: payload.iat,
        expiresAt: payload.exp,
      };
    } catch (error) {
      logger.error('Token verification error', error);
      return null;
    }
  }
}

// ============================================================================
// Auth Service
// ============================================================================

const keycloakClient = new KeycloakClient();
const sunbirdClient = new SunbirdRCClient();
const tokenService = new TokenService();

class AuthService {
  /**
   * Login with Keycloak credentials, enrich with Sunbird RC practitioner data
   */
  async login(username: string, password: string): Promise<AuthToken> {
    // Authenticate with Keycloak
    const keycloakToken = await keycloakClient.authenticate(username, password);
    const userInfo = await keycloakClient.getUserInfo(keycloakToken.access_token);

    // Get practitioner info from Sunbird RC
    const licenseNumber = this.extractLicenseNumber(userInfo);
    let practitionerInfo: PractitionerInfo | null = null;

    if (licenseNumber) {
      practitionerInfo = await sunbirdClient.getPractitionerInfo(licenseNumber);
      
      if (practitionerInfo) {
        // Verify credential is still valid
        const verification = await sunbirdClient.verifyCredential(practitionerInfo.credentialId);
        if (!verification.verified) {
          throw new NDPError(
            ErrorCodes.CERTIFICATE_EXPIRED,
            `Practitioner credential is not valid: ${verification.reason}`,
            403
          );
        }

        if (practitionerInfo.status !== 'active') {
          throw new NDPError(
            ErrorCodes.FORBIDDEN,
            `Practitioner license is ${practitionerInfo.status}`,
            403
          );
        }
      }
    }

    // Build AuthUser
    const user: AuthUser = {
      id: userInfo.sub,
      license: practitionerInfo?.license || licenseNumber || userInfo.preferred_username,
      name: practitionerInfo?.name || userInfo.name,
      role: this.mapRole(userInfo.realm_access?.roles || []),
      specialty: practitionerInfo?.specialty,
      facilityId: practitionerInfo?.facilityId,
      facilityName: practitionerInfo?.facilityName,
      scopes: this.getScopesForRole(this.mapRole(userInfo.realm_access?.roles || [])),
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    // Generate internal JWT
    const token = tokenService.generateToken(user);

    logger.info('User logged in', { 
      userId: user.id, 
      license: user.license, 
      role: user.role 
    });

    return token;
  }

  /**
   * Refresh token
   */
  async refreshToken(refreshToken: string): Promise<AuthToken> {
    const user = tokenService.verifyToken(refreshToken);
    if (!user) {
      throw new NDPError(ErrorCodes.TOKEN_EXPIRED, 'Invalid or expired refresh token', 401);
    }

    // Re-verify practitioner status
    if (user.license) {
      const practitionerInfo = await sunbirdClient.getPractitionerInfo(user.license);
      if (practitionerInfo && practitionerInfo.status !== 'active') {
        throw new NDPError(
          ErrorCodes.FORBIDDEN,
          `Practitioner license is ${practitionerInfo.status}`,
          403
        );
      }
    }

    return tokenService.generateToken(user);
  }

  /**
   * Verify token and return user
   */
  verifyToken(token: string): AuthUser {
    const user = tokenService.verifyToken(token);
    if (!user) {
      throw new NDPError(ErrorCodes.INVALID_TOKEN, 'Invalid or expired token', 401);
    }
    return user;
  }

  /**
   * Get practitioner info
   */
  async getPractitionerInfo(licenseNumber: string): Promise<PractitionerInfo> {
    const info = await sunbirdClient.getPractitionerInfo(licenseNumber);
    if (!info) {
      throw new NDPError(ErrorCodes.CERTIFICATE_NOT_FOUND, 'Practitioner not found', 404);
    }
    return info;
  }

  /**
   * Sign document
   */
  async signDocument(
    documentHash: string,
    documentType: 'prescription' | 'dispense',
    user: AuthUser
  ): Promise<SignatureResponse> {
    // Verify user has signing permission
    if (!user.scopes.includes(`${documentType}.sign`)) {
      throw new NDPError(ErrorCodes.FORBIDDEN, `No permission to sign ${documentType}`, 403);
    }

    // Verify practitioner credential is valid
    const practitionerInfo = await sunbirdClient.getPractitionerInfo(user.license);
    if (!practitionerInfo || practitionerInfo.status !== 'active') {
      throw new NDPError(ErrorCodes.CERTIFICATE_EXPIRED, 'Practitioner credential is not active', 403);
    }

    // Sign with Sunbird RC
    const signature = await sunbirdClient.signDocument({
      documentHash,
      documentType,
      practitionerLicense: user.license,
    });

    logger.info('Document signed', {
      documentType,
      signerLicense: user.license,
      certificateId: signature.certificateId,
    });

    return signature;
  }

  /**
   * Verify signature
   */
  async verifySignature(
    documentHash: string,
    signature: string,
    signerLicense: string
  ): Promise<{ valid: boolean; reason?: string }> {
    return sunbirdClient.verifySignature(documentHash, signature, signerLicense);
  }

  /**
   * Logout
   */
  async logout(refreshToken: string): Promise<void> {
    await keycloakClient.logout(refreshToken);
    logger.info('User logged out');
  }

  private extractLicenseNumber(userInfo: KeycloakUserInfo): string | null {
    // Try to extract license from custom attributes or username
    // Format: EMS-XXXXX (Egyptian Medical Syndicate), PH-XXXXX (Pharmacist), etc.
    const licensePattern = /^(EMS|PH|NS|DT)-\d{5,}$/;
    
    if (userInfo.preferred_username && licensePattern.test(userInfo.preferred_username)) {
      return userInfo.preferred_username;
    }

    // Check email prefix
    const emailPrefix = userInfo.email?.split('@')[0];
    if (emailPrefix && licensePattern.test(emailPrefix)) {
      return emailPrefix;
    }

    return null;
  }

  private mapRole(keycloakRoles: string[]): UserRole {
    if (keycloakRoles.includes('admin')) return 'admin';
    if (keycloakRoles.includes('regulator') || keycloakRoles.includes('eda_regulator')) return 'regulator';
    if (keycloakRoles.includes('physician') || keycloakRoles.includes('doctor')) return 'physician';
    if (keycloakRoles.includes('pharmacist')) return 'pharmacist';
    if (keycloakRoles.includes('nurse')) return 'nurse';
    if (keycloakRoles.includes('integrator')) return 'integrator';
    return 'physician';
  }

  private getScopesForRole(role: UserRole): string[] {
    const scopes: Record<UserRole, string[]> = {
      physician: [
        'prescription.create',
        'prescription.sign',
        'prescription.view',
        'prescription.cancel',
        'patient.read',
        'medication.read',
      ],
      pharmacist: [
        'prescription.view',
        'dispense.create',
        'dispense.sign',
        'dispense.view',
        'patient.read',
        'medication.read',
      ],
      nurse: [
        'prescription.view',
        'patient.read',
        'medication.read',
      ],
      regulator: [
        'prescription.view',
        'dispense.view',
        'medication.read',
        'medication.update',
        'medication.recall',
        'audit.read',
      ],
      admin: [
        'user.manage',
        'system.configure',
        'audit.read',
        'prescription.view',
        'dispense.view',
        'medication.read',
      ],
      integrator: [
        'prescription.create',
        'prescription.view',
        'dispense.create',
        'dispense.view',
        'medication.read',
      ],
    };

    return scopes[role] || [];
  }
}

const authService = new AuthService();

// ============================================================================
// Request Validation Schemas
// ============================================================================

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

// ============================================================================
// Routes
// ============================================================================

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'auth-service', timestamp: new Date().toISOString() });
});

// Login
router.post('/api/auth/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = LoginSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }

    const token = await authService.login(validation.data.username, validation.data.password);
    res.json(token);
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post('/api/auth/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = RefreshSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }

    const token = await authService.refreshToken(validation.data.refreshToken);
    res.json(token);
  } catch (error) {
    next(error);
  }
});

// Verify token
router.get('/api/auth/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Missing authorization header', 401);
    }

    const token = authHeader.substring(7);
    const user = authService.verifyToken(token);
    res.json({ valid: true, user });
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/api/auth/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get practitioner info
router.get('/api/practitioners/:license', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const info = await authService.getPractitionerInfo(req.params.license!);
    res.json(info);
  } catch (error) {
    next(error);
  }
});

// Sign document
router.post('/api/sign', async (req: Request, res: Response, next: NextFunction) => {
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
  } catch (error) {
    next(error);
  }
});

// Verify signature
router.post('/api/verify-signature', async (req: Request, res: Response, next: NextFunction) => {
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
  } catch (error) {
    next(error);
  }
});

// OIDC Discovery endpoint
router.get('/.well-known/openid-configuration', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/auth`,
    token_endpoint: `${baseUrl}/api/auth/login`,
    userinfo_endpoint: `${baseUrl}/api/auth/verify`,
    jwks_uri: `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/certs`,
    scopes_supported: ['openid', 'profile', 'email', 'prescription.create', 'prescription.sign', 'dispense.create'],
    response_types_supported: ['code', 'token'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'password'],
  });
});

// ============================================================================
// Error Handler
// ============================================================================

function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Auth error', error, { method: req.method, path: req.path });

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
  logger.info('Starting Auth Service', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(compression());
  app.use(express.json());
  app.use('/', router);
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(`Auth Service listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

// Export for testing
export { authService, tokenService, sunbirdClient, keycloakClient };

import crypto from 'crypto';
import { JWT_CONFIG } from '../config/index.js';
import { AuthToken, AuthUser } from '../../../../shared/types/ndp.types.js';
import { createLogger } from '../../../../shared/utils/index.js';

const logger = createLogger('auth-service:token');

export class TokenService {
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

  verifyToken(token: string): AuthUser | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signature] = parts;

      const expectedSignature = crypto
        .createHmac('sha256', this.secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

      if (signature !== expectedSignature) {
        logger.warn('Invalid token signature');
        return null;
      }

      const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());

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

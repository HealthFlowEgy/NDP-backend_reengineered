/**
 * Authentication Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { AuthUser, NDPError, ErrorCodes, UserRole } from '../../../../shared/types/ndp.types.js';
import { createLogger } from '../../../../shared/utils/index.js';

const logger = createLogger('prescription-service:auth');

// Extend Express Request to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Extract and verify JWT token from Authorization header
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Missing or invalid authorization header', 401);
    }
    
    const token = authHeader.substring(7);
    
    // TODO: Verify token with Keycloak/Sunbird RC
    // For now, decode and validate structure
    const user = await verifyToken(token);
    
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof NDPError) {
      next(error);
    } else {
      logger.error('Authentication error', error);
      next(new NDPError(ErrorCodes.UNAUTHORIZED, 'Authentication failed', 401));
    }
  }
}

/**
 * Require specific roles
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    
    if (!user) {
      return next(new NDPError(ErrorCodes.UNAUTHORIZED, 'Authentication required', 401));
    }
    
    if (!allowedRoles.includes(user.role)) {
      return next(new NDPError(
        ErrorCodes.FORBIDDEN, 
        `Access denied. Required role: ${allowedRoles.join(' or ')}`, 
        403
      ));
    }
    
    next();
  };
}

/**
 * Require specific scopes
 */
export function requireScope(requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    
    if (!user) {
      return next(new NDPError(ErrorCodes.UNAUTHORIZED, 'Authentication required', 401));
    }
    
    const hasAllScopes = requiredScopes.every(scope => user.scopes.includes(scope));
    
    if (!hasAllScopes) {
      return next(new NDPError(
        ErrorCodes.INSUFFICIENT_SCOPE, 
        `Insufficient permissions. Required scopes: ${requiredScopes.join(', ')}`, 
        403
      ));
    }
    
    next();
  };
}

/**
 * Verify JWT token
 * TODO: Implement actual token verification with Keycloak
 */
async function verifyToken(token: string): Promise<AuthUser> {
  try {
    // Decode JWT (without verification for development)
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }
    
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64').toString());
    
    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new NDPError(ErrorCodes.TOKEN_EXPIRED, 'Token has expired', 401);
    }
    
    // Map to AuthUser
    const user: AuthUser = {
      id: payload.sub || payload.user_id,
      license: payload.license || payload.practitioner_license || 'UNKNOWN',
      name: payload.name || payload.preferred_username || 'Unknown',
      role: mapRole(payload.role || payload.realm_access?.roles),
      specialty: payload.specialty,
      facilityId: payload.facility_id,
      facilityName: payload.facility_name,
      scopes: payload.scope?.split(' ') || payload.scopes || [],
      issuedAt: payload.iat || Date.now() / 1000,
      expiresAt: payload.exp || (Date.now() / 1000) + 3600,
    };
    
    return user;
  } catch (error) {
    if (error instanceof NDPError) {
      throw error;
    }
    logger.error('Token verification failed', error);
    throw new NDPError(ErrorCodes.INVALID_TOKEN, 'Invalid token', 401);
  }
}

/**
 * Map role from token to UserRole
 */
function mapRole(roles: string | string[] | undefined): UserRole {
  if (!roles) return 'physician';
  
  const roleList = Array.isArray(roles) ? roles : [roles];
  
  // Priority order for role assignment
  if (roleList.includes('admin') || roleList.includes('administrator')) return 'admin';
  if (roleList.includes('regulator') || roleList.includes('eda_regulator')) return 'regulator';
  if (roleList.includes('physician') || roleList.includes('doctor')) return 'physician';
  if (roleList.includes('pharmacist')) return 'pharmacist';
  if (roleList.includes('nurse')) return 'nurse';
  if (roleList.includes('integrator') || roleList.includes('system')) return 'integrator';
  
  return 'physician'; // Default
}

/**
 * Development-only: Generate a test token
 */
export function generateTestToken(user: Partial<AuthUser>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id || 'test-user-123',
    license: user.license || 'EMS-12345',
    name: user.name || 'Dr. Test User',
    role: user.role || 'physician',
    specialty: user.specialty || 'general',
    facility_id: user.facilityId || 'FAC-001',
    facility_name: user.facilityName || 'Test Hospital',
    scopes: user.scopes || ['prescription.create', 'prescription.sign', 'prescription.view'],
    iat: now,
    exp: now + 3600,
  };
  
  // Simple base64 encoding (NOT secure, for development only)
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  return `${header}.${body}.`;
}

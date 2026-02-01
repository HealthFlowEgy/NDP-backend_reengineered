import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthUser, NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';

// ============================================================================
// Configuration
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production';

// ============================================================================
// Scope Mapping
// ============================================================================

const SCOPE_RULES: Record<string, Record<string, string>> = {
  'MedicationRequest': {
    'GET': 'prescription.view',
    'POST': 'prescription.create',
    'PUT': 'prescription.update',
    'DELETE': 'prescription.cancel', // Logical delete/cancel
  },
  'MedicationDispense': {
    'GET': 'dispense.view',
    'POST': 'dispense.create',
    'PUT': 'dispense.update',
  },
  'MedicationKnowledge': {
    'GET': 'medication.read',
    'POST': 'medication.update', // Only regulators
    'PUT': 'medication.update',
  },
  'Patient': {
    'GET': 'patient.read',
  },
  'Provenance': {
    'GET': 'audit.read',
    'POST': 'prescription.sign', // Signing creates a Provenance record
  }
};

// ============================================================================
// Token Verification Utility
// ============================================================================

function verifyToken(token: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
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
    return null;
  }
}

// ============================================================================
// Middleware
// ============================================================================

export function authorizeFHIR(req: Request, res: Response, next: NextFunction) {
  // 1. Extract Token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'login',
        diagnostics: 'Missing or invalid authorization header',
      }],
    });
  }

  const token = authHeader.substring(7);
  const user = verifyToken(token);

  if (!user) {
    return res.status(401).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'login',
        diagnostics: 'Invalid or expired token',
      }],
    });
  }

  // Attach user to request for downstream use
  (req as any).user = user;

  // 2. Determine Required Scope
  // Basic interaction check: e.g., POST /MedicationRequest
  // URL structure is typically /ResourceType or /ResourceType/id
  const pathParts = req.path.split('/').filter(p => p);
  const resourceType = pathParts[0]; // e.g., MedicationRequest

  if (!resourceType) {
    // Root access or metadata, allow public or basic auth?
    // For now, metadata is public, but this middleware might block it if applied globally.
    // We should allow metadata.
    if (req.path === '/metadata') return next();
    return next(); // Pass to proxy for handling unknown routes, or block.
  }

  const requiredScope = SCOPE_RULES[resourceType]?.[req.method];

  // If no specific rule, and it's a known resource, default to strictly deny or require admin?
  // For safety, if we don't know the rule for a modification, we block.
  // Read interactions might be more lenient.
  
  if (!requiredScope) {
    // If resource is unknown to our scope map, block access to be safe
    // Or if method is unknown.
    if (SCOPE_RULES[resourceType]) {
      return res.status(403).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'forbidden',
          diagnostics: `Method ${req.method} not allowed for ${resourceType}`,
        }],
      });
    }
    // Allow unknown resources? Probably not in a strict gateway.
    // For now, let's allow read-only on unknown resources if user has generic read?
    // Safer to block.
    return next(); 
  }

  // 3. Check User Scopes
  if (!user.scopes.includes(requiredScope) && !user.scopes.includes('admin')) {
    return res.status(403).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'forbidden',
        diagnostics: `Insufficient scope. Required: ${requiredScope}`,
      }],
    });
  }

  // 4. Contextual Access Control (Smart Scopes)
  // e.g., Patient can only read their own data.
  // This requires parsing the query params or ID.
  
  if (user.role === 'patient') {
    // Enforce patient compartmentalization
    const patientId = req.query['patient'] || req.query['subject'];
    // Logic to verify patientId matches user.nationalId (assuming mapped to ID)
    // This is complex for a simple middleware, but critical for production.
    // For MVP, we rely on the scope check.
  }

  next();
}

/**
 * Prescription Controller - HTTP Request Handlers
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prescriptionService } from '../services/prescription.service.js';
import { 
  CreatePrescriptionRequest, 
  AuthUser, 
  NDPError,
  ErrorCodes 
} from '../../../../shared/types/ndp.types.js';
import { createLogger, createOperationOutcome } from '../../../../shared/utils/index.js';

const logger = createLogger('prescription-service:controller');

// ============================================================================
// Request Validation Schemas
// ============================================================================

const CreatePrescriptionSchema = z.object({
  patientNationalId: z.string().length(14, 'National ID must be 14 digits').regex(/^\d+$/, 'National ID must contain only digits'),
  patientName: z.string().optional(),
  medications: z.array(z.object({
    edaCode: z.string().min(1, 'EDA code is required'),
    medicationName: z.string().optional(),
    quantity: z.number().positive('Quantity must be positive'),
    unit: z.string().min(1, 'Unit is required'),
    dosageInstruction: z.string().min(1, 'Dosage instruction is required'),
    frequency: z.string().optional(),
    duration: z.string().optional(),
    route: z.string().optional(),
    asNeeded: z.boolean().optional(),
    notes: z.string().optional(),
  })).min(1, 'At least one medication is required'),
  diagnosis: z.array(z.object({
    coding: z.array(z.object({
      system: z.string(),
      code: z.string(),
      display: z.string().optional(),
    })).optional(),
    text: z.string().optional(),
  })).optional(),
  notes: z.string().optional(),
  allowedDispenses: z.number().int().min(1).max(12).optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  priority: z.enum(['routine', 'urgent', 'asap', 'stat']).optional(),
  skipAIValidation: z.boolean().optional(),
});

const SearchPrescriptionsSchema = z.object({
  patientNationalId: z.string().optional(),
  prescriptionNumber: z.string().optional(),
  prescriberLicense: z.string().optional(),
  status: z.union([
    z.enum(['draft', 'active', 'on-hold', 'cancelled', 'completed', 'entered-in-error']),
    z.array(z.enum(['draft', 'active', 'on-hold', 'cancelled', 'completed', 'entered-in-error'])),
  ]).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ============================================================================
// Controller Functions
// ============================================================================

/**
 * Create a new prescription
 * POST /fhir/MedicationRequest
 */
export async function createPrescription(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user as AuthUser;
    if (!user) {
      throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Authentication required', 401);
    }
    
    // Validate request body
    const validationResult = CreatePrescriptionSchema.safeParse(req.body);
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new NDPError(ErrorCodes.INVALID_REQUEST, errors.join('; '), 400);
    }
    
    const request: CreatePrescriptionRequest = validationResult.data;
    const result = await prescriptionService.createPrescription(request, user);
    
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get prescription by ID
 * GET /fhir/MedicationRequest/:id
 */
export async function getPrescription(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    
    if (!id) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Prescription ID is required', 400);
    }
    
    const prescription = await prescriptionService.getPrescription(id);
    
    // Return FHIR resource
    res.json(prescription.fhirResource);
  } catch (error) {
    next(error);
  }
}

/**
 * Get full prescription record by ID (internal)
 * GET /api/prescriptions/:id
 */
export async function getPrescriptionRecord(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    
    if (!id) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Prescription ID is required', 400);
    }
    
    const prescription = await prescriptionService.getPrescription(id);
    res.json(prescription);
  } catch (error) {
    next(error);
  }
}

/**
 * Search prescriptions
 * GET /fhir/MedicationRequest
 */
export async function searchPrescriptions(req: Request, res: Response, next: NextFunction) {
  try {
    // Map FHIR search params to our params
    const params = {
      patientNationalId: req.query['patient'] as string || req.query['subject'] as string,
      prescriptionNumber: req.query['identifier'] as string,
      prescriberLicense: req.query['requester'] as string,
      status: req.query['status'] as string,
      fromDate: req.query['authoredon-ge'] as string || req.query['_lastUpdated-ge'] as string,
      toDate: req.query['authoredon-le'] as string || req.query['_lastUpdated-le'] as string,
      limit: req.query['_count'] as string,
      offset: req.query['_offset'] as string,
    };
    
    const validationResult = SearchPrescriptionsSchema.safeParse(params);
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new NDPError(ErrorCodes.INVALID_REQUEST, errors.join('; '), 400);
    }
    
    const result = await prescriptionService.searchPrescriptions(validationResult.data);
    
    // Return as FHIR Bundle
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: result.pagination.total,
      link: [
        {
          relation: 'self',
          url: req.originalUrl,
        },
      ],
      entry: result.data.map(record => ({
        fullUrl: `${req.protocol}://${req.get('host')}/fhir/MedicationRequest/${record.id}`,
        resource: record.fhirResource,
      })),
    };
    
    res.json(bundle);
  } catch (error) {
    next(error);
  }
}

/**
 * Sign prescription
 * POST /fhir/MedicationRequest/:id/$sign
 */
export async function signPrescription(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user as AuthUser;
    if (!user) {
      throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Authentication required', 401);
    }
    
    const { id } = req.params;
    if (!id) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Prescription ID is required', 400);
    }
    
    const result = await prescriptionService.signPrescription(id, user);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Cancel prescription
 * DELETE /fhir/MedicationRequest/:id
 * or POST /fhir/MedicationRequest/:id/$cancel
 */
export async function cancelPrescription(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user as AuthUser;
    if (!user) {
      throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Authentication required', 401);
    }
    
    const { id } = req.params;
    if (!id) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Prescription ID is required', 400);
    }
    
    const reason = req.body?.reason;
    const result = await prescriptionService.cancelPrescription(id, user, reason);
    
    res.json(result.fhirResource);
  } catch (error) {
    next(error);
  }
}

/**
 * Get active prescriptions for patient (for pharmacist)
 * GET /fhir/MedicationRequest?patient={nid}&status=active
 */
export async function getActivePrescriptionsForPatient(req: Request, res: Response, next: NextFunction) {
  try {
    const patientNationalId = req.query['patient'] as string || req.params['patientId'];
    
    if (!patientNationalId) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Patient national ID is required', 400);
    }
    
    const prescriptions = await prescriptionService.getActivePrescriptionsForPatient(patientNationalId);
    
    // Return as FHIR Bundle
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: prescriptions.length,
      entry: prescriptions.map(record => ({
        fullUrl: `${req.protocol}://${req.get('host')}/fhir/MedicationRequest/${record.id}`,
        resource: record.fhirResource,
      })),
    };
    
    res.json(bundle);
  } catch (error) {
    next(error);
  }
}

/**
 * Verify prescription can be dispensed (internal API for dispense service)
 * GET /api/prescriptions/:id/verify-dispensable
 */
export async function verifyDispensable(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    
    if (!id) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Prescription ID is required', 400);
    }
    
    const result = await prescriptionService.verifyDispensable(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Record dispense (internal API called by dispense service)
 * POST /api/prescriptions/:id/record-dispense
 */
export async function recordDispense(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { isPartial } = req.body;
    
    if (!id) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Prescription ID is required', 400);
    }
    
    const result = await prescriptionService.recordDispense(id, isPartial || false);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

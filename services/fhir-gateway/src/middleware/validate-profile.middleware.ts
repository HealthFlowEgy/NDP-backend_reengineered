import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// ============================================================================
// Validation Schemas (Simulating Profile Constraints)
// ============================================================================

const FHIR_CODING_SYSTEMS = {
  EDA: 'http://eda.mohp.gov.eg/medications',
  NATIONAL_ID: 'http://mohp.gov.eg/national-id',
  LICENSE_PHYSICIAN: 'http://syndicate.eg/physician',
  LICENSE_PHARMACIST: 'http://syndicate.eg/pharmacist',
};

// Basic FHIR Resource Schema
const ResourceSchema = z.object({
  resourceType: z.string(),
  meta: z.object({
    profile: z.array(z.string()).optional(),
  }).optional(),
}).passthrough();

// Egypt MedicationRequest Profile Validator
const MedicationRequestSchema = ResourceSchema.extend({
  resourceType: z.literal('MedicationRequest'),
  subject: z.object({
    identifier: z.object({
      system: z.string().refine(val => val === FHIR_CODING_SYSTEMS.NATIONAL_ID || val.includes('national-id'), {
        message: 'Patient identifier must be a National ID',
      }),
      value: z.string().length(14, 'National ID must be 14 digits'),
    }),
  }),
  medicationCodeableConcept: z.object({
    coding: z.array(z.object({
      system: z.string().refine(val => val === FHIR_CODING_SYSTEMS.EDA, {
        message: 'Medication must use EDA coding system',
      }),
      code: z.string().min(1),
    })).min(1),
  }),
  requester: z.object({
    identifier: z.object({
      value: z.string().min(1), // License number
    }),
  }),
});

// Egypt MedicationDispense Profile Validator
const MedicationDispenseSchema = ResourceSchema.extend({
  resourceType: z.literal('MedicationDispense'),
  authorizingPrescription: z.array(z.object({
    reference: z.string().startsWith('MedicationRequest/'),
  })).min(1, 'Must link to an authorizing prescription'),
  performer: z.array(z.object({
    actor: z.object({
      identifier: z.object({
        value: z.string().min(1), // Pharmacist license
      }),
    }),
  })).min(1),
});

// ============================================================================
// Middleware
// ============================================================================

export function validateFHIRProfile(req: Request, res: Response, next: NextFunction) {
  // Only validate write operations (POST, PUT)
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return next();
  }

  const resourceType = req.body.resourceType;

  try {
    if (resourceType === 'MedicationRequest') {
      MedicationRequestSchema.parse(req.body);
    } 
    else if (resourceType === 'MedicationDispense') {
      MedicationDispenseSchema.parse(req.body);
    }
    // Allow other resources to pass for now, or block strict
    
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: error.errors.map(err => ({
          severity: 'error',
          code: 'invariant',
          diagnostics: `${err.path.join('.')}: ${err.message}`,
        })),
      });
    }
    next(error);
  }
}

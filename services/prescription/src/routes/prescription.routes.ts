/**
 * Prescription Service - Routes
 */

import { Router } from 'express';
import {
  createPrescription,
  getPrescription,
  getPrescriptionRecord,
  searchPrescriptions,
  signPrescription,
  cancelPrescription,
  getActivePrescriptionsForPatient,
  verifyDispensable,
  recordDispense,
} from '../controllers/prescription.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// ============================================================================
// FHIR-Compliant Routes
// ============================================================================

// Search prescriptions (FHIR searchset Bundle)
router.get('/fhir/MedicationRequest', authMiddleware, searchPrescriptions);

// Create prescription (FHIR MedicationRequest)
router.post('/fhir/MedicationRequest', authMiddleware, requireRole(['physician']), createPrescription);

// Get prescription by ID (FHIR MedicationRequest)
router.get('/fhir/MedicationRequest/:id', authMiddleware, getPrescription);

// Sign prescription (FHIR operation)
router.post('/fhir/MedicationRequest/:id/\\$sign', authMiddleware, requireRole(['physician']), signPrescription);

// Cancel prescription (FHIR operation)
router.post('/fhir/MedicationRequest/:id/\\$cancel', authMiddleware, requireRole(['physician']), cancelPrescription);
router.delete('/fhir/MedicationRequest/:id', authMiddleware, requireRole(['physician']), cancelPrescription);

// ============================================================================
// Internal API Routes (for service-to-service communication)
// ============================================================================

// Get full prescription record
router.get('/api/prescriptions/:id', authMiddleware, getPrescriptionRecord);

// Get active prescriptions for patient (pharmacist use)
router.get('/api/prescriptions/patient/:patientId/active', authMiddleware, requireRole(['pharmacist', 'physician']), getActivePrescriptionsForPatient);

// Verify prescription can be dispensed
router.get('/api/prescriptions/:id/verify-dispensable', authMiddleware, verifyDispensable);

// Record dispense (called by dispense service)
router.post('/api/prescriptions/:id/record-dispense', authMiddleware, recordDispense);

// ============================================================================
// Health Check
// ============================================================================

router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'prescription-service',
    timestamp: new Date().toISOString() 
  });
});

router.get('/ready', async (req, res) => {
  // TODO: Check database connection
  res.json({ 
    status: 'ready', 
    service: 'prescription-service',
    timestamp: new Date().toISOString() 
  });
});

export default router;

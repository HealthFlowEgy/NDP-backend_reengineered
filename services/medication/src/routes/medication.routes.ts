import { Router } from 'express';
import { MedicationController } from '../controllers/medication.controller.js';

const router = Router();
const controller = new MedicationController();

// Health check
router.get('/health', (req, res) => res.json({ status: 'healthy', service: 'medication-directory' }));

// FHIR Routes
router.get('/fhir/MedicationKnowledge', controller.search.bind(controller));
router.get('/fhir/MedicationKnowledge/:id', controller.getById.bind(controller));

// API Routes
router.get('/api/medications/:edaCode', controller.getByCode.bind(controller));
router.post('/api/medications/validate', controller.validate.bind(controller));
router.post('/api/medications/:edaCode/recall', controller.recall.bind(controller));
router.post('/api/medications/:edaCode/reactivate', controller.reactivate.bind(controller));

export default router;

import { Router } from 'express';
import { regulatorController } from '../controllers/regulator.controller.js';

const router = Router();

// Health
router.get('/health', (req, res) => res.json({ status: 'healthy', service: 'regulator-service' }));

// Dashboard
router.get('/api/regulator/dashboard', regulatorController.getDashboard.bind(regulatorController));
router.get('/api/regulator/trends', regulatorController.getTrends.bind(regulatorController));

// Recalls
router.post('/api/regulator/recalls', regulatorController.initiateRecall.bind(regulatorController));
router.get('/api/regulator/recalls', regulatorController.getRecalls.bind(regulatorController));
router.patch('/api/regulator/recalls/:id/status', regulatorController.updateRecall.bind(regulatorController));

// Alerts
router.get('/api/regulator/alerts', regulatorController.getAlerts.bind(regulatorController));
router.post('/api/regulator/compliance/check', regulatorController.runChecks.bind(regulatorController));

export default router;

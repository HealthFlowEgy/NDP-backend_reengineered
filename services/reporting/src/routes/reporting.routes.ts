import { Router } from 'express';
import { reportingController } from '../controllers/reporting.controller.js';

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'healthy', service: 'reporting-service' }));

router.post('/api/reports', reportingController.createReport.bind(reportingController));
router.get('/api/reports', reportingController.listJobs.bind(reportingController));
router.get('/api/reports/:id', reportingController.getJob.bind(reportingController));
router.get('/api/reports/:id/download', reportingController.downloadReport.bind(reportingController));

export default router;

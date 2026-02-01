import { Router } from 'express';
import { soapController } from '../controllers/soap.controller.js';

const router = Router();

router.post('/soap/prescription', soapController.handleSOAP.bind(soapController));
router.get('/health', (req, res) => res.json({ status: 'healthy', service: 'legacy-soap' }));

export default router;

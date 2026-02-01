import { Router } from 'express';
import { signingController } from '../controllers/signing.controller.js';

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'healthy', service: 'signing-service' }));

router.post('/api/signatures/sign', signingController.sign.bind(signingController));
router.post('/api/signatures/verify', signingController.verify.bind(signingController));
router.get('/api/certificates/:license', signingController.getCertificate.bind(signingController));
router.get('/api/documents/:documentId/signatures', signingController.getDocumentSignatures.bind(signingController));
router.post('/fhir/Provenance', signingController.createProvenance.bind(signingController));

export default router;

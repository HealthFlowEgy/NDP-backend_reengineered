import { Router } from 'express';
import { DispenseController } from '../controllers/dispense.controller.js';

const router = Router();
const controller = new DispenseController();

// Mock Auth Middleware (In production, this would be a shared JWT validator or Gateway handled)
const mockAuth = (req: any, res: any, next: any) => {
  req.user = {
    id: 'test-pharmacist',
    license: 'PH-12345',
    name: 'Dr. Pharmacist',
    role: 'pharmacist'
  };
  next();
};

router.post('/fhir/MedicationDispense', mockAuth, controller.create.bind(controller));
router.get('/fhir/MedicationDispense/:id', mockAuth, controller.getOne.bind(controller));
router.get('/fhir/MedicationDispense', mockAuth, controller.search.bind(controller));

export default router;

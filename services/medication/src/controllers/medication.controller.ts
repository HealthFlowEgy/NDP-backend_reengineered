import { Request, Response, NextFunction } from 'express';
import { medicationService } from '../services/medication.service.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';

export class MedicationController {
  
  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await medicationService.searchMedications({
        query: req.query.name as string,
        edaCode: req.query.code as string,
        status: req.query.status as string,
        limit: parseInt(req.query._count as string) || 20,
        offset: parseInt(req.query._offset as string) || 0,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const med = await medicationService.getMedicationById(req.params.id!);
      res.json(med.fhirResource);
    } catch (error) {
      next(error);
    }
  }

  async getByCode(req: Request, res: Response, next: NextFunction) {
    try {
      const med = await medicationService.getMedication(req.params.edaCode!);
      res.json(med);
    } catch (error) {
      next(error);
    }
  }

  async validate(req: Request, res: Response, next: NextFunction) {
    try {
      const { edaCodes } = req.body;
      if (!Array.isArray(edaCodes) || edaCodes.length === 0) {
        throw new NDPError(ErrorCodes.INVALID_REQUEST, 'edaCodes array is required', 400);
      }
      const result = await medicationService.validateMedications(edaCodes);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async recall(req: Request, res: Response, next: NextFunction) {
    try {
      const { reason, batchNumbers } = req.body;
      if (!reason) throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Reason is required', 400);
      
      const med = await medicationService.recallMedication(req.params.edaCode!, reason, batchNumbers);
      res.json(med);
    } catch (error) {
      next(error);
    }
  }

  async reactivate(req: Request, res: Response, next: NextFunction) {
    try {
      const med = await medicationService.reactivateMedication(req.params.edaCode!);
      res.json(med);
    } catch (error) {
      next(error);
    }
  }
}

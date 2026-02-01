import { Request, Response, NextFunction } from 'express';
import { DispenseService } from '../services/dispense.service.js';
import { NDPError } from '../../../../shared/types/ndp.types.js';

const service = new DispenseService();

export class DispenseController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.headers.authorization?.split(' ')[1] || '';
      const user = (req as any).user; // Assumes auth middleware ran upstream or mock
      
      // Basic validation of body
      if (!req.body.dispensedItems || !Array.isArray(req.body.dispensedItems)) {
        throw new NDPError('INVALID_REQUEST', 'dispensedItems must be an array', 400);
      }

      const result = await service.createDispense(req.body, user, token);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.headers.authorization?.split(' ')[1] || '';
      const result = await service.getDispense(req.params.id!, token);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.headers.authorization?.split(' ')[1] || '';
      const result = await service.searchDispenses(req.query, token);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

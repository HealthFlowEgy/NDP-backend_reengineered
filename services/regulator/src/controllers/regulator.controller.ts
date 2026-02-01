import { Request, Response, NextFunction } from 'express';
import { drugRecallService } from '../services/drug-recall.service.js';
import { complianceService } from '../services/compliance.service.js';
import { analyticsService } from '../services/analytics.service.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';

export class RegulatorController {
  
  // Dashboard & Analytics
  async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await analyticsService.getDashboardStats();
      res.json(stats);
    } catch (error) { next(error); }
  }

  async getTrends(req: Request, res: Response, next: NextFunction) {
    try {
      const trends = await analyticsService.getPrescriptionTrends(
        req.query.period as string || 'day', 
        parseInt(req.query.days as string) || 30
      );
      res.json(trends);
    } catch (error) { next(error); }
  }

  // Recalls
  async initiateRecall(req: Request, res: Response, next: NextFunction) {
    try {
      const recall = await drugRecallService.initiateRecall(req.body);
      res.status(201).json(recall);
    } catch (error) { next(error); }
  }

  async getRecalls(req: Request, res: Response, next: NextFunction) {
    try {
      const recalls = drugRecallService.searchRecalls(req.query);
      res.json(recalls);
    } catch (error) { next(error); }
  }

  async updateRecall(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, notes } = req.body;
      const recall = await drugRecallService.updateRecallStatus(req.params.id!, status, 'admin', notes);
      res.json(recall);
    } catch (error) { next(error); }
  }

  // Alerts
  async getAlerts(req: Request, res: Response, next: NextFunction) {
    try {
      const alerts = complianceService.searchAlerts(req.query);
      res.json(alerts);
    } catch (error) { next(error); }
  }

  async runChecks(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await complianceService.runComplianceChecks();
      res.json(result);
    } catch (error) { next(error); }
  }
}

export const regulatorController = new RegulatorController();

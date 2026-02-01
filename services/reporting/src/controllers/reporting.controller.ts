import { Request, Response, NextFunction } from 'express';
import { reportGenerator } from '../services/report-generator.service.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';

export class ReportingController {
  
  async createReport(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await reportGenerator.generateReport({
        ...req.body,
        requestedBy: req.headers['x-user-id'] || 'anonymous',
      });
      res.status(202).json(job);
    } catch (error) { next(error); }
  }

  async getJob(req: Request, res: Response, next: NextFunction) {
    try {
      const job = reportGenerator.getJob(req.params.id!);
      if (!job) throw new NDPError(ErrorCodes.NOT_FOUND, 'Job not found', 404);
      res.json(job);
    } catch (error) { next(error); }
  }

  async downloadReport(req: Request, res: Response, next: NextFunction) {
    try {
      const data = reportGenerator.getReportData(req.params.id!);
      if (!data) throw new NDPError(ErrorCodes.NOT_FOUND, 'Report data not found', 404);
      res.json(data);
    } catch (error) { next(error); }
  }

  async listJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const jobs = reportGenerator.listJobs(req.query.userId as string);
      res.json(jobs);
    } catch (error) { next(error); }
  }
}

export const reportingController = new ReportingController();

import { createLogger, generateUUID, toFHIRDateTime } from '../../../../shared/utils/index.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';

const logger = createLogger('reporting-service:generator');

export type ReportType = 'prescription_summary' | 'dispense_summary' | 'daily_summary' | 'monthly_summary';
export type ReportFormat = 'json' | 'csv';

export interface ReportJob {
  id: string;
  type: ReportType;
  format: ReportFormat;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  parameters: any;
  requestedBy: string;
  requestedAt: string;
  completedAt?: string;
  downloadUrl?: string;
}

const reportJobStore: Map<string, ReportJob> = new Map();
const reportDataStore: Map<string, any> = new Map();

export class ReportGeneratorService {
  async generateReport(request: any): Promise<ReportJob> {
    const job: ReportJob = {
      id: generateUUID(),
      type: request.type,
      format: request.format || 'json',
      status: 'pending',
      parameters: request.parameters,
      requestedBy: request.requestedBy,
      requestedAt: toFHIRDateTime(new Date()),
    };

    reportJobStore.set(job.id, job);
    
    // Process async
    this.processReport(job).catch(err => {
      logger.error('Report failed', err);
      job.status = 'failed';
      reportJobStore.set(job.id, job);
    });

    return job;
  }

  private async processReport(job: ReportJob) {
    job.status = 'processing';
    reportJobStore.set(job.id, job);

    // Mock data generation
    const data = {
      title: `${job.type} Report`,
      generatedAt: new Date().toISOString(),
      rows: Array.from({ length: 50 }, (_, i) => ({ id: i, value: Math.random() * 100 })),
    };

    reportDataStore.set(job.id, data);
    
    job.status = 'completed';
    job.completedAt = toFHIRDateTime(new Date());
    job.downloadUrl = `/api/reports/${job.id}/download`;
    reportJobStore.set(job.id, job);
  }

  getJob(id: string) {
    return reportJobStore.get(id);
  }

  getReportData(id: string) {
    return reportDataStore.get(id);
  }

  listJobs(userId?: string) {
    return Array.from(reportJobStore.values())
      .filter(j => !userId || j.requestedBy === userId);
  }
}

export const reportGenerator = new ReportGeneratorService();

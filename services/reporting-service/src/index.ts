/**
 * Reporting Service
 * Generate PDF and Excel reports for prescriptions, dispenses, and analytics
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';

import { loadConfig } from '../../../shared/config/index.js';
import { createLogger, generateUUID, toFHIRDateTime } from '../../../shared/utils/index.js';
import { NDPError, ErrorCodes } from '../../../shared/types/ndp.types.js';

const config = loadConfig('reporting-service');
const logger = createLogger('reporting-service', config.logLevel);

// Service URLs
const SERVICES = {
  prescription: process.env['PRESCRIPTION_SERVICE_URL'] || 'http://localhost:3001',
  dispense: process.env['DISPENSE_SERVICE_URL'] || 'http://localhost:3002',
  medication: process.env['MEDICATION_SERVICE_URL'] || 'http://localhost:3003',
  regulator: process.env['REGULATOR_SERVICE_URL'] || 'http://localhost:3009',
};

// ============================================================================
// Types
// ============================================================================

type ReportType = 
  | 'prescription_summary'
  | 'dispense_summary'
  | 'patient_history'
  | 'physician_activity'
  | 'pharmacy_activity'
  | 'medication_usage'
  | 'controlled_substances'
  | 'compliance_report'
  | 'recall_report'
  | 'daily_summary'
  | 'monthly_summary';

type ReportFormat = 'json' | 'csv' | 'pdf' | 'xlsx';

interface ReportRequest {
  type: ReportType;
  format: ReportFormat;
  parameters: Record<string, any>;
  requestedBy: string;
}

interface ReportJob {
  id: string;
  type: ReportType;
  format: ReportFormat;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  parameters: Record<string, any>;
  requestedBy: string;
  requestedAt: string;
  completedAt?: string;
  downloadUrl?: string;
  error?: string;
  metadata?: {
    rowCount?: number;
    fileSize?: number;
    generationTime?: number;
  };
}

interface ReportData {
  title: string;
  subtitle?: string;
  generatedAt: string;
  generatedBy: string;
  period?: { from: string; to: string };
  headers: string[];
  rows: any[][];
  summary?: Record<string, any>;
  charts?: Array<{
    type: 'bar' | 'line' | 'pie';
    title: string;
    data: any[];
  }>;
}

// ============================================================================
// Report Store (In production, use Redis/S3)
// ============================================================================

const reportJobStore: Map<string, ReportJob> = new Map();
const reportDataStore: Map<string, ReportData> = new Map();

// ============================================================================
// Report Generators
// ============================================================================

class ReportGeneratorService {
  /**
   * Generate a report
   */
  async generateReport(request: ReportRequest): Promise<ReportJob> {
    const job: ReportJob = {
      id: generateUUID(),
      type: request.type,
      format: request.format,
      status: 'pending',
      parameters: request.parameters,
      requestedBy: request.requestedBy,
      requestedAt: toFHIRDateTime(new Date()),
    };

    reportJobStore.set(job.id, job);

    // Process async
    this.processReport(job).catch(err => {
      logger.error('Report generation failed', err, { jobId: job.id });
      job.status = 'failed';
      job.error = err.message;
      reportJobStore.set(job.id, job);
    });

    return job;
  }

  /**
   * Process report generation
   */
  private async processReport(job: ReportJob): Promise<void> {
    const startTime = Date.now();
    job.status = 'processing';
    reportJobStore.set(job.id, job);

    logger.info('Processing report', { jobId: job.id, type: job.type });

    // Generate report data based on type
    let reportData: ReportData;

    switch (job.type) {
      case 'prescription_summary':
        reportData = await this.generatePrescriptionSummary(job.parameters);
        break;
      case 'dispense_summary':
        reportData = await this.generateDispenseSummary(job.parameters);
        break;
      case 'patient_history':
        reportData = await this.generatePatientHistory(job.parameters);
        break;
      case 'physician_activity':
        reportData = await this.generatePhysicianActivity(job.parameters);
        break;
      case 'pharmacy_activity':
        reportData = await this.generatePharmacyActivity(job.parameters);
        break;
      case 'medication_usage':
        reportData = await this.generateMedicationUsage(job.parameters);
        break;
      case 'controlled_substances':
        reportData = await this.generateControlledSubstances(job.parameters);
        break;
      case 'daily_summary':
        reportData = await this.generateDailySummary(job.parameters);
        break;
      case 'monthly_summary':
        reportData = await this.generateMonthlySummary(job.parameters);
        break;
      default:
        throw new Error(`Unknown report type: ${job.type}`);
    }

    // Store report data
    reportDataStore.set(job.id, reportData);

    // Update job status
    job.status = 'completed';
    job.completedAt = toFHIRDateTime(new Date());
    job.downloadUrl = `/api/reports/${job.id}/download`;
    job.metadata = {
      rowCount: reportData.rows.length,
      generationTime: Date.now() - startTime,
    };
    reportJobStore.set(job.id, job);

    logger.info('Report completed', { 
      jobId: job.id, 
      rowCount: reportData.rows.length,
      generationTime: job.metadata.generationTime 
    });
  }

  /**
   * Get report job status
   */
  getJob(jobId: string): ReportJob | null {
    return reportJobStore.get(jobId) || null;
  }

  /**
   * Get report data for download
   */
  getReportData(jobId: string): ReportData | null {
    return reportDataStore.get(jobId) || null;
  }

  /**
   * List recent report jobs
   */
  listJobs(userId?: string, limit: number = 20): ReportJob[] {
    let jobs = Array.from(reportJobStore.values());
    
    if (userId) {
      jobs = jobs.filter(j => j.requestedBy === userId);
    }

    return jobs
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, limit);
  }

  // ============================================================================
  // Report Type Generators
  // ============================================================================

  private async generatePrescriptionSummary(params: Record<string, any>): Promise<ReportData> {
    const fromDate = params.fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const toDate = params.toDate || new Date().toISOString();

    // In production, fetch from prescription service
    const rows = this.generateSamplePrescriptionData(50);

    return {
      title: 'Prescription Summary Report',
      subtitle: `Period: ${fromDate.split('T')[0]} to ${toDate.split('T')[0]}`,
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      period: { from: fromDate, to: toDate },
      headers: [
        'Prescription #',
        'Date',
        'Patient NID',
        'Physician',
        'Medications',
        'Status',
        'Dispenses',
      ],
      rows,
      summary: {
        totalPrescriptions: rows.length,
        active: rows.filter(r => r[5] === 'Active').length,
        completed: rows.filter(r => r[5] === 'Completed').length,
        cancelled: rows.filter(r => r[5] === 'Cancelled').length,
      },
    };
  }

  private async generateDispenseSummary(params: Record<string, any>): Promise<ReportData> {
    const rows = this.generateSampleDispenseData(40);

    return {
      title: 'Dispense Summary Report',
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      headers: [
        'Dispense ID',
        'Date',
        'Prescription #',
        'Pharmacy',
        'Pharmacist',
        'Items',
        'Partial',
      ],
      rows,
      summary: {
        totalDispenses: rows.length,
        fullDispenses: rows.filter(r => r[6] === 'No').length,
        partialDispenses: rows.filter(r => r[6] === 'Yes').length,
      },
    };
  }

  private async generatePatientHistory(params: Record<string, any>): Promise<ReportData> {
    const patientId = params.patientNationalId;
    if (!patientId) {
      throw new Error('Patient National ID is required');
    }

    return {
      title: `Patient Prescription History`,
      subtitle: `Patient ID: ${patientId}`,
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      headers: [
        'Date',
        'Prescription #',
        'Physician',
        'Facility',
        'Medications',
        'Status',
        'Dispensed At',
      ],
      rows: this.generateSamplePatientHistory(20),
      summary: {
        totalPrescriptions: 20,
        totalMedications: 45,
        activeAllergies: ['Penicillin', 'Sulfa'],
      },
    };
  }

  private async generatePhysicianActivity(params: Record<string, any>): Promise<ReportData> {
    const physicianLicense = params.physicianLicense;

    return {
      title: 'Physician Activity Report',
      subtitle: physicianLicense ? `License: ${physicianLicense}` : 'All Physicians',
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      headers: [
        'License',
        'Name',
        'Specialty',
        'Facility',
        'Prescriptions',
        'Controlled',
        'Avg/Day',
      ],
      rows: [
        ['EMS-12345', 'Dr. Ahmed Mohamed', 'Internal Medicine', 'Cairo General', 234, 12, 8.5],
        ['EMS-67890', 'Dr. Fatima Hassan', 'Pediatrics', 'Cairo General', 198, 5, 7.2],
        ['EMS-11111', 'Dr. Omar Ali', 'Cardiology', 'Alexandria Medical', 167, 8, 6.1],
        ['EMS-22222', 'Dr. Sara Ibrahim', 'Psychiatry', 'Mental Health Center', 145, 45, 5.3],
        ['EMS-33333', 'Dr. Mohamed Hassan', 'Orthopedics', 'Bone & Joint Clinic', 134, 23, 4.9],
      ],
      summary: {
        totalPhysicians: 5,
        totalPrescriptions: 878,
        avgPrescriptionsPerPhysician: 175.6,
      },
    };
  }

  private async generatePharmacyActivity(params: Record<string, any>): Promise<ReportData> {
    return {
      title: 'Pharmacy Activity Report',
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      headers: [
        'Pharmacy ID',
        'Name',
        'Region',
        'Dispenses',
        'Prescriptions',
        'Controlled',
        'Revenue (EGP)',
      ],
      rows: [
        ['PHARM-001', 'Central Pharmacy', 'Cairo', 456, 423, 34, 125000],
        ['PHARM-002', 'City Pharmacy', 'Giza', 389, 367, 28, 98000],
        ['PHARM-003', 'Health First', 'Alexandria', 312, 298, 22, 87000],
        ['PHARM-004', 'MediCare', 'Cairo', 287, 265, 19, 76000],
        ['PHARM-005', 'Family Pharmacy', 'Dakahlia', 234, 212, 15, 65000],
      ],
      summary: {
        totalPharmacies: 5,
        totalDispenses: 1678,
        totalRevenue: 451000,
      },
    };
  }

  private async generateMedicationUsage(params: Record<string, any>): Promise<ReportData> {
    return {
      title: 'Medication Usage Report',
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      headers: [
        'EDA Code',
        'Medication',
        'Category',
        'Prescribed',
        'Dispensed',
        'Fill Rate %',
        'Avg Qty',
      ],
      rows: [
        ['PAR001', 'Paracetamol 500mg', 'Analgesic', 45678, 42345, 92.7, 20],
        ['AMO001', 'Amoxicillin 500mg', 'Antibiotic', 34567, 31234, 90.4, 21],
        ['OME001', 'Omeprazole 20mg', 'PPI', 28901, 26789, 92.7, 30],
        ['MET001', 'Metformin 500mg', 'Antidiabetic', 23456, 22345, 95.3, 60],
        ['AML001', 'Amlodipine 5mg', 'Antihypertensive', 19876, 18765, 94.4, 30],
        ['LOS001', 'Losartan 50mg', 'ARB', 17654, 16543, 93.7, 30],
        ['ATO001', 'Atorvastatin 20mg', 'Statin', 15432, 14321, 92.8, 30],
        ['IBU001', 'Ibuprofen 400mg', 'NSAID', 14321, 12345, 86.2, 20],
        ['CIP001', 'Ciprofloxacin 500mg', 'Antibiotic', 12345, 11234, 91.0, 14],
        ['DIC001', 'Diclofenac 50mg', 'NSAID', 11234, 9876, 87.9, 20],
      ],
      summary: {
        totalMedications: 10,
        avgFillRate: 91.7,
        totalPrescribed: 223464,
        totalDispensed: 205807,
      },
      charts: [
        {
          type: 'bar',
          title: 'Top 10 Medications by Prescription Volume',
          data: [
            { name: 'Paracetamol', value: 45678 },
            { name: 'Amoxicillin', value: 34567 },
            { name: 'Omeprazole', value: 28901 },
          ],
        },
      ],
    };
  }

  private async generateControlledSubstances(params: Record<string, any>): Promise<ReportData> {
    return {
      title: 'Controlled Substances Report',
      subtitle: 'Schedule II-V Medications',
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      headers: [
        'Date',
        'Medication',
        'Schedule',
        'Physician',
        'Patient',
        'Quantity',
        'Pharmacy',
      ],
      rows: [
        ['2026-01-15', 'Tramadol 50mg', 'IV', 'Dr. Ahmed', '299***567', 30, 'Central Pharmacy'],
        ['2026-01-15', 'Alprazolam 0.5mg', 'IV', 'Dr. Sara', '298***234', 30, 'City Pharmacy'],
        ['2026-01-14', 'Codeine 30mg', 'III', 'Dr. Omar', '297***890', 20, 'Health First'],
        ['2026-01-14', 'Diazepam 5mg', 'IV', 'Dr. Fatima', '296***456', 30, 'MediCare'],
        ['2026-01-13', 'Morphine 10mg', 'II', 'Dr. Ahmed', '295***123', 14, 'Central Pharmacy'],
      ],
      summary: {
        totalControlledPrescriptions: 5,
        bySchedule: {
          'II': 1,
          'III': 1,
          'IV': 3,
        },
        flaggedForReview: 0,
      },
    };
  }

  private async generateDailySummary(params: Record<string, any>): Promise<ReportData> {
    const date = params.date || new Date().toISOString().split('T')[0];

    return {
      title: 'Daily Summary Report',
      subtitle: `Date: ${date}`,
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      headers: ['Metric', 'Value', 'Change', 'Status'],
      rows: [
        ['Total Prescriptions', 15234, '+5.2%', 'Normal'],
        ['Total Dispenses', 12456, '+3.8%', 'Normal'],
        ['New Patients', 1234, '+2.1%', 'Normal'],
        ['Active Prescriptions', 45678, '-1.2%', 'Normal'],
        ['Controlled Substances', 1234, '+0.5%', 'Monitor'],
        ['Prescription Rejections', 45, '-12%', 'Good'],
        ['AI Validation Failures', 123, '+8%', 'Review'],
        ['Active Recalls', 2, '0', 'Alert'],
        ['Compliance Alerts', 5, '+2', 'Review'],
      ],
      summary: {
        overallStatus: 'Normal',
        actionRequired: ['Review AI validation failures', 'Monitor controlled substances'],
      },
    };
  }

  private async generateMonthlySummary(params: Record<string, any>): Promise<ReportData> {
    const month = params.month || new Date().toISOString().slice(0, 7);

    return {
      title: 'Monthly Summary Report',
      subtitle: `Month: ${month}`,
      generatedAt: new Date().toISOString(),
      generatedBy: params.requestedBy || 'System',
      headers: ['Week', 'Prescriptions', 'Dispenses', 'New Patients', 'Revenue (EGP)'],
      rows: [
        ['Week 1', 98567, 78234, 8901, 2450000],
        ['Week 2', 102345, 82456, 9234, 2580000],
        ['Week 3', 99876, 79012, 8567, 2490000],
        ['Week 4', 105678, 85234, 9456, 2680000],
      ],
      summary: {
        totalPrescriptions: 406466,
        totalDispenses: 324936,
        totalNewPatients: 36158,
        totalRevenue: 10200000,
        growthRate: '+4.5%',
      },
      charts: [
        {
          type: 'line',
          title: 'Weekly Prescription Trend',
          data: [
            { week: 1, prescriptions: 98567, dispenses: 78234 },
            { week: 2, prescriptions: 102345, dispenses: 82456 },
            { week: 3, prescriptions: 99876, dispenses: 79012 },
            { week: 4, prescriptions: 105678, dispenses: 85234 },
          ],
        },
      ],
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private generateSamplePrescriptionData(count: number): any[][] {
    const statuses = ['Active', 'Completed', 'Cancelled', 'Expired'];
    const physicians = ['Dr. Ahmed', 'Dr. Fatima', 'Dr. Omar', 'Dr. Sara'];
    const rows = [];

    for (let i = 0; i < count; i++) {
      const date = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
      rows.push([
        `RX-2026-${String(i + 1).padStart(8, '0')}`,
        date.toISOString().split('T')[0],
        `299${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
        physicians[Math.floor(Math.random() * physicians.length)],
        Math.floor(Math.random() * 4) + 1,
        statuses[Math.floor(Math.random() * statuses.length)],
        Math.floor(Math.random() * 3),
      ]);
    }

    return rows;
  }

  private generateSampleDispenseData(count: number): any[][] {
    const pharmacies = ['Central Pharmacy', 'City Pharmacy', 'Health First', 'MediCare'];
    const pharmacists = ['Dr. Omar', 'Dr. Layla', 'Dr. Hassan', 'Dr. Nour'];
    const rows = [];

    for (let i = 0; i < count; i++) {
      const date = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
      rows.push([
        `DSP-${generateUUID().slice(0, 8)}`,
        date.toISOString().split('T')[0],
        `RX-2026-${String(Math.floor(Math.random() * 1000)).padStart(8, '0')}`,
        pharmacies[Math.floor(Math.random() * pharmacies.length)],
        pharmacists[Math.floor(Math.random() * pharmacists.length)],
        Math.floor(Math.random() * 4) + 1,
        Math.random() > 0.8 ? 'Yes' : 'No',
      ]);
    }

    return rows;
  }

  private generateSamplePatientHistory(count: number): any[][] {
    const physicians = ['Dr. Ahmed', 'Dr. Fatima', 'Dr. Omar'];
    const facilities = ['Cairo General', 'Alexandria Medical', 'Giza Clinic'];
    const rows = [];

    for (let i = 0; i < count; i++) {
      const date = new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000);
      rows.push([
        date.toISOString().split('T')[0],
        `RX-2026-${String(i + 1).padStart(8, '0')}`,
        physicians[Math.floor(Math.random() * physicians.length)],
        facilities[Math.floor(Math.random() * facilities.length)],
        Math.floor(Math.random() * 3) + 1,
        i < 3 ? 'Active' : 'Completed',
        i < 3 ? '-' : 'Central Pharmacy',
      ]);
    }

    return rows;
  }
}

const reportGenerator = new ReportGeneratorService();

// ============================================================================
// Format Converters
// ============================================================================

function convertToCSV(data: ReportData): string {
  const lines: string[] = [];
  
  // Title
  lines.push(`"${data.title}"`);
  if (data.subtitle) lines.push(`"${data.subtitle}"`);
  lines.push(`"Generated: ${data.generatedAt}"`);
  lines.push('');
  
  // Headers
  lines.push(data.headers.map(h => `"${h}"`).join(','));
  
  // Rows
  for (const row of data.rows) {
    lines.push(row.map(cell => `"${cell}"`).join(','));
  }
  
  // Summary
  if (data.summary) {
    lines.push('');
    lines.push('"Summary"');
    for (const [key, value] of Object.entries(data.summary)) {
      lines.push(`"${key}","${value}"`);
    }
  }
  
  return lines.join('\n');
}

// ============================================================================
// Routes
// ============================================================================

const ReportRequestSchema = z.object({
  type: z.enum([
    'prescription_summary', 'dispense_summary', 'patient_history',
    'physician_activity', 'pharmacy_activity', 'medication_usage',
    'controlled_substances', 'compliance_report', 'recall_report',
    'daily_summary', 'monthly_summary'
  ]),
  format: z.enum(['json', 'csv', 'pdf', 'xlsx']).default('json'),
  parameters: z.record(z.any()).default({}),
});

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'reporting-service',
    timestamp: new Date().toISOString() 
  });
});

// Request a new report
router.post('/api/reports', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = ReportRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }

    const requestedBy = req.headers['x-user-id'] as string || 'anonymous';
    
    const job = await reportGenerator.generateReport({
      ...validation.data,
      requestedBy,
    });

    res.status(202).json(job);
  } catch (error) {
    next(error);
  }
});

// Get report job status
router.get('/api/reports/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = reportGenerator.getJob(req.params.jobId!);
    if (!job) {
      throw new NDPError(ErrorCodes.NOT_FOUND, 'Report job not found', 404);
    }
    res.json(job);
  } catch (error) {
    next(error);
  }
});

// Download report
router.get('/api/reports/:jobId/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = reportGenerator.getJob(req.params.jobId!);
    if (!job) {
      throw new NDPError(ErrorCodes.NOT_FOUND, 'Report not found', 404);
    }

    if (job.status !== 'completed') {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, `Report is ${job.status}`, 400);
    }

    const data = reportGenerator.getReportData(req.params.jobId!);
    if (!data) {
      throw new NDPError(ErrorCodes.NOT_FOUND, 'Report data not found', 404);
    }

    const format = (req.query.format as ReportFormat) || job.format;

    switch (format) {
      case 'json':
        res.json(data);
        break;
      
      case 'csv':
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${job.type}_${job.id}.csv"`);
        res.send(convertToCSV(data));
        break;
      
      case 'pdf':
        // In production, use pdfkit or puppeteer
        res.json({ 
          error: 'PDF generation not implemented',
          data 
        });
        break;
      
      case 'xlsx':
        // In production, use exceljs
        res.json({ 
          error: 'Excel generation not implemented',
          data 
        });
        break;
      
      default:
        res.json(data);
    }
  } catch (error) {
    next(error);
  }
});

// List report jobs
router.get('/api/reports', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.query.userId as string;
    const limit = parseInt(req.query.limit as string) || 20;
    
    const jobs = reportGenerator.listJobs(userId, limit);
    res.json(jobs);
  } catch (error) {
    next(error);
  }
});

// Quick reports (synchronous, returns data directly)
router.get('/api/reports/quick/daily', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = req.query.date as string;
    const job = await reportGenerator.generateReport({
      type: 'daily_summary',
      format: 'json',
      parameters: { date },
      requestedBy: req.headers['x-user-id'] as string || 'anonymous',
    });

    // Wait for completion (quick reports should be fast)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const data = reportGenerator.getReportData(job.id);
    res.json(data || job);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Error Handler
// ============================================================================

function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Reporting error', error);

  if (error instanceof NDPError) {
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  logger.info('Starting Reporting Service', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());
  app.use('/', router);
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(`Reporting Service listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

export { reportGenerator };

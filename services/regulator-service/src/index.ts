/**
 * Regulator Portal Service
 * EDA (Egyptian Drug Authority) oversight, drug recalls, and compliance monitoring
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';

import { loadConfig } from '../../../shared/config/index.js';
import { 
  createLogger, 
  generateUUID, 
  toFHIRDateTime,
  paginate 
} from '../../../shared/utils/index.js';
import { NDPError, ErrorCodes, UserRole } from '../../../shared/types/ndp.types.js';

const config = loadConfig('regulator-service');
const logger = createLogger('regulator-service', config.logLevel);

// Service URLs
const SERVICES = {
  prescription: process.env['PRESCRIPTION_SERVICE_URL'] || 'http://localhost:3001',
  dispense: process.env['DISPENSE_SERVICE_URL'] || 'http://localhost:3002',
  medication: process.env['MEDICATION_SERVICE_URL'] || 'http://localhost:3003',
  notification: process.env['NOTIFICATION_SERVICE_URL'] || 'http://localhost:3008',
};

// ============================================================================
// Types
// ============================================================================

interface DrugRecall {
  id: string;
  edaCode: string;
  medicationName: string;
  manufacturer?: string;
  batchNumbers: string[];
  recallType: 'voluntary' | 'mandatory' | 'market_withdrawal';
  recallClass: 'I' | 'II' | 'III'; // I = Most severe
  reason: string;
  healthHazard: string;
  instructions: string;
  affectedRegions: string[];
  initiatedBy: string;
  initiatedAt: string;
  effectiveDate: string;
  status: 'active' | 'completed' | 'cancelled';
  affectedPrescriptions?: number;
  affectedDispenses?: number;
  notificationsSent?: number;
  createdAt: string;
  updatedAt: string;
}

interface ComplianceAlert {
  id: string;
  alertType: 'overprescribing' | 'suspicious_pattern' | 'controlled_substance' | 'expired_license' | 'duplicate_dispense' | 'unusual_quantity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  entityType: 'physician' | 'pharmacist' | 'pharmacy' | 'patient';
  entityId: string;
  entityName: string;
  description: string;
  details: Record<string, any>;
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  assignedTo?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  ipAddress?: string;
  userAgent?: string;
  details: Record<string, any>;
  outcome: 'success' | 'failure';
}

interface RegulatorDashboardStats {
  prescriptions: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    total: number;
    byStatus: Record<string, number>;
  };
  dispenses: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    total: number;
  };
  activeRecalls: number;
  openAlerts: number;
  controlledSubstances: {
    prescribedToday: number;
    dispensedToday: number;
  };
  topPrescribedMedications: Array<{ code: string; name: string; count: number }>;
  geographicDistribution: Array<{ region: string; prescriptions: number; dispenses: number }>;
}

// ============================================================================
// In-Memory Stores (Use PostgreSQL in production)
// ============================================================================

const recallStore: Map<string, DrugRecall> = new Map();
const alertStore: Map<string, ComplianceAlert> = new Map();
const auditStore: AuditLogEntry[] = [];

// ============================================================================
// Drug Recall Service
// ============================================================================

class DrugRecallService {
  /**
   * Initiate a drug recall
   */
  async initiateRecall(data: {
    edaCode: string;
    medicationName: string;
    manufacturer?: string;
    batchNumbers: string[];
    recallType: 'voluntary' | 'mandatory' | 'market_withdrawal';
    recallClass: 'I' | 'II' | 'III';
    reason: string;
    healthHazard: string;
    instructions: string;
    affectedRegions: string[];
    initiatedBy: string;
    effectiveDate?: string;
  }): Promise<DrugRecall> {
    const recall: DrugRecall = {
      id: generateUUID(),
      ...data,
      initiatedAt: toFHIRDateTime(new Date()),
      effectiveDate: data.effectiveDate || toFHIRDateTime(new Date()),
      status: 'active',
      createdAt: toFHIRDateTime(new Date()),
      updatedAt: toFHIRDateTime(new Date()),
    };

    recallStore.set(recall.id, recall);

    logger.info('Drug recall initiated', { 
      recallId: recall.id, 
      edaCode: data.edaCode, 
      recallClass: data.recallClass 
    });

    // Update medication status in directory
    try {
      await fetch(`${SERVICES.medication}/api/medications/${data.edaCode}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          recallId: recall.id, 
          reason: data.reason,
          batchNumbers: data.batchNumbers 
        }),
      });
    } catch (error) {
      logger.warn('Failed to update medication status', { error });
    }

    // Find affected prescriptions and dispenses
    const affected = await this.findAffectedEntities(data.edaCode, data.batchNumbers);
    recall.affectedPrescriptions = affected.prescriptions;
    recall.affectedDispenses = affected.dispenses;

    // Send notifications to affected patients (if Class I or II)
    if (data.recallClass === 'I' || data.recallClass === 'II') {
      recall.notificationsSent = await this.sendRecallNotifications(recall, affected.patientIds);
    }

    recallStore.set(recall.id, recall);

    // Log audit
    this.logAudit({
      action: 'DRUG_RECALL_INITIATED',
      resourceType: 'DrugRecall',
      resourceId: recall.id,
      actorId: data.initiatedBy,
      actorName: 'EDA Regulator',
      actorRole: 'regulator',
      details: { edaCode: data.edaCode, recallClass: data.recallClass },
      outcome: 'success',
    });

    return recall;
  }

  /**
   * Update recall status
   */
  async updateRecallStatus(
    recallId: string, 
    status: 'active' | 'completed' | 'cancelled',
    updatedBy: string,
    notes?: string
  ): Promise<DrugRecall> {
    const recall = recallStore.get(recallId);
    if (!recall) {
      throw new NDPError(ErrorCodes.NOT_FOUND, 'Recall not found', 404);
    }

    recall.status = status;
    recall.updatedAt = toFHIRDateTime(new Date());
    recallStore.set(recallId, recall);

    // If completed/cancelled, reactivate medication
    if (status === 'completed' || status === 'cancelled') {
      try {
        await fetch(`${SERVICES.medication}/api/medications/${recall.edaCode}/reactivate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        logger.warn('Failed to reactivate medication', { error });
      }
    }

    this.logAudit({
      action: 'DRUG_RECALL_UPDATED',
      resourceType: 'DrugRecall',
      resourceId: recallId,
      actorId: updatedBy,
      actorName: 'EDA Regulator',
      actorRole: 'regulator',
      details: { newStatus: status, notes },
      outcome: 'success',
    });

    return recall;
  }

  /**
   * Get all active recalls
   */
  getActiveRecalls(): DrugRecall[] {
    return Array.from(recallStore.values())
      .filter(r => r.status === 'active')
      .sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
  }

  /**
   * Get recall by ID
   */
  getRecall(id: string): DrugRecall | null {
    return recallStore.get(id) || null;
  }

  /**
   * Search recalls
   */
  searchRecalls(params: {
    status?: string;
    recallClass?: string;
    edaCode?: string;
    fromDate?: string;
    toDate?: string;
  }): DrugRecall[] {
    let results = Array.from(recallStore.values());

    if (params.status) {
      results = results.filter(r => r.status === params.status);
    }
    if (params.recallClass) {
      results = results.filter(r => r.recallClass === params.recallClass);
    }
    if (params.edaCode) {
      results = results.filter(r => r.edaCode === params.edaCode);
    }
    if (params.fromDate) {
      results = results.filter(r => r.initiatedAt >= params.fromDate!);
    }
    if (params.toDate) {
      results = results.filter(r => r.initiatedAt <= params.toDate!);
    }

    return results.sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
  }

  private async findAffectedEntities(edaCode: string, batchNumbers: string[]): Promise<{
    prescriptions: number;
    dispenses: number;
    patientIds: string[];
  }> {
    // In production, query the database
    // For now, return mock data
    return {
      prescriptions: Math.floor(Math.random() * 100),
      dispenses: Math.floor(Math.random() * 50),
      patientIds: ['29901011234567', '29902022345678'],
    };
  }

  private async sendRecallNotifications(recall: DrugRecall, patientIds: string[]): Promise<number> {
    let sent = 0;
    
    for (const patientId of patientIds) {
      try {
        await fetch(`${SERVICES.notification}/api/notifications/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'medication_recalled',
            channel: ['sms', 'email'],
            recipient: { nationalId: patientId },
            data: {
              medicationName: recall.medicationName,
              batchNumbers: recall.batchNumbers.join(', '),
              recallReason: recall.reason,
              instructions: recall.instructions,
            },
            priority: 'high',
          }),
        });
        sent++;
      } catch (error) {
        logger.warn('Failed to send recall notification', { patientId, error });
      }
    }

    return sent;
  }

  private logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    auditStore.push({
      id: generateUUID(),
      timestamp: toFHIRDateTime(new Date()),
      ...entry,
    });
  }
}

// ============================================================================
// Compliance Alert Service
// ============================================================================

class ComplianceAlertService {
  /**
   * Create compliance alert
   */
  createAlert(data: {
    alertType: ComplianceAlert['alertType'];
    severity: ComplianceAlert['severity'];
    entityType: ComplianceAlert['entityType'];
    entityId: string;
    entityName: string;
    description: string;
    details: Record<string, any>;
  }): ComplianceAlert {
    const alert: ComplianceAlert = {
      id: generateUUID(),
      ...data,
      status: 'open',
      createdAt: toFHIRDateTime(new Date()),
      updatedAt: toFHIRDateTime(new Date()),
    };

    alertStore.set(alert.id, alert);

    logger.info('Compliance alert created', { 
      alertId: alert.id, 
      type: data.alertType, 
      severity: data.severity 
    });

    return alert;
  }

  /**
   * Update alert status
   */
  updateAlert(
    alertId: string,
    updates: {
      status?: ComplianceAlert['status'];
      assignedTo?: string;
      resolution?: string;
    }
  ): ComplianceAlert {
    const alert = alertStore.get(alertId);
    if (!alert) {
      throw new NDPError(ErrorCodes.NOT_FOUND, 'Alert not found', 404);
    }

    Object.assign(alert, updates, { updatedAt: toFHIRDateTime(new Date()) });
    alertStore.set(alertId, alert);

    return alert;
  }

  /**
   * Get open alerts
   */
  getOpenAlerts(): ComplianceAlert[] {
    return Array.from(alertStore.values())
      .filter(a => a.status === 'open' || a.status === 'investigating')
      .sort((a, b) => {
        // Sort by severity, then by date
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (sevDiff !== 0) return sevDiff;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  /**
   * Get alert by ID
   */
  getAlert(id: string): ComplianceAlert | null {
    return alertStore.get(id) || null;
  }

  /**
   * Search alerts
   */
  searchAlerts(params: {
    status?: string;
    severity?: string;
    alertType?: string;
    entityType?: string;
    entityId?: string;
  }): ComplianceAlert[] {
    let results = Array.from(alertStore.values());

    if (params.status) results = results.filter(a => a.status === params.status);
    if (params.severity) results = results.filter(a => a.severity === params.severity);
    if (params.alertType) results = results.filter(a => a.alertType === params.alertType);
    if (params.entityType) results = results.filter(a => a.entityType === params.entityType);
    if (params.entityId) results = results.filter(a => a.entityId === params.entityId);

    return results;
  }

  /**
   * Run automated compliance checks (called periodically)
   */
  async runComplianceChecks(): Promise<{ alertsGenerated: number }> {
    let generated = 0;

    // Check for overprescribing patterns
    generated += await this.checkOverprescribing();

    // Check for controlled substance patterns
    generated += await this.checkControlledSubstances();

    // Check for duplicate dispenses
    generated += await this.checkDuplicateDispenses();

    logger.info('Compliance checks completed', { alertsGenerated: generated });

    return { alertsGenerated: generated };
  }

  private async checkOverprescribing(): Promise<number> {
    // In production, analyze prescription patterns
    // For demo, create sample alert
    if (Math.random() < 0.1) {
      this.createAlert({
        alertType: 'overprescribing',
        severity: 'medium',
        entityType: 'physician',
        entityId: 'EMS-99999',
        entityName: 'Dr. Sample Physician',
        description: 'Physician has prescribed 50% more opioids than peer average this month',
        details: {
          monthlyCount: 150,
          peerAverage: 100,
          percentAbove: 50,
        },
      });
      return 1;
    }
    return 0;
  }

  private async checkControlledSubstances(): Promise<number> {
    return 0;
  }

  private async checkDuplicateDispenses(): Promise<number> {
    return 0;
  }
}

// ============================================================================
// Analytics Service
// ============================================================================

class AnalyticsService {
  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<RegulatorDashboardStats> {
    // In production, aggregate from database
    // For now, return realistic mock data
    
    const now = new Date();
    const stats: RegulatorDashboardStats = {
      prescriptions: {
        today: 15234 + Math.floor(Math.random() * 1000),
        thisWeek: 98567 + Math.floor(Math.random() * 5000),
        thisMonth: 412890 + Math.floor(Math.random() * 20000),
        total: 8945123,
        byStatus: {
          active: 45678,
          completed: 8123456,
          cancelled: 234567,
          expired: 541422,
        },
      },
      dispenses: {
        today: 12456 + Math.floor(Math.random() * 800),
        thisWeek: 78234 + Math.floor(Math.random() * 4000),
        thisMonth: 356789 + Math.floor(Math.random() * 15000),
        total: 7234567,
      },
      activeRecalls: recallStore.size,
      openAlerts: Array.from(alertStore.values()).filter(a => a.status === 'open').length,
      controlledSubstances: {
        prescribedToday: 1234 + Math.floor(Math.random() * 200),
        dispensedToday: 1100 + Math.floor(Math.random() * 150),
      },
      topPrescribedMedications: [
        { code: 'PAR001', name: 'Paracetamol 500mg', count: 45678 },
        { code: 'AMO001', name: 'Amoxicillin 500mg', count: 34567 },
        { code: 'OME001', name: 'Omeprazole 20mg', count: 28901 },
        { code: 'MET001', name: 'Metformin 500mg', count: 23456 },
        { code: 'AML001', name: 'Amlodipine 5mg', count: 19876 },
        { code: 'LOS001', name: 'Losartan 50mg', count: 17654 },
        { code: 'ATO001', name: 'Atorvastatin 20mg', count: 15432 },
        { code: 'IBU001', name: 'Ibuprofen 400mg', count: 14321 },
        { code: 'CIP001', name: 'Ciprofloxacin 500mg', count: 12345 },
        { code: 'DIC001', name: 'Diclofenac 50mg', count: 11234 },
      ],
      geographicDistribution: [
        { region: 'Cairo', prescriptions: 125678, dispenses: 112345 },
        { region: 'Alexandria', prescriptions: 67890, dispenses: 61234 },
        { region: 'Giza', prescriptions: 56789, dispenses: 50123 },
        { region: 'Sharkia', prescriptions: 34567, dispenses: 30123 },
        { region: 'Dakahlia', prescriptions: 32456, dispenses: 28901 },
        { region: 'Qalyubia', prescriptions: 28901, dispenses: 25678 },
        { region: 'Beheira', prescriptions: 23456, dispenses: 20123 },
        { region: 'Gharbia', prescriptions: 21234, dispenses: 18901 },
        { region: 'Monufia', prescriptions: 19876, dispenses: 17654 },
        { region: 'Fayoum', prescriptions: 15678, dispenses: 13456 },
      ],
    };

    return stats;
  }

  /**
   * Get prescription trends
   */
  async getPrescriptionTrends(period: 'day' | 'week' | 'month', days: number = 30): Promise<Array<{
    date: string;
    prescriptions: number;
    dispenses: number;
  }>> {
    const trends = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      
      trends.push({
        date: date.toISOString().split('T')[0]!,
        prescriptions: 10000 + Math.floor(Math.random() * 5000),
        dispenses: 8000 + Math.floor(Math.random() * 4000),
      });
    }

    return trends;
  }

  /**
   * Get medication analytics
   */
  async getMedicationAnalytics(params: {
    edaCode?: string;
    category?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{
    totalPrescribed: number;
    totalDispensed: number;
    avgQuantityPerPrescription: number;
    topPrescribers: Array<{ license: string; name: string; count: number }>;
    topPharmacies: Array<{ id: string; name: string; count: number }>;
    dailyTrend: Array<{ date: string; count: number }>;
  }> {
    return {
      totalPrescribed: 45678,
      totalDispensed: 41234,
      avgQuantityPerPrescription: 25.5,
      topPrescribers: [
        { license: 'EMS-12345', name: 'Dr. Ahmed Mohamed', count: 234 },
        { license: 'EMS-67890', name: 'Dr. Fatima Hassan', count: 198 },
        { license: 'EMS-11111', name: 'Dr. Omar Ali', count: 167 },
      ],
      topPharmacies: [
        { id: 'PHARM-001', name: 'Central Pharmacy', count: 456 },
        { id: 'PHARM-002', name: 'City Pharmacy', count: 389 },
        { id: 'PHARM-003', name: 'Health First', count: 312 },
      ],
      dailyTrend: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!,
        count: 1000 + Math.floor(Math.random() * 500),
      })),
    };
  }

  /**
   * Get practitioner analytics
   */
  async getPractitionerAnalytics(license: string): Promise<{
    license: string;
    name: string;
    specialty: string;
    facility: string;
    prescriptionCount: number;
    avgPrescriptionsPerDay: number;
    topMedications: Array<{ code: string; name: string; count: number }>;
    controlledSubstanceCount: number;
    complianceScore: number;
    alerts: ComplianceAlert[];
  }> {
    const alerts = Array.from(alertStore.values())
      .filter(a => a.entityId === license);

    return {
      license,
      name: 'Dr. Sample Physician',
      specialty: 'Internal Medicine',
      facility: 'Cairo General Hospital',
      prescriptionCount: 2345,
      avgPrescriptionsPerDay: 12.5,
      topMedications: [
        { code: 'PAR001', name: 'Paracetamol 500mg', count: 456 },
        { code: 'AMO001', name: 'Amoxicillin 500mg', count: 345 },
        { code: 'OME001', name: 'Omeprazole 20mg', count: 234 },
      ],
      controlledSubstanceCount: 89,
      complianceScore: 95,
      alerts,
    };
  }
}

// ============================================================================
// Service Instances
// ============================================================================

const drugRecallService = new DrugRecallService();
const complianceAlertService = new ComplianceAlertService();
const analyticsService = new AnalyticsService();

// ============================================================================
// Validation Schemas
// ============================================================================

const InitiateRecallSchema = z.object({
  edaCode: z.string().min(1),
  medicationName: z.string().min(1),
  manufacturer: z.string().optional(),
  batchNumbers: z.array(z.string()).min(1),
  recallType: z.enum(['voluntary', 'mandatory', 'market_withdrawal']),
  recallClass: z.enum(['I', 'II', 'III']),
  reason: z.string().min(10),
  healthHazard: z.string().min(10),
  instructions: z.string().min(10),
  affectedRegions: z.array(z.string()).default(['All Egypt']),
  effectiveDate: z.string().optional(),
});

const UpdateAlertSchema = z.object({
  status: z.enum(['open', 'investigating', 'resolved', 'dismissed']).optional(),
  assignedTo: z.string().optional(),
  resolution: z.string().optional(),
});

// ============================================================================
// Middleware
// ============================================================================

function requireRegulatorRole(req: Request, res: Response, next: NextFunction) {
  // In production, verify from JWT
  const userRole = req.headers['x-user-role'] as string;
  if (userRole !== 'regulator' && userRole !== 'admin') {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Regulator access required' },
    });
  }
  next();
}

// ============================================================================
// Routes
// ============================================================================

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'regulator-service',
    timestamp: new Date().toISOString() 
  });
});

// ============================================================================
// Dashboard & Analytics
// ============================================================================

router.get('/api/regulator/dashboard', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await analyticsService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/trends', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as 'day' | 'week' | 'month') || 'day';
    const days = parseInt(req.query.days as string) || 30;
    const trends = await analyticsService.getPrescriptionTrends(period, days);
    res.json(trends);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/medications/:edaCode/analytics', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const analytics = await analyticsService.getMedicationAnalytics({
      edaCode: req.params.edaCode,
      fromDate: req.query.from as string,
      toDate: req.query.to as string,
    });
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/practitioners/:license/analytics', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const analytics = await analyticsService.getPractitionerAnalytics(req.params.license!);
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Drug Recalls
// ============================================================================

router.post('/api/regulator/recalls', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = InitiateRecallSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }

    const initiatedBy = req.headers['x-user-id'] as string || 'unknown';
    const recall = await drugRecallService.initiateRecall({
      ...validation.data,
      initiatedBy,
    });

    res.status(201).json(recall);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/recalls', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recalls = drugRecallService.searchRecalls({
      status: req.query.status as string,
      recallClass: req.query.class as string,
      edaCode: req.query.edaCode as string,
      fromDate: req.query.from as string,
      toDate: req.query.to as string,
    });
    res.json(recalls);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/recalls/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recalls = drugRecallService.getActiveRecalls();
    res.json(recalls);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/recalls/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recall = drugRecallService.getRecall(req.params.id!);
    if (!recall) {
      throw new NDPError(ErrorCodes.NOT_FOUND, 'Recall not found', 404);
    }
    res.json(recall);
  } catch (error) {
    next(error);
  }
});

router.patch('/api/regulator/recalls/:id/status', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, notes } = req.body;
    const updatedBy = req.headers['x-user-id'] as string || 'unknown';
    
    const recall = await drugRecallService.updateRecallStatus(
      req.params.id!,
      status,
      updatedBy,
      notes
    );
    
    res.json(recall);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Compliance Alerts
// ============================================================================

router.get('/api/regulator/alerts', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const alerts = complianceAlertService.searchAlerts({
      status: req.query.status as string,
      severity: req.query.severity as string,
      alertType: req.query.type as string,
      entityType: req.query.entityType as string,
      entityId: req.query.entityId as string,
    });
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/alerts/open', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const alerts = complianceAlertService.getOpenAlerts();
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/alerts/:id', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const alert = complianceAlertService.getAlert(req.params.id!);
    if (!alert) {
      throw new NDPError(ErrorCodes.NOT_FOUND, 'Alert not found', 404);
    }
    res.json(alert);
  } catch (error) {
    next(error);
  }
});

router.patch('/api/regulator/alerts/:id', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = UpdateAlertSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }

    const alert = complianceAlertService.updateAlert(req.params.id!, validation.data);
    res.json(alert);
  } catch (error) {
    next(error);
  }
});

router.post('/api/regulator/compliance/check', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await complianceAlertService.runComplianceChecks();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Audit Log
// ============================================================================

router.get('/api/regulator/audit', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = auditStore.slice(-limit).reverse();
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Reports (Export)
// ============================================================================

router.get('/api/regulator/reports/prescriptions', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Generate prescription report data
    const reportData = {
      generatedAt: new Date().toISOString(),
      period: {
        from: req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        to: req.query.to || new Date().toISOString(),
      },
      summary: await analyticsService.getDashboardStats(),
      trends: await analyticsService.getPrescriptionTrends('day', 30),
    };

    res.json(reportData);
  } catch (error) {
    next(error);
  }
});

router.get('/api/regulator/reports/controlled-substances', requireRegulatorRole, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Generate controlled substances report
    const reportData = {
      generatedAt: new Date().toISOString(),
      period: {
        from: req.query.from,
        to: req.query.to,
      },
      controlledSubstances: [
        { category: 'Opioids', prescribed: 4567, dispensed: 4234 },
        { category: 'Benzodiazepines', prescribed: 3456, dispensed: 3123 },
        { category: 'Stimulants', prescribed: 1234, dispensed: 1100 },
        { category: 'Barbiturates', prescribed: 456, dispensed: 400 },
      ],
      topPrescribers: [
        { license: 'EMS-12345', name: 'Dr. Ahmed Mohamed', count: 234, specialty: 'Pain Management' },
        { license: 'EMS-67890', name: 'Dr. Fatima Hassan', count: 198, specialty: 'Psychiatry' },
      ],
      alerts: complianceAlertService.searchAlerts({ alertType: 'controlled_substance' }),
    };

    res.json(reportData);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Error Handler
// ============================================================================

function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Regulator service error', error);

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
  logger.info('Starting Regulator Portal Service', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());
  app.use('/', router);
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(`Regulator Portal Service listening on port ${config.port}`);
  });

  // Start periodic compliance checks (every hour in production)
  if (config.env === 'production') {
    setInterval(() => {
      complianceAlertService.runComplianceChecks().catch(err => {
        logger.error('Scheduled compliance check failed', err);
      });
    }, 60 * 60 * 1000);
  }

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

export { drugRecallService, complianceAlertService, analyticsService };

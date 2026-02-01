import { createLogger, generateUUID, toFHIRDateTime } from '../../../../shared/utils/index.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';
import { loadConfig } from '../../../../shared/config/index.js';

const config = loadConfig('regulator-service');
const logger = createLogger('regulator-service:recall');

// Service URLs (should be in a config file)
const SERVICES = {
  notification: process.env['NOTIFICATION_SERVICE_URL'] || 'http://notification:3008',
  medication: process.env['MEDICATION_SERVICE_URL'] || 'http://medication:3003',
};

// Types (Ideally shared)
export interface DrugRecall {
  id: string;
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
  initiatedAt: string;
  effectiveDate: string;
  status: 'active' | 'completed' | 'cancelled';
  affectedPrescriptions?: number;
  affectedDispenses?: number;
  notificationsSent?: number;
  createdAt: string;
  updatedAt: string;
}

// In-memory store
const recallStore: Map<string, DrugRecall> = new Map();
const auditStore: any[] = []; // Simple audit log

export class DrugRecallService {
  async initiateRecall(data: Omit<DrugRecall, 'id' | 'initiatedAt' | 'status' | 'createdAt' | 'updatedAt' | 'effectiveDate'> & { effectiveDate?: string }): Promise<DrugRecall> {
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
    logger.info('Drug recall initiated', { recallId: recall.id, edaCode: data.edaCode });

    // Update medication status
    try {
      await fetch(`${SERVICES.medication}/api/medications/${data.edaCode}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recallId: recall.id, reason: data.reason, batchNumbers: data.batchNumbers }),
      });
    } catch (error) {
      logger.warn('Failed to update medication status', { error });
    }

    // Mock affected counts
    recall.affectedPrescriptions = Math.floor(Math.random() * 100);
    recall.affectedDispenses = Math.floor(Math.random() * 50);

    // Send notifications if severe
    if (data.recallClass === 'I' || data.recallClass === 'II') {
      // Mock sending notifications
      recall.notificationsSent = Math.floor(recall.affectedPrescriptions * 0.8);
    }

    recallStore.set(recall.id, recall);
    return recall;
  }

  async updateRecallStatus(id: string, status: DrugRecall['status'], updatedBy: string, notes?: string): Promise<DrugRecall> {
    const recall = recallStore.get(id);
    if (!recall) throw new NDPError(ErrorCodes.NOT_FOUND, 'Recall not found', 404);

    recall.status = status;
    recall.updatedAt = toFHIRDateTime(new Date());
    recallStore.set(id, recall);

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

    return recall;
  }

  getActiveRecalls(): DrugRecall[] {
    return Array.from(recallStore.values()).filter(r => r.status === 'active');
  }

  getRecall(id: string): DrugRecall | null {
    return recallStore.get(id) || null;
  }

  searchRecalls(params: any): DrugRecall[] {
    let results = Array.from(recallStore.values());
    if (params.status) results = results.filter(r => r.status === params.status);
    if (params.edaCode) results = results.filter(r => r.edaCode === params.edaCode);
    return results;
  }
}

export const drugRecallService = new DrugRecallService();

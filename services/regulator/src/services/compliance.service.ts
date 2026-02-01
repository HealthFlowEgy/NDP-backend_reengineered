import { createLogger, generateUUID, toFHIRDateTime } from '../../../../shared/utils/index.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';

const logger = createLogger('regulator-service:compliance');

export interface ComplianceAlert {
  id: string;
  alertType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  entityType: string;
  entityId: string;
  entityName: string;
  description: string;
  details: any;
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

const alertStore: Map<string, ComplianceAlert> = new Map();

export class ComplianceService {
  createAlert(data: any): ComplianceAlert {
    const alert: ComplianceAlert = {
      id: generateUUID(),
      ...data,
      status: 'open',
      createdAt: toFHIRDateTime(new Date()),
      updatedAt: toFHIRDateTime(new Date()),
    };
    alertStore.set(alert.id, alert);
    return alert;
  }

  getOpenAlerts(): ComplianceAlert[] {
    return Array.from(alertStore.values()).filter(a => a.status === 'open');
  }

  getAlert(id: string): ComplianceAlert | null {
    return alertStore.get(id) || null;
  }

  updateAlert(id: string, updates: any): ComplianceAlert {
    const alert = alertStore.get(id);
    if (!alert) throw new NDPError(ErrorCodes.NOT_FOUND, 'Alert not found', 404);
    Object.assign(alert, updates, { updatedAt: toFHIRDateTime(new Date()) });
    alertStore.set(id, alert);
    return alert;
  }

  searchAlerts(params: any): ComplianceAlert[] {
    let results = Array.from(alertStore.values());
    if (params.status) results = results.filter(a => a.status === params.status);
    if (params.entityId) results = results.filter(a => a.entityId === params.entityId);
    return results;
  }

  async runComplianceChecks() {
    // Mock check
    if (Math.random() < 0.1) {
      this.createAlert({
        alertType: 'overprescribing',
        severity: 'medium',
        entityType: 'physician',
        entityId: 'EMS-99999',
        entityName: 'Dr. Automated Check',
        description: 'Mock alert generated',
        details: {},
      });
      return { alertsGenerated: 1 };
    }
    return { alertsGenerated: 0 };
  }
}

export const complianceService = new ComplianceService();

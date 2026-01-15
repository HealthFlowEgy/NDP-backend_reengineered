/**
 * OpenHIM-Style Audit Mediator
 * Provides ATN-A compatible audit logging for healthcare interoperability
 * National Digital Prescription Platform - Egypt
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// ============================================================================
// ATN-A (Audit Trail Node-Audit) Types
// ============================================================================

export interface ATNAAuditMessage {
  // Event Identification
  eventIdentification: {
    eventID: {
      code: string;
      codeSystemName: string;
      displayName: string;
    };
    eventActionCode: 'C' | 'R' | 'U' | 'D' | 'E'; // Create, Read, Update, Delete, Execute
    eventDateTime: string;
    eventOutcomeIndicator: '0' | '4' | '8' | '12'; // Success, Minor failure, Serious failure, Major failure
    eventTypeCode?: Array<{
      code: string;
      codeSystemName: string;
      displayName: string;
    }>;
  };

  // Active Participant (User/System that triggered event)
  activeParticipant: Array<{
    userID: string;
    alternativeUserID?: string;
    userName?: string;
    userIsRequestor: boolean;
    roleIDCode?: {
      code: string;
      codeSystemName: string;
      displayName: string;
    };
    networkAccessPointID?: string;
    networkAccessPointTypeCode?: '1' | '2' | '3' | '4' | '5'; // Machine, IP, Phone, Email, URI
  }>;

  // Audit Source Identification
  auditSourceIdentification: {
    auditSourceID: string;
    auditEnterpriseSiteID?: string;
    auditSourceTypeCode?: Array<{
      code: string;
      codeSystemName: string;
      displayName: string;
    }>;
  };

  // Participant Object Identification (Resource being accessed)
  participantObjectIdentification?: Array<{
    participantObjectTypeCode: '1' | '2' | '3' | '4'; // Person, System, Organization, Other
    participantObjectTypeCodeRole?: string;
    participantObjectDataLifeCycle?: string;
    participantObjectIDTypeCode: {
      code: string;
      codeSystemName: string;
      displayName: string;
    };
    participantObjectSensitivity?: string;
    participantObjectID: string;
    participantObjectName?: string;
    participantObjectQuery?: string;
    participantObjectDetail?: Array<{
      type: string;
      value: string;
    }>;
  }>;
}

// ============================================================================
// OpenHIM Transaction Types
// ============================================================================

export interface OpenHIMTransaction {
  _id: string;
  status: 'Processing' | 'Successful' | 'Completed' | 'Completed with error(s)' | 'Failed';
  clientID: string;
  channelID?: string;
  request: {
    host: string;
    port: string;
    path: string;
    headers: Record<string, string>;
    querystring: string;
    body: string;
    method: string;
    timestamp: string;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body: string;
    timestamp: string;
  };
  routes?: Array<{
    name: string;
    request: {
      host: string;
      port: string;
      path: string;
      headers: Record<string, string>;
      querystring: string;
      body: string;
      method: string;
      timestamp: string;
    };
    response?: {
      status: number;
      headers: Record<string, string>;
      body: string;
      timestamp: string;
    };
    orchestrations?: Array<{
      name: string;
      request: any;
      response: any;
    }>;
  }>;
  orchestrations?: Array<{
    name: string;
    request: {
      host: string;
      port: string;
      path: string;
      headers: Record<string, string>;
      querystring: string;
      body: string;
      method: string;
      timestamp: string;
    };
    response?: {
      status: number;
      headers: Record<string, string>;
      body: string;
      timestamp: string;
    };
  }>;
  properties?: Record<string, string>;
  error?: {
    message: string;
    stack: string;
  };
  autoRetry: boolean;
  autoRetryAttempt?: number;
}

// ============================================================================
// Event Codes for Healthcare
// ============================================================================

export const HEALTHCARE_EVENT_CODES = {
  // IHE Event Codes
  APPLICATION_START: { code: '110120', system: 'DCM', display: 'Application Start' },
  APPLICATION_STOP: { code: '110121', system: 'DCM', display: 'Application Stop' },
  LOGIN: { code: '110122', system: 'DCM', display: 'Login' },
  LOGOUT: { code: '110123', system: 'DCM', display: 'Logout' },
  NODE_AUTHENTICATION: { code: '110124', system: 'DCM', display: 'Node Authentication' },
  SECURITY_ALERT: { code: '110113', system: 'DCM', display: 'Security Alert' },
  USER_SECURITY_ATTRIBUTE_CHANGE: { code: '110114', system: 'DCM', display: 'User Security Attribute Changed' },
  
  // FHIR Audit Event Codes
  REST_CREATE: { code: 'rest', system: 'http://terminology.hl7.org/CodeSystem/audit-event-type', display: 'RESTful Operation' },
  
  // NDP-specific Event Codes
  PRESCRIPTION_CREATE: { code: 'NDP-001', system: 'NDP', display: 'Prescription Created' },
  PRESCRIPTION_SIGN: { code: 'NDP-002', system: 'NDP', display: 'Prescription Signed' },
  PRESCRIPTION_CANCEL: { code: 'NDP-003', system: 'NDP', display: 'Prescription Cancelled' },
  DISPENSE_RECORD: { code: 'NDP-004', system: 'NDP', display: 'Dispense Recorded' },
  MEDICATION_LOOKUP: { code: 'NDP-005', system: 'NDP', display: 'Medication Lookup' },
  MEDICATION_RECALL: { code: 'NDP-006', system: 'NDP', display: 'Medication Recalled' },
  AI_VALIDATION: { code: 'NDP-007', system: 'NDP', display: 'AI Validation' },
  COMPLIANCE_CHECK: { code: 'NDP-008', system: 'NDP', display: 'Compliance Check' },
} as const;

// ============================================================================
// OpenHIM Audit Mediator Class
// ============================================================================

export class OpenHIMAuditMediator {
  private auditSourceId: string;
  private enterpriseSiteId: string;
  private transactions: Map<string, OpenHIMTransaction> = new Map();
  private auditMessages: ATNAAuditMessage[] = [];

  constructor(auditSourceId: string = 'NDP-Backend', enterpriseSiteId: string = 'NDP-Egypt') {
    this.auditSourceId = auditSourceId;
    this.enterpriseSiteId = enterpriseSiteId;
  }

  /**
   * Create ATN-A compliant audit message
   */
  createAuditMessage(params: {
    eventCode: typeof HEALTHCARE_EVENT_CODES[keyof typeof HEALTHCARE_EVENT_CODES];
    actionCode: ATNAAuditMessage['eventIdentification']['eventActionCode'];
    outcome: '0' | '4' | '8' | '12';
    actor: {
      userId: string;
      userName?: string;
      roleCode?: string;
      roleDisplay?: string;
      ipAddress?: string;
      isRequestor: boolean;
    };
    participantObject?: {
      typeCode: '1' | '2' | '3' | '4';
      idTypeCode: string;
      idTypeDisplay: string;
      id: string;
      name?: string;
      sensitivity?: string;
      details?: Array<{ type: string; value: string }>;
    };
    additionalActors?: Array<{
      userId: string;
      userName?: string;
      roleCode?: string;
      roleDisplay?: string;
      isRequestor: boolean;
    }>;
  }): ATNAAuditMessage {
    const participants: ATNAAuditMessage['activeParticipant'] = [
      {
        userID: params.actor.userId,
        userName: params.actor.userName,
        userIsRequestor: params.actor.isRequestor,
        roleIDCode: params.actor.roleCode ? {
          code: params.actor.roleCode,
          codeSystemName: 'NDP-Roles',
          displayName: params.actor.roleDisplay || params.actor.roleCode,
        } : undefined,
        networkAccessPointID: params.actor.ipAddress,
        networkAccessPointTypeCode: params.actor.ipAddress ? '2' : undefined,
      },
    ];

    if (params.additionalActors) {
      for (const actor of params.additionalActors) {
        participants.push({
          userID: actor.userId,
          userName: actor.userName,
          userIsRequestor: actor.isRequestor,
          roleIDCode: actor.roleCode ? {
            code: actor.roleCode,
            codeSystemName: 'NDP-Roles',
            displayName: actor.roleDisplay || actor.roleCode,
          } : undefined,
        });
      }
    }

    const message: ATNAAuditMessage = {
      eventIdentification: {
        eventID: {
          code: params.eventCode.code,
          codeSystemName: params.eventCode.system,
          displayName: params.eventCode.display,
        },
        eventActionCode: params.actionCode,
        eventDateTime: new Date().toISOString(),
        eventOutcomeIndicator: params.outcome,
      },
      activeParticipant: participants,
      auditSourceIdentification: {
        auditSourceID: this.auditSourceId,
        auditEnterpriseSiteID: this.enterpriseSiteId,
        auditSourceTypeCode: [{
          code: '4',
          codeSystemName: 'DCM',
          displayName: 'Application Server',
        }],
      },
    };

    if (params.participantObject) {
      message.participantObjectIdentification = [{
        participantObjectTypeCode: params.participantObject.typeCode,
        participantObjectIDTypeCode: {
          code: params.participantObject.idTypeCode,
          codeSystemName: 'NDP',
          displayName: params.participantObject.idTypeDisplay,
        },
        participantObjectID: params.participantObject.id,
        participantObjectName: params.participantObject.name,
        participantObjectSensitivity: params.participantObject.sensitivity,
        participantObjectDetail: params.participantObject.details,
      }];
    }

    this.auditMessages.push(message);
    return message;
  }

  /**
   * Create OpenHIM transaction
   */
  startTransaction(req: Request): string {
    const transactionId = crypto.randomUUID();
    
    const transaction: OpenHIMTransaction = {
      _id: transactionId,
      status: 'Processing',
      clientID: req.headers['x-client-id'] as string || 'unknown',
      channelID: req.headers['x-channel-id'] as string,
      request: {
        host: req.hostname,
        port: req.socket.localPort?.toString() || '3000',
        path: req.path,
        headers: req.headers as Record<string, string>,
        querystring: req.url.includes('?') ? req.url.split('?')[1] || '' : '',
        body: JSON.stringify(req.body || {}),
        method: req.method,
        timestamp: new Date().toISOString(),
      },
      orchestrations: [],
      autoRetry: false,
    };

    this.transactions.set(transactionId, transaction);
    return transactionId;
  }

  /**
   * Add orchestration to transaction
   */
  addOrchestration(transactionId: string, name: string, request: any, response?: any): void {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return;

    transaction.orchestrations = transaction.orchestrations || [];
    transaction.orchestrations.push({
      name,
      request: {
        host: request.host || 'internal',
        port: request.port || '0',
        path: request.path || '',
        headers: request.headers || {},
        querystring: request.querystring || '',
        body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body || {}),
        method: request.method || 'GET',
        timestamp: new Date().toISOString(),
      },
      response: response ? {
        status: response.status || 200,
        headers: response.headers || {},
        body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body || {}),
        timestamp: new Date().toISOString(),
      } : undefined,
    });
  }

  /**
   * Complete transaction
   */
  completeTransaction(transactionId: string, res: Response, body?: any, error?: Error): OpenHIMTransaction | undefined {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return undefined;

    transaction.response = {
      status: res.statusCode,
      headers: res.getHeaders() as Record<string, string>,
      body: typeof body === 'string' ? body : JSON.stringify(body || {}),
      timestamp: new Date().toISOString(),
    };

    if (error) {
      transaction.status = 'Failed';
      transaction.error = {
        message: error.message,
        stack: error.stack || '',
      };
    } else if (res.statusCode >= 500) {
      transaction.status = 'Failed';
    } else if (res.statusCode >= 400) {
      transaction.status = 'Completed with error(s)';
    } else {
      transaction.status = 'Successful';
    }

    return transaction;
  }

  /**
   * Get transaction
   */
  getTransaction(transactionId: string): OpenHIMTransaction | undefined {
    return this.transactions.get(transactionId);
  }

  /**
   * Get recent audit messages
   */
  getAuditMessages(limit: number = 100): ATNAAuditMessage[] {
    return this.auditMessages.slice(-limit);
  }

  /**
   * Clear old transactions (memory management)
   */
  clearOldTransactions(maxAge: number = 3600000): void {
    const cutoff = Date.now() - maxAge;
    for (const [id, tx] of this.transactions) {
      const txTime = new Date(tx.request.timestamp).getTime();
      if (txTime < cutoff) {
        this.transactions.delete(id);
      }
    }
  }

  /**
   * Express middleware for automatic transaction tracking
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const transactionId = this.startTransaction(req);
      
      // Attach transaction ID to request
      (req as any).transactionId = transactionId;
      (req as any).auditMediator = this;

      // Capture response
      const originalSend = res.send.bind(res);
      res.send = (body: any) => {
        this.completeTransaction(transactionId, res, body);
        return originalSend(body);
      };

      next();
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let mediatorInstance: OpenHIMAuditMediator | null = null;

export function getAuditMediator(): OpenHIMAuditMediator {
  if (!mediatorInstance) {
    mediatorInstance = new OpenHIMAuditMediator();
  }
  return mediatorInstance;
}

// ============================================================================
// Express Middleware Export
// ============================================================================

export function auditMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return getAuditMediator().middleware();
}

// ============================================================================
// Convenience Audit Functions
// ============================================================================

export function auditPrescriptionCreated(
  prescriptionId: string,
  prescriptionNumber: string,
  userId: string,
  userName: string,
  userRole: string,
  ipAddress?: string,
  success: boolean = true
): ATNAAuditMessage {
  return getAuditMediator().createAuditMessage({
    eventCode: HEALTHCARE_EVENT_CODES.PRESCRIPTION_CREATE,
    actionCode: 'C',
    outcome: success ? '0' : '4',
    actor: {
      userId,
      userName,
      roleCode: userRole,
      roleDisplay: userRole,
      ipAddress,
      isRequestor: true,
    },
    participantObject: {
      typeCode: '2',
      idTypeCode: 'prescription-number',
      idTypeDisplay: 'Prescription Number',
      id: prescriptionNumber,
      name: `Prescription ${prescriptionNumber}`,
      sensitivity: 'N',
      details: [{ type: 'prescription-id', value: prescriptionId }],
    },
  });
}

export function auditDispenseRecorded(
  dispenseId: string,
  prescriptionNumber: string,
  pharmacistId: string,
  pharmacistName: string,
  pharmacyId: string,
  ipAddress?: string,
  success: boolean = true
): ATNAAuditMessage {
  return getAuditMediator().createAuditMessage({
    eventCode: HEALTHCARE_EVENT_CODES.DISPENSE_RECORD,
    actionCode: 'C',
    outcome: success ? '0' : '4',
    actor: {
      userId: pharmacistId,
      userName: pharmacistName,
      roleCode: 'pharmacist',
      roleDisplay: 'Pharmacist',
      ipAddress,
      isRequestor: true,
    },
    participantObject: {
      typeCode: '2',
      idTypeCode: 'dispense-id',
      idTypeDisplay: 'Dispense ID',
      id: dispenseId,
      name: `Dispense for ${prescriptionNumber}`,
      details: [
        { type: 'prescription-number', value: prescriptionNumber },
        { type: 'pharmacy-id', value: pharmacyId },
      ],
    },
  });
}

export function auditMedicationRecall(
  recallId: string,
  edaCode: string,
  medicationName: string,
  recallClass: string,
  regulatorId: string,
  regulatorName: string,
  ipAddress?: string
): ATNAAuditMessage {
  return getAuditMediator().createAuditMessage({
    eventCode: HEALTHCARE_EVENT_CODES.MEDICATION_RECALL,
    actionCode: 'U',
    outcome: '0',
    actor: {
      userId: regulatorId,
      userName: regulatorName,
      roleCode: 'regulator',
      roleDisplay: 'EDA Regulator',
      ipAddress,
      isRequestor: true,
    },
    participantObject: {
      typeCode: '2',
      idTypeCode: 'eda-code',
      idTypeDisplay: 'EDA Medication Code',
      id: edaCode,
      name: medicationName,
      sensitivity: 'N',
      details: [
        { type: 'recall-id', value: recallId },
        { type: 'recall-class', value: recallClass },
      ],
    },
  });
}

export function auditLogin(
  userId: string,
  userName: string,
  userRole: string,
  ipAddress: string,
  success: boolean = true
): ATNAAuditMessage {
  return getAuditMediator().createAuditMessage({
    eventCode: HEALTHCARE_EVENT_CODES.LOGIN,
    actionCode: 'E',
    outcome: success ? '0' : '4',
    actor: {
      userId,
      userName,
      roleCode: userRole,
      roleDisplay: userRole,
      ipAddress,
      isRequestor: true,
    },
  });
}

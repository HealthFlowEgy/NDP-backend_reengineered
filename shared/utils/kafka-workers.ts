/**
 * Kafka Event Consumer Workers
 * Background workers for processing NDP events
 * National Digital Prescription Platform - Egypt
 */

import {
  getKafkaService,
  KAFKA_TOPICS,
  NDPEvent,
  PrescriptionCreatedPayload,
  PrescriptionSignedPayload,
  DispenseRecordedPayload,
  MedicationRecalledPayload,
  AuditLogPayload,
  ComplianceAlertPayload,
  NotificationRequestedPayload,
} from './kafka.js';

import {
  getElasticsearchService,
  AuditLogDocument,
  ComplianceAlertDocument,
} from './elasticsearch.js';

// ============================================================================
// Worker Configuration
// ============================================================================

interface WorkerConfig {
  enabled: boolean;
  groupId: string;
  topics: string[];
}

const WORKERS: Record<string, WorkerConfig> = {
  audit: {
    enabled: true,
    groupId: 'audit-worker',
    topics: [KAFKA_TOPICS.AUDIT_LOG],
  },
  compliance: {
    enabled: true,
    groupId: 'compliance-worker',
    topics: [KAFKA_TOPICS.COMPLIANCE_ALERT],
  },
  notification: {
    enabled: true,
    groupId: 'notification-worker',
    topics: [
      KAFKA_TOPICS.NOTIFICATION_REQUESTED,
      KAFKA_TOPICS.PRESCRIPTION_CREATED,
      KAFKA_TOPICS.PRESCRIPTION_SIGNED,
      KAFKA_TOPICS.DISPENSE_RECORDED,
      KAFKA_TOPICS.MEDICATION_RECALLED,
    ],
  },
  analytics: {
    enabled: true,
    groupId: 'analytics-worker',
    topics: [
      KAFKA_TOPICS.PRESCRIPTION_CREATED,
      KAFKA_TOPICS.PRESCRIPTION_SIGNED,
      KAFKA_TOPICS.PRESCRIPTION_COMPLETED,
      KAFKA_TOPICS.DISPENSE_RECORDED,
    ],
  },
};

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle audit log events - persist to Elasticsearch
 */
async function handleAuditLog(event: NDPEvent<AuditLogPayload>): Promise<void> {
  const es = getElasticsearchService();
  const payload = event.payload;

  const doc: Omit<AuditLogDocument, '@timestamp' | 'eventId'> = {
    action: payload.action,
    category: determineCategory(payload.action),
    resourceType: payload.resourceType,
    resourceId: payload.resourceId,
    actor: {
      id: payload.actorId,
      name: payload.actorName || 'Unknown',
      role: payload.actorRole,
      license: payload.actorLicense,
      type: determineActorType(payload.actorRole),
    },
    request: payload.ipAddress ? {
      method: 'API',
      path: payload.resourceType,
      ipAddress: payload.ipAddress,
      userAgent: payload.userAgent || '',
      sessionId: payload.sessionId,
    } : undefined,
    outcome: payload.outcome,
    errorMessage: payload.errorMessage,
    details: payload.details,
    facility: payload.facility,
  };

  await es.logAudit(doc);
  console.log(`[AuditWorker] Indexed audit log: ${event.eventId}`);
}

/**
 * Handle compliance alert events
 */
async function handleComplianceAlert(event: NDPEvent<ComplianceAlertPayload>): Promise<void> {
  const es = getElasticsearchService();
  const payload = event.payload;

  const doc: Omit<ComplianceAlertDocument, '@timestamp'> = {
    alertId: payload.alertId,
    alertType: payload.alertType,
    severity: payload.severity,
    status: 'open',
    entityType: payload.entityType as any,
    entityId: payload.entityId,
    entityName: payload.entityName,
    description: payload.description,
    metrics: payload.metrics,
  };

  await es.logComplianceAlert(doc);
  console.log(`[ComplianceWorker] Indexed compliance alert: ${payload.alertId}`);

  // For critical alerts, trigger immediate notification
  if (payload.severity === 'critical') {
    const kafka = getKafkaService();
    await kafka.publishNotificationRequested({
      notificationId: crypto.randomUUID(),
      type: 'recall_alert',
      channel: 'email',
      recipientId: 'regulators@eda.gov.eg',
      recipientEmail: 'regulators@eda.gov.eg',
      templateId: 'critical-compliance-alert',
      variables: {
        alertType: payload.alertType,
        entityName: payload.entityName,
        description: payload.description,
      },
      priority: 'urgent',
    });
  }
}

/**
 * Handle notification request events
 */
async function handleNotificationRequest(event: NDPEvent<NotificationRequestedPayload>): Promise<void> {
  const payload = event.payload;
  
  console.log(`[NotificationWorker] Processing notification: ${payload.notificationId}`);
  console.log(`  Type: ${payload.type}, Channel: ${payload.channel}, Priority: ${payload.priority}`);
  
  // In production, this would call the actual notification service
  // For now, we just log the request
  
  // Simulate sending notification
  const success = Math.random() > 0.05; // 95% success rate
  
  const kafka = getKafkaService();
  if (success) {
    const sentEvent = kafka.createEvent('NotificationSent', {
      notificationId: payload.notificationId,
      channel: payload.channel,
      sentAt: new Date().toISOString(),
    }, 'notification-worker');
    await kafka.publish(KAFKA_TOPICS.NOTIFICATION_SENT, sentEvent);
  } else {
    const failedEvent = kafka.createEvent('NotificationFailed', {
      notificationId: payload.notificationId,
      channel: payload.channel,
      error: 'Simulated failure for testing',
    }, 'notification-worker');
    await kafka.publish(KAFKA_TOPICS.NOTIFICATION_FAILED, failedEvent);
  }
}

/**
 * Handle prescription created events - trigger notifications
 */
async function handlePrescriptionCreated(event: NDPEvent<PrescriptionCreatedPayload>): Promise<void> {
  const payload = event.payload;
  console.log(`[AnalyticsWorker] Prescription created: ${payload.prescriptionNumber}`);

  // Queue patient notification (prescription ready)
  const kafka = getKafkaService();
  await kafka.publishNotificationRequested({
    notificationId: crypto.randomUUID(),
    type: 'prescription_created',
    channel: 'sms',
    recipientId: payload.patientNationalId,
    templateId: 'prescription-created-ar',
    variables: {
      prescriptionNumber: payload.prescriptionNumber,
      medicationCount: payload.medications.length.toString(),
    },
    priority: 'normal',
  });
}

/**
 * Handle medication recall events - notify affected parties
 */
async function handleMedicationRecalled(event: NDPEvent<MedicationRecalledPayload>): Promise<void> {
  const payload = event.payload;
  console.log(`[NotificationWorker] Medication recalled: ${payload.edaCode} (Class ${payload.recallClass})`);

  const kafka = getKafkaService();
  
  // For Class I recalls, send urgent notifications
  if (payload.recallClass === 'I') {
    await kafka.publishNotificationRequested({
      notificationId: crypto.randomUUID(),
      type: 'recall_alert',
      channel: 'sms',
      recipientId: 'broadcast',
      templateId: 'urgent-recall-ar',
      variables: {
        medicationName: payload.medicationName,
        edaCode: payload.edaCode,
        reason: payload.reason,
      },
      priority: 'urgent',
    });

    await kafka.publishNotificationRequested({
      notificationId: crypto.randomUUID(),
      type: 'recall_alert',
      channel: 'email',
      recipientId: 'pharmacies@ndp.gov.eg',
      recipientEmail: 'pharmacies@ndp.gov.eg',
      templateId: 'class1-recall-pharmacy',
      variables: {
        medicationName: payload.medicationName,
        edaCode: payload.edaCode,
        reason: payload.reason,
        batchNumbers: payload.batchNumbers.join(', '),
        affectedCount: payload.affectedPrescriptions.toString(),
      },
      priority: 'urgent',
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function determineCategory(action: string): AuditLogDocument['category'] {
  if (action.includes('login') || action.includes('logout') || action.includes('auth')) {
    return 'authentication';
  }
  if (action.includes('access') || action.includes('deny') || action.includes('permission')) {
    return 'authorization';
  }
  if (action.includes('read') || action.includes('search') || action.includes('get')) {
    return 'data_access';
  }
  if (action.includes('create') || action.includes('update') || action.includes('delete')) {
    return 'data_modification';
  }
  if (action.includes('compliance') || action.includes('alert') || action.includes('recall')) {
    return 'compliance';
  }
  return 'system';
}

function determineActorType(role: string): AuditLogDocument['actor']['type'] {
  if (role === 'physician' || role === 'doctor') return 'physician';
  if (role === 'pharmacist') return 'pharmacist';
  if (role === 'patient') return 'patient';
  if (role === 'regulator' || role === 'eda') return 'regulator';
  return 'system';
}

// ============================================================================
// Worker Initialization
// ============================================================================

/**
 * Start all event workers
 */
export async function startEventWorkers(): Promise<void> {
  const kafka = getKafkaService();
  await kafka.connect();

  // Start audit worker
  if (WORKERS.audit.enabled) {
    await kafka.subscribe(
      WORKERS.audit.topics as any[],
      WORKERS.audit.groupId,
      async (event) => {
        if (event.eventType === 'AuditLog') {
          await handleAuditLog(event as NDPEvent<AuditLogPayload>);
        }
      }
    );
    console.log('[Workers] Audit worker started');
  }

  // Start compliance worker
  if (WORKERS.compliance.enabled) {
    await kafka.subscribe(
      WORKERS.compliance.topics as any[],
      WORKERS.compliance.groupId,
      async (event) => {
        if (event.eventType === 'ComplianceAlert') {
          await handleComplianceAlert(event as NDPEvent<ComplianceAlertPayload>);
        }
      }
    );
    console.log('[Workers] Compliance worker started');
  }

  // Start notification worker
  if (WORKERS.notification.enabled) {
    await kafka.subscribe(
      WORKERS.notification.topics as any[],
      WORKERS.notification.groupId,
      async (event) => {
        switch (event.eventType) {
          case 'NotificationRequested':
            await handleNotificationRequest(event as NDPEvent<NotificationRequestedPayload>);
            break;
          case 'PrescriptionCreated':
            await handlePrescriptionCreated(event as NDPEvent<PrescriptionCreatedPayload>);
            break;
          case 'MedicationRecalled':
            await handleMedicationRecalled(event as NDPEvent<MedicationRecalledPayload>);
            break;
        }
      }
    );
    console.log('[Workers] Notification worker started');
  }

  // Start analytics worker
  if (WORKERS.analytics.enabled) {
    await kafka.subscribe(
      WORKERS.analytics.topics as any[],
      WORKERS.analytics.groupId,
      async (event) => {
        console.log(`[AnalyticsWorker] Processing: ${event.eventType}`);
        // Analytics processing would go here
        // In production, this would update aggregations, dashboards, etc.
      }
    );
    console.log('[Workers] Analytics worker started');
  }

  console.log('[Workers] All event workers started');
}

/**
 * Stop all workers
 */
export async function stopEventWorkers(): Promise<void> {
  const kafka = getKafkaService();
  await kafka.disconnect();
  console.log('[Workers] All event workers stopped');
}

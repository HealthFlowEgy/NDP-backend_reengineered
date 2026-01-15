/**
 * Kafka Event Streaming Service
 * Apache Kafka integration for event-driven architecture
 * National Digital Prescription Platform - Egypt
 */

import { Kafka, Producer, Consumer, EachMessagePayload, logLevel } from 'kafkajs';

// ============================================================================
// Configuration
// ============================================================================

const KAFKA_BROKERS = (process.env['KAFKA_BROKERS'] || 'localhost:9092').split(',');
const KAFKA_CLIENT_ID = process.env['KAFKA_CLIENT_ID'] || 'ndp-backend';
const KAFKA_GROUP_PREFIX = process.env['KAFKA_GROUP_PREFIX'] || 'ndp';

// ============================================================================
// Kafka Topics
// ============================================================================

export const KAFKA_TOPICS = {
  // Prescription Events
  PRESCRIPTION_CREATED: 'ndp.prescription.created',
  PRESCRIPTION_SIGNED: 'ndp.prescription.signed',
  PRESCRIPTION_CANCELLED: 'ndp.prescription.cancelled',
  PRESCRIPTION_EXPIRED: 'ndp.prescription.expired',
  
  // Dispense Events
  DISPENSE_RECORDED: 'ndp.dispense.recorded',
  DISPENSE_PARTIAL: 'ndp.dispense.partial',
  PRESCRIPTION_COMPLETED: 'ndp.prescription.completed',
  
  // Medication Events
  MEDICATION_RECALLED: 'ndp.medication.recalled',
  MEDICATION_UPDATED: 'ndp.medication.updated',
  
  // Audit Events
  AUDIT_LOG: 'ndp.audit.log',
  
  // Notification Events
  NOTIFICATION_REQUESTED: 'ndp.notification.requested',
  NOTIFICATION_SENT: 'ndp.notification.sent',
  NOTIFICATION_FAILED: 'ndp.notification.failed',
  
  // Compliance Events
  COMPLIANCE_ALERT: 'ndp.compliance.alert',
  CONTROLLED_SUBSTANCE: 'ndp.controlled.substance',
} as const;

export type KafkaTopic = typeof KAFKA_TOPICS[keyof typeof KAFKA_TOPICS];

// ============================================================================
// Event Types
// ============================================================================

export interface NDPEvent<T = unknown> {
  eventId: string;
  eventType: string;
  timestamp: string;
  source: string;
  correlationId?: string;
  actor?: {
    id: string;
    type: 'physician' | 'pharmacist' | 'patient' | 'regulator' | 'system';
    name?: string;
    license?: string;
  };
  payload: T;
  metadata?: Record<string, unknown>;
}

export interface PrescriptionCreatedPayload {
  prescriptionId: string;
  prescriptionNumber: string;
  patientNationalId: string;
  physicianLicense: string;
  facilityId: string;
  medications: Array<{
    edaCode: string;
    name: string;
    quantity: number;
  }>;
  status: string;
}

export interface PrescriptionSignedPayload {
  prescriptionId: string;
  prescriptionNumber: string;
  signedBy: string;
  signedAt: string;
  signatureHash: string;
}

export interface DispenseRecordedPayload {
  dispenseId: string;
  prescriptionId: string;
  prescriptionNumber: string;
  pharmacyId: string;
  pharmacistLicense: string;
  items: Array<{
    edaCode: string;
    quantity: number;
  }>;
  isPartial: boolean;
  dispenseNumber: number;
  remainingDispenses: number;
}

export interface MedicationRecalledPayload {
  recallId: string;
  edaCode: string;
  medicationName: string;
  recallClass: 'I' | 'II' | 'III';
  reason: string;
  batchNumbers: string[];
  recalledBy: string;
  affectedPrescriptions: number;
}

export interface AuditLogPayload {
  action: string;
  resourceType: string;
  resourceId: string;
  actorId: string;
  actorName?: string;
  actorRole: string;
  actorLicense?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  outcome: 'success' | 'failure';
  errorMessage?: string;
  details?: Record<string, unknown>;
  facility?: {
    id: string;
    name: string;
    type: string;
    governorate?: string;
  };
}

export interface ComplianceAlertPayload {
  alertId: string;
  alertType: 'overprescribing' | 'controlled_substance' | 'duplicate_therapy' | 'interaction' | 'recall_affected';
  severity: 'low' | 'medium' | 'high' | 'critical';
  entityType: 'physician' | 'pharmacist' | 'pharmacy' | 'patient';
  entityId: string;
  entityName: string;
  description: string;
  metrics?: Record<string, number>;
}

export interface NotificationRequestedPayload {
  notificationId: string;
  type: 'prescription_created' | 'prescription_ready' | 'dispense_complete' | 'recall_alert';
  channel: 'sms' | 'email' | 'whatsapp' | 'push';
  recipientId: string;
  recipientPhone?: string;
  recipientEmail?: string;
  templateId: string;
  variables: Record<string, string>;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

// ============================================================================
// Kafka Service Class
// ============================================================================

export class KafkaEventService {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Map<string, Consumer> = new Map();
  private connected = false;

  constructor() {
    this.kafka = new Kafka({
      clientId: KAFKA_CLIENT_ID,
      brokers: KAFKA_BROKERS,
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });
  }

  /**
   * Initialize and connect producer
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });

    await this.producer.connect();
    this.connected = true;
    console.log(`[Kafka] Producer connected to ${KAFKA_BROKERS.join(', ')}`);
  }

  /**
   * Disconnect producer and all consumers
   */
  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }

    for (const [groupId, consumer] of this.consumers) {
      await consumer.disconnect();
      console.log(`[Kafka] Consumer ${groupId} disconnected`);
    }
    
    this.consumers.clear();
    this.connected = false;
    console.log('[Kafka] All connections closed');
  }

  /**
   * Publish event to topic
   */
  async publish<T>(topic: KafkaTopic, event: NDPEvent<T>): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer not initialized. Call connect() first.');
    }

    await this.producer.send({
      topic,
      messages: [
        {
          key: event.correlationId || event.eventId,
          value: JSON.stringify(event),
          headers: {
            'event-type': event.eventType,
            'event-id': event.eventId,
            'timestamp': event.timestamp,
            'source': event.source,
          },
        },
      ],
    });
  }

  /**
   * Subscribe to topics with handler
   */
  async subscribe(
    topics: KafkaTopic[],
    groupId: string,
    handler: (event: NDPEvent, topic: string) => Promise<void>
  ): Promise<void> {
    const fullGroupId = `${KAFKA_GROUP_PREFIX}-${groupId}`;
    
    const consumer = this.kafka.consumer({
      groupId: fullGroupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    await consumer.connect();

    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }

    await consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        try {
          const event = JSON.parse(message.value?.toString() || '{}') as NDPEvent;
          await handler(event, topic);
        } catch (error) {
          console.error(`[Kafka] Error processing message from ${topic}:${partition}`, error);
        }
      },
    });

    this.consumers.set(fullGroupId, consumer);
    console.log(`[Kafka] Consumer ${fullGroupId} subscribed to ${topics.join(', ')}`);
  }

  /**
   * Create standard event envelope
   */
  createEvent<T>(
    eventType: string,
    payload: T,
    source: string,
    options?: {
      correlationId?: string;
      actor?: NDPEvent['actor'];
      metadata?: Record<string, unknown>;
    }
  ): NDPEvent<T> {
    return {
      eventId: crypto.randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      source,
      correlationId: options?.correlationId,
      actor: options?.actor,
      payload,
      metadata: options?.metadata,
    };
  }

  // ============================================================================
  // Convenience Publishers
  // ============================================================================

  async publishPrescriptionCreated(
    payload: PrescriptionCreatedPayload,
    actor: NDPEvent['actor']
  ): Promise<void> {
    const event = this.createEvent('PrescriptionCreated', payload, 'prescription-service', {
      correlationId: payload.prescriptionId,
      actor,
    });
    await this.publish(KAFKA_TOPICS.PRESCRIPTION_CREATED, event);
  }

  async publishPrescriptionSigned(
    payload: PrescriptionSignedPayload,
    actor: NDPEvent['actor']
  ): Promise<void> {
    const event = this.createEvent('PrescriptionSigned', payload, 'signing-service', {
      correlationId: payload.prescriptionId,
      actor,
    });
    await this.publish(KAFKA_TOPICS.PRESCRIPTION_SIGNED, event);
  }

  async publishDispenseRecorded(
    payload: DispenseRecordedPayload,
    actor: NDPEvent['actor']
  ): Promise<void> {
    const eventType = payload.isPartial ? 'PartialDispenseRecorded' : 'DispenseRecorded';
    const topic = payload.isPartial ? KAFKA_TOPICS.DISPENSE_PARTIAL : KAFKA_TOPICS.DISPENSE_RECORDED;
    
    const event = this.createEvent(eventType, payload, 'dispense-service', {
      correlationId: payload.prescriptionId,
      actor,
    });
    await this.publish(topic, event);

    // If no remaining dispenses, also publish completion
    if (payload.remainingDispenses === 0) {
      const completionEvent = this.createEvent('PrescriptionCompleted', {
        prescriptionId: payload.prescriptionId,
        prescriptionNumber: payload.prescriptionNumber,
        totalDispenses: payload.dispenseNumber,
      }, 'dispense-service', { correlationId: payload.prescriptionId, actor });
      await this.publish(KAFKA_TOPICS.PRESCRIPTION_COMPLETED, completionEvent);
    }
  }

  async publishMedicationRecalled(
    payload: MedicationRecalledPayload,
    actor: NDPEvent['actor']
  ): Promise<void> {
    const event = this.createEvent('MedicationRecalled', payload, 'regulator-service', {
      correlationId: payload.recallId,
      actor,
    });
    await this.publish(KAFKA_TOPICS.MEDICATION_RECALLED, event);
  }

  async publishAuditLog(payload: AuditLogPayload): Promise<void> {
    const event = this.createEvent('AuditLog', payload, payload.resourceType.toLowerCase() + '-service', {
      correlationId: payload.resourceId,
    });
    await this.publish(KAFKA_TOPICS.AUDIT_LOG, event);
  }

  async publishComplianceAlert(
    payload: ComplianceAlertPayload,
    actor?: NDPEvent['actor']
  ): Promise<void> {
    const event = this.createEvent('ComplianceAlert', payload, 'regulator-service', {
      correlationId: payload.alertId,
      actor,
    });
    await this.publish(KAFKA_TOPICS.COMPLIANCE_ALERT, event);
  }

  async publishNotificationRequested(payload: NotificationRequestedPayload): Promise<void> {
    const event = this.createEvent('NotificationRequested', payload, 'notification-service', {
      correlationId: payload.notificationId,
    });
    await this.publish(KAFKA_TOPICS.NOTIFICATION_REQUESTED, event);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: KafkaEventService | null = null;

export function getKafkaService(): KafkaEventService {
  if (!instance) {
    instance = new KafkaEventService();
  }
  return instance;
}

export async function initKafka(): Promise<KafkaEventService> {
  const service = getKafkaService();
  await service.connect();
  return service;
}

export async function shutdownKafka(): Promise<void> {
  if (instance) {
    await instance.disconnect();
    instance = null;
  }
}

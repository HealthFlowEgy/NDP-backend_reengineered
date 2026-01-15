/**
 * NDP Kafka Event Streaming Library
 * Provides event producers and consumers for prescription lifecycle events
 */

import { Kafka, Producer, Consumer, EachMessagePayload, logLevel } from 'kafkajs';

// ============================================================================
// Types
// ============================================================================

export interface NDPEvent<T = unknown> {
  eventId: string;
  eventType: NDPEventType;
  timestamp: string;
  source: string;
  correlationId?: string;
  payload: T;
  metadata: {
    userId?: string;
    userRole?: string;
    ipAddress?: string;
    userAgent?: string;
  };
}

export type NDPEventType =
  | 'prescription.created'
  | 'prescription.signed'
  | 'prescription.cancelled'
  | 'prescription.dispensed'
  | 'prescription.partially_dispensed'
  | 'prescription.expired'
  | 'dispense.recorded'
  | 'dispense.reversed'
  | 'medication.recalled'
  | 'medication.updated'
  | 'validation.failed'
  | 'validation.warning'
  | 'notification.sent'
  | 'notification.failed'
  | 'audit.action';

export interface PrescriptionCreatedPayload {
  prescriptionId: string;
  prescriptionNumber: string;
  patientNationalId: string;
  prescriberLicense: string;
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
  signatureAlgorithm: string;
  signedAt: string;
}

export interface DispenseRecordedPayload {
  dispenseId: string;
  prescriptionId: string;
  prescriptionNumber: string;
  pharmacyId: string;
  pharmacistLicense: string;
  dispensedItems: Array<{
    edaCode: string;
    name: string;
    quantityDispensed: number;
  }>;
  isPartial: boolean;
}

export interface MedicationRecalledPayload {
  edaCode: string;
  medicationName: string;
  recallClass: 'I' | 'II' | 'III';
  reason: string;
  affectedBatches?: string[];
  recalledBy: string;
}

export interface AuditEventPayload {
  action: string;
  resourceType: string;
  resourceId: string;
  oldValue?: unknown;
  newValue?: unknown;
  result: 'success' | 'failure';
  errorMessage?: string;
}

// ============================================================================
// Kafka Configuration
// ============================================================================

const KAFKA_TOPICS = {
  PRESCRIPTION_EVENTS: 'ndp.prescription.events',
  DISPENSE_EVENTS: 'ndp.dispense.events',
  MEDICATION_EVENTS: 'ndp.medication.events',
  NOTIFICATION_EVENTS: 'ndp.notification.events',
  AUDIT_EVENTS: 'ndp.audit.events',
  DEAD_LETTER: 'ndp.dead-letter',
} as const;

const DEFAULT_KAFKA_CONFIG = {
  brokers: (process.env.KAFKA_BROKERS || 'kafka-0.kafka-headless.ndp-kafka:9092').split(','),
  clientId: process.env.SERVICE_NAME || 'ndp-service',
  connectionTimeout: 10000,
  requestTimeout: 30000,
  retry: {
    initialRetryTime: 100,
    retries: 8,
    maxRetryTime: 30000,
  },
  logLevel: logLevel.INFO,
};

// ============================================================================
// Event Producer
// ============================================================================

export class NDPEventProducer {
  private kafka: Kafka;
  private producer: Producer;
  private isConnected: boolean = false;
  private serviceName: string;

  constructor(serviceName: string, kafkaConfig?: Partial<typeof DEFAULT_KAFKA_CONFIG>) {
    this.serviceName = serviceName;
    this.kafka = new Kafka({
      ...DEFAULT_KAFKA_CONFIG,
      ...kafkaConfig,
      clientId: serviceName,
    });
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
      idempotent: true,
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      await this.producer.connect();
      this.isConnected = true;
      console.log(`[${this.serviceName}] Kafka producer connected`);
    } catch (error) {
      console.error(`[${this.serviceName}] Failed to connect Kafka producer:`, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.producer.disconnect();
      this.isConnected = false;
      console.log(`[${this.serviceName}] Kafka producer disconnected`);
    } catch (error) {
      console.error(`[${this.serviceName}] Error disconnecting Kafka producer:`, error);
    }
  }

  private createEvent<T>(eventType: NDPEventType, payload: T, metadata?: NDPEvent['metadata']): NDPEvent<T> {
    return {
      eventId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      eventType,
      timestamp: new Date().toISOString(),
      source: this.serviceName,
      payload,
      metadata: metadata || {},
    };
  }

  private getTopicForEventType(eventType: NDPEventType): string {
    if (eventType.startsWith('prescription.')) return KAFKA_TOPICS.PRESCRIPTION_EVENTS;
    if (eventType.startsWith('dispense.')) return KAFKA_TOPICS.DISPENSE_EVENTS;
    if (eventType.startsWith('medication.')) return KAFKA_TOPICS.MEDICATION_EVENTS;
    if (eventType.startsWith('notification.')) return KAFKA_TOPICS.NOTIFICATION_EVENTS;
    if (eventType.startsWith('audit.')) return KAFKA_TOPICS.AUDIT_EVENTS;
    return KAFKA_TOPICS.AUDIT_EVENTS;
  }

  async publish<T>(eventType: NDPEventType, payload: T, metadata?: NDPEvent['metadata']): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    const event = this.createEvent(eventType, payload, metadata);
    const topic = this.getTopicForEventType(eventType);

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: event.eventId,
            value: JSON.stringify(event),
            headers: {
              'event-type': eventType,
              'source': this.serviceName,
              'correlation-id': event.correlationId || '',
            },
          },
        ],
      });

      console.log(`[${this.serviceName}] Published event ${eventType} to ${topic}:`, event.eventId);
    } catch (error) {
      console.error(`[${this.serviceName}] Failed to publish event:`, error);
      throw error;
    }
  }

  // Convenience methods for common events
  async publishPrescriptionCreated(payload: PrescriptionCreatedPayload, metadata?: NDPEvent['metadata']): Promise<void> {
    await this.publish('prescription.created', payload, metadata);
  }

  async publishPrescriptionSigned(payload: PrescriptionSignedPayload, metadata?: NDPEvent['metadata']): Promise<void> {
    await this.publish('prescription.signed', payload, metadata);
  }

  async publishDispenseRecorded(payload: DispenseRecordedPayload, metadata?: NDPEvent['metadata']): Promise<void> {
    await this.publish('dispense.recorded', payload, metadata);
  }

  async publishMedicationRecalled(payload: MedicationRecalledPayload, metadata?: NDPEvent['metadata']): Promise<void> {
    await this.publish('medication.recalled', payload, metadata);
  }

  async publishAuditEvent(payload: AuditEventPayload, metadata?: NDPEvent['metadata']): Promise<void> {
    await this.publish('audit.action', payload, metadata);
  }
}

// ============================================================================
// Event Consumer
// ============================================================================

export type EventHandler<T = unknown> = (event: NDPEvent<T>) => Promise<void>;

export class NDPEventConsumer {
  private kafka: Kafka;
  private consumer: Consumer;
  private isConnected: boolean = false;
  private serviceName: string;
  private handlers: Map<NDPEventType, EventHandler[]> = new Map();

  constructor(
    serviceName: string,
    groupId: string,
    kafkaConfig?: Partial<typeof DEFAULT_KAFKA_CONFIG>
  ) {
    this.serviceName = serviceName;
    this.kafka = new Kafka({
      ...DEFAULT_KAFKA_CONFIG,
      ...kafkaConfig,
      clientId: serviceName,
    });
    this.consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 5000,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      await this.consumer.connect();
      this.isConnected = true;
      console.log(`[${this.serviceName}] Kafka consumer connected`);
    } catch (error) {
      console.error(`[${this.serviceName}] Failed to connect Kafka consumer:`, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.consumer.disconnect();
      this.isConnected = false;
      console.log(`[${this.serviceName}] Kafka consumer disconnected`);
    } catch (error) {
      console.error(`[${this.serviceName}] Error disconnecting Kafka consumer:`, error);
    }
  }

  on<T>(eventType: NDPEventType, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(eventType) || [];
    handlers.push(handler as EventHandler);
    this.handlers.set(eventType, handlers);
  }

  async subscribe(topics: string[]): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
      console.log(`[${this.serviceName}] Subscribed to topic: ${topic}`);
    }
  }

  async start(): Promise<void> {
    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        try {
          const event: NDPEvent = JSON.parse(message.value?.toString() || '{}');
          const handlers = this.handlers.get(event.eventType) || [];

          console.log(`[${this.serviceName}] Received event ${event.eventType} from ${topic}:`, event.eventId);

          for (const handler of handlers) {
            try {
              await handler(event);
            } catch (handlerError) {
              console.error(`[${this.serviceName}] Handler error for ${event.eventType}:`, handlerError);
              // Send to dead letter queue
              await this.sendToDeadLetter(event, handlerError);
            }
          }
        } catch (parseError) {
          console.error(`[${this.serviceName}] Failed to parse message from ${topic}:`, parseError);
        }
      },
    });
  }

  private async sendToDeadLetter(event: NDPEvent, error: unknown): Promise<void> {
    const producer = this.kafka.producer();
    try {
      await producer.connect();
      await producer.send({
        topic: KAFKA_TOPICS.DEAD_LETTER,
        messages: [
          {
            key: event.eventId,
            value: JSON.stringify({
              originalEvent: event,
              error: error instanceof Error ? error.message : String(error),
              failedAt: new Date().toISOString(),
              consumer: this.serviceName,
            }),
          },
        ],
      });
    } finally {
      await producer.disconnect();
    }
  }
}

// ============================================================================
// Singleton Instances
// ============================================================================

let producerInstance: NDPEventProducer | null = null;

export function getEventProducer(serviceName?: string): NDPEventProducer {
  if (!producerInstance) {
    producerInstance = new NDPEventProducer(serviceName || process.env.SERVICE_NAME || 'ndp-service');
  }
  return producerInstance;
}

// ============================================================================
// Express Middleware for Event Context
// ============================================================================

import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      eventMetadata?: NDPEvent['metadata'];
    }
  }
}

export function eventContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.eventMetadata = {
    userId: (req as any).user?.id,
    userRole: (req as any).user?.role,
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
  next();
}

// ============================================================================
// Topic Constants Export
// ============================================================================

export { KAFKA_TOPICS };

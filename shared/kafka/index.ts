/**
 * NDP Kafka Event Streaming Module
 * Re-exports all Kafka-related functionality
 */

export {
  // Types
  NDPEvent,
  NDPEventType,
  PrescriptionCreatedPayload,
  PrescriptionSignedPayload,
  DispenseRecordedPayload,
  MedicationRecalledPayload,
  AuditEventPayload,
  EventHandler,
  
  // Classes
  NDPEventProducer,
  NDPEventConsumer,
  
  // Functions
  getEventProducer,
  eventContextMiddleware,
  
  // Constants
  KAFKA_TOPICS,
} from './event-streaming';

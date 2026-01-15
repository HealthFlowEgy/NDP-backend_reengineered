/**
 * Legacy Adapter Kafka Worker
 * Processes async requests from Legacy Adapter and updates status
 */

import { 
  NDPEventConsumer, 
  getEventProducer,
  NDPEventProducer,
} from '../../../shared/kafka/index.js';
import { getDatabase, DatabaseClient } from '../../../shared/database/index.js';
import { getAuditLogger, AuditLogger } from '../../../shared/elasticsearch/index.js';
import { createLogger } from '../../../shared/utils/index.js';
import Redis from 'ioredis';

const SERVICE_NAME = 'legacy-adapter-worker';
const logger = createLogger(SERVICE_NAME, 'info');

// ============================================================================
// Configuration
// ============================================================================

const BACKEND_SERVICES = {
  prescription: process.env['PRESCRIPTION_SERVICE_URL'] || 'http://prescription-service:3001',
  dispense: process.env['DISPENSE_SERVICE_URL'] || 'http://dispense-service:3002',
  signing: process.env['SIGNING_SERVICE_URL'] || 'http://signing-service:3005',
};

// ============================================================================
// Services
// ============================================================================

let db: DatabaseClient;
let producer: NDPEventProducer;
let auditLogger: AuditLogger;
let redis: Redis;

// ============================================================================
// HTTP Client for Backend Services
// ============================================================================

async function callBackend(url: string, method: string = 'GET', body?: any, headers?: Record<string, string>): Promise<any> {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Name': SERVICE_NAME,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Backend error: ${response.status} - ${error}`);
  }

  return response.json();
}

// ============================================================================
// Status Update Helper
// ============================================================================

async function updateStatus(trackingId: string, status: any): Promise<void> {
  const statusKey = `legacy:status:${trackingId}`;
  await redis.setex(statusKey, 86400, JSON.stringify(status)); // 24 hours
  logger.debug('Status updated', { trackingId, status: status.Status });
}

// ============================================================================
// Legacy to FHIR Converters
// ============================================================================

function convertLegacyPrescriptionToFHIR(legacy: any): any {
  return {
    resourceType: 'MedicationRequest',
    status: 'draft',
    intent: 'order',
    subject: {
      identifier: { 
        system: 'http://ndp.egypt.gov.eg/national-id',
        value: legacy.PatientNationalID,
      },
      display: legacy.PatientName,
    },
    requester: {
      identifier: { 
        system: 'http://ndp.egypt.gov.eg/physician-license',
        value: legacy.PhysicianLicense,
      },
      display: legacy.PhysicianName,
    },
    authoredOn: new Date().toISOString(),
    dosageInstruction: legacy.Medications?.map((med: any) => ({
      text: med.Dosage,
      timing: {
        code: { text: med.Frequency },
      },
      route: med.Route ? { text: med.Route } : undefined,
      doseAndRate: [{
        doseQuantity: {
          value: med.Quantity,
          unit: med.Unit,
        },
      }],
    })),
    contained: legacy.Medications?.map((med: any, idx: number) => ({
      resourceType: 'Medication',
      id: `med-${idx}`,
      code: {
        coding: [{
          system: 'http://ndp.egypt.gov.eg/eda-code',
          code: med.DrugCode,
          display: med.DrugName,
        }],
      },
    })),
    dispenseRequest: {
      numberOfRepeatsAllowed: legacy.AllowedDispenses || 1,
      quantity: {
        value: legacy.Medications?.length || 1,
      },
    },
    note: legacy.Notes ? [{ text: legacy.Notes }] : undefined,
  };
}

function convertLegacyDispenseToFHIR(legacy: any): any {
  return {
    resourceType: 'MedicationDispense',
    status: 'completed',
    authorizingPrescription: [{
      identifier: { value: legacy.PrescriptionNumber },
    }],
    performer: [{
      actor: {
        identifier: { 
          system: 'http://ndp.egypt.gov.eg/pharmacist-license',
          value: legacy.PharmacistLicense,
        },
        display: legacy.PharmacistName,
      },
    }],
    location: {
      identifier: { 
        system: 'http://ndp.egypt.gov.eg/pharmacy-code',
        value: legacy.PharmacyCode,
      },
      display: legacy.PharmacyName,
    },
    whenHandedOver: legacy.DispenseDate || new Date().toISOString(),
    quantity: {
      value: legacy.Items?.reduce((sum: number, item: any) => sum + item.QuantityDispensed, 0) || 0,
    },
  };
}

// ============================================================================
// Request Handlers
// ============================================================================

async function handlePrescriptionCreate(event: any): Promise<void> {
  const { trackingId, legacyRequest, callbackUrl, headers } = event.payload;
  const startTime = Date.now();

  logger.info('Processing prescription create', { trackingId });

  try {
    // Update status to PROCESSING
    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'PROCESSING',
      Message: 'Converting to FHIR and creating prescription',
      StartedAt: new Date().toISOString(),
    });

    // Convert legacy format to FHIR
    const fhirRequest = convertLegacyPrescriptionToFHIR(legacyRequest);

    // Call prescription service
    const result = await callBackend(
      `${BACKEND_SERVICES.prescription}/fhir/MedicationRequest`,
      'POST',
      fhirRequest,
      headers?.authorization ? { Authorization: headers.authorization } : undefined
    );

    // Update status to COMPLETED
    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'COMPLETED',
      Message: 'Prescription created successfully',
      Result: {
        PrescriptionID: result.id,
        PrescriptionNumber: result.identifier?.[0]?.value,
        Status: result.status,
      },
      CompletedAt: new Date().toISOString(),
      ProcessingTimeMs: Date.now() - startTime,
    });

    // Publish completion event
    await producer.publish('prescription.created', {
      correlationId: trackingId,
      prescriptionId: result.id,
      prescriptionNumber: result.identifier?.[0]?.value,
      source: 'legacy-adapter',
      result,
    });

    // Send callback if URL provided
    if (callbackUrl) {
      await sendCallback(callbackUrl, {
        TrackingID: trackingId,
        Status: 'COMPLETED',
        PrescriptionID: result.id,
        PrescriptionNumber: result.identifier?.[0]?.value,
      });
    }

    // Audit log
    await auditLogger.log({
      eventType: 'prescription.create',
      action: 'create',
      resourceType: 'prescription',
      resourceId: result.id,
      result: 'success',
      metadata: {
        trackingId,
        source: 'legacy-adapter',
        processingTimeMs: Date.now() - startTime,
      },
    });

    logger.info('Prescription create completed', { trackingId, prescriptionId: result.id });

  } catch (error: any) {
    logger.error('Prescription create failed', { trackingId, error: error.message });

    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'FAILED',
      Message: 'Failed to create prescription',
      Error: error.message,
      FailedAt: new Date().toISOString(),
      ProcessingTimeMs: Date.now() - startTime,
    });

    // Publish failure event
    await producer.publish('prescription.created', {
      correlationId: trackingId,
      source: 'legacy-adapter',
      error: error.message,
    });

    // Send callback with error
    if (callbackUrl) {
      await sendCallback(callbackUrl, {
        TrackingID: trackingId,
        Status: 'FAILED',
        Error: error.message,
      });
    }

    // Audit log failure
    await auditLogger.log({
      eventType: 'prescription.create',
      action: 'create',
      resourceType: 'prescription',
      resourceId: trackingId,
      result: 'failure',
      errorMessage: error.message,
      metadata: { trackingId, source: 'legacy-adapter' },
    });
  }
}

async function handlePrescriptionSign(event: any): Promise<void> {
  const { trackingId, prescriptionNumber, prescriptionId, signature, callbackUrl, headers } = event.payload;
  const startTime = Date.now();

  logger.info('Processing prescription sign', { trackingId, prescriptionNumber });

  try {
    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'PROCESSING',
      Message: 'Signing prescription',
      StartedAt: new Date().toISOString(),
    });

    const identifier = prescriptionId || prescriptionNumber;
    const result = await callBackend(
      `${BACKEND_SERVICES.prescription}/api/prescriptions/${identifier}/sign`,
      'POST',
      { signature },
      headers?.authorization ? { Authorization: headers.authorization } : undefined
    );

    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'COMPLETED',
      Message: 'Prescription signed successfully',
      Result: result,
      CompletedAt: new Date().toISOString(),
      ProcessingTimeMs: Date.now() - startTime,
    });

    await producer.publish('prescription.signed', {
      correlationId: trackingId,
      prescriptionId: identifier,
      source: 'legacy-adapter',
      result,
    });

    if (callbackUrl) {
      await sendCallback(callbackUrl, {
        TrackingID: trackingId,
        Status: 'COMPLETED',
        Result: result,
      });
    }

    logger.info('Prescription sign completed', { trackingId });

  } catch (error: any) {
    logger.error('Prescription sign failed', { trackingId, error: error.message });

    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'FAILED',
      Error: error.message,
      FailedAt: new Date().toISOString(),
    });

    if (callbackUrl) {
      await sendCallback(callbackUrl, {
        TrackingID: trackingId,
        Status: 'FAILED',
        Error: error.message,
      });
    }
  }
}

async function handlePrescriptionCancel(event: any): Promise<void> {
  const { trackingId, prescriptionNumber, prescriptionId, reason, callbackUrl } = event.payload;
  const startTime = Date.now();

  logger.info('Processing prescription cancel', { trackingId, prescriptionNumber });

  try {
    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'PROCESSING',
      Message: 'Cancelling prescription',
      StartedAt: new Date().toISOString(),
    });

    const identifier = prescriptionId || prescriptionNumber;
    const result = await callBackend(
      `${BACKEND_SERVICES.prescription}/api/prescriptions/${identifier}/cancel`,
      'POST',
      { reason }
    );

    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'COMPLETED',
      Message: 'Prescription cancelled successfully',
      Result: result,
      CompletedAt: new Date().toISOString(),
      ProcessingTimeMs: Date.now() - startTime,
    });

    await producer.publish('prescription.cancelled', {
      correlationId: trackingId,
      prescriptionId: identifier,
      source: 'legacy-adapter',
      reason,
    });

    if (callbackUrl) {
      await sendCallback(callbackUrl, {
        TrackingID: trackingId,
        Status: 'COMPLETED',
        Result: result,
      });
    }

    logger.info('Prescription cancel completed', { trackingId });

  } catch (error: any) {
    logger.error('Prescription cancel failed', { trackingId, error: error.message });

    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'FAILED',
      Error: error.message,
      FailedAt: new Date().toISOString(),
    });

    if (callbackUrl) {
      await sendCallback(callbackUrl, { TrackingID: trackingId, Status: 'FAILED', Error: error.message });
    }
  }
}

async function handleDispenseRecord(event: any): Promise<void> {
  const { trackingId, legacyRequest, callbackUrl, headers } = event.payload;
  const startTime = Date.now();

  logger.info('Processing dispense record', { trackingId, prescriptionNumber: legacyRequest.PrescriptionNumber });

  try {
    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'PROCESSING',
      Message: 'Recording dispense',
      StartedAt: new Date().toISOString(),
    });

    const fhirDispense = convertLegacyDispenseToFHIR(legacyRequest);

    const result = await callBackend(
      `${BACKEND_SERVICES.dispense}/fhir/MedicationDispense`,
      'POST',
      fhirDispense,
      headers?.authorization ? { Authorization: headers.authorization } : undefined
    );

    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'COMPLETED',
      Message: 'Dispense recorded successfully',
      Result: {
        DispenseID: result.id,
        PrescriptionNumber: legacyRequest.PrescriptionNumber,
        Status: result.status,
      },
      CompletedAt: new Date().toISOString(),
      ProcessingTimeMs: Date.now() - startTime,
    });

    await producer.publish('dispense.recorded', {
      correlationId: trackingId,
      dispenseId: result.id,
      prescriptionNumber: legacyRequest.PrescriptionNumber,
      source: 'legacy-adapter',
      result,
    });

    if (callbackUrl) {
      await sendCallback(callbackUrl, {
        TrackingID: trackingId,
        Status: 'COMPLETED',
        DispenseID: result.id,
      });
    }

    await auditLogger.logDispenseAccess(
      'create',
      result.id,
      legacyRequest.PharmacistLicense,
      'success',
      { trackingId, source: 'legacy-adapter' }
    );

    logger.info('Dispense record completed', { trackingId, dispenseId: result.id });

  } catch (error: any) {
    logger.error('Dispense record failed', { trackingId, error: error.message });

    await updateStatus(trackingId, {
      TrackingID: trackingId,
      Status: 'FAILED',
      Error: error.message,
      FailedAt: new Date().toISOString(),
    });

    if (callbackUrl) {
      await sendCallback(callbackUrl, { TrackingID: trackingId, Status: 'FAILED', Error: error.message });
    }
  }
}

// ============================================================================
// Callback Sender
// ============================================================================

async function sendCallback(url: string, payload: any): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NDP-Callback': 'true',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.warn('Callback failed', { url, status: response.status });
    } else {
      logger.debug('Callback sent', { url, trackingId: payload.TrackingID });
    }
  } catch (error: any) {
    logger.warn('Callback error', { url, error: error.message });
  }
}

// ============================================================================
// Main Worker
// ============================================================================

async function main(): Promise<void> {
  logger.info('Starting Legacy Adapter Worker');

  // Initialize services
  db = getDatabase(SERVICE_NAME, { usePgBouncer: true });
  producer = getEventProducer(SERVICE_NAME);
  auditLogger = getAuditLogger(SERVICE_NAME);
  redis = new Redis(process.env['REDIS_URL'] || 'redis://redis:6379');

  await db.connect();
  await producer.connect();
  await auditLogger.initialize();

  // Create consumer
  const consumer = new NDPEventConsumer(
    SERVICE_NAME,
    'legacy-adapter-workers'
  );

  // Register handlers
  consumer.on('prescription.legacy.create' as any, handlePrescriptionCreate);
  consumer.on('prescription.legacy.sign' as any, handlePrescriptionSign);
  consumer.on('prescription.legacy.cancel' as any, handlePrescriptionCancel);
  consumer.on('dispense.legacy.record' as any, handleDispenseRecord);

  // Subscribe to legacy topics
  await consumer.subscribe([
    'ndp.legacy.prescription.create',
    'ndp.legacy.prescription.sign',
    'ndp.legacy.prescription.cancel',
    'ndp.legacy.dispense.record',
  ]);

  // Start consuming
  await consumer.start();

  logger.info('Legacy Adapter Worker started and listening for messages');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down worker...');
    await producer.disconnect();
    await auditLogger.shutdown();
    await db.disconnect();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(error => {
  logger.error('Worker failed to start', error);
  process.exit(1);
});

/**
 * NDP Gap Implementation Integration Example
 * Shows how to integrate Kafka, Elasticsearch, PgBouncer, and Prometheus
 */

import express, { Application, Request, Response, NextFunction } from 'express';

// Import new gap implementation modules
import { 
  getEventProducer, 
  NDPEventConsumer, 
  eventContextMiddleware,
  KAFKA_TOPICS,
  PrescriptionCreatedPayload,
  DispenseRecordedPayload,
} from '../shared/kafka';

import { 
  getAuditLogger, 
  auditMiddleware,
} from '../shared/elasticsearch';

import { 
  getDatabase, 
  fhirJsonHelpers,
} from '../shared/database';

import { 
  metricsMiddleware, 
  metricsHandler,
  prescriptionsTotal,
  dispensesTotal,
  trackDatabaseQuery,
  trackExternalCall,
} from '../shared/metrics';

// ============================================================================
// Service Configuration
// ============================================================================

const SERVICE_NAME = 'prescription-service';
const PORT = process.env.PORT || 3001;

// Initialize components
const app: Application = express();
const eventProducer = getEventProducer(SERVICE_NAME);
const auditLogger = getAuditLogger(SERVICE_NAME);
const db = getDatabase(SERVICE_NAME, {
  usePgBouncer: process.env.USE_PGBOUNCER === 'true',
});

// ============================================================================
// Middleware Setup
// ============================================================================

app.use(express.json());
app.use(metricsMiddleware(SERVICE_NAME));
app.use(eventContextMiddleware);
app.use(auditMiddleware({ excludePaths: ['/health', '/ready', '/metrics'] }));

// ============================================================================
// Health & Metrics Endpoints
// ============================================================================

app.get('/health', async (req: Request, res: Response) => {
  const dbHealth = await db.healthCheck();
  res.status(dbHealth.healthy ? 200 : 503).json({
    status: dbHealth.healthy ? 'healthy' : 'unhealthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    checks: { database: dbHealth },
  });
});

app.get('/ready', async (req: Request, res: Response) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

app.get('/metrics', metricsHandler);

// ============================================================================
// Create Prescription with Full Integration
// ============================================================================

interface CreatePrescriptionRequest {
  patientNationalId: string;
  patientName: string;
  prescriberLicense: string;
  medications: Array<{
    edaCode: string;
    name: string;
    quantity: number;
    unit: string;
    dosageInstruction: string;
  }>;
}

app.post('/fhir/MedicationRequest', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const requestData: CreatePrescriptionRequest = req.body;
  
  try {
    // 1. Create prescription in database (via PgBouncer)
    const prescription = await trackDatabaseQuery(
      SERVICE_NAME,
      'INSERT',
      'prescriptions',
      async () => {
        const prescriptionNumber = `RX-${new Date().getFullYear()}-${Date.now()}`;
        const result = await db.query<{ id: string; prescription_number: string; status: string }>(
          `INSERT INTO prescriptions (prescription_number, patient_national_id, prescriber_license, status, fhir_resource)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, prescription_number, status`,
          [
            prescriptionNumber,
            requestData.patientNationalId,
            requestData.prescriberLicense,
            'draft',
            JSON.stringify({
              resourceType: 'MedicationRequest',
              status: 'draft',
              intent: 'order',
              subject: {
                identifier: { value: requestData.patientNationalId },
                display: requestData.patientName,
              },
            }),
          ]
        );
        return result.rows[0];
      }
    );

    // 2. Publish event to Kafka
    const eventPayload: PrescriptionCreatedPayload = {
      prescriptionId: prescription!.id,
      prescriptionNumber: prescription!.prescription_number,
      patientNationalId: requestData.patientNationalId,
      prescriberLicense: requestData.prescriberLicense,
      medications: requestData.medications.map(m => ({
        edaCode: m.edaCode,
        name: m.name,
        quantity: m.quantity,
      })),
      status: prescription!.status,
    };
    await eventProducer.publishPrescriptionCreated(eventPayload, req.eventMetadata);

    // 3. Log to Elasticsearch audit
    await auditLogger.logPrescriptionAccess(
      'create',
      prescription!.id,
      (req as any).user?.id || 'anonymous',
      'success',
      { prescriptionNumber: prescription!.prescription_number, duration: Date.now() - startTime }
    );

    // 4. Update Prometheus metrics
    prescriptionsTotal.inc({ status: 'draft', action: 'create' });

    // 5. Return response
    res.status(201).json({
      resourceType: 'MedicationRequest',
      id: prescription!.id,
      identifier: [{ value: prescription!.prescription_number }],
      status: prescription!.status,
    });

  } catch (error) {
    await auditLogger.logPrescriptionAccess('create', 'unknown', (req as any).user?.id || 'anonymous', 'failure', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
});

// ============================================================================
// Kafka Consumer for Event Processing
// ============================================================================

async function startEventConsumer(): Promise<void> {
  const consumer = new NDPEventConsumer(SERVICE_NAME, 'prescription-service-group');

  consumer.on<{ prescriptionId: string; signedBy: string }>('prescription.signed', async (event) => {
    console.log(`Processing signed prescription: ${event.payload.prescriptionId}`);
    await db.query(
      `UPDATE prescriptions SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [event.payload.prescriptionId]
    );
    prescriptionsTotal.inc({ status: 'active', action: 'sign' });
  });

  consumer.on<DispenseRecordedPayload>('dispense.recorded', async (event) => {
    console.log(`Processing dispense for prescription: ${event.payload.prescriptionId}`);
    await db.query(
      `UPDATE prescriptions 
       SET remaining_dispenses = remaining_dispenses - 1,
           status = CASE WHEN remaining_dispenses <= 1 THEN 'completed' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [event.payload.prescriptionId]
    );
    dispensesTotal.inc({ type: event.payload.isPartial ? 'partial' : 'full', pharmacy_id: event.payload.pharmacyId });
  });

  await consumer.subscribe([KAFKA_TOPICS.PRESCRIPTION_EVENTS, KAFKA_TOPICS.DISPENSE_EVENTS]);
  await consumer.start();
  console.log(`${SERVICE_NAME} event consumer started`);
}

// ============================================================================
// Database Transaction Example with PgBouncer
// ============================================================================

async function transferPrescription(prescriptionId: string, fromPharmacy: string, toPharmacy: string): Promise<void> {
  await db.transaction(async (tx) => {
    const prescription = await tx.queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM prescriptions WHERE id = $1 FOR UPDATE',
      [prescriptionId]
    );

    if (!prescription || prescription.status !== 'active') {
      throw new Error('Prescription not found or not active');
    }

    await tx.query(
      `INSERT INTO prescription_transfers (prescription_id, from_pharmacy, to_pharmacy) VALUES ($1, $2, $3)`,
      [prescriptionId, fromPharmacy, toPharmacy]
    );

    await tx.query(
      `UPDATE prescriptions SET assigned_pharmacy = $1, updated_at = NOW() WHERE id = $2`,
      [toPharmacy, prescriptionId]
    );
  });
}

// FHIR JSON query example using helpers
async function searchPrescriptionsByMedication(edaCode: string): Promise<any[]> {
  const sql = `
    SELECT id, prescription_number, fhir_resource
    FROM prescriptions
    WHERE ${fhirJsonHelpers.extractText('fhir_resource', 'medicationCodeableConcept', '0', 'coding', '0', 'code')} = $1
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return db.queryAll(sql, [edaCode]);
}

// ============================================================================
// External Service Call with Metrics Tracking
// ============================================================================

async function validateWithAIEngine(medications: any[]): Promise<{ valid: boolean; warnings: string[] }> {
  return trackExternalCall('ai-validation-engine', 'validatePrescription', async () => {
    const response = await fetch(
      process.env.AI_VALIDATION_URL || 'http://ai-validation-service:3006/api/validate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medications }),
      }
    );
    if (!response.ok) throw new Error(`AI validation failed: ${response.status}`);
    return response.json();
  });
}

// ============================================================================
// Elasticsearch Audit Search Endpoints
// ============================================================================

app.get('/api/audit/search', async (req: Request, res: Response) => {
  const { userId, resourceType, startDate, endDate, limit } = req.query;
  const results = await auditLogger.search({
    userId: userId as string,
    resourceType: resourceType as string,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
    limit: limit ? parseInt(limit as string, 10) : 100,
  });
  res.json(results);
});

app.get('/api/audit/user/:userId', async (req: Request, res: Response) => {
  const activity = await auditLogger.getRecentActivity(req.params.userId, 50);
  res.json(activity);
});

app.get('/api/audit/security-alerts', async (req: Request, res: Response) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const alerts = await auditLogger.getSecurityAlerts(startDate, new Date());
  res.json(alerts);
});

// ============================================================================
// Error Handling
// ============================================================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  
  if (err.message.includes('unauthorized') || err.message.includes('forbidden')) {
    auditLogger.logSecurityAlert(`Security error: ${err.message}`, 'medium', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    }).catch(console.error);
  }

  res.status(500).json({
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'exception', diagnostics: err.message }],
  });
});

// ============================================================================
// Startup & Shutdown
// ============================================================================

async function start(): Promise<void> {
  try {
    await db.connect();
    console.log('Database connected (via PgBouncer: ' + (process.env.USE_PGBOUNCER === 'true') + ')');

    await eventProducer.connect();
    console.log('Kafka producer connected');

    await auditLogger.initialize();
    console.log('Elasticsearch audit logger initialized');

    if (process.env.ENABLE_CONSUMER === 'true') {
      await startEventConsumer();
    }

    app.listen(PORT, () => {
      console.log(`${SERVICE_NAME} listening on port ${PORT}`);
      console.log(`Metrics: http://localhost:${PORT}/metrics`);
      console.log(`Health: http://localhost:${PORT}/health`);
    });

  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  console.log('Shutting down gracefully...');
  await eventProducer.disconnect();
  await auditLogger.shutdown();
  await db.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();

export { app, db, eventProducer, auditLogger, transferPrescription, searchPrescriptionsByMedication, validateWithAIEngine };

/**
 * Dispense Service - FHIR MedicationDispense Management
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import pg from 'pg';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';

import { MedicationDispense, Reference } from '../../../shared/types/fhir.types.js';
import { 
  DispenseRecord, 
  DispenseStatus, 
  DispensedItem,
  CreateDispenseRequest,
  CreateDispenseResponse,
  NDPError, 
  ErrorCodes,
  AuthUser 
} from '../../../shared/types/ndp.types.js';
import { loadConfig, EgyptianConstants } from '../../../shared/config/index.js';
import { 
  createLogger, 
  generateUUID, 
  toFHIRDateTime,
  createFHIRReference,
  createFHIRIdentifier,
  createFHIRQuantity,
  createOperationOutcome,
  paginate
} from '../../../shared/utils/index.js';

const config = loadConfig('dispense-service');
const logger = createLogger('dispense-service', config.logLevel);

// ============================================================================
// Database
// ============================================================================

let pool: pg.Pool | null = null;

async function initDatabase(): Promise<pg.Pool> {
  pool = new pg.Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    min: config.database.poolMin,
    max: config.database.poolMax,
  });
  
  const client = await pool.connect();
  await client.query('SELECT NOW()');
  client.release();
  logger.info('Database connected');
  return pool;
}

function getPool(): pg.Pool {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

// ============================================================================
// FHIR MedicationDispense Builder
// ============================================================================

interface BuildDispenseParams {
  dispenseId: string;
  prescriptionId: string;
  prescriptionNumber: string;
  patientNationalId: string;
  patientName?: string;
  pharmacist: AuthUser;
  pharmacyId: string;
  pharmacyName?: string;
  dispenseNumber: number;
  dispensedItems: DispensedItem[];
  isPartial: boolean;
  notes?: string;
}

function buildMedicationDispense(params: BuildDispenseParams): MedicationDispense {
  const now = new Date();
  
  // Build subject (patient) reference
  const subject: Reference = {
    type: 'Patient',
    identifier: createFHIRIdentifier('http://mohp.gov.eg/national-id', params.patientNationalId, 'official'),
    display: params.patientName,
  };
  
  // Build authorizing prescription reference
  const authorizingPrescription: Reference[] = [{
    reference: `MedicationRequest/${params.prescriptionId}`,
    identifier: createFHIRIdentifier(EgyptianConstants.CODING_SYSTEMS.NDP_PRESCRIPTION, params.prescriptionNumber, 'official'),
  }];
  
  // Build performer (pharmacist)
  const performer = [{
    function: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/medicationdispense-performer-function',
        code: 'packager',
        display: 'Packager',
      }],
    },
    actor: createFHIRReference('Practitioner', params.pharmacist.license, params.pharmacist.name),
  }];
  
  // Build location (pharmacy)
  const location: Reference = {
    reference: `Location/${params.pharmacyId}`,
    display: params.pharmacyName,
  };
  
  // Calculate total quantity
  const totalQuantity = params.dispensedItems.reduce((sum, item) => sum + item.dispensedQuantity, 0);
  
  // Build medication coding from dispensed items
  const medicationCodeableConcept = {
    coding: params.dispensedItems.map(item => ({
      system: EgyptianConstants.CODING_SYSTEMS.EDA,
      code: item.medicationCode,
      display: item.medicationName,
    })),
    text: params.dispensedItems.length === 1 
      ? params.dispensedItems[0]!.medicationName 
      : `${params.dispensedItems.length} medications`,
  };
  
  const resource: MedicationDispense = {
    resourceType: 'MedicationDispense',
    id: params.dispenseId,
    meta: {
      profile: ['http://ndp.egypt.gov.eg/fhir/StructureDefinition/NDPMedicationDispense'],
      lastUpdated: toFHIRDateTime(now),
    },
    identifier: [
      createFHIRIdentifier(
        EgyptianConstants.CODING_SYSTEMS.NDP_DISPENSE,
        `${params.prescriptionNumber}-D${params.dispenseNumber}`,
        'official'
      ),
    ],
    status: 'completed',
    medicationCodeableConcept,
    subject,
    performer,
    location,
    authorizingPrescription,
    type: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: params.isPartial ? 'PF' : 'FF',
        display: params.isPartial ? 'Partial Fill' : 'First Fill',
      }],
    },
    quantity: createFHIRQuantity(totalQuantity, 'unit'),
    whenPrepared: toFHIRDateTime(now),
    whenHandedOver: toFHIRDateTime(now),
    note: params.notes ? [{ text: params.notes, time: toFHIRDateTime(now) }] : undefined,
  };
  
  return resource;
}

// ============================================================================
// Repository
// ============================================================================

class DispenseRepository {
  async create(data: {
    prescriptionId: string;
    prescriptionNumber: string;
    fhirResource: MedicationDispense;
    pharmacistLicense: string;
    pharmacistName?: string;
    pharmacyId: string;
    pharmacyName?: string;
    dispenseNumber: number;
    isPartial: boolean;
    dispensedItems: DispensedItem[];
  }): Promise<DispenseRecord> {
    const db = getPool();
    const id = generateUUID();
    
    const query = `
      INSERT INTO dispenses (
        id, prescription_id, prescription_number, fhir_resource, status,
        pharmacist_license, pharmacist_name, pharmacy_id, pharmacy_name,
        dispense_number, is_partial, dispensed_items, created_at
      ) VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *
    `;
    
    const result = await db.query(query, [
      id, data.prescriptionId, data.prescriptionNumber, JSON.stringify(data.fhirResource),
      data.pharmacistLicense, data.pharmacistName, data.pharmacyId, data.pharmacyName,
      data.dispenseNumber, data.isPartial, JSON.stringify(data.dispensedItems),
    ]);
    
    return this.mapRow(result.rows[0]);
  }
  
  async findById(id: string): Promise<DispenseRecord | null> {
    const result = await getPool().query('SELECT * FROM dispenses WHERE id = $1', [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }
  
  async findByPrescriptionId(prescriptionId: string): Promise<DispenseRecord[]> {
    const result = await getPool().query(
      'SELECT * FROM dispenses WHERE prescription_id = $1 ORDER BY dispense_number ASC',
      [prescriptionId]
    );
    return result.rows.map(row => this.mapRow(row));
  }
  
  async getDispenseCount(prescriptionId: string): Promise<number> {
    const result = await getPool().query(
      'SELECT COUNT(*) as count FROM dispenses WHERE prescription_id = $1 AND status = \'completed\'',
      [prescriptionId]
    );
    return parseInt(result.rows[0].count, 10);
  }
  
  async search(params: {
    prescriptionId?: string;
    pharmacistLicense?: string;
    pharmacyId?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ records: DispenseRecord[]; total: number }> {
    const db = getPool();
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    
    if (params.prescriptionId) { conditions.push(`prescription_id = $${idx++}`); values.push(params.prescriptionId); }
    if (params.pharmacistLicense) { conditions.push(`pharmacist_license = $${idx++}`); values.push(params.pharmacistLicense); }
    if (params.pharmacyId) { conditions.push(`pharmacy_id = $${idx++}`); values.push(params.pharmacyId); }
    if (params.fromDate) { conditions.push(`created_at >= $${idx++}`); values.push(params.fromDate); }
    if (params.toDate) { conditions.push(`created_at <= $${idx++}`); values.push(params.toDate); }
    
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit || 20;
    const offset = params.offset || 0;
    
    const countResult = await db.query(`SELECT COUNT(*) as total FROM dispenses ${where}`, values);
    const total = parseInt(countResult.rows[0].total, 10);
    
    values.push(limit, offset);
    const result = await db.query(
      `SELECT * FROM dispenses ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      values
    );
    
    return { records: result.rows.map(row => this.mapRow(row)), total };
  }
  
  private mapRow(row: Record<string, unknown>): DispenseRecord {
    return {
      id: row.id as string,
      prescriptionId: row.prescription_id as string,
      prescriptionNumber: row.prescription_number as string,
      fhirResource: row.fhir_resource as MedicationDispense,
      status: row.status as DispenseStatus,
      pharmacistLicense: row.pharmacist_license as string,
      pharmacistName: row.pharmacist_name as string | undefined,
      pharmacyId: row.pharmacy_id as string,
      pharmacyName: row.pharmacy_name as string | undefined,
      dispenseNumber: row.dispense_number as number,
      isPartial: row.is_partial as boolean,
      dispensedItems: row.dispensed_items as DispensedItem[],
      signature: row.signature as any,
      createdAt: new Date(row.created_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    };
  }
}

const dispenseRepo = new DispenseRepository();

// ============================================================================
// Service
// ============================================================================

// Prescription service client (would be HTTP in production)
async function verifyPrescriptionDispensable(prescriptionId: string): Promise<{
  canDispense: boolean;
  reason?: string;
  prescription?: any;
}> {
  // In production, call prescription service
  // For now, query directly
  const result = await getPool().query(
    `SELECT * FROM prescriptions WHERE id = $1`,
    [prescriptionId]
  );
  
  if (result.rows.length === 0) {
    return { canDispense: false, reason: 'Prescription not found' };
  }
  
  const rx = result.rows[0];
  
  if (rx.status !== 'active' && rx.status !== 'on-hold') {
    return { canDispense: false, reason: `Prescription status is ${rx.status}` };
  }
  
  if (rx.remaining_dispenses <= 0) {
    return { canDispense: false, reason: 'No dispenses remaining' };
  }
  
  if (rx.expires_at && new Date(rx.expires_at) < new Date()) {
    return { canDispense: false, reason: 'Prescription has expired' };
  }
  
  return { canDispense: true, prescription: rx };
}

async function updatePrescriptionAfterDispense(prescriptionId: string, isPartial: boolean): Promise<void> {
  const newStatus = isPartial ? 'on-hold' : null;
  
  await getPool().query(`
    UPDATE prescriptions 
    SET remaining_dispenses = remaining_dispenses - 1,
        status = CASE 
          WHEN remaining_dispenses - 1 = 0 THEN 'completed'
          WHEN $2 THEN 'on-hold'
          ELSE status
        END,
        updated_at = NOW()
    WHERE id = $1
  `, [prescriptionId, isPartial]);
}

class DispenseService {
  async createDispense(request: CreateDispenseRequest, pharmacist: AuthUser): Promise<CreateDispenseResponse> {
    // Find prescription
    let prescriptionId = request.prescriptionId;
    let prescriptionNumber = request.prescriptionNumber;
    
    if (!prescriptionId && prescriptionNumber) {
      const rxResult = await getPool().query('SELECT id FROM prescriptions WHERE prescription_number = $1', [prescriptionNumber]);
      if (rxResult.rows.length === 0) throw new NDPError(ErrorCodes.PRESCRIPTION_NOT_FOUND, 'Prescription not found', 404);
      prescriptionId = rxResult.rows[0].id;
    }
    
    if (!prescriptionId && request.patientNationalId) {
      // Find active prescription for patient
      const rxResult = await getPool().query(`
        SELECT id, prescription_number FROM prescriptions 
        WHERE patient_national_id = $1 AND status IN ('active', 'on-hold') AND remaining_dispenses > 0
        ORDER BY created_at DESC LIMIT 1
      `, [request.patientNationalId]);
      
      if (rxResult.rows.length === 0) {
        throw new NDPError(ErrorCodes.PRESCRIPTION_NOT_FOUND, 'No active prescription found for patient', 404);
      }
      prescriptionId = rxResult.rows[0].id;
      prescriptionNumber = rxResult.rows[0].prescription_number;
    }
    
    if (!prescriptionId) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Prescription ID, number, or patient ID is required', 400);
    }
    
    // Verify prescription can be dispensed
    const verification = await verifyPrescriptionDispensable(prescriptionId);
    if (!verification.canDispense) {
      throw new NDPError(ErrorCodes.PRESCRIPTION_NOT_ACTIVE, verification.reason || 'Cannot dispense', 400);
    }
    
    const prescription = verification.prescription;
    prescriptionNumber = prescription.prescription_number;
    
    // Get current dispense count
    const dispenseCount = await dispenseRepo.getDispenseCount(prescriptionId);
    const dispenseNumber = dispenseCount + 1;
    
    // Build dispensed items
    const dispensedItems: DispensedItem[] = request.dispensedItems.map(item => ({
      medicationCode: item.medicationCode,
      medicationName: item.medicationCode, // Would lookup from medication service
      prescribedQuantity: 0, // Would get from prescription
      dispensedQuantity: item.dispensedQuantity,
      remainingQuantity: 0,
      batchNumber: item.batchNumber,
      expiryDate: item.expiryDate,
      notes: item.notes,
    }));
    
    // Determine if partial dispense
    const isPartial = request.dispensedItems.some(item => item.dispensedQuantity < (item as any).prescribedQuantity);
    
    // Build FHIR resource
    const dispenseId = generateUUID();
    const fhirResource = buildMedicationDispense({
      dispenseId,
      prescriptionId,
      prescriptionNumber: prescriptionNumber!,
      patientNationalId: prescription.patient_national_id,
      patientName: prescription.patient_name,
      pharmacist,
      pharmacyId: request.pharmacyId,
      pharmacyName: request.pharmacyName,
      dispenseNumber,
      dispensedItems,
      isPartial,
      notes: request.notes,
    });
    
    // Create dispense record
    const record = await dispenseRepo.create({
      prescriptionId,
      prescriptionNumber: prescriptionNumber!,
      fhirResource,
      pharmacistLicense: pharmacist.license,
      pharmacistName: pharmacist.name,
      pharmacyId: request.pharmacyId,
      pharmacyName: request.pharmacyName,
      dispenseNumber,
      isPartial,
      dispensedItems,
    });
    
    // Update prescription
    await updatePrescriptionAfterDispense(prescriptionId, isPartial);
    
    // Get updated prescription status
    const updatedRx = await getPool().query('SELECT status, remaining_dispenses FROM prescriptions WHERE id = $1', [prescriptionId]);
    
    logger.info('Dispense created', { 
      dispenseId: record.id, 
      prescriptionId, 
      dispenseNumber,
      isPartial 
    });
    
    return {
      id: record.id,
      prescriptionId,
      prescriptionNumber: prescriptionNumber!,
      dispenseNumber,
      status: record.status,
      isPartial,
      fhirResource: record.fhirResource,
      prescriptionStatus: updatedRx.rows[0].status,
      remainingDispenses: updatedRx.rows[0].remaining_dispenses,
      createdAt: record.createdAt.toISOString(),
    };
  }
  
  async getDispense(id: string): Promise<DispenseRecord> {
    const record = await dispenseRepo.findById(id);
    if (!record) throw new NDPError(ErrorCodes.DISPENSE_NOT_FOUND, 'Dispense not found', 404);
    return record;
  }
  
  async getDispensesByPrescription(prescriptionId: string): Promise<DispenseRecord[]> {
    return dispenseRepo.findByPrescriptionId(prescriptionId);
  }
  
  async searchDispenses(params: any) {
    const { records, total } = await dispenseRepo.search(params);
    return paginate(records, total, params.limit || 20, params.offset || 0);
  }
}

const dispenseService = new DispenseService();

// ============================================================================
// Routes
// ============================================================================

const CreateDispenseSchema = z.object({
  prescriptionId: z.string().uuid().optional(),
  prescriptionNumber: z.string().optional(),
  patientNationalId: z.string().length(14).optional(),
  pharmacyId: z.string().min(1),
  pharmacyName: z.string().optional(),
  dispensedItems: z.array(z.object({
    medicationCode: z.string().min(1),
    dispensedQuantity: z.number().positive(),
    batchNumber: z.string().optional(),
    expiryDate: z.string().optional(),
    notes: z.string().optional(),
  })).min(1),
  notes: z.string().optional(),
});

const router = Router();

// Health check
router.get('/health', (req, res) => res.json({ status: 'healthy', service: 'dispense-service' }));

// Mock auth middleware
const mockAuth = (req: Request, res: Response, next: NextFunction) => {
  (req as any).user = {
    id: 'pharmacist-123',
    license: 'PH-12345',
    name: 'Dr. Pharmacist',
    role: 'pharmacist',
    facilityId: 'PHARM-001',
    facilityName: 'Central Pharmacy',
    scopes: ['dispense.create', 'dispense.view'],
    issuedAt: Date.now() / 1000,
    expiresAt: Date.now() / 1000 + 3600,
  };
  next();
};

// FHIR: Create dispense
router.post('/fhir/MedicationDispense', mockAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = CreateDispenseSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }
    
    const result = await dispenseService.createDispense(validation.data, (req as any).user);
    res.status(201).json(result);
  } catch (error) { next(error); }
});

// FHIR: Get dispense by ID
router.get('/fhir/MedicationDispense/:id', mockAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await dispenseService.getDispense(req.params.id!);
    res.json(record.fhirResource);
  } catch (error) { next(error); }
});

// FHIR: Search dispenses
router.get('/fhir/MedicationDispense', mockAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await dispenseService.searchDispenses({
      prescriptionId: req.query['prescription'] as string,
      pharmacyId: req.query['performer'] as string,
      limit: parseInt(req.query['_count'] as string) || 20,
      offset: parseInt(req.query['_offset'] as string) || 0,
    });
    
    res.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: result.pagination.total,
      entry: result.data.map(d => ({ resource: d.fhirResource })),
    });
  } catch (error) { next(error); }
});

// API: Get dispenses for prescription
router.get('/api/prescriptions/:prescriptionId/dispenses', mockAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const records = await dispenseService.getDispensesByPrescription(req.params.prescriptionId!);
    res.json(records);
  } catch (error) { next(error); }
});

// Error handler
function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Request error', error);
  
  if (error instanceof NDPError) {
    if (req.path.startsWith('/fhir')) {
      return res.status(error.statusCode).json(createOperationOutcome('error', error.code, error.message));
    }
    return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
  }
  
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  logger.info('Starting Dispense Service', { env: config.env, port: config.port });
  
  await initDatabase();
  
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());
  app.use('/fhir', (req, res, next) => { res.setHeader('Content-Type', 'application/fhir+json'); next(); });
  app.use('/', router);
  app.use(errorHandler);
  
  const server = app.listen(config.port, () => {
    logger.info(`Dispense Service listening on port ${config.port}`);
  });
  
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

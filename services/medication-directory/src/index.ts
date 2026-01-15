/**
 * Medication Directory Service - Combined Service Layer
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import pg from 'pg';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';

import { MedicationKnowledge, CodeableConcept } from '../../../shared/types/fhir.types.js';
import { MedicationRecord, NDPError, ErrorCodes } from '../../../shared/types/ndp.types.js';
import { loadConfig, EgyptianConstants } from '../../../shared/config/index.js';
import { 
  createLogger, 
  generateUUID, 
  toFHIRDateTime,
  createFHIRCodeableConcept,
  paginate,
  createOperationOutcome
} from '../../../shared/utils/index.js';

const config = loadConfig('medication-directory');
const logger = createLogger('medication-directory', config.logLevel);

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
// FHIR MedicationKnowledge Builder
// ============================================================================

interface EdaDrugEntry {
  edaCode: string;
  commercialName: string;
  genericName?: string;
  manufacturer?: string;
  doseForm?: string;
  strength?: string;
  packSize?: string;
  price?: number;
}

function buildMedicationKnowledge(entry: EdaDrugEntry): MedicationKnowledge {
  const code: CodeableConcept = {
    coding: [{
      system: EgyptianConstants.CODING_SYSTEMS.EDA,
      code: entry.edaCode,
      display: entry.commercialName,
    }],
    text: entry.commercialName,
  };
  
  return {
    resourceType: 'MedicationKnowledge',
    id: generateUUID(),
    meta: {
      profile: ['http://ndp.egypt.gov.eg/fhir/StructureDefinition/NDPMedicationKnowledge'],
      lastUpdated: toFHIRDateTime(new Date()),
    },
    code,
    status: 'active',
    manufacturer: entry.manufacturer ? {
      reference: `Organization/${encodeURIComponent(entry.manufacturer)}`,
      display: entry.manufacturer,
    } : undefined,
    doseForm: entry.doseForm ? { text: entry.doseForm } : undefined,
    synonym: entry.genericName ? [entry.genericName] : undefined,
    packaging: entry.packSize ? { type: { text: entry.packSize } } : undefined,
    cost: entry.price ? [{
      type: createFHIRCodeableConcept('http://terminology.hl7.org/CodeSystem/ex-claimtype', 'pharmacy', 'Pharmacy'),
      source: 'EDA Price List',
      cost: { value: entry.price, currency: 'EGP' },
    }] : undefined,
  };
}

// ============================================================================
// Repository
// ============================================================================

interface CreateMedicationData {
  edaCode: string;
  commercialName: string;
  genericName?: string;
  manufacturer?: string;
  doseForm?: string;
  strength?: string;
  packagingInfo?: string;
  fhirResource: MedicationKnowledge;
}

class MedicationRepository {
  async upsert(data: CreateMedicationData): Promise<MedicationRecord> {
    const db = getPool();
    const id = generateUUID();
    
    const query = `
      INSERT INTO medications (id, eda_code, fhir_resource, commercial_name, generic_name, manufacturer, dose_form, strength, packaging_info, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW(), NOW())
      ON CONFLICT (eda_code) DO UPDATE SET
        fhir_resource = EXCLUDED.fhir_resource, commercial_name = EXCLUDED.commercial_name, generic_name = EXCLUDED.generic_name,
        manufacturer = EXCLUDED.manufacturer, dose_form = EXCLUDED.dose_form, strength = EXCLUDED.strength,
        packaging_info = EXCLUDED.packaging_info, updated_at = NOW()
      RETURNING *
    `;
    
    const result = await db.query(query, [
      id, data.edaCode, JSON.stringify(data.fhirResource), data.commercialName,
      data.genericName || null, data.manufacturer || null, data.doseForm || null,
      data.strength || null, data.packagingInfo || null,
    ]);
    
    return this.mapRow(result.rows[0]);
  }
  
  async findByEdaCode(edaCode: string): Promise<MedicationRecord | null> {
    const result = await getPool().query('SELECT * FROM medications WHERE eda_code = $1', [edaCode]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }
  
  async findById(id: string): Promise<MedicationRecord | null> {
    const result = await getPool().query('SELECT * FROM medications WHERE id = $1', [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }
  
  async findByEdaCodes(edaCodes: string[]): Promise<MedicationRecord[]> {
    if (edaCodes.length === 0) return [];
    const result = await getPool().query('SELECT * FROM medications WHERE eda_code = ANY($1)', [edaCodes]);
    return result.rows.map(row => this.mapRow(row));
  }
  
  async search(params: { query?: string; edaCode?: string; status?: string; limit?: number; offset?: number }): Promise<{ records: MedicationRecord[]; total: number }> {
    const db = getPool();
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    
    if (params.edaCode) { conditions.push(`eda_code = $${idx++}`); values.push(params.edaCode); }
    if (params.status) { conditions.push(`status = $${idx++}`); values.push(params.status); }
    if (params.query) {
      conditions.push(`(commercial_name ILIKE $${idx} OR generic_name ILIKE $${idx} OR eda_code ILIKE $${idx})`);
      values.push(`%${params.query}%`);
      idx++;
    }
    
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit || 20;
    const offset = params.offset || 0;
    
    const countResult = await db.query(`SELECT COUNT(*) as total FROM medications ${where}`, values);
    const total = parseInt(countResult.rows[0].total, 10);
    
    values.push(limit, offset);
    const result = await db.query(`SELECT * FROM medications ${where} ORDER BY commercial_name LIMIT $${idx++} OFFSET $${idx}`, values);
    
    return { records: result.rows.map(row => this.mapRow(row)), total };
  }
  
  async recall(edaCode: string, reason: string, batchNumbers?: string[]): Promise<MedicationRecord | null> {
    const result = await getPool().query(`
      UPDATE medications SET status = 'recalled', recalled_at = NOW(), recall_reason = $2, recall_batch_numbers = $3, updated_at = NOW()
      WHERE eda_code = $1 RETURNING *
    `, [edaCode, reason, batchNumbers || null]);
    
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }
  
  async reactivate(edaCode: string): Promise<MedicationRecord | null> {
    const result = await getPool().query(`
      UPDATE medications SET status = 'active', recalled_at = NULL, recall_reason = NULL, recall_batch_numbers = NULL, updated_at = NOW()
      WHERE eda_code = $1 RETURNING *
    `, [edaCode]);
    
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }
  
  async getStats(): Promise<{ total: number; active: number; recalled: number; inactive: number }> {
    const result = await getPool().query(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'recalled') as recalled, COUNT(*) FILTER (WHERE status = 'inactive') as inactive
      FROM medications
    `);
    const row = result.rows[0];
    return { total: parseInt(row.total), active: parseInt(row.active), recalled: parseInt(row.recalled), inactive: parseInt(row.inactive) };
  }
  
  private mapRow(row: Record<string, unknown>): MedicationRecord {
    return {
      id: row.id as string,
      edaCode: row.eda_code as string,
      fhirResource: row.fhir_resource as MedicationKnowledge,
      commercialName: row.commercial_name as string,
      genericName: row.generic_name as string | undefined,
      manufacturer: row.manufacturer as string | undefined,
      doseForm: row.dose_form as string | undefined,
      strength: row.strength as string | undefined,
      packagingInfo: row.packaging_info as string | undefined,
      status: row.status as 'active' | 'inactive' | 'recalled',
      recalledAt: row.recalled_at ? new Date(row.recalled_at as string) : undefined,
      recallReason: row.recall_reason as string | undefined,
      recallBatchNumbers: row.recall_batch_numbers as string[] | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

const medicationRepo = new MedicationRepository();

// ============================================================================
// Service
// ============================================================================

class MedicationService {
  async getMedication(edaCode: string): Promise<MedicationRecord> {
    const med = await medicationRepo.findByEdaCode(edaCode);
    if (!med) throw new NDPError(ErrorCodes.MEDICATION_NOT_FOUND, 'Medication not found', 404);
    return med;
  }
  
  async getMedicationById(id: string): Promise<MedicationRecord> {
    const med = await medicationRepo.findById(id);
    if (!med) throw new NDPError(ErrorCodes.MEDICATION_NOT_FOUND, 'Medication not found', 404);
    return med;
  }
  
  async searchMedications(params: { query?: string; edaCode?: string; status?: string; limit?: number; offset?: number }) {
    const { records, total } = await medicationRepo.search(params);
    return paginate(records, total, params.limit || 20, params.offset || 0);
  }
  
  async validateMedications(edaCodes: string[]): Promise<{ valid: boolean; medications: MedicationRecord[]; errors: string[] }> {
    const medications = await medicationRepo.findByEdaCodes(edaCodes);
    const foundCodes = new Set(medications.map(m => m.edaCode));
    const errors: string[] = [];
    
    for (const code of edaCodes) {
      if (!foundCodes.has(code)) errors.push(`Medication ${code} not found`);
    }
    
    for (const med of medications) {
      if (med.status === 'recalled') errors.push(`Medication ${med.edaCode} (${med.commercialName}) has been recalled`);
      if (med.status === 'inactive') errors.push(`Medication ${med.edaCode} (${med.commercialName}) is inactive`);
    }
    
    return { valid: errors.length === 0, medications, errors };
  }
  
  async recallMedication(edaCode: string, reason: string, batchNumbers?: string[]): Promise<MedicationRecord> {
    const med = await medicationRepo.recall(edaCode, reason, batchNumbers);
    if (!med) throw new NDPError(ErrorCodes.MEDICATION_NOT_FOUND, 'Medication not found', 404);
    logger.info('Medication recalled', { edaCode, reason });
    return med;
  }
  
  async reactivateMedication(edaCode: string): Promise<MedicationRecord> {
    const med = await medicationRepo.reactivate(edaCode);
    if (!med) throw new NDPError(ErrorCodes.MEDICATION_NOT_FOUND, 'Medication not found', 404);
    logger.info('Medication reactivated', { edaCode });
    return med;
  }
  
  async getStats() {
    return medicationRepo.getStats();
  }
}

const medicationService = new MedicationService();

// ============================================================================
// Controller & Routes
// ============================================================================

const SearchSchema = z.object({
  code: z.string().optional(),
  name: z.string().optional(),
  status: z.enum(['active', 'inactive', 'recalled']).optional(),
  _count: z.coerce.number().min(1).max(100).optional(),
  _offset: z.coerce.number().min(0).optional(),
});

const RecallSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
  batchNumbers: z.array(z.string()).optional(),
});

const router = Router();

// Health checks
router.get('/health', (req, res) => res.json({ status: 'healthy', service: 'medication-directory', timestamp: new Date().toISOString() }));

// FHIR: Search medications
router.get('/fhir/MedicationKnowledge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = SearchSchema.parse(req.query);
    const result = await medicationService.searchMedications({
      query: params.name,
      edaCode: params.code,
      status: params.status,
      limit: params._count,
      offset: params._offset,
    });
    
    res.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: result.pagination.total,
      entry: result.data.map(med => ({
        fullUrl: `${req.protocol}://${req.get('host')}/fhir/MedicationKnowledge/${med.id}`,
        resource: med.fhirResource,
      })),
    });
  } catch (error) { next(error); }
});

// FHIR: Get medication by ID
router.get('/fhir/MedicationKnowledge/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const med = await medicationService.getMedicationById(req.params.id!);
    res.json(med.fhirResource);
  } catch (error) { next(error); }
});

// API: Get medication by EDA code
router.get('/api/medications/:edaCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const med = await medicationService.getMedication(req.params.edaCode!);
    res.json(med);
  } catch (error) { next(error); }
});

// API: Validate medications
router.post('/api/medications/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { edaCodes } = req.body;
    if (!Array.isArray(edaCodes) || edaCodes.length === 0) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'edaCodes array is required', 400);
    }
    const result = await medicationService.validateMedications(edaCodes);
    res.json(result);
  } catch (error) { next(error); }
});

// API: Recall medication (regulator only)
router.post('/api/medications/:edaCode/recall', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = RecallSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, validation.error.errors.map(e => e.message).join('; '), 400);
    }
    const med = await medicationService.recallMedication(req.params.edaCode!, validation.data.reason, validation.data.batchNumbers);
    res.json(med);
  } catch (error) { next(error); }
});

// API: Reactivate medication (regulator only)
router.post('/api/medications/:edaCode/reactivate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const med = await medicationService.reactivateMedication(req.params.edaCode!);
    res.json(med);
  } catch (error) { next(error); }
});

// API: Get statistics
router.get('/api/medications/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await medicationService.getStats();
    res.json(stats);
  } catch (error) { next(error); }
});

// ============================================================================
// Error Handler
// ============================================================================

function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Request error', error, { method: req.method, path: req.path });
  
  if (error instanceof NDPError) {
    if (req.path.startsWith('/fhir')) {
      return res.status(error.statusCode).json(createOperationOutcome('error', error.code, error.message));
    }
    return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
  }
  
  const message = config.env === 'production' ? 'Internal server error' : error.message;
  if (req.path.startsWith('/fhir')) {
    return res.status(500).json(createOperationOutcome('error', 'exception', message));
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  logger.info('Starting Medication Directory Service', { env: config.env, port: config.port });
  
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
    logger.info(`Medication Directory Service listening on port ${config.port}`);
  });
  
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      if (pool) await pool.end();
      process.exit(0);
    });
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

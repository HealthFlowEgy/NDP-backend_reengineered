/**
 * Medication Repository - Database operations for EDA Drug Directory
 */

import pg from 'pg';
import { MedicationKnowledge } from '../../../../shared/types/fhir.types.js';
import { MedicationRecord } from '../../../../shared/types/ndp.types.js';
import { createLogger, generateUUID } from '../../../../shared/utils/index.js';

const logger = createLogger('medication-directory:repository');

let pool: pg.Pool | null = null;

export function setPool(p: pg.Pool) {
  pool = p;
}

function getPool(): pg.Pool {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

export interface CreateMedicationData {
  edaCode: string;
  commercialName: string;
  genericName?: string;
  manufacturer?: string;
  doseForm?: string;
  strength?: string;
  packagingInfo?: string;
  fhirResource: MedicationKnowledge;
}

export interface SearchMedicationsParams {
  query?: string;
  edaCode?: string;
  name?: string;
  status?: 'active' | 'inactive' | 'recalled';
  limit?: number;
  offset?: number;
}

export class MedicationRepository {
  
  /**
   * Create or update a medication
   */
  async upsert(data: CreateMedicationData): Promise<MedicationRecord> {
    const db = getPool();
    const id = generateUUID();
    
    const query = `
      INSERT INTO medications (
        id, eda_code, fhir_resource, commercial_name, generic_name,
        manufacturer, dose_form, strength, packaging_info, status,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW(), NOW())
      ON CONFLICT (eda_code) DO UPDATE SET
        fhir_resource = EXCLUDED.fhir_resource,
        commercial_name = EXCLUDED.commercial_name,
        generic_name = EXCLUDED.generic_name,
        manufacturer = EXCLUDED.manufacturer,
        dose_form = EXCLUDED.dose_form,
        strength = EXCLUDED.strength,
        packaging_info = EXCLUDED.packaging_info,
        updated_at = NOW()
      RETURNING *
    `;
    
    const values = [
      id,
      data.edaCode,
      JSON.stringify(data.fhirResource),
      data.commercialName,
      data.genericName || null,
      data.manufacturer || null,
      data.doseForm || null,
      data.strength || null,
      data.packagingInfo || null,
    ];
    
    const result = await db.query(query, values);
    return this.mapRowToRecord(result.rows[0]);
  }
  
  /**
   * Bulk insert medications (for seeding)
   */
  async bulkUpsert(medications: CreateMedicationData[]): Promise<number> {
    const db = getPool();
    let inserted = 0;
    
    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < medications.length; i += batchSize) {
      const batch = medications.slice(i, i + batchSize);
      
      const values: unknown[] = [];
      const placeholders: string[] = [];
      
      batch.forEach((med, idx) => {
        const offset = idx * 9;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`);
        values.push(
          generateUUID(),
          med.edaCode,
          JSON.stringify(med.fhirResource),
          med.commercialName,
          med.genericName || null,
          med.manufacturer || null,
          med.doseForm || null,
          med.strength || null,
          med.packagingInfo || null
        );
      });
      
      const query = `
        INSERT INTO medications (
          id, eda_code, fhir_resource, commercial_name, generic_name,
          manufacturer, dose_form, strength, packaging_info
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (eda_code) DO UPDATE SET
          fhir_resource = EXCLUDED.fhir_resource,
          commercial_name = EXCLUDED.commercial_name,
          generic_name = EXCLUDED.generic_name,
          manufacturer = EXCLUDED.manufacturer,
          dose_form = EXCLUDED.dose_form,
          strength = EXCLUDED.strength,
          packaging_info = EXCLUDED.packaging_info,
          updated_at = NOW()
      `;
      
      await db.query(query, values);
      inserted += batch.length;
      
      if (i % 1000 === 0) {
        logger.info(`Inserted ${inserted}/${medications.length} medications`);
      }
    }
    
    return inserted;
  }
  
  /**
   * Find medication by EDA code
   */
  async findByEdaCode(edaCode: string): Promise<MedicationRecord | null> {
    const db = getPool();
    const query = 'SELECT * FROM medications WHERE eda_code = $1';
    const result = await db.query(query, [edaCode]);
    
    if (result.rows.length === 0) return null;
    return this.mapRowToRecord(result.rows[0]);
  }
  
  /**
   * Find medication by ID
   */
  async findById(id: string): Promise<MedicationRecord | null> {
    const db = getPool();
    const query = 'SELECT * FROM medications WHERE id = $1';
    const result = await db.query(query, [id]);
    
    if (result.rows.length === 0) return null;
    return this.mapRowToRecord(result.rows[0]);
  }
  
  /**
   * Find multiple medications by EDA codes
   */
  async findByEdaCodes(edaCodes: string[]): Promise<MedicationRecord[]> {
    if (edaCodes.length === 0) return [];
    
    const db = getPool();
    const query = 'SELECT * FROM medications WHERE eda_code = ANY($1)';
    const result = await db.query(query, [edaCodes]);
    
    return result.rows.map(row => this.mapRowToRecord(row));
  }
  
  /**
   * Search medications
   */
  async search(params: SearchMedicationsParams): Promise<{ records: MedicationRecord[]; total: number }> {
    const db = getPool();
    
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    
    if (params.edaCode) {
      conditions.push(`eda_code = $${paramIndex++}`);
      values.push(params.edaCode);
    }
    
    if (params.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }
    
    if (params.query || params.name) {
      const searchTerm = params.query || params.name;
      conditions.push(`(
        commercial_name ILIKE $${paramIndex} OR 
        generic_name ILIKE $${paramIndex} OR
        eda_code ILIKE $${paramIndex}
      )`);
      values.push(`%${searchTerm}%`);
      paramIndex++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit || 20;
    const offset = params.offset || 0;
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM medications ${whereClause}`;
    const countResult = await db.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total, 10);
    
    // Get records
    const query = `
      SELECT * FROM medications 
      ${whereClause}
      ORDER BY commercial_name ASC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
    values.push(limit, offset);
    
    const result = await db.query(query, values);
    
    return {
      records: result.rows.map(row => this.mapRowToRecord(row)),
      total,
    };
  }
  
  /**
   * Full-text search medications
   */
  async fullTextSearch(searchTerm: string, limit: number = 20): Promise<MedicationRecord[]> {
    const db = getPool();
    
    const query = `
      SELECT *, 
        ts_rank(to_tsvector('english', commercial_name || ' ' || COALESCE(generic_name, '')), 
                plainto_tsquery('english', $1)) as rank
      FROM medications
      WHERE to_tsvector('english', commercial_name || ' ' || COALESCE(generic_name, '')) 
            @@ plainto_tsquery('english', $1)
        AND status = 'active'
      ORDER BY rank DESC
      LIMIT $2
    `;
    
    const result = await db.query(query, [searchTerm, limit]);
    return result.rows.map(row => this.mapRowToRecord(row));
  }
  
  /**
   * Recall a medication
   */
  async recall(
    edaCode: string, 
    reason: string, 
    batchNumbers?: string[]
  ): Promise<MedicationRecord | null> {
    const db = getPool();
    
    const query = `
      UPDATE medications 
      SET status = 'recalled',
          recalled_at = NOW(),
          recall_reason = $2,
          recall_batch_numbers = $3,
          updated_at = NOW()
      WHERE eda_code = $1
      RETURNING *
    `;
    
    const result = await db.query(query, [edaCode, reason, batchNumbers || null]);
    
    if (result.rows.length === 0) return null;
    
    logger.info('Medication recalled', { edaCode, reason });
    return this.mapRowToRecord(result.rows[0]);
  }
  
  /**
   * Reactivate a recalled medication
   */
  async reactivate(edaCode: string): Promise<MedicationRecord | null> {
    const db = getPool();
    
    const query = `
      UPDATE medications 
      SET status = 'active',
          recalled_at = NULL,
          recall_reason = NULL,
          recall_batch_numbers = NULL,
          updated_at = NOW()
      WHERE eda_code = $1
      RETURNING *
    `;
    
    const result = await db.query(query, [edaCode]);
    
    if (result.rows.length === 0) return null;
    
    logger.info('Medication reactivated', { edaCode });
    return this.mapRowToRecord(result.rows[0]);
  }
  
  /**
   * Get medication statistics
   */
  async getStats(): Promise<{ total: number; active: number; recalled: number; inactive: number }> {
    const db = getPool();
    
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'recalled') as recalled,
        COUNT(*) FILTER (WHERE status = 'inactive') as inactive
      FROM medications
    `;
    
    const result = await db.query(query);
    const row = result.rows[0];
    
    return {
      total: parseInt(row.total, 10),
      active: parseInt(row.active, 10),
      recalled: parseInt(row.recalled, 10),
      inactive: parseInt(row.inactive, 10),
    };
  }
  
  /**
   * Map database row to MedicationRecord
   */
  private mapRowToRecord(row: Record<string, unknown>): MedicationRecord {
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

export const medicationRepository = new MedicationRepository();

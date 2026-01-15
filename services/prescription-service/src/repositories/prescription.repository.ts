/**
 * Prescription Repository - Database operations
 */

import { getPool, withTransaction } from '../db/client.js';
import { 
  PrescriptionRecord, 
  PrescriptionStatus,
  SignatureRecord,
  AIValidationResult
} from '../../../shared/types/ndp.types.js';
import { MedicationRequest } from '../../../shared/types/fhir.types.js';
import { 
  generateUUID, 
  generatePrescriptionNumber,
  createLogger 
} from '../../../shared/utils/index.js';

const logger = createLogger('prescription-service:repository');

export interface CreatePrescriptionData {
  patientNationalId: string;
  patientName?: string;
  prescriberLicense: string;
  prescriberName?: string;
  facilityId?: string;
  facilityName?: string;
  allowedDispenses: number;
  expiresAt?: Date;
  fhirResource: MedicationRequest;
  aiValidation?: AIValidationResult;
}

export interface UpdatePrescriptionData {
  status?: PrescriptionStatus;
  signature?: SignatureRecord;
  signedAt?: Date;
  remainingDispenses?: number;
  aiValidation?: AIValidationResult;
  fhirResource?: MedicationRequest;
}

export interface SearchPrescriptionsParams {
  patientNationalId?: string;
  prescriptionNumber?: string;
  prescriberLicense?: string;
  status?: PrescriptionStatus | PrescriptionStatus[];
  facilityId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export class PrescriptionRepository {
  
  /**
   * Create a new prescription
   */
  async create(data: CreatePrescriptionData): Promise<PrescriptionRecord> {
    const pool = getPool();
    const id = generateUUID();
    const prescriptionNumber = generatePrescriptionNumber();
    
    const query = `
      INSERT INTO prescriptions (
        id, prescription_number, fhir_resource, status,
        patient_national_id, patient_name, prescriber_license, prescriber_name,
        facility_id, facility_name, allowed_dispenses, remaining_dispenses,
        ai_validation, expires_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW()
      )
      RETURNING *
    `;
    
    const values = [
      id,
      prescriptionNumber,
      JSON.stringify(data.fhirResource),
      'draft',
      data.patientNationalId,
      data.patientName || null,
      data.prescriberLicense,
      data.prescriberName || null,
      data.facilityId || null,
      data.facilityName || null,
      data.allowedDispenses,
      data.allowedDispenses, // remaining = allowed initially
      data.aiValidation ? JSON.stringify(data.aiValidation) : null,
      data.expiresAt || null,
    ];
    
    try {
      const result = await pool.query(query, values);
      logger.info('Prescription created', { id, prescriptionNumber });
      return this.mapRowToRecord(result.rows[0]);
    } catch (error) {
      logger.error('Failed to create prescription', error, { patientNationalId: data.patientNationalId });
      throw error;
    }
  }
  
  /**
   * Get prescription by ID
   */
  async findById(id: string): Promise<PrescriptionRecord | null> {
    const pool = getPool();
    const query = 'SELECT * FROM prescriptions WHERE id = $1';
    
    try {
      const result = await pool.query(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToRecord(result.rows[0]);
    } catch (error) {
      logger.error('Failed to find prescription by ID', error, { id });
      throw error;
    }
  }
  
  /**
   * Get prescription by prescription number
   */
  async findByNumber(prescriptionNumber: string): Promise<PrescriptionRecord | null> {
    const pool = getPool();
    const query = 'SELECT * FROM prescriptions WHERE prescription_number = $1';
    
    try {
      const result = await pool.query(query, [prescriptionNumber]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToRecord(result.rows[0]);
    } catch (error) {
      logger.error('Failed to find prescription by number', error, { prescriptionNumber });
      throw error;
    }
  }
  
  /**
   * Update prescription
   */
  async update(id: string, data: UpdatePrescriptionData): Promise<PrescriptionRecord | null> {
    const pool = getPool();
    
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.signature !== undefined) {
      updates.push(`signature = $${paramIndex++}`);
      values.push(JSON.stringify(data.signature));
    }
    if (data.signedAt !== undefined) {
      updates.push(`signed_at = $${paramIndex++}`);
      values.push(data.signedAt);
    }
    if (data.remainingDispenses !== undefined) {
      updates.push(`remaining_dispenses = $${paramIndex++}`);
      values.push(data.remainingDispenses);
    }
    if (data.aiValidation !== undefined) {
      updates.push(`ai_validation = $${paramIndex++}`);
      values.push(JSON.stringify(data.aiValidation));
    }
    if (data.fhirResource !== undefined) {
      updates.push(`fhir_resource = $${paramIndex++}`);
      values.push(JSON.stringify(data.fhirResource));
    }
    
    if (updates.length === 0) {
      return this.findById(id);
    }
    
    updates.push('updated_at = NOW()');
    values.push(id);
    
    const query = `
      UPDATE prescriptions 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    
    try {
      const result = await pool.query(query, values);
      if (result.rows.length === 0) {
        return null;
      }
      logger.info('Prescription updated', { id, updates: Object.keys(data) });
      return this.mapRowToRecord(result.rows[0]);
    } catch (error) {
      logger.error('Failed to update prescription', error, { id });
      throw error;
    }
  }
  
  /**
   * Search prescriptions
   */
  async search(params: SearchPrescriptionsParams): Promise<{ records: PrescriptionRecord[]; total: number }> {
    const pool = getPool();
    
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    
    if (params.patientNationalId) {
      conditions.push(`patient_national_id = $${paramIndex++}`);
      values.push(params.patientNationalId);
    }
    if (params.prescriptionNumber) {
      conditions.push(`prescription_number = $${paramIndex++}`);
      values.push(params.prescriptionNumber);
    }
    if (params.prescriberLicense) {
      conditions.push(`prescriber_license = $${paramIndex++}`);
      values.push(params.prescriberLicense);
    }
    if (params.facilityId) {
      conditions.push(`facility_id = $${paramIndex++}`);
      values.push(params.facilityId);
    }
    if (params.status) {
      if (Array.isArray(params.status)) {
        conditions.push(`status = ANY($${paramIndex++})`);
        values.push(params.status);
      } else {
        conditions.push(`status = $${paramIndex++}`);
        values.push(params.status);
      }
    }
    if (params.fromDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(params.fromDate);
    }
    if (params.toDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(params.toDate);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit || 20;
    const offset = params.offset || 0;
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM prescriptions ${whereClause}`;
    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total, 10);
    
    // Get records
    const query = `
      SELECT * FROM prescriptions 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
    values.push(limit, offset);
    
    try {
      const result = await pool.query(query, values);
      return {
        records: result.rows.map((row) => this.mapRowToRecord(row)),
        total,
      };
    } catch (error) {
      logger.error('Failed to search prescriptions', error, { params });
      throw error;
    }
  }
  
  /**
   * Get active prescriptions for a patient
   */
  async findActiveByPatient(patientNationalId: string): Promise<PrescriptionRecord[]> {
    const pool = getPool();
    const query = `
      SELECT * FROM prescriptions 
      WHERE patient_national_id = $1 
        AND status IN ('active', 'on-hold')
        AND remaining_dispenses > 0
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
    `;
    
    try {
      const result = await pool.query(query, [patientNationalId]);
      return result.rows.map((row) => this.mapRowToRecord(row));
    } catch (error) {
      logger.error('Failed to find active prescriptions', error, { patientNationalId });
      throw error;
    }
  }
  
  /**
   * Decrement remaining dispenses (used after successful dispense)
   */
  async decrementDispenses(id: string, updateStatus?: PrescriptionStatus): Promise<PrescriptionRecord | null> {
    return withTransaction(async (client) => {
      // Lock the row for update
      const selectQuery = 'SELECT * FROM prescriptions WHERE id = $1 FOR UPDATE';
      const selectResult = await client.query(selectQuery, [id]);
      
      if (selectResult.rows.length === 0) {
        return null;
      }
      
      const current = selectResult.rows[0];
      const newRemaining = current.remaining_dispenses - 1;
      
      // Determine new status
      let newStatus = updateStatus;
      if (!newStatus) {
        if (newRemaining === 0) {
          newStatus = 'completed';
        } else if (current.status === 'active') {
          newStatus = 'on-hold'; // Partial dispense
        }
      }
      
      const updateQuery = `
        UPDATE prescriptions 
        SET remaining_dispenses = $1, status = COALESCE($2, status), updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;
      
      const updateResult = await client.query(updateQuery, [newRemaining, newStatus, id]);
      return this.mapRowToRecord(updateResult.rows[0]);
    });
  }
  
  /**
   * Map database row to PrescriptionRecord
   */
  private mapRowToRecord(row: Record<string, unknown>): PrescriptionRecord {
    return {
      id: row.id as string,
      prescriptionNumber: row.prescription_number as string,
      fhirResource: row.fhir_resource as MedicationRequest,
      status: row.status as PrescriptionStatus,
      patientNationalId: row.patient_national_id as string,
      patientName: row.patient_name as string | undefined,
      prescriberLicense: row.prescriber_license as string,
      prescriberName: row.prescriber_name as string | undefined,
      facilityId: row.facility_id as string | undefined,
      facilityName: row.facility_name as string | undefined,
      allowedDispenses: row.allowed_dispenses as number,
      remainingDispenses: row.remaining_dispenses as number,
      signature: row.signature as SignatureRecord | undefined,
      aiValidation: row.ai_validation as AIValidationResult | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      signedAt: row.signed_at ? new Date(row.signed_at as string) : undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    };
  }
}

export const prescriptionRepository = new PrescriptionRepository();

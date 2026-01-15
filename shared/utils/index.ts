/**
 * Shared Utilities - NDP Backend
 */

import crypto from 'crypto';
import { EgyptianConstants } from '../config/index.js';
import { NDPError, ErrorCodes } from '../types/ndp.types.js';

// ============================================================================
// Re-export Event Streaming and Audit utilities
// These modules require KAFKA_BROKERS and ELASTICSEARCH_URL env vars
// ============================================================================

// Re-export all modules (uncomment when dependencies are installed)
export * from '../kafka/index.js';
export * from '../elasticsearch/index.js';
export * from '../database/index.js';
export * from '../metrics/index.js';

// Legacy exports (can be removed after migration)
// export * from './kafka.js';
// export * from './elasticsearch.js';
// export * from './audit-mediator.js';
// export * from './kafka-workers.js';

// ============================================================================
// Logger
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private serviceName: string;
  private minLevel: LogLevel;

  constructor(serviceName: string, minLevel: LogLevel = 'info') {
    this.serviceName = serviceName;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      service: this.serviceName,
      message,
      ...meta,
    };
    return JSON.stringify(logEntry);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      const errorMeta = error instanceof Error ? {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
      } : { error };
      console.error(this.formatMessage('error', message, { ...errorMeta, ...meta }));
    }
  }
}

export function createLogger(serviceName: string, minLevel: LogLevel = 'info'): Logger {
  return new Logger(serviceName, minLevel);
}

// ============================================================================
// Validation Utilities
// ============================================================================

export function validateNationalId(nationalId: string): boolean {
  if (!nationalId || typeof nationalId !== 'string') {
    return false;
  }
  return EgyptianConstants.NATIONAL_ID_REGEX.test(nationalId);
}

export function validateEdaCode(edaCode: string): boolean {
  if (!edaCode || typeof edaCode !== 'string') {
    return false;
  }
  return EgyptianConstants.EDA_CODE_REGEX.test(edaCode);
}

export function validatePrescriptionNumber(prescriptionNumber: string): boolean {
  if (!prescriptionNumber || typeof prescriptionNumber !== 'string') {
    return false;
  }
  // Format: RX-YYYY-XXXXXXXX
  const regex = /^RX-\d{4}-\d{8}$/;
  return regex.test(prescriptionNumber);
}

export function assertValidNationalId(nationalId: string): void {
  if (!validateNationalId(nationalId)) {
    throw new NDPError(
      ErrorCodes.INVALID_PATIENT_ID,
      'Invalid Egyptian National ID. Must be 14 digits.',
      400
    );
  }
}

export function assertValidEdaCode(edaCode: string): void {
  if (!validateEdaCode(edaCode)) {
    throw new NDPError(
      ErrorCodes.INVALID_MEDICATION,
      'Invalid EDA medication code.',
      400
    );
  }
}

// ============================================================================
// ID Generation
// ============================================================================

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function generatePrescriptionNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `${EgyptianConstants.PRESCRIPTION_NUMBER_PREFIX}-${year}-${random}`;
}

export function generateDispenseNumber(existingDispenses: number): number {
  return existingDispenses + 1;
}

// ============================================================================
// Date Utilities
// ============================================================================

export function toFHIRInstant(date: Date = new Date()): string {
  return date.toISOString();
}

export function toFHIRDateTime(date: Date = new Date()): string {
  return date.toISOString().split('.')[0] + 'Z';
}

export function toFHIRDate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]!;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function isExpired(expiryDate: Date | string): boolean {
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  return expiry < new Date();
}

// ============================================================================
// Hash Utilities
// ============================================================================

export function hashDocument(document: object): string {
  const canonical = JSON.stringify(document, Object.keys(document).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function hashString(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// ============================================================================
// Response Helpers
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export function paginate<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number
): PaginatedResponse<T> {
  return {
    data: items,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    },
  };
}

// ============================================================================
// FHIR Helpers
// ============================================================================

export function createFHIRReference(resourceType: string, id: string, display?: string): {
  reference: string;
  type: string;
  display?: string;
} {
  return {
    reference: `${resourceType}/${id}`,
    type: resourceType,
    ...(display && { display }),
  };
}

export function createFHIRCoding(
  system: string,
  code: string,
  display?: string
): { system: string; code: string; display?: string } {
  return {
    system,
    code,
    ...(display && { display }),
  };
}

export function createFHIRCodeableConcept(
  system: string,
  code: string,
  display?: string,
  text?: string
): { coding: Array<{ system: string; code: string; display?: string }>; text?: string } {
  return {
    coding: [createFHIRCoding(system, code, display)],
    ...(text && { text }),
  };
}

export function createFHIRIdentifier(
  system: string,
  value: string,
  use: 'usual' | 'official' | 'temp' | 'secondary' | 'old' = 'official'
): { use: string; system: string; value: string } {
  return { use, system, value };
}

export function createFHIRQuantity(
  value: number,
  unit: string,
  system: string = EgyptianConstants.CODING_SYSTEMS.UCUM,
  code?: string
): { value: number; unit: string; system: string; code?: string } {
  return {
    value,
    unit,
    system,
    ...(code && { code }),
  };
}

// ============================================================================
// Error Handling
// ============================================================================

export function createOperationOutcome(
  severity: 'fatal' | 'error' | 'warning' | 'information',
  code: string,
  diagnostics: string,
  details?: { coding: Array<{ system: string; code: string; display?: string }> }
): {
  resourceType: 'OperationOutcome';
  issue: Array<{
    severity: string;
    code: string;
    diagnostics: string;
    details?: { coding: Array<{ system: string; code: string; display?: string }> };
  }>;
} {
  return {
    resourceType: 'OperationOutcome',
    issue: [
      {
        severity,
        code,
        diagnostics,
        ...(details && { details }),
      },
    ],
  };
}

// ============================================================================
// Masking Utilities (for PHI protection in logs)
// ============================================================================

export function maskNationalId(nationalId: string): string {
  if (!nationalId || nationalId.length < 4) return '****';
  return nationalId.substring(0, 3) + '********' + nationalId.substring(11);
}

export function maskName(name: string): string {
  if (!name || name.length < 2) return '***';
  return name.charAt(0) + '***' + name.charAt(name.length - 1);
}

export function sanitizeForLogging<T extends Record<string, unknown>>(obj: T): T {
  const sensitiveFields = ['nationalId', 'patientNationalId', 'patientName', 'name', 'phone', 'email', 'address'];
  const sanitized = { ...obj };
  
  for (const field of sensitiveFields) {
    if (field in sanitized && typeof sanitized[field] === 'string') {
      if (field.includes('nationalId') || field.includes('NationalId')) {
        sanitized[field] = maskNationalId(sanitized[field] as string) as T[typeof field];
      } else if (field.includes('name') || field.includes('Name')) {
        sanitized[field] = maskName(sanitized[field] as string) as T[typeof field];
      } else {
        sanitized[field] = '***' as T[typeof field];
      }
    }
  }
  
  return sanitized;
}

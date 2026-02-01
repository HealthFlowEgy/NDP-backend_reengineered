/**
 * AI Validation Service Client
 * Communicates with the AI validation service for prescription validation
 */

import { createLogger } from '../../../../shared/utils/index.js';
import { 
  NDPError, 
  ErrorCodes,
  AIValidationResult,
  AIValidationWarning,
  AIValidationError,
  DrugInteraction,
  DosingAlert,
  CreatePrescriptionRequest,
  PrescriptionMedication
} from '../../../../shared/types/ndp.types.js';

const logger = createLogger('prescription-service:ai-client');

const AI_VALIDATION_URL = process.env['AI_VALIDATION_URL'] || 'http://localhost:3006';
const AI_VALIDATION_TIMEOUT = parseInt(process.env['AI_VALIDATION_TIMEOUT'] || '10000');
const AI_VALIDATION_ENABLED = process.env['AI_VALIDATION_ENABLED'] !== 'false';
const AI_VALIDATION_SKIP_ON_ERROR = process.env['AI_VALIDATION_SKIP_ON_ERROR'] !== 'false';

export interface PatientContext {
  nationalId: string;
  age?: number;
  weight?: number;
  gender?: 'male' | 'female';
  conditions?: string[];
  allergies?: string[];
  renalFunction?: 'normal' | 'mild' | 'moderate' | 'severe';
  hepaticFunction?: 'normal' | 'mild' | 'moderate' | 'severe';
  currentMedications?: Array<{
    edaCode: string;
    name: string;
    genericName?: string;
  }>;
}

export interface ValidationRequest {
  prescriptionId?: string;
  patient: PatientContext;
  medications: PrescriptionMedication[];
}

export class AIValidationClient {
  private baseUrl: string;
  private timeout: number;
  private enabled: boolean;
  private skipOnError: boolean;

  constructor(
    baseUrl: string = AI_VALIDATION_URL,
    timeout: number = AI_VALIDATION_TIMEOUT,
    enabled: boolean = AI_VALIDATION_ENABLED,
    skipOnError: boolean = AI_VALIDATION_SKIP_ON_ERROR
  ) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
    this.enabled = enabled;
    this.skipOnError = skipOnError;
  }

  /**
   * Validate a prescription before creation/signing
   */
  async validatePrescription(request: ValidationRequest): Promise<AIValidationResult> {
    if (!this.enabled) {
      logger.debug('AI validation disabled, skipping');
      return this.createSkippedResult('AI validation disabled');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const validationRequest = {
        prescriptionId: request.prescriptionId,
        patientNationalId: request.patient.nationalId,
        patientAge: request.patient.age,
        patientWeight: request.patient.weight,
        patientGender: request.patient.gender,
        patientConditions: request.patient.conditions,
        patientAllergies: request.patient.allergies,
        renalFunction: request.patient.renalFunction,
        hepaticFunction: request.patient.hepaticFunction,
        medications: request.medications.map(med => ({
          edaCode: med.edaCode,
          name: med.medicationName || med.edaCode,
          genericName: undefined,
          dose: med.quantity,
          doseUnit: med.unit,
          frequency: med.frequency || 'once daily',
          duration: med.duration,
          route: med.route,
        })),
        currentMedications: request.patient.currentMedications,
      };

      logger.info('Calling AI validation service', {
        prescriptionId: request.prescriptionId,
        medicationCount: request.medications.length,
      });

      const response = await fetch(`${this.baseUrl}/api/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validationRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const result = await response.json();

      logger.info('AI validation complete', {
        prescriptionId: request.prescriptionId,
        passed: result.passed,
        score: result.overallScore,
        interactionCount: result.drugInteractions?.length || 0,
      });

      return this.mapToAIValidationResult(result);
    } catch (error) {
      logger.error('AI validation failed', error);

      if (this.skipOnError) {
        logger.warn('AI validation error, skipping validation');
        return this.createSkippedResult('AI validation service unavailable');
      }

      throw new NDPError(
        ErrorCodes.AI_SERVICE_UNAVAILABLE,
        'AI validation service unavailable',
        503
      );
    }
  }

  /**
   * Quick check for drug interactions only
   */
  async checkInteractions(medications: Array<{ edaCode: string; name: string; genericName?: string }>): Promise<{
    hasInteractions: boolean;
    interactions: DrugInteraction[];
  }> {
    if (!this.enabled || medications.length < 2) {
      return { hasInteractions: false, interactions: [] };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/interactions/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medications }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Interaction check failed', error);
      return { hasInteractions: false, interactions: [] };
    }
  }

  /**
   * Map external response to AIValidationResult
   */
  private mapToAIValidationResult(response: any): AIValidationResult {
    return {
      validated: response.validated || true,
      validatedAt: response.validatedAt || new Date().toISOString(),
      overallScore: response.overallScore || 100,
      passed: response.passed ?? true,
      warnings: (response.warnings || []).map((w: any) => ({
        code: w.code || 'UNKNOWN',
        message: w.message,
        severity: w.severity || 'medium',
        medicationCodes: w.medicationCodes,
      })),
      errors: (response.errors || []).map((e: any) => ({
        code: e.code || 'UNKNOWN',
        message: e.message,
        medicationCodes: e.medicationCodes,
      })),
      drugInteractions: (response.drugInteractions || []).map((i: any) => ({
        drug1Code: i.drug1Code,
        drug1Name: i.drug1Name,
        drug2Code: i.drug2Code,
        drug2Name: i.drug2Name,
        severity: i.severity,
        description: i.description,
        recommendation: i.recommendation,
      })),
      dosingAlerts: (response.dosingAlerts || []).map((a: any) => ({
        medicationCode: a.medicationCode,
        medicationName: a.medicationName,
        alertType: a.alertType,
        message: a.message,
        recommendedDose: a.recommendedDose,
      })),
    };
  }

  /**
   * Create a skipped validation result
   */
  private createSkippedResult(reason: string): AIValidationResult {
    return {
      validated: false,
      validatedAt: new Date().toISOString(),
      overallScore: 0,
      passed: true, // Allow to proceed when skipped
      warnings: [{
        code: 'VALIDATION_SKIPPED',
        message: reason,
        severity: 'low',
      }],
      errors: [],
      drugInteractions: [],
      dosingAlerts: [],
    };
  }

  /**
   * Check if validation is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const aiValidationClient = new AIValidationClient();

/**
 * Validate prescription medications before creation
 * Throws if validation fails and skipOnError is false
 */
export async function validatePrescriptionMedications(
  prescriptionId: string | undefined,
  request: CreatePrescriptionRequest,
  patientContext?: Partial<PatientContext>
): Promise<AIValidationResult> {
  const patient: PatientContext = {
    nationalId: request.patientNationalId,
    ...patientContext,
  };

  return aiValidationClient.validatePrescription({
    prescriptionId,
    patient,
    medications: request.medications,
  });
}

/**
 * Check if validation result should block prescription
 */
export function shouldBlockPrescription(result: AIValidationResult): {
  block: boolean;
  reason?: string;
} {
  // Block if not passed and there are errors
  if (!result.passed && result.errors.length > 0) {
    return {
      block: true,
      reason: result.errors.map(e => e.message).join('; '),
    };
  }

  // Block if there are contraindicated interactions
  const contraindicated = result.drugInteractions.filter(i => i.severity === 'contraindicated');
  if (contraindicated.length > 0) {
    return {
      block: true,
      reason: `Contraindicated drug interaction: ${contraindicated[0]!.description}`,
    };
  }

  // Block if score is too low
  if (result.overallScore < 30) {
    return {
      block: true,
      reason: `Validation score too low (${result.overallScore}/100)`,
    };
  }

  return { block: false };
}

/**
 * Format validation result for display
 */
export function formatValidationSummary(result: AIValidationResult): string {
  const parts: string[] = [];

  if (result.drugInteractions.length > 0) {
    const severe = result.drugInteractions.filter(
      i => i.severity === 'major' || i.severity === 'contraindicated'
    ).length;
    parts.push(`${result.drugInteractions.length} drug interaction(s) (${severe} severe)`);
  }

  if (result.dosingAlerts.length > 0) {
    parts.push(`${result.dosingAlerts.length} dosing alert(s)`);
  }

  if (result.warnings.length > 0) {
    parts.push(`${result.warnings.length} warning(s)`);
  }

  if (parts.length === 0) {
    return 'No issues detected';
  }

  return parts.join(', ');
}

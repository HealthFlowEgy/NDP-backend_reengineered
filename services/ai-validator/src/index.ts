/**
 * AI Validation Service
 * Drug-drug interactions, dosage validation, contraindication alerts
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';

import { loadConfig } from '../../../shared/config/index.js';
import { 
  createLogger, 
  generateUUID, 
  toFHIRDateTime 
} from '../../../shared/utils/index.js';
import { 
  NDPError, 
  ErrorCodes,
  AIValidationResult,
  AIValidationWarning,
  AIValidationError,
  DrugInteraction,
  DosingAlert
} from '../../../shared/types/ndp.types.js';

const config = loadConfig('ai-validation-service');
const logger = createLogger('ai-validation-service', config.logLevel);

// External AI Engine URL (your existing AI validation engine)
const AI_ENGINE_URL = process.env['AI_ENGINE_URL'] || 'http://67.207.74.0';
const AI_ENGINE_TIMEOUT = parseInt(process.env['AI_ENGINE_TIMEOUT'] || '10000');

// ============================================================================
// Types
// ============================================================================

interface PrescriptionValidationRequest {
  prescriptionId?: string;
  patientNationalId: string;
  patientAge?: number;
  patientWeight?: number;
  patientGender?: 'male' | 'female';
  patientConditions?: string[];
  patientAllergies?: string[];
  renalFunction?: 'normal' | 'mild' | 'moderate' | 'severe';
  hepaticFunction?: 'normal' | 'mild' | 'moderate' | 'severe';
  medications: MedicationToValidate[];
  currentMedications?: CurrentMedication[];
}

interface MedicationToValidate {
  edaCode: string;
  name: string;
  genericName?: string;
  dose: number;
  doseUnit: string;
  frequency: string;
  duration?: string;
  route?: string;
}

interface CurrentMedication {
  edaCode: string;
  name: string;
  genericName?: string;
  startDate?: string;
}

interface ValidationResponse {
  validationId: string;
  validated: boolean;
  validatedAt: string;
  overallScore: number;
  passed: boolean;
  summary: string;
  drugInteractions: DrugInteraction[];
  dosingAlerts: DosingAlert[];
  contraindicationAlerts: ContraindicationAlert[];
  allergyAlerts: AllergyAlert[];
  duplicateTherapyAlerts: DuplicateTherapyAlert[];
  warnings: AIValidationWarning[];
  errors: AIValidationError[];
  recommendations: string[];
}

interface ContraindicationAlert {
  medicationCode: string;
  medicationName: string;
  condition: string;
  severity: 'relative' | 'absolute';
  description: string;
  recommendation: string;
}

interface AllergyAlert {
  medicationCode: string;
  medicationName: string;
  allergen: string;
  crossReactivity?: boolean;
  severity: 'mild' | 'moderate' | 'severe' | 'life-threatening';
  description: string;
}

interface DuplicateTherapyAlert {
  medications: { code: string; name: string }[];
  therapeuticClass: string;
  description: string;
  recommendation: string;
}

// ============================================================================
// Drug Interaction Database (In production, this would be a proper database)
// ============================================================================

interface InteractionRule {
  drug1Pattern: RegExp | string;
  drug2Pattern: RegExp | string;
  severity: 'minor' | 'moderate' | 'major' | 'contraindicated';
  description: string;
  mechanism?: string;
  recommendation: string;
}

const INTERACTION_RULES: InteractionRule[] = [
  // Anticoagulants + NSAIDs
  {
    drug1Pattern: /warfarin|coumadin|heparin|enoxaparin|rivaroxaban|apixaban/i,
    drug2Pattern: /ibuprofen|aspirin|diclofenac|naproxen|ketoprofen|piroxicam/i,
    severity: 'major',
    description: 'Increased risk of bleeding when anticoagulants are combined with NSAIDs',
    mechanism: 'NSAIDs inhibit platelet function and may cause GI bleeding',
    recommendation: 'Avoid combination if possible. If necessary, use lowest effective NSAID dose and monitor for bleeding.',
  },
  // ACE Inhibitors + Potassium-sparing diuretics
  {
    drug1Pattern: /captopril|enalapril|lisinopril|ramipril|perindopril/i,
    drug2Pattern: /spironolactone|eplerenone|amiloride|triamterene/i,
    severity: 'major',
    description: 'Risk of hyperkalemia when ACE inhibitors are combined with potassium-sparing diuretics',
    mechanism: 'Both drugs can increase serum potassium levels',
    recommendation: 'Monitor serum potassium levels closely. Consider using alternative diuretic.',
  },
  // Metformin + Contrast media
  {
    drug1Pattern: /metformin|glucophage/i,
    drug2Pattern: /contrast|iodine|iohexol|iopamidol/i,
    severity: 'major',
    description: 'Risk of lactic acidosis when metformin is used with iodinated contrast media',
    mechanism: 'Contrast media can cause acute kidney injury, leading to metformin accumulation',
    recommendation: 'Hold metformin 48 hours before and after contrast administration.',
  },
  // SSRIs + MAOIs
  {
    drug1Pattern: /fluoxetine|sertraline|paroxetine|citalopram|escitalopram|fluvoxamine/i,
    drug2Pattern: /phenelzine|tranylcypromine|isocarboxazid|selegiline|rasagiline/i,
    severity: 'contraindicated',
    description: 'Serotonin syndrome risk - potentially fatal combination',
    mechanism: 'Excessive serotonergic activity',
    recommendation: 'CONTRAINDICATED. Allow 2-5 week washout period between drugs.',
  },
  // Quinolones + Antacids
  {
    drug1Pattern: /ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin/i,
    drug2Pattern: /aluminum|magnesium|calcium carbonate|antacid/i,
    severity: 'moderate',
    description: 'Reduced absorption of quinolone antibiotics',
    mechanism: 'Metal cations chelate with quinolones reducing bioavailability',
    recommendation: 'Separate administration by at least 2 hours.',
  },
  // Statins + Fibrates
  {
    drug1Pattern: /atorvastatin|simvastatin|rosuvastatin|pravastatin|lovastatin/i,
    drug2Pattern: /gemfibrozil|fenofibrate|bezafibrate/i,
    severity: 'major',
    description: 'Increased risk of myopathy and rhabdomyolysis',
    mechanism: 'Fibrates inhibit statin metabolism and increase muscle toxicity',
    recommendation: 'Use fenofibrate preferentially. Monitor for muscle symptoms.',
  },
  // Digoxin + Amiodarone
  {
    drug1Pattern: /digoxin|digitalis/i,
    drug2Pattern: /amiodarone|cordarone/i,
    severity: 'major',
    description: 'Amiodarone increases digoxin levels significantly',
    mechanism: 'Inhibition of P-glycoprotein and CYP3A4',
    recommendation: 'Reduce digoxin dose by 50% and monitor levels.',
  },
  // Lithium + NSAIDs
  {
    drug1Pattern: /lithium/i,
    drug2Pattern: /ibuprofen|naproxen|diclofenac|indomethacin|piroxicam/i,
    severity: 'major',
    description: 'NSAIDs can increase lithium levels to toxic range',
    mechanism: 'Reduced renal clearance of lithium',
    recommendation: 'Monitor lithium levels closely. Consider using aspirin or sulindac instead.',
  },
  // Theophylline + Ciprofloxacin
  {
    drug1Pattern: /theophylline|aminophylline/i,
    drug2Pattern: /ciprofloxacin|enoxacin/i,
    severity: 'major',
    description: 'Ciprofloxacin significantly increases theophylline levels',
    mechanism: 'Inhibition of CYP1A2',
    recommendation: 'Reduce theophylline dose by 30-50% and monitor levels.',
  },
  // Methotrexate + NSAIDs
  {
    drug1Pattern: /methotrexate/i,
    drug2Pattern: /ibuprofen|naproxen|diclofenac|ketoprofen/i,
    severity: 'major',
    description: 'Increased methotrexate toxicity',
    mechanism: 'Reduced renal clearance of methotrexate',
    recommendation: 'Avoid high-dose NSAIDs. Monitor for methotrexate toxicity.',
  },
];

// ============================================================================
// Dosing Rules Database
// ============================================================================

interface DosingRule {
  drugPattern: RegExp | string;
  maxDailyDose: number;
  maxDailyDoseUnit: string;
  maxSingleDose?: number;
  renalAdjustment?: {
    mild?: number;      // Dose multiplier
    moderate?: number;
    severe?: number;
  };
  hepaticAdjustment?: {
    mild?: number;
    moderate?: number;
    severe?: number;
  };
  ageAdjustment?: {
    pediatric?: { maxAge: number; doseMultiplier: number };
    geriatric?: { minAge: number; doseMultiplier: number };
  };
  warnings?: string[];
}

const DOSING_RULES: DosingRule[] = [
  {
    drugPattern: /paracetamol|acetaminophen/i,
    maxDailyDose: 4000,
    maxDailyDoseUnit: 'mg',
    maxSingleDose: 1000,
    hepaticAdjustment: { mild: 0.75, moderate: 0.5, severe: 0.25 },
    warnings: ['Hepatotoxicity risk at high doses', 'Avoid in chronic alcohol use'],
  },
  {
    drugPattern: /ibuprofen/i,
    maxDailyDose: 2400,
    maxDailyDoseUnit: 'mg',
    maxSingleDose: 800,
    renalAdjustment: { mild: 1, moderate: 0.75, severe: 0.5 },
    ageAdjustment: {
      geriatric: { minAge: 65, doseMultiplier: 0.75 },
    },
    warnings: ['GI bleeding risk', 'Cardiovascular risk with prolonged use'],
  },
  {
    drugPattern: /metformin/i,
    maxDailyDose: 2550,
    maxDailyDoseUnit: 'mg',
    renalAdjustment: { mild: 1, moderate: 0.5, severe: 0 },
    warnings: ['Contraindicated in severe renal impairment', 'Hold before contrast procedures'],
  },
  {
    drugPattern: /amoxicillin/i,
    maxDailyDose: 3000,
    maxDailyDoseUnit: 'mg',
    renalAdjustment: { mild: 1, moderate: 0.66, severe: 0.5 },
  },
  {
    drugPattern: /ciprofloxacin/i,
    maxDailyDose: 1500,
    maxDailyDoseUnit: 'mg',
    renalAdjustment: { mild: 1, moderate: 0.5, severe: 0.5 },
    warnings: ['Tendon rupture risk', 'Avoid in myasthenia gravis'],
  },
  {
    drugPattern: /gabapentin/i,
    maxDailyDose: 3600,
    maxDailyDoseUnit: 'mg',
    renalAdjustment: { mild: 0.75, moderate: 0.5, severe: 0.25 },
  },
  {
    drugPattern: /tramadol/i,
    maxDailyDose: 400,
    maxDailyDoseUnit: 'mg',
    maxSingleDose: 100,
    renalAdjustment: { mild: 1, moderate: 0.5, severe: 0.25 },
    ageAdjustment: {
      geriatric: { minAge: 75, doseMultiplier: 0.5 },
    },
    warnings: ['Seizure risk', 'Serotonin syndrome risk with SSRIs'],
  },
  {
    drugPattern: /digoxin/i,
    maxDailyDose: 0.5,
    maxDailyDoseUnit: 'mg',
    renalAdjustment: { mild: 0.75, moderate: 0.5, severe: 0.25 },
    ageAdjustment: {
      geriatric: { minAge: 70, doseMultiplier: 0.5 },
    },
    warnings: ['Narrow therapeutic index', 'Monitor levels regularly'],
  },
];

// ============================================================================
// Contraindication Rules
// ============================================================================

interface ContraindicationRule {
  drugPattern: RegExp | string;
  condition: string;
  conditionPattern: RegExp | string;
  severity: 'relative' | 'absolute';
  description: string;
  recommendation: string;
}

const CONTRAINDICATION_RULES: ContraindicationRule[] = [
  {
    drugPattern: /metformin/i,
    condition: 'Renal Failure',
    conditionPattern: /renal failure|kidney disease|ckd stage 4|ckd stage 5|egfr.*<30/i,
    severity: 'absolute',
    description: 'Metformin is contraindicated in severe renal impairment due to lactic acidosis risk',
    recommendation: 'Use alternative diabetes medication such as insulin or sulfonylurea',
  },
  {
    drugPattern: /nsaid|ibuprofen|naproxen|diclofenac/i,
    condition: 'Peptic Ulcer',
    conditionPattern: /peptic ulcer|gastric ulcer|gi bleed|gastrointestinal bleeding/i,
    severity: 'absolute',
    description: 'NSAIDs are contraindicated in active peptic ulcer disease',
    recommendation: 'Use paracetamol for pain relief. If NSAID required, use with PPI protection.',
  },
  {
    drugPattern: /beta.?blocker|atenolol|metoprolol|propranolol|bisoprolol/i,
    condition: 'Asthma',
    conditionPattern: /asthma|bronchospasm|reactive airway/i,
    severity: 'relative',
    description: 'Beta-blockers may precipitate bronchospasm in asthmatic patients',
    recommendation: 'Use cardioselective beta-blockers (bisoprolol, metoprolol) with caution',
  },
  {
    drugPattern: /ace.?inhibitor|captopril|enalapril|lisinopril|ramipril/i,
    condition: 'Pregnancy',
    conditionPattern: /pregnant|pregnancy/i,
    severity: 'absolute',
    description: 'ACE inhibitors are teratogenic and contraindicated in pregnancy',
    recommendation: 'Use alternative antihypertensive such as labetalol or methyldopa',
  },
  {
    drugPattern: /statin|atorvastatin|simvastatin|rosuvastatin/i,
    condition: 'Pregnancy',
    conditionPattern: /pregnant|pregnancy/i,
    severity: 'absolute',
    description: 'Statins are contraindicated in pregnancy due to teratogenic effects',
    recommendation: 'Discontinue statin during pregnancy',
  },
  {
    drugPattern: /warfarin|coumadin/i,
    condition: 'Pregnancy',
    conditionPattern: /pregnant|pregnancy/i,
    severity: 'absolute',
    description: 'Warfarin causes fetal warfarin syndrome and is contraindicated',
    recommendation: 'Use low molecular weight heparin instead',
  },
  {
    drugPattern: /fluoroquinolone|ciprofloxacin|levofloxacin|moxifloxacin/i,
    condition: 'Myasthenia Gravis',
    conditionPattern: /myasthenia gravis/i,
    severity: 'absolute',
    description: 'Fluoroquinolones may exacerbate muscle weakness in myasthenia gravis',
    recommendation: 'Use alternative antibiotic class',
  },
];

// ============================================================================
// Therapeutic Class Database (for duplicate therapy detection)
// ============================================================================

const THERAPEUTIC_CLASSES: Record<string, RegExp> = {
  'Proton Pump Inhibitors': /omeprazole|esomeprazole|lansoprazole|pantoprazole|rabeprazole/i,
  'ACE Inhibitors': /captopril|enalapril|lisinopril|ramipril|perindopril|quinapril/i,
  'ARBs': /losartan|valsartan|irbesartan|candesartan|telmisartan|olmesartan/i,
  'Statins': /atorvastatin|simvastatin|rosuvastatin|pravastatin|lovastatin|fluvastatin/i,
  'SSRIs': /fluoxetine|sertraline|paroxetine|citalopram|escitalopram|fluvoxamine/i,
  'Benzodiazepines': /diazepam|lorazepam|alprazolam|clonazepam|midazolam|temazepam/i,
  'NSAIDs': /ibuprofen|naproxen|diclofenac|ketoprofen|piroxicam|meloxicam|celecoxib/i,
  'Opioids': /morphine|codeine|tramadol|oxycodone|hydrocodone|fentanyl/i,
  'Beta Blockers': /atenolol|metoprolol|propranolol|bisoprolol|carvedilol|nebivolol/i,
  'Calcium Channel Blockers': /amlodipine|nifedipine|diltiazem|verapamil|felodipine/i,
  'Thiazide Diuretics': /hydrochlorothiazide|chlorthalidone|indapamide|metolazone/i,
  'Loop Diuretics': /furosemide|bumetanide|torsemide/i,
};

// ============================================================================
// AI Validation Engine
// ============================================================================

class AIValidationEngine {
  /**
   * Validate a prescription
   */
  async validatePrescription(request: PrescriptionValidationRequest): Promise<ValidationResponse> {
    const validationId = generateUUID();
    const startTime = Date.now();
    
    logger.info('Starting prescription validation', { 
      validationId, 
      patientId: request.patientNationalId,
      medicationCount: request.medications.length 
    });

    // Initialize results
    const drugInteractions: DrugInteraction[] = [];
    const dosingAlerts: DosingAlert[] = [];
    const contraindicationAlerts: ContraindicationAlert[] = [];
    const allergyAlerts: AllergyAlert[] = [];
    const duplicateTherapyAlerts: DuplicateTherapyAlert[] = [];
    const warnings: AIValidationWarning[] = [];
    const errors: AIValidationError[] = [];
    const recommendations: string[] = [];

    // 1. Check drug-drug interactions
    const interactions = this.checkDrugInteractions(
      request.medications,
      request.currentMedications || []
    );
    drugInteractions.push(...interactions);

    // 2. Check dosing
    const dosing = this.checkDosing(
      request.medications,
      request.patientAge,
      request.renalFunction,
      request.hepaticFunction
    );
    dosingAlerts.push(...dosing);

    // 3. Check contraindications
    if (request.patientConditions && request.patientConditions.length > 0) {
      const contraindications = this.checkContraindications(
        request.medications,
        request.patientConditions
      );
      contraindicationAlerts.push(...contraindications);
    }

    // 4. Check allergies
    if (request.patientAllergies && request.patientAllergies.length > 0) {
      const allergies = this.checkAllergies(
        request.medications,
        request.patientAllergies
      );
      allergyAlerts.push(...allergies);
    }

    // 5. Check duplicate therapy
    const duplicates = this.checkDuplicateTherapy(
      request.medications,
      request.currentMedications || []
    );
    duplicateTherapyAlerts.push(...duplicates);

    // 6. Try external AI engine for enhanced validation
    try {
      const externalResult = await this.callExternalAIEngine(request);
      if (externalResult) {
        // Merge external results
        if (externalResult.warnings) warnings.push(...externalResult.warnings);
        if (externalResult.recommendations) recommendations.push(...externalResult.recommendations);
      }
    } catch (error) {
      logger.warn('External AI engine unavailable, using local rules only', { error });
      warnings.push({
        code: 'AI_ENGINE_UNAVAILABLE',
        message: 'Advanced AI validation unavailable, using rule-based validation',
        severity: 'low',
      });
    }

    // Calculate overall score and pass/fail
    const { score, passed } = this.calculateScore(
      drugInteractions,
      dosingAlerts,
      contraindicationAlerts,
      allergyAlerts,
      duplicateTherapyAlerts
    );

    // Generate summary
    const summary = this.generateSummary(
      passed,
      drugInteractions,
      dosingAlerts,
      contraindicationAlerts,
      allergyAlerts,
      duplicateTherapyAlerts
    );

    // Generate recommendations
    recommendations.push(...this.generateRecommendations(
      drugInteractions,
      dosingAlerts,
      contraindicationAlerts
    ));

    const duration = Date.now() - startTime;
    logger.info('Prescription validation complete', { 
      validationId, 
      passed, 
      score,
      duration,
      interactionCount: drugInteractions.length,
      alertCount: dosingAlerts.length + contraindicationAlerts.length
    });

    return {
      validationId,
      validated: true,
      validatedAt: toFHIRDateTime(new Date()),
      overallScore: score,
      passed,
      summary,
      drugInteractions,
      dosingAlerts,
      contraindicationAlerts,
      allergyAlerts,
      duplicateTherapyAlerts,
      warnings,
      errors,
      recommendations,
    };
  }

  /**
   * Check drug-drug interactions
   */
  private checkDrugInteractions(
    medications: MedicationToValidate[],
    currentMedications: CurrentMedication[]
  ): DrugInteraction[] {
    const interactions: DrugInteraction[] = [];
    const allMeds = [
      ...medications.map(m => ({ code: m.edaCode, name: m.name, generic: m.genericName })),
      ...currentMedications.map(m => ({ code: m.edaCode, name: m.name, generic: m.genericName })),
    ];

    // Check each pair of medications
    for (let i = 0; i < allMeds.length; i++) {
      for (let j = i + 1; j < allMeds.length; j++) {
        const med1 = allMeds[i]!;
        const med2 = allMeds[j]!;

        for (const rule of INTERACTION_RULES) {
          const med1Match = this.matchesDrug(med1, rule.drug1Pattern) && this.matchesDrug(med2, rule.drug2Pattern);
          const med2Match = this.matchesDrug(med2, rule.drug1Pattern) && this.matchesDrug(med1, rule.drug2Pattern);

          if (med1Match || med2Match) {
            interactions.push({
              drug1Code: med1.code,
              drug1Name: med1.name,
              drug2Code: med2.code,
              drug2Name: med2.name,
              severity: rule.severity,
              description: rule.description,
              recommendation: rule.recommendation,
            });
          }
        }
      }
    }

    return interactions;
  }

  /**
   * Check dosing alerts
   */
  private checkDosing(
    medications: MedicationToValidate[],
    patientAge?: number,
    renalFunction?: string,
    hepaticFunction?: string
  ): DosingAlert[] {
    const alerts: DosingAlert[] = [];

    for (const med of medications) {
      for (const rule of DOSING_RULES) {
        if (!this.matchesDrugPattern(med, rule.drugPattern)) continue;

        // Calculate daily dose
        const dailyDose = this.calculateDailyDose(med);
        let adjustedMaxDose = rule.maxDailyDose;

        // Apply renal adjustment
        if (renalFunction && rule.renalAdjustment) {
          const adjustment = rule.renalAdjustment[renalFunction as keyof typeof rule.renalAdjustment];
          if (adjustment !== undefined) {
            adjustedMaxDose *= adjustment;
            if (adjustment === 0) {
              alerts.push({
                medicationCode: med.edaCode,
                medicationName: med.name,
                alertType: 'renal',
                message: `${med.name} is contraindicated in ${renalFunction} renal impairment`,
                recommendedDose: 'Contraindicated',
              });
              continue;
            }
          }
        }

        // Apply hepatic adjustment
        if (hepaticFunction && rule.hepaticAdjustment) {
          const adjustment = rule.hepaticAdjustment[hepaticFunction as keyof typeof rule.hepaticAdjustment];
          if (adjustment !== undefined) {
            adjustedMaxDose *= adjustment;
          }
        }

        // Apply age adjustment
        if (patientAge && rule.ageAdjustment) {
          if (rule.ageAdjustment.geriatric && patientAge >= rule.ageAdjustment.geriatric.minAge) {
            adjustedMaxDose *= rule.ageAdjustment.geriatric.doseMultiplier;
          }
          if (rule.ageAdjustment.pediatric && patientAge <= rule.ageAdjustment.pediatric.maxAge) {
            adjustedMaxDose *= rule.ageAdjustment.pediatric.doseMultiplier;
          }
        }

        // Check if dose exceeds maximum
        if (dailyDose > adjustedMaxDose) {
          alerts.push({
            medicationCode: med.edaCode,
            medicationName: med.name,
            alertType: 'overdose',
            message: `Daily dose of ${dailyDose}${med.doseUnit} exceeds maximum of ${adjustedMaxDose}${rule.maxDailyDoseUnit}`,
            recommendedDose: `Maximum ${adjustedMaxDose}${rule.maxDailyDoseUnit}/day`,
          });
        }

        // Check single dose
        if (rule.maxSingleDose && med.dose > rule.maxSingleDose) {
          alerts.push({
            medicationCode: med.edaCode,
            medicationName: med.name,
            alertType: 'overdose',
            message: `Single dose of ${med.dose}${med.doseUnit} exceeds maximum of ${rule.maxSingleDose}${rule.maxDailyDoseUnit}`,
            recommendedDose: `Maximum ${rule.maxSingleDose}${rule.maxDailyDoseUnit} per dose`,
          });
        }
      }
    }

    return alerts;
  }

  /**
   * Check contraindications
   */
  private checkContraindications(
    medications: MedicationToValidate[],
    conditions: string[]
  ): ContraindicationAlert[] {
    const alerts: ContraindicationAlert[] = [];

    for (const med of medications) {
      for (const rule of CONTRAINDICATION_RULES) {
        if (!this.matchesDrugPattern(med, rule.drugPattern)) continue;

        for (const condition of conditions) {
          if (this.matchesPattern(condition, rule.conditionPattern)) {
            alerts.push({
              medicationCode: med.edaCode,
              medicationName: med.name,
              condition: rule.condition,
              severity: rule.severity,
              description: rule.description,
              recommendation: rule.recommendation,
            });
          }
        }
      }
    }

    return alerts;
  }

  /**
   * Check allergies
   */
  private checkAllergies(
    medications: MedicationToValidate[],
    allergies: string[]
  ): AllergyAlert[] {
    const alerts: AllergyAlert[] = [];

    for (const med of medications) {
      const medNameLower = (med.name + ' ' + (med.genericName || '')).toLowerCase();

      for (const allergy of allergies) {
        const allergyLower = allergy.toLowerCase();

        // Direct match
        if (medNameLower.includes(allergyLower) || allergyLower.includes(medNameLower.split(' ')[0]!)) {
          alerts.push({
            medicationCode: med.edaCode,
            medicationName: med.name,
            allergen: allergy,
            severity: 'severe',
            description: `Patient has documented allergy to ${allergy}`,
          });
        }

        // Cross-reactivity checks
        // Penicillin - Cephalosporin cross-reactivity
        if (allergyLower.includes('penicillin') && medNameLower.match(/cephalosporin|cefuroxime|ceftriaxone|cefixime/)) {
          alerts.push({
            medicationCode: med.edaCode,
            medicationName: med.name,
            allergen: allergy,
            crossReactivity: true,
            severity: 'moderate',
            description: `Potential cross-reactivity with penicillin allergy (~1-10% risk)`,
          });
        }

        // Sulfa drug cross-reactivity
        if (allergyLower.includes('sulfa') && medNameLower.match(/sulfamethoxazole|sulfasalazine|sulfadiazine/)) {
          alerts.push({
            medicationCode: med.edaCode,
            medicationName: med.name,
            allergen: allergy,
            severity: 'severe',
            description: `Patient has documented sulfa allergy`,
          });
        }
      }
    }

    return alerts;
  }

  /**
   * Check duplicate therapy
   */
  private checkDuplicateTherapy(
    medications: MedicationToValidate[],
    currentMedications: CurrentMedication[]
  ): DuplicateTherapyAlert[] {
    const alerts: DuplicateTherapyAlert[] = [];
    const allMeds = [
      ...medications.map(m => ({ code: m.edaCode, name: m.name, generic: m.genericName })),
      ...currentMedications.map(m => ({ code: m.edaCode, name: m.name, generic: m.genericName })),
    ];

    // Group medications by therapeutic class
    const byClass: Record<string, typeof allMeds> = {};

    for (const med of allMeds) {
      for (const [className, pattern] of Object.entries(THERAPEUTIC_CLASSES)) {
        const nameToCheck = med.name + ' ' + (med.generic || '');
        if (pattern.test(nameToCheck)) {
          if (!byClass[className]) byClass[className] = [];
          byClass[className]!.push(med);
        }
      }
    }

    // Alert for duplicate classes
    for (const [className, meds] of Object.entries(byClass)) {
      if (meds.length > 1) {
        alerts.push({
          medications: meds.map(m => ({ code: m.code, name: m.name })),
          therapeuticClass: className,
          description: `Multiple ${className} prescribed: ${meds.map(m => m.name).join(', ')}`,
          recommendation: `Review need for multiple ${className}. Consider discontinuing one.`,
        });
      }
    }

    return alerts;
  }

  /**
   * Call external AI engine for enhanced validation
   */
  private async callExternalAIEngine(request: PrescriptionValidationRequest): Promise<{
    warnings?: AIValidationWarning[];
    recommendations?: string[];
  } | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_ENGINE_TIMEOUT);

      const response = await fetch(`${AI_ENGINE_URL}/api/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      logger.debug('External AI engine call failed', { error });
      return null;
    }
  }

  /**
   * Calculate overall validation score
   */
  private calculateScore(
    interactions: DrugInteraction[],
    dosingAlerts: DosingAlert[],
    contraindications: ContraindicationAlert[],
    allergies: AllergyAlert[],
    duplicates: DuplicateTherapyAlert[]
  ): { score: number; passed: boolean } {
    let score = 100;

    // Deduct for interactions
    for (const interaction of interactions) {
      switch (interaction.severity) {
        case 'contraindicated': score -= 50; break;
        case 'major': score -= 25; break;
        case 'moderate': score -= 10; break;
        case 'minor': score -= 5; break;
      }
    }

    // Deduct for dosing alerts
    score -= dosingAlerts.length * 15;

    // Deduct for contraindications
    for (const contra of contraindications) {
      score -= contra.severity === 'absolute' ? 40 : 15;
    }

    // Deduct for allergies
    for (const allergy of allergies) {
      switch (allergy.severity) {
        case 'life-threatening': score -= 50; break;
        case 'severe': score -= 40; break;
        case 'moderate': score -= 20; break;
        case 'mild': score -= 10; break;
      }
    }

    // Deduct for duplicates
    score -= duplicates.length * 10;

    // Ensure score is within bounds
    score = Math.max(0, Math.min(100, score));

    // Determine pass/fail
    const hasBlocker = 
      interactions.some(i => i.severity === 'contraindicated') ||
      contraindications.some(c => c.severity === 'absolute') ||
      allergies.some(a => a.severity === 'life-threatening' || a.severity === 'severe');

    const passed = score >= 60 && !hasBlocker;

    return { score, passed };
  }

  /**
   * Generate validation summary
   */
  private generateSummary(
    passed: boolean,
    interactions: DrugInteraction[],
    dosingAlerts: DosingAlert[],
    contraindications: ContraindicationAlert[],
    allergies: AllergyAlert[],
    duplicates: DuplicateTherapyAlert[]
  ): string {
    const issues: string[] = [];

    if (interactions.length > 0) {
      const severe = interactions.filter(i => i.severity === 'contraindicated' || i.severity === 'major').length;
      issues.push(`${interactions.length} drug interaction(s) (${severe} severe)`);
    }

    if (dosingAlerts.length > 0) {
      issues.push(`${dosingAlerts.length} dosing alert(s)`);
    }

    if (contraindications.length > 0) {
      issues.push(`${contraindications.length} contraindication(s)`);
    }

    if (allergies.length > 0) {
      issues.push(`${allergies.length} allergy alert(s)`);
    }

    if (duplicates.length > 0) {
      issues.push(`${duplicates.length} duplicate therapy alert(s)`);
    }

    if (issues.length === 0) {
      return 'Prescription validated successfully with no significant issues detected.';
    }

    const status = passed ? 'Prescription validated with warnings' : 'Prescription validation failed';
    return `${status}: ${issues.join(', ')}.`;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    interactions: DrugInteraction[],
    dosingAlerts: DosingAlert[],
    contraindications: ContraindicationAlert[]
  ): string[] {
    const recommendations: string[] = [];

    for (const interaction of interactions) {
      if (interaction.severity === 'contraindicated' || interaction.severity === 'major') {
        recommendations.push(interaction.recommendation);
      }
    }

    for (const alert of dosingAlerts) {
      if (alert.recommendedDose) {
        recommendations.push(`${alert.medicationName}: ${alert.recommendedDose}`);
      }
    }

    for (const contra of contraindications) {
      recommendations.push(contra.recommendation);
    }

    return [...new Set(recommendations)]; // Remove duplicates
  }

  // Helper methods
  private matchesDrug(med: { name: string; generic?: string }, pattern: RegExp | string): boolean {
    const nameToCheck = med.name + ' ' + (med.generic || '');
    return this.matchesPattern(nameToCheck, pattern);
  }

  private matchesDrugPattern(med: MedicationToValidate, pattern: RegExp | string): boolean {
    const nameToCheck = med.name + ' ' + (med.genericName || '');
    return this.matchesPattern(nameToCheck, pattern);
  }

  private matchesPattern(text: string, pattern: RegExp | string): boolean {
    if (pattern instanceof RegExp) {
      return pattern.test(text);
    }
    return text.toLowerCase().includes(pattern.toLowerCase());
  }

  private calculateDailyDose(med: MedicationToValidate): number {
    const frequencyMultipliers: Record<string, number> = {
      'once daily': 1,
      'twice daily': 2,
      'three times daily': 3,
      'four times daily': 4,
      'every 4 hours': 6,
      'every 6 hours': 4,
      'every 8 hours': 3,
      'every 12 hours': 2,
      'qd': 1,
      'bid': 2,
      'tid': 3,
      'qid': 4,
    };

    const freqLower = med.frequency.toLowerCase();
    const multiplier = frequencyMultipliers[freqLower] || 1;
    return med.dose * multiplier;
  }
}

const aiEngine = new AIValidationEngine();

// ============================================================================
// Routes
// ============================================================================

const ValidationRequestSchema = z.object({
  prescriptionId: z.string().optional(),
  patientNationalId: z.string().min(1),
  patientAge: z.number().positive().optional(),
  patientWeight: z.number().positive().optional(),
  patientGender: z.enum(['male', 'female']).optional(),
  patientConditions: z.array(z.string()).optional(),
  patientAllergies: z.array(z.string()).optional(),
  renalFunction: z.enum(['normal', 'mild', 'moderate', 'severe']).optional(),
  hepaticFunction: z.enum(['normal', 'mild', 'moderate', 'severe']).optional(),
  medications: z.array(z.object({
    edaCode: z.string().min(1),
    name: z.string().min(1),
    genericName: z.string().optional(),
    dose: z.number().positive(),
    doseUnit: z.string().min(1),
    frequency: z.string().min(1),
    duration: z.string().optional(),
    route: z.string().optional(),
  })).min(1),
  currentMedications: z.array(z.object({
    edaCode: z.string().min(1),
    name: z.string().min(1),
    genericName: z.string().optional(),
    startDate: z.string().optional(),
  })).optional(),
});

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'ai-validation-service',
    aiEngineUrl: AI_ENGINE_URL,
    timestamp: new Date().toISOString() 
  });
});

// Validate prescription
router.post('/api/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = ValidationRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(
        ErrorCodes.INVALID_REQUEST, 
        validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '), 
        400
      );
    }

    const result = await aiEngine.validatePrescription(validation.data);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Quick interaction check
router.post('/api/interactions/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { medications } = req.body;
    if (!Array.isArray(medications) || medications.length < 2) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'At least 2 medications required', 400);
    }

    const result = await aiEngine.validatePrescription({
      patientNationalId: 'quick-check',
      medications: medications.map((m: any) => ({
        edaCode: m.edaCode || m.code || 'unknown',
        name: m.name,
        genericName: m.genericName,
        dose: m.dose || 1,
        doseUnit: m.doseUnit || 'unit',
        frequency: m.frequency || 'once daily',
      })),
    });

    res.json({
      hasInteractions: result.drugInteractions.length > 0,
      interactions: result.drugInteractions,
    });
  } catch (error) {
    next(error);
  }
});

// Get interaction rules (for reference)
router.get('/api/interactions/rules', (req, res) => {
  res.json({
    totalRules: INTERACTION_RULES.length,
    severityLevels: ['minor', 'moderate', 'major', 'contraindicated'],
    rules: INTERACTION_RULES.map(r => ({
      severity: r.severity,
      description: r.description,
      recommendation: r.recommendation,
    })),
  });
});

// Error handler
function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Validation error', error, { method: req.method, path: req.path });

  if (error instanceof NDPError) {
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  logger.info('Starting AI Validation Service', { 
    env: config.env, 
    port: config.port,
    aiEngineUrl: AI_ENGINE_URL 
  });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());
  app.use('/', router);
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(`AI Validation Service listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

export { aiEngine, AIValidationEngine };

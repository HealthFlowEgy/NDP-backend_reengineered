/**
 * Legacy Adapter Service
 * SOAP to REST bridge for backward compatibility with existing systems
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { parseStringPromise, Builder } from 'xml2js';

import { loadConfig } from '../../../shared/config/index.js';
import { 
  createLogger, 
  generateUUID, 
  toFHIRDateTime 
} from '../../../shared/utils/index.js';
import { NDPError, ErrorCodes } from '../../../shared/types/ndp.types.js';

const config = loadConfig('legacy-adapter');
const logger = createLogger('legacy-adapter', config.logLevel);

// Service URLs
const SERVICES = {
  prescription: process.env['PRESCRIPTION_SERVICE_URL'] || 'http://localhost:3001',
  dispense: process.env['DISPENSE_SERVICE_URL'] || 'http://localhost:3002',
  medication: process.env['MEDICATION_SERVICE_URL'] || 'http://localhost:3003',
  auth: process.env['AUTH_SERVICE_URL'] || 'http://localhost:3004',
};

// ============================================================================
// XML Builder Configuration
// ============================================================================

const xmlBuilder = new Builder({
  rootName: 'soap:Envelope',
  xmldec: { version: '1.0', encoding: 'UTF-8' },
  renderOpts: { pretty: true, indent: '  ' },
  headless: false,
});

// ============================================================================
// SOAP Namespace Constants
// ============================================================================

const NAMESPACES = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  ndp: 'http://ndp.egypt.gov.eg/soap/prescription',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
};

// ============================================================================
// Legacy Data Types (matching existing SOAP interface)
// ============================================================================

interface LegacyPrescription {
  PrescriptionID?: string;
  PrescriptionNumber: string;
  PatientNationalID: string;
  PatientName?: string;
  PhysicianLicense: string;
  PhysicianName?: string;
  FacilityCode: string;
  FacilityName?: string;
  PrescriptionDate: string;
  ExpiryDate?: string;
  Status: string;
  AllowedDispenses: number;
  RemainingDispenses: number;
  Medications: LegacyMedication[];
  Notes?: string;
  Signature?: string;
}

interface LegacyMedication {
  LineNumber: number;
  DrugCode: string;
  DrugName: string;
  GenericName?: string;
  Quantity: number;
  Unit: string;
  Dosage: string;
  Frequency: string;
  Duration?: string;
  Route?: string;
  Instructions?: string;
}

interface LegacyDispense {
  DispenseID?: string;
  PrescriptionNumber: string;
  PharmacyCode: string;
  PharmacyName?: string;
  PharmacistLicense: string;
  PharmacistName?: string;
  DispenseDate: string;
  DispenseNumber: number;
  IsPartial: boolean;
  Items: LegacyDispenseItem[];
  Notes?: string;
}

interface LegacyDispenseItem {
  LineNumber: number;
  DrugCode: string;
  DrugName: string;
  QuantityDispensed: number;
  BatchNumber?: string;
  ExpiryDate?: string;
}

interface LegacyDrugInfo {
  DrugCode: string;
  CommercialName: string;
  GenericName?: string;
  Manufacturer?: string;
  DoseForm?: string;
  Strength?: string;
  PackSize?: string;
  Price?: number;
  Status: string;
}

// ============================================================================
// SOAP Message Parser
// ============================================================================

async function parseSOAPRequest(xmlBody: string): Promise<{
  action: string;
  body: any;
  headers?: any;
}> {
  try {
    const parsed = await parseStringPromise(xmlBody, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [(name) => name.replace(/^.*:/, '')], // Remove namespace prefix
    });

    const envelope = parsed.Envelope || parsed['soap:Envelope'] || parsed['SOAP-ENV:Envelope'];
    if (!envelope) {
      throw new Error('Invalid SOAP envelope');
    }

    const header = envelope.Header || envelope['soap:Header'];
    const body = envelope.Body || envelope['soap:Body'];

    if (!body) {
      throw new Error('Missing SOAP body');
    }

    // Extract the action (first child of body)
    const actionKey = Object.keys(body).find(k => !k.startsWith('$'));
    if (!actionKey) {
      throw new Error('No action found in SOAP body');
    }

    return {
      action: actionKey,
      body: body[actionKey],
      headers: header,
    };
  } catch (error) {
    logger.error('SOAP parse error', error);
    throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Invalid SOAP request', 400);
  }
}

// ============================================================================
// SOAP Response Builder
// ============================================================================

function buildSOAPResponse(action: string, result: any, success: boolean = true): string {
  const responseAction = `${action}Response`;
  
  const envelope = {
    '$': {
      'xmlns:soap': NAMESPACES.soap,
      'xmlns:ndp': NAMESPACES.ndp,
    },
    'soap:Header': {},
    'soap:Body': {
      [`ndp:${responseAction}`]: {
        Success: success,
        Timestamp: new Date().toISOString(),
        ...result,
      },
    },
  };

  return xmlBuilder.buildObject(envelope);
}

function buildSOAPFault(code: string, message: string, detail?: string): string {
  const envelope = {
    '$': {
      'xmlns:soap': NAMESPACES.soap,
    },
    'soap:Header': {},
    'soap:Body': {
      'soap:Fault': {
        faultcode: `soap:${code}`,
        faultstring: message,
        detail: detail ? { errorDetail: detail } : undefined,
      },
    },
  };

  return xmlBuilder.buildObject(envelope);
}

// ============================================================================
// REST to Legacy Converters
// ============================================================================

function convertFHIRToLegacyPrescription(fhir: any, record: any): LegacyPrescription {
  const medications: LegacyMedication[] = (fhir.contained || [])
    .filter((r: any) => r.resourceType === 'Medication')
    .map((med: any, index: number) => {
      const dosageInstruction = fhir.dosageInstruction?.[index] || {};
      return {
        LineNumber: index + 1,
        DrugCode: med.code?.coding?.[0]?.code || '',
        DrugName: med.code?.coding?.[0]?.display || med.code?.text || '',
        GenericName: med.ingredient?.[0]?.itemCodeableConcept?.text,
        Quantity: dosageInstruction.doseAndRate?.[0]?.doseQuantity?.value || 0,
        Unit: dosageInstruction.doseAndRate?.[0]?.doseQuantity?.unit || 'unit',
        Dosage: dosageInstruction.text || '',
        Frequency: dosageInstruction.timing?.code?.text || '',
        Duration: dosageInstruction.timing?.repeat?.boundsDuration?.value?.toString(),
        Route: dosageInstruction.route?.text,
        Instructions: dosageInstruction.patientInstruction,
      };
    });

  return {
    PrescriptionID: record.id,
    PrescriptionNumber: record.prescriptionNumber,
    PatientNationalID: record.patientNationalId,
    PatientName: fhir.subject?.display,
    PhysicianLicense: record.prescriberLicense,
    PhysicianName: fhir.requester?.display,
    FacilityCode: record.facilityId,
    FacilityName: fhir.requester?.extension?.find((e: any) => e.url?.includes('facility'))?.valueString,
    PrescriptionDate: record.createdAt?.toISOString() || fhir.authoredOn,
    ExpiryDate: record.expiresAt?.toISOString(),
    Status: mapFHIRStatusToLegacy(fhir.status),
    AllowedDispenses: record.allowedDispenses,
    RemainingDispenses: record.remainingDispenses,
    Medications: medications,
    Notes: fhir.note?.[0]?.text,
    Signature: record.signature?.signatureData,
  };
}

function convertLegacyToFHIRRequest(legacy: LegacyPrescription): any {
  return {
    patientNationalId: legacy.PatientNationalID,
    patientName: legacy.PatientName,
    medications: legacy.Medications.map(med => ({
      edaCode: med.DrugCode,
      medicationName: med.DrugName,
      quantity: med.Quantity,
      unit: med.Unit,
      dosageInstruction: med.Dosage || med.Instructions,
      frequency: med.Frequency,
      duration: med.Duration,
      route: med.Route,
    })),
    notes: legacy.Notes,
    allowedDispenses: legacy.AllowedDispenses || 1,
    validityDays: legacy.ExpiryDate 
      ? Math.ceil((new Date(legacy.ExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 30,
  };
}

function convertFHIRToLegacyDispense(fhir: any, record: any): LegacyDispense {
  return {
    DispenseID: record.id,
    PrescriptionNumber: record.prescriptionNumber,
    PharmacyCode: record.pharmacyId,
    PharmacyName: record.pharmacyName,
    PharmacistLicense: record.pharmacistLicense,
    PharmacistName: record.pharmacistName,
    DispenseDate: record.createdAt?.toISOString() || fhir.whenHandedOver,
    DispenseNumber: record.dispenseNumber,
    IsPartial: record.isPartial,
    Items: (record.dispensedItems || []).map((item: any, index: number) => ({
      LineNumber: index + 1,
      DrugCode: item.medicationCode,
      DrugName: item.medicationName,
      QuantityDispensed: item.dispensedQuantity,
      BatchNumber: item.batchNumber,
      ExpiryDate: item.expiryDate,
    })),
    Notes: fhir.note?.[0]?.text,
  };
}

function mapFHIRStatusToLegacy(status: string): string {
  const mapping: Record<string, string> = {
    'draft': 'DRAFT',
    'active': 'ACTIVE',
    'on-hold': 'PARTIAL',
    'completed': 'COMPLETED',
    'cancelled': 'CANCELLED',
    'stopped': 'STOPPED',
    'entered-in-error': 'ERROR',
  };
  return mapping[status] || 'UNKNOWN';
}

function mapLegacyStatusToFHIR(status: string): string {
  const mapping: Record<string, string> = {
    'DRAFT': 'draft',
    'ACTIVE': 'active',
    'PARTIAL': 'on-hold',
    'COMPLETED': 'completed',
    'CANCELLED': 'cancelled',
    'STOPPED': 'stopped',
    'ERROR': 'entered-in-error',
  };
  return mapping[status] || 'unknown';
}

// ============================================================================
// SOAP Action Handlers
// ============================================================================

async function handleCreatePrescription(body: any, headers: any): Promise<any> {
  const legacy = body.Prescription || body;
  const request = convertLegacyToFHIRRequest(legacy);

  // Get auth token from SOAP header
  const authToken = headers?.Security?.Token || headers?.AuthToken;

  try {
    const response = await fetch(`${SERVICES.prescription}/fhir/MedicationRequest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : '',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to create prescription');
    }

    const result = await response.json();
    
    return {
      PrescriptionNumber: result.prescriptionNumber,
      PrescriptionID: result.id,
      Status: 'CREATED',
      Message: 'Prescription created successfully',
    };
  } catch (error) {
    logger.error('Create prescription error', error);
    throw error;
  }
}

async function handleGetPrescription(body: any): Promise<any> {
  const prescriptionNumber = body.PrescriptionNumber || body.prescriptionNumber;
  const prescriptionId = body.PrescriptionID || body.prescriptionId;

  const identifier = prescriptionId || prescriptionNumber;
  if (!identifier) {
    throw new NDPError(ErrorCodes.INVALID_REQUEST, 'PrescriptionNumber or PrescriptionID required', 400);
  }

  try {
    const response = await fetch(
      `${SERVICES.prescription}/fhir/MedicationRequest/${identifier}`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { Found: false, Message: 'Prescription not found' };
      }
      throw new Error('Failed to get prescription');
    }

    const fhir = await response.json();
    const legacy = convertFHIRToLegacyPrescription(fhir, fhir);

    return {
      Found: true,
      Prescription: legacy,
    };
  } catch (error) {
    logger.error('Get prescription error', error);
    throw error;
  }
}

async function handleSearchPrescriptions(body: any): Promise<any> {
  const params = new URLSearchParams();
  
  if (body.PatientNationalID) params.append('patient', body.PatientNationalID);
  if (body.Status) params.append('status', mapLegacyStatusToFHIR(body.Status));
  if (body.PhysicianLicense) params.append('requester', body.PhysicianLicense);
  if (body.FacilityCode) params.append('facility', body.FacilityCode);
  if (body.FromDate) params.append('date', `ge${body.FromDate}`);
  if (body.ToDate) params.append('date', `le${body.ToDate}`);

  try {
    const response = await fetch(
      `${SERVICES.prescription}/fhir/MedicationRequest?${params.toString()}`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error('Failed to search prescriptions');
    }

    const bundle = await response.json();
    const prescriptions = (bundle.entry || []).map((entry: any) => {
      return convertFHIRToLegacyPrescription(entry.resource, entry.resource);
    });

    return {
      TotalCount: bundle.total || prescriptions.length,
      Prescriptions: { Prescription: prescriptions },
    };
  } catch (error) {
    logger.error('Search prescriptions error', error);
    throw error;
  }
}

async function handleSignPrescription(body: any, headers: any): Promise<any> {
  const prescriptionId = body.PrescriptionID || body.prescriptionId;
  const authToken = headers?.Security?.Token || headers?.AuthToken;

  if (!prescriptionId) {
    throw new NDPError(ErrorCodes.INVALID_REQUEST, 'PrescriptionID required', 400);
  }

  try {
    const response = await fetch(
      `${SERVICES.prescription}/fhir/MedicationRequest/${prescriptionId}/$sign`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to sign prescription');
    }

    const result = await response.json();

    return {
      Signed: true,
      PrescriptionID: prescriptionId,
      Status: 'ACTIVE',
      SignedAt: result.signedAt,
      Message: 'Prescription signed successfully',
    };
  } catch (error) {
    logger.error('Sign prescription error', error);
    throw error;
  }
}

async function handleCancelPrescription(body: any, headers: any): Promise<any> {
  const prescriptionId = body.PrescriptionID || body.prescriptionId;
  const reason = body.CancellationReason || body.reason;
  const authToken = headers?.Security?.Token || headers?.AuthToken;

  if (!prescriptionId) {
    throw new NDPError(ErrorCodes.INVALID_REQUEST, 'PrescriptionID required', 400);
  }

  try {
    const response = await fetch(
      `${SERVICES.prescription}/fhir/MedicationRequest/${prescriptionId}/$cancel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
        body: JSON.stringify({ reason }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to cancel prescription');
    }

    return {
      Cancelled: true,
      PrescriptionID: prescriptionId,
      Status: 'CANCELLED',
      Message: 'Prescription cancelled successfully',
    };
  } catch (error) {
    logger.error('Cancel prescription error', error);
    throw error;
  }
}

async function handleRecordDispense(body: any, headers: any): Promise<any> {
  const dispense = body.Dispense || body;
  const authToken = headers?.Security?.Token || headers?.AuthToken;

  const request = {
    prescriptionNumber: dispense.PrescriptionNumber,
    pharmacyId: dispense.PharmacyCode,
    pharmacyName: dispense.PharmacyName,
    dispensedItems: (dispense.Items?.Item || dispense.Items || []).map((item: any) => ({
      medicationCode: item.DrugCode,
      dispensedQuantity: item.QuantityDispensed,
      batchNumber: item.BatchNumber,
      expiryDate: item.ExpiryDate,
    })),
    notes: dispense.Notes,
  };

  try {
    const response = await fetch(`${SERVICES.dispense}/fhir/MedicationDispense`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : '',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to record dispense');
    }

    const result = await response.json();

    return {
      DispenseID: result.id,
      PrescriptionNumber: result.prescriptionNumber,
      DispenseNumber: result.dispenseNumber,
      Status: result.prescriptionStatus,
      RemainingDispenses: result.remainingDispenses,
      Message: 'Dispense recorded successfully',
    };
  } catch (error) {
    logger.error('Record dispense error', error);
    throw error;
  }
}

async function handleGetDrugInfo(body: any): Promise<any> {
  const drugCode = body.DrugCode || body.drugCode;

  if (!drugCode) {
    throw new NDPError(ErrorCodes.INVALID_REQUEST, 'DrugCode required', 400);
  }

  try {
    const response = await fetch(
      `${SERVICES.medication}/api/medications/${drugCode}`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { Found: false, Message: 'Drug not found' };
      }
      throw new Error('Failed to get drug info');
    }

    const med = await response.json();

    return {
      Found: true,
      Drug: {
        DrugCode: med.edaCode,
        CommercialName: med.commercialName,
        GenericName: med.genericName,
        Manufacturer: med.manufacturer,
        DoseForm: med.doseForm,
        Strength: med.strength,
        PackSize: med.packagingInfo,
        Status: med.status?.toUpperCase(),
      },
    };
  } catch (error) {
    logger.error('Get drug info error', error);
    throw error;
  }
}

async function handleSearchDrugs(body: any): Promise<any> {
  const params = new URLSearchParams();
  
  if (body.SearchTerm) params.append('name', body.SearchTerm);
  if (body.DrugCode) params.append('code', body.DrugCode);
  if (body.MaxResults) params.append('_count', body.MaxResults.toString());

  try {
    const response = await fetch(
      `${SERVICES.medication}/fhir/MedicationKnowledge?${params.toString()}`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error('Failed to search drugs');
    }

    const bundle = await response.json();
    const drugs = (bundle.entry || []).map((entry: any) => ({
      DrugCode: entry.resource?.code?.coding?.[0]?.code,
      CommercialName: entry.resource?.code?.coding?.[0]?.display,
      GenericName: entry.resource?.synonym?.[0],
      Manufacturer: entry.resource?.manufacturer?.display,
      Status: entry.resource?.status?.toUpperCase(),
    }));

    return {
      TotalCount: bundle.total || drugs.length,
      Drugs: { Drug: drugs },
    };
  } catch (error) {
    logger.error('Search drugs error', error);
    throw error;
  }
}

async function handleVerifyPrescription(body: any): Promise<any> {
  const prescriptionNumber = body.PrescriptionNumber;
  const patientNationalId = body.PatientNationalID;

  if (!prescriptionNumber) {
    throw new NDPError(ErrorCodes.INVALID_REQUEST, 'PrescriptionNumber required', 400);
  }

  try {
    // Get prescription
    const rxResponse = await fetch(
      `${SERVICES.prescription}/fhir/MedicationRequest?identifier=${prescriptionNumber}`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!rxResponse.ok) {
      return { Valid: false, Reason: 'Prescription not found' };
    }

    const bundle = await rxResponse.json();
    if (!bundle.entry || bundle.entry.length === 0) {
      return { Valid: false, Reason: 'Prescription not found' };
    }

    const rx = bundle.entry[0].resource;

    // Verify patient if provided
    if (patientNationalId) {
      const rxPatientId = rx.subject?.identifier?.value;
      if (rxPatientId !== patientNationalId) {
        return { Valid: false, Reason: 'Patient ID mismatch' };
      }
    }

    // Check status
    if (rx.status !== 'active' && rx.status !== 'on-hold') {
      return { 
        Valid: false, 
        Reason: `Prescription status is ${mapFHIRStatusToLegacy(rx.status)}` 
      };
    }

    // Check dispenses remaining
    const remaining = rx.dispenseRequest?.numberOfRepeatsAllowed || 0;
    if (remaining <= 0) {
      return { Valid: false, Reason: 'No dispenses remaining' };
    }

    return {
      Valid: true,
      PrescriptionNumber: prescriptionNumber,
      Status: mapFHIRStatusToLegacy(rx.status),
      RemainingDispenses: remaining,
      ExpiryDate: rx.dispenseRequest?.validityPeriod?.end,
    };
  } catch (error) {
    logger.error('Verify prescription error', error);
    throw error;
  }
}

// ============================================================================
// Action Router
// ============================================================================

const actionHandlers: Record<string, (body: any, headers: any) => Promise<any>> = {
  // Prescription operations
  'CreatePrescription': handleCreatePrescription,
  'GetPrescription': handleGetPrescription,
  'SearchPrescriptions': handleSearchPrescriptions,
  'SignPrescription': handleSignPrescription,
  'CancelPrescription': handleCancelPrescription,
  'VerifyPrescription': handleVerifyPrescription,
  
  // Dispense operations
  'RecordDispense': handleRecordDispense,
  
  // Drug operations
  'GetDrugInfo': handleGetDrugInfo,
  'SearchDrugs': handleSearchDrugs,
};

// ============================================================================
// Routes
// ============================================================================

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'legacy-adapter',
    soapEndpoint: '/soap/prescription',
    wsdlEndpoint: '/soap/prescription?wsdl',
    timestamp: new Date().toISOString() 
  });
});

// WSDL endpoint
router.get('/soap/prescription', (req, res) => {
  if (req.query.wsdl !== undefined) {
    res.setHeader('Content-Type', 'text/xml');
    res.send(generateWSDL(req));
    return;
  }
  res.status(400).send('Use POST for SOAP requests');
});

// Main SOAP endpoint
router.post('/soap/prescription', async (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');

  try {
    // Get raw XML body
    let xmlBody = '';
    if (typeof req.body === 'string') {
      xmlBody = req.body;
    } else if (req.body && typeof req.body === 'object') {
      // Body was parsed as JSON, need raw
      xmlBody = JSON.stringify(req.body);
    }

    if (!xmlBody) {
      res.status(400).send(buildSOAPFault('Client', 'Empty request body'));
      return;
    }

    // Parse SOAP request
    const { action, body, headers } = await parseSOAPRequest(xmlBody);

    logger.info('SOAP request', { action, bodyKeys: Object.keys(body || {}) });

    // Find handler
    const handler = actionHandlers[action];
    if (!handler) {
      res.status(400).send(buildSOAPFault('Client', `Unknown action: ${action}`));
      return;
    }

    // Execute handler
    const result = await handler(body, headers);

    // Build response
    const response = buildSOAPResponse(action, result, true);
    res.send(response);

  } catch (error) {
    logger.error('SOAP error', error);

    if (error instanceof NDPError) {
      res.status(error.statusCode).send(
        buildSOAPFault('Client', error.message, error.code)
      );
    } else {
      res.status(500).send(
        buildSOAPFault('Server', (error as Error).message || 'Internal server error')
      );
    }
  }
});

// REST compatibility endpoints (for gradual migration)
router.post('/api/legacy/prescription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handleCreatePrescription({ Prescription: req.body }, {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/api/legacy/prescription/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handleGetPrescription({ PrescriptionID: req.params.id });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api/legacy/dispense', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handleRecordDispense({ Dispense: req.body }, {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// WSDL Generator
// ============================================================================

function generateWSDL(req: Request): string {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="NDPPrescriptionService"
    targetNamespace="${NAMESPACES.ndp}"
    xmlns="http://schemas.xmlsoap.org/wsdl/"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
    xmlns:tns="${NAMESPACES.ndp}"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema">

  <types>
    <xsd:schema targetNamespace="${NAMESPACES.ndp}">
      <xsd:element name="CreatePrescription">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="Prescription" type="tns:PrescriptionType"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="CreatePrescriptionResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="Success" type="xsd:boolean"/>
            <xsd:element name="PrescriptionNumber" type="xsd:string"/>
            <xsd:element name="PrescriptionID" type="xsd:string"/>
            <xsd:element name="Message" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      
      <xsd:complexType name="PrescriptionType">
        <xsd:sequence>
          <xsd:element name="PatientNationalID" type="xsd:string"/>
          <xsd:element name="PatientName" type="xsd:string" minOccurs="0"/>
          <xsd:element name="Medications" type="tns:MedicationListType"/>
          <xsd:element name="Notes" type="xsd:string" minOccurs="0"/>
          <xsd:element name="AllowedDispenses" type="xsd:int" minOccurs="0"/>
        </xsd:sequence>
      </xsd:complexType>
      
      <xsd:complexType name="MedicationListType">
        <xsd:sequence>
          <xsd:element name="Medication" type="tns:MedicationType" maxOccurs="unbounded"/>
        </xsd:sequence>
      </xsd:complexType>
      
      <xsd:complexType name="MedicationType">
        <xsd:sequence>
          <xsd:element name="DrugCode" type="xsd:string"/>
          <xsd:element name="DrugName" type="xsd:string"/>
          <xsd:element name="Quantity" type="xsd:decimal"/>
          <xsd:element name="Unit" type="xsd:string"/>
          <xsd:element name="Dosage" type="xsd:string"/>
          <xsd:element name="Frequency" type="xsd:string"/>
          <xsd:element name="Duration" type="xsd:string" minOccurs="0"/>
          <xsd:element name="Route" type="xsd:string" minOccurs="0"/>
        </xsd:sequence>
      </xsd:complexType>
    </xsd:schema>
  </types>

  <message name="CreatePrescriptionInput">
    <part name="parameters" element="tns:CreatePrescription"/>
  </message>
  <message name="CreatePrescriptionOutput">
    <part name="parameters" element="tns:CreatePrescriptionResponse"/>
  </message>

  <portType name="NDPPrescriptionPortType">
    <operation name="CreatePrescription">
      <input message="tns:CreatePrescriptionInput"/>
      <output message="tns:CreatePrescriptionOutput"/>
    </operation>
  </portType>

  <binding name="NDPPrescriptionBinding" type="tns:NDPPrescriptionPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="CreatePrescription">
      <soap:operation soapAction="${NAMESPACES.ndp}/CreatePrescription"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
  </binding>

  <service name="NDPPrescriptionService">
    <port name="NDPPrescriptionPort" binding="tns:NDPPrescriptionBinding">
      <soap:address location="${baseUrl}/soap/prescription"/>
    </port>
  </service>
</definitions>`;
}

// ============================================================================
// Error Handler
// ============================================================================

function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Legacy adapter error', error, { method: req.method, path: req.path });

  if (req.path.startsWith('/soap')) {
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.status(500).send(
      buildSOAPFault('Server', error.message || 'Internal server error')
    );
  } else {
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: error.message || 'Internal server error' },
    });
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  logger.info('Starting Legacy Adapter Service', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  
  // Raw body for SOAP XML
  app.use('/soap', express.text({ type: ['text/xml', 'application/xml', 'application/soap+xml'] }));
  app.use(express.json());
  app.use(compression());
  
  app.use('/', router);
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(`Legacy Adapter Service listening on port ${config.port}`);
    logger.info(`SOAP endpoint: http://localhost:${config.port}/soap/prescription`);
    logger.info(`WSDL: http://localhost:${config.port}/soap/prescription?wsdl`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

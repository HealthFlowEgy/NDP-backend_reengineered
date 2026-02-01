import { parseStringPromise, Builder } from 'xml2js';
import { NAMESPACES } from '../config/index.js';
import { createLogger } from '../../../../shared/utils/index.js';

const logger = createLogger('legacy-soap:soap-utils');

const xmlBuilder = new Builder({
  rootName: 'soap:Envelope',
  xmldec: { version: '1.0', encoding: 'UTF-8' },
  renderOpts: { pretty: true, indent: '  ' },
  headless: false,
});

export async function parseSOAPRequest(xmlBody: string): Promise<{
  action: string;
  body: any;
  headers?: any;
}> {
  try {
    const parsed = await parseStringPromise(xmlBody, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [(name) => name.replace(/^.*:/, '')],
      trim: true,
      normalize: true,
    });

    const envelope = parsed.Envelope || parsed['soap:Envelope'] || parsed['SOAP-ENV:Envelope'];
    if (!envelope) throw new Error('Invalid SOAP envelope');

    const header = envelope.Header || envelope['soap:Header'];
    const body = envelope.Body || envelope['soap:Body'];
    if (!body) throw new Error('Missing SOAP body');

    const actionKey = Object.keys(body).find(k => !k.startsWith('$'));
    if (!actionKey) throw new Error('No action found in SOAP body');

    return {
      action: actionKey,
      body: body[actionKey],
      headers: header,
    };
  } catch (error) {
    logger.error('SOAP parse error', error);
    throw error;
  }
}

export function buildSOAPResponse(action: string, result: any, success: boolean = true): string {
  const responseAction = `${action}Response`;
  const envelope = {
    '$': { 'xmlns:soap': NAMESPACES.soap, 'xmlns:ndp': NAMESPACES.ndp },
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

export function buildSOAPFault(code: string, message: string, detail?: string): string {
  const envelope = {
    '$': { 'xmlns:soap': NAMESPACES.soap },
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

// FHIR Mappings
export function convertFHIRToLegacy(fhir: any): any {
  return {
    PrescriptionID: fhir.id,
    PrescriptionNumber: fhir.identifier?.[0]?.value,
    PatientNationalID: fhir.subject?.identifier?.value || '',
    PatientName: fhir.subject?.display,
    PhysicianLicense: fhir.requester?.identifier?.value || '',
    PhysicianName: fhir.requester?.display,
    PrescriptionDate: fhir.authoredOn,
    Status: fhir.status?.toUpperCase(),
    AllowedDispenses: fhir.dispenseRequest?.numberOfRepeatsAllowed || 1,
    RemainingDispenses: fhir.dispenseRequest?.numberOfRepeatsAllowed || 1,
    Medications: (fhir.contained || [])
      .filter((r: any) => r.resourceType === 'Medication')
      .map((med: any, idx: number) => ({
        LineNumber: idx + 1,
        DrugCode: med.code?.coding?.[0]?.code || '',
        DrugName: med.code?.coding?.[0]?.display || '',
        Quantity: fhir.dosageInstruction?.[idx]?.doseAndRate?.[0]?.doseQuantity?.value || 0,
        Unit: fhir.dosageInstruction?.[idx]?.doseAndRate?.[0]?.doseQuantity?.unit || 'unit',
        Dosage: fhir.dosageInstruction?.[idx]?.text || '',
        Frequency: fhir.dosageInstruction?.[idx]?.timing?.code?.text || '',
      })),
  };
}

export function convertLegacyToFHIR(prescription: any): any {
  return {
    resourceType: 'MedicationRequest',
    status: 'draft',
    intent: 'order',
    subject: {
      identifier: { value: prescription.PatientNationalID },
      display: prescription.PatientName,
    },
    requester: {
      identifier: { value: prescription.PhysicianLicense },
      display: prescription.PhysicianName,
    },
    dosageInstruction: prescription.Medications?.map((med: any) => ({
      text: med.Dosage,
      timing: { code: { text: med.Frequency } },
      route: med.Route ? { text: med.Route } : undefined,
      doseAndRate: [{
        doseQuantity: { value: med.Quantity, unit: med.Unit },
      }],
    })),
    dispenseRequest: {
      numberOfRepeatsAllowed: prescription.AllowedDispenses || 1,
    },
    note: prescription.Notes ? [{ text: prescription.Notes }] : undefined,
  };
}

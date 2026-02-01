import { loadConfig } from '../../../../shared/config/index.js';

export const config = loadConfig('legacy-adapter');

export const SERVICE_NAME = 'legacy-soap';

export const SERVICES = {
  prescription: process.env['PRESCRIPTION_SERVICE_URL'] || 'http://prescription:3001',
  dispense: process.env['DISPENSE_SERVICE_URL'] || 'http://dispense:3002',
  medication: process.env['MEDICATION_SERVICE_URL'] || 'http://medication:3003',
  auth: process.env['AUTH_SERVICE_URL'] || 'http://auth:3004',
};

export const FEATURES = {
  ASYNC_PROCESSING: process.env['ENABLE_ASYNC_PROCESSING'] !== 'false',
  CACHING: process.env['ENABLE_CACHING'] !== 'false',
  RATE_LIMITING: process.env['ENABLE_RATE_LIMITING'] !== 'false',
  CIRCUIT_BREAKER: process.env['ENABLE_CIRCUIT_BREAKER'] !== 'false',
};

export const NAMESPACES = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  ndp: 'http://ndp.egypt.gov.eg/soap/prescription',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
};

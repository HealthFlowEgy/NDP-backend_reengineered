/**
 * API Gateway - Request routing and aggregation
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { loadConfig } from '../../../shared/config/index.js';
import { createLogger, createOperationOutcome } from '../../../shared/utils/index.js';

const config = loadConfig('api-gateway');
const logger = createLogger('api-gateway', config.logLevel);

// Service URLs (from environment or defaults)
const SERVICES = {
  prescription: process.env['PRESCRIPTION_SERVICE_URL'] || 'http://localhost:3001',
  dispense: process.env['DISPENSE_SERVICE_URL'] || 'http://localhost:3002',
  medication: process.env['MEDICATION_SERVICE_URL'] || 'http://localhost:3003',
  auth: process.env['AUTH_SERVICE_URL'] || 'http://localhost:3004',
  signing: process.env['SIGNING_SERVICE_URL'] || 'http://localhost:3005',
};

async function main() {
  logger.info('Starting API Gateway', { env: config.env, port: config.port });
  
  const app = express();
  
  // Security
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(compression());
  
  // Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: config.rateLimitPerMinute,
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
    standardHeaders: true,
  });
  app.use(limiter);
  
  // Request ID
  app.use((req, res, next) => {
    req.headers['x-request-id'] = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    res.setHeader('X-Request-ID', req.headers['x-request-id']);
    next();
  });
  
  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('Request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: Date.now() - start,
        requestId: req.headers['x-request-id'],
      });
    });
    next();
  });
  
  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'api-gateway', timestamp: new Date().toISOString() });
  });
  
  // FHIR Capability Statement
  app.get('/fhir/metadata', (req, res) => {
    res.json({
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: new Date().toISOString(),
      kind: 'instance',
      software: {
        name: 'NDP FHIR Server',
        version: '1.0.0',
      },
      implementation: {
        description: 'Egypt National Digital Prescription Platform',
        url: `${req.protocol}://${req.get('host')}/fhir`,
      },
      fhirVersion: '4.0.1',
      format: ['application/fhir+json'],
      rest: [{
        mode: 'server',
        resource: [
          {
            type: 'MedicationRequest',
            interaction: [
              { code: 'create' },
              { code: 'read' },
              { code: 'search-type' },
            ],
            searchParam: [
              { name: 'patient', type: 'reference' },
              { name: 'status', type: 'token' },
              { name: 'authoredon', type: 'date' },
            ],
          },
          {
            type: 'MedicationDispense',
            interaction: [
              { code: 'create' },
              { code: 'read' },
              { code: 'search-type' },
            ],
          },
          {
            type: 'MedicationKnowledge',
            interaction: [
              { code: 'read' },
              { code: 'search-type' },
            ],
          },
        ],
      }],
    });
  });
  
  // Proxy to Prescription Service
  app.use('/fhir/MedicationRequest', createProxyMiddleware({
    target: SERVICES.prescription,
    changeOrigin: true,
    pathRewrite: { '^/fhir/MedicationRequest': '/fhir/MedicationRequest' },
    onError: (err, req, res) => {
      logger.error('Proxy error (prescription)', err);
      (res as Response).status(502).json(createOperationOutcome('error', 'exception', 'Service unavailable'));
    },
  }));
  
  app.use('/api/prescriptions', createProxyMiddleware({
    target: SERVICES.prescription,
    changeOrigin: true,
    pathRewrite: { '^/api/prescriptions': '/api/prescriptions' },
  }));
  
  // Proxy to Dispense Service
  app.use('/fhir/MedicationDispense', createProxyMiddleware({
    target: SERVICES.dispense,
    changeOrigin: true,
    pathRewrite: { '^/fhir/MedicationDispense': '/fhir/MedicationDispense' },
    onError: (err, req, res) => {
      logger.error('Proxy error (dispense)', err);
      (res as Response).status(502).json(createOperationOutcome('error', 'exception', 'Service unavailable'));
    },
  }));
  
  // Proxy to Medication Directory
  app.use('/fhir/MedicationKnowledge', createProxyMiddleware({
    target: SERVICES.medication,
    changeOrigin: true,
    pathRewrite: { '^/fhir/MedicationKnowledge': '/fhir/MedicationKnowledge' },
    onError: (err, req, res) => {
      logger.error('Proxy error (medication)', err);
      (res as Response).status(502).json(createOperationOutcome('error', 'exception', 'Service unavailable'));
    },
  }));
  
  app.use('/api/medications', createProxyMiddleware({
    target: SERVICES.medication,
    changeOrigin: true,
    pathRewrite: { '^/api/medications': '/api/medications' },
  }));
  
  // Proxy to Auth Service
  app.use('/api/auth', createProxyMiddleware({
    target: SERVICES.auth,
    changeOrigin: true,
    pathRewrite: { '^/api/auth': '/api/auth' },
    onError: (err, req, res) => {
      logger.error('Proxy error (auth)', err);
      (res as Response).status(502).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Auth service unavailable' } });
    },
  }));
  
  app.use('/api/practitioners', createProxyMiddleware({
    target: SERVICES.auth,
    changeOrigin: true,
    pathRewrite: { '^/api/practitioners': '/api/practitioners' },
  }));
  
  app.use('/.well-known', createProxyMiddleware({
    target: SERVICES.auth,
    changeOrigin: true,
  }));
  
  // Proxy to Signing Service
  app.use('/api/signatures', createProxyMiddleware({
    target: SERVICES.signing,
    changeOrigin: true,
    pathRewrite: { '^/api/signatures': '/api/signatures' },
    onError: (err, req, res) => {
      logger.error('Proxy error (signing)', err);
      (res as Response).status(502).json({ error: { code: 'SIGNING_UNAVAILABLE', message: 'Signing service unavailable' } });
    },
  }));
  
  app.use('/api/certificates', createProxyMiddleware({
    target: SERVICES.signing,
    changeOrigin: true,
    pathRewrite: { '^/api/certificates': '/api/certificates' },
  }));
  
  app.use('/fhir/Provenance', createProxyMiddleware({
    target: SERVICES.signing,
    changeOrigin: true,
    pathRewrite: { '^/fhir/Provenance': '/fhir/Provenance' },
  }));
  
  // 404 handler
  app.use((req, res) => {
    if (req.path.startsWith('/fhir')) {
      res.status(404).json(createOperationOutcome('error', 'not-found', `Resource not found: ${req.path}`));
    } else {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.path}` } });
    }
  });
  
  // Error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Gateway error', err);
    if (req.path.startsWith('/fhir')) {
      res.status(500).json(createOperationOutcome('error', 'exception', 'Internal gateway error'));
    } else {
      res.status(500).json({ error: { code: 'GATEWAY_ERROR', message: 'Internal gateway error' } });
    }
  });
  
  // Start server
  const server = app.listen(config.port, () => {
    logger.info(`API Gateway listening on port ${config.port}`);
    logger.info('Service endpoints:', SERVICES);
  });
  
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start gateway', error);
  process.exit(1);
});

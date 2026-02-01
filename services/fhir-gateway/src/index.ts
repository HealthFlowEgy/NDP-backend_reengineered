/**
 * FHIR Gateway Service
 * Smart Proxy & Governance Layer for HAPI FHIR
 * National Digital Prescription Platform - Egypt
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { validateFHIRProfile } from './middleware/validate-profile.middleware.js';
import { authorizeFHIR } from './middleware/auth.middleware.js';

const PORT = process.env.PORT || 3011;
const HAPI_URL = process.env.HAPI_FHIR_URL || 'http://hapi-fhir:8080/fhir';

async function main() {
  console.log(`Starting FHIR Gateway on port ${PORT}`);
  console.log(`Proxying to HAPI FHIR at ${HAPI_URL}`);

  const app = express();

  // Security & Utility Middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(compression());
  
  // Body parsing (Required for validation middleware)
  app.use(express.json({ limit: '10mb', type: ['application/json', 'application/fhir+json'] }));

  // Health Check (Public)
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy', 
      service: 'fhir-gateway', 
      backend: HAPI_URL 
    });
  });

  // Compliance Middleware
  app.use(validateFHIRProfile);

  // Authorization Middleware
  app.use(authorizeFHIR);

  // FHIR Proxy
  app.use('/', createProxyMiddleware({
    target: HAPI_URL,
    changeOrigin: true,
    pathRewrite: {
      '^/': '/', // Keep path as is
    },
    onProxyReq: (proxyReq, req, res) => {
      // Add custom headers or logging here
      console.log(`[FHIR-Gateway] Proxying ${req.method} ${req.url}`);
    },
    onError: (err, req, res) => {
      console.error('[FHIR-Gateway] Proxy Error:', err);
      res.status(502).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'timeout',
          diagnostics: 'Upstream FHIR server unavailable'
        }]
      });
    }
  }));

  app.listen(PORT, () => {
    console.log(`FHIR Gateway listening on port ${PORT}`);
  });
}

main().catch(console.error);

/**
 * Enhanced Legacy Adapter Service v2.0
 * Refactored to Layered Architecture
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import soapRoutes from './routes/soap.routes.js';
import { config } from './config/index.js';
import { legacyService } from './services/legacy.service.js';
import { createLogger } from '../../../shared/utils/index.js';

const logger = createLogger('legacy-soap');

async function main() {
  logger.info('Starting Legacy SOAP Service (Refactored)', { port: config.port });

  await legacyService.connect();

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(compression());
  
  // RAW body for SOAP XML
  app.use('/soap', express.text({ 
    type: ['text/xml', 'application/xml', 'application/soap+xml'],
    limit: '1mb',
  }));
  app.use(express.json());

  app.use('/', soapRoutes);

  const server = app.listen(config.port, () => {
    logger.info(`Legacy SOAP Service listening on port ${config.port}`);
  });

  const shutdown = async () => {
    logger.info('Shutting down...');
    server.close();
    await legacyService.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});
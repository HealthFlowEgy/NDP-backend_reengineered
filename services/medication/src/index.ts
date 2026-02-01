/**
 * Medication Directory Service
 * Refactored to Layered Architecture + Central FHIR Gateway
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import medicationRoutes from './routes/medication.routes.js';
import { loadConfig } from '../../../shared/config/index.js';
import { createLogger, createOperationOutcome } from '../../../shared/utils/index.js';

const config = loadConfig('medication-directory');
const logger = createLogger('medication-directory', config.logLevel);

async function main() {
  logger.info('Starting Medication Directory Service (Gateway Mode)', { env: config.env, port: config.port });
  
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());
  
  app.use('/fhir', (req, res, next) => { res.setHeader('Content-Type', 'application/fhir+json'); next(); });
  
  app.use('/', medicationRoutes);
  
  // Error Handler
  app.use((error: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Request error', error);
    const status = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';
    
    if (req.path.startsWith('/fhir')) {
      res.status(status).json(createOperationOutcome('error', 'exception', message));
    } else {
      res.status(status).json({ error: { code: error.code || 'INTERNAL_ERROR', message } });
    }
  });
  
  const server = app.listen(config.port, () => {
    logger.info(`Medication Directory Service listening on port ${config.port}`);
  });
  
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});
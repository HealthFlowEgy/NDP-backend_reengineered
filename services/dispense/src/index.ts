/**
 * Dispense Service
 * Refactored to Layered Architecture + Central FHIR Gateway
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dispenseRoutes from './routes/dispense.routes.js';
import { loadConfig } from '../../../shared/config/index.js';
import { createLogger, createOperationOutcome } from '../../../shared/utils/index.js';

const config = loadConfig('dispense-service');
const logger = createLogger('dispense-service', config.logLevel);

async function main() {
  logger.info('Starting Dispense Service (Refactored)', { env: config.env, port: config.port });

  const app = express();

  // Middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());

  // FHIR Content Type
  app.use('/fhir', (req, res, next) => { 
    res.setHeader('Content-Type', 'application/fhir+json'); 
    next(); 
  });

  // Routes
  app.use('/', dispenseRoutes);

  // Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Dispense Service Error', err);
    
    // FHIR Error Response
    const status = err.statusCode || 500;
    const outcome = createOperationOutcome('error', 'exception', err.message || 'Internal Server Error');
    res.status(status).json(outcome);
  });

  const server = app.listen(config.port, () => {
    logger.info(`Dispense Service listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});
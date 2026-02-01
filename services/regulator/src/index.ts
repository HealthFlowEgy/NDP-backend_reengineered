/**
 * Regulator Portal Service
 * Refactored to Layered Architecture
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import regulatorRoutes from './routes/regulator.routes.js';
import { loadConfig } from '../../../shared/config/index.js';
import { createLogger, createOperationOutcome } from '../../../shared/utils/index.js';

const config = loadConfig('regulator-service');
const logger = createLogger('regulator-service', config.logLevel);

async function main() {
  logger.info('Starting Regulator Service (Layered)', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());

  app.use('/', regulatorRoutes);

  // Error Handler
  app.use((error: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Regulator Service Error', error);
    const status = error.statusCode || 500;
    res.status(status).json({ error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  });

  const server = app.listen(config.port, () => {
    logger.info(`Regulator Service listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});
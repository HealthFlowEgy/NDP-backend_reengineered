/**
 * Reporting Service
 * Refactored to Layered Architecture
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import reportingRoutes from './routes/reporting.routes.js';
import { loadConfig } from '../../../shared/config/index.js';
import { createLogger } from '../../../shared/utils/index.js';

const config = loadConfig('reporting-service');
const logger = createLogger('reporting-service', config.logLevel);

async function main() {
  logger.info('Starting Reporting Service (Layered)', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());

  app.use('/', reportingRoutes);

  app.use((error: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Reporting Service Error', error);
    const status = error.statusCode || 500;
    res.status(status).json({ error: { code: error.code || 'INTERNAL_ERROR', message: error.message } });
  });

  const server = app.listen(config.port, () => {
    logger.info(`Reporting Service listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});
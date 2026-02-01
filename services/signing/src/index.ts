/**
 * Signing Service
 * Refactored to Layered Architecture
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import signingRoutes from './routes/signing.routes.js';
import { loadConfig } from '../../../shared/config/index.js';
import { createLogger } from '../../../shared/utils/index.js';
import { NDPError } from '../../../shared/types/ndp.types.js';

const config = loadConfig('signing-service');
const logger = createLogger('signing-service', config.logLevel);

async function main() {
  logger.info('Starting Signing Service (Layered)', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());

  app.use('/', signingRoutes);

  // Error Handler
  app.use((error: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Signing error', error);
    if (error instanceof NDPError) {
      return res.status(error.statusCode).json({
        error: { code: error.code, message: error.message },
      });
    }
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  const server = app.listen(config.port, () => {
    logger.info(`Signing Service listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});
/**
 * Prescription Service - Main Entry Point
 * National Digital Prescription Platform
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { loadConfig } from '../../../shared/config/index.js';
import { createLogger } from '../../../shared/utils/index.js';
import prescriptionRoutes from './routes/prescription.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';

const config = loadConfig('prescription-service');
const logger = createLogger('prescription-service', config.logLevel);

async function main() {
  logger.info('Starting Prescription Service (Gateway Mode)', { 
    env: config.env, 
    port: config.port 
  });
  
  // Create Express app
  const app = express();
  
  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Disable for API
  }));
  
  // CORS
  app.use(cors({
    origin: config.corsOrigins,
    credentials: true,
  }));
  
  // Compression
  app.use(compression());
  
  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: config.rateLimitPerMinute,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);
  
  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('Request completed', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        requestId: req.headers['x-request-id'],
      });
    });
    next();
  });
  
  // Add request ID if not present
  app.use((req, res, next) => {
    if (!req.headers['x-request-id']) {
      req.headers['x-request-id'] = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    res.setHeader('X-Request-ID', req.headers['x-request-id']);
    next();
  });
  
  // FHIR Content-Type header
  app.use('/fhir', (req, res, next) => {
    res.setHeader('Content-Type', 'application/fhir+json');
    next();
  });
  
  // Routes
  app.use('/', prescriptionRoutes);
  
  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);
  
  // Start server
  const server = app.listen(config.port, () => {
    logger.info(`Prescription Service listening on port ${config.port}`);
  });
  
  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);
    
    server.close(async () => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Failed to start service', error);
  process.exit(1);
});
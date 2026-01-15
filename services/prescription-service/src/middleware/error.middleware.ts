/**
 * Error Handler Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { NDPError } from '../../../../shared/types/ndp.types.js';
import { createLogger, createOperationOutcome } from '../../../../shared/utils/index.js';

const logger = createLogger('prescription-service:error');

/**
 * Global error handler middleware
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log error
  logger.error('Request error', error, {
    method: req.method,
    path: req.path,
    requestId: req.headers['x-request-id'],
  });
  
  // Handle NDPError
  if (error instanceof NDPError) {
    // Check if FHIR endpoint - return OperationOutcome
    if (req.path.startsWith('/fhir')) {
      const operationOutcome = createOperationOutcome(
        'error',
        error.code,
        error.message
      );
      return res.status(error.statusCode).json(operationOutcome);
    }
    
    // Regular API error response
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
      requestId: req.headers['x-request-id'],
    });
  }
  
  // Handle Zod validation errors
  if (error.name === 'ZodError') {
    const zodError = error as { errors: Array<{ path: string[]; message: string }> };
    const message = zodError.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    
    if (req.path.startsWith('/fhir')) {
      const operationOutcome = createOperationOutcome('error', 'invalid', message);
      return res.status(400).json(operationOutcome);
    }
    
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    });
  }
  
  // Handle other errors
  const statusCode = 500;
  const message = process.env['NODE_ENV'] === 'production' 
    ? 'Internal server error' 
    : error.message;
  
  if (req.path.startsWith('/fhir')) {
    const operationOutcome = createOperationOutcome('error', 'exception', message);
    return res.status(statusCode).json(operationOutcome);
  }
  
  res.status(statusCode).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
    timestamp: new Date().toISOString(),
    path: req.path,
    requestId: req.headers['x-request-id'],
  });
}

/**
 * Not found handler
 */
export function notFoundHandler(req: Request, res: Response) {
  if (req.path.startsWith('/fhir')) {
    const operationOutcome = createOperationOutcome(
      'error',
      'not-found',
      `Endpoint not found: ${req.method} ${req.path}`
    );
    return res.status(404).json(operationOutcome);
  }
  
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint not found: ${req.method} ${req.path}`,
    },
    timestamp: new Date().toISOString(),
    path: req.path,
  });
}

/**
 * NDP Prometheus Metrics Library
 * Provides standardized metrics collection for all microservices
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { Request, Response, NextFunction } from 'express';

// ============================================================================
// Global Registry
// ============================================================================

const registry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: registry, prefix: 'ndp_' });

// ============================================================================
// HTTP Request Metrics
// ============================================================================

export const httpRequestsTotal = new Counter({
  name: 'ndp_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status', 'service'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'ndp_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status', 'service'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestSize = new Histogram({
  name: 'ndp_http_request_size_bytes',
  help: 'HTTP request size in bytes',
  labelNames: ['method', 'path', 'service'],
  buckets: [100, 1000, 10000, 100000, 1000000],
  registers: [registry],
});

export const httpResponseSize = new Histogram({
  name: 'ndp_http_response_size_bytes',
  help: 'HTTP response size in bytes',
  labelNames: ['method', 'path', 'service'],
  buckets: [100, 1000, 10000, 100000, 1000000],
  registers: [registry],
});

// ============================================================================
// Business Metrics
// ============================================================================

export const prescriptionsTotal = new Counter({
  name: 'ndp_prescriptions_total',
  help: 'Total number of prescriptions processed',
  labelNames: ['status', 'action'],
  registers: [registry],
});

export const dispensesTotal = new Counter({
  name: 'ndp_dispenses_total',
  help: 'Total number of dispenses processed',
  labelNames: ['type', 'pharmacy_id'],
  registers: [registry],
});

export const validationChecksTotal = new Counter({
  name: 'ndp_validation_checks_total',
  help: 'Total number of AI validation checks',
  labelNames: ['result', 'check_type'],
  registers: [registry],
});

export const notificationsSentTotal = new Counter({
  name: 'ndp_notifications_sent_total',
  help: 'Total number of notifications sent',
  labelNames: ['channel', 'status', 'type'],
  registers: [registry],
});

export const drugRecallsTotal = new Counter({
  name: 'ndp_drug_recalls_total',
  help: 'Total number of drug recalls',
  labelNames: ['class', 'status'],
  registers: [registry],
});

// ============================================================================
// Database Metrics
// ============================================================================

export const dbQueryDuration = new Histogram({
  name: 'ndp_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table', 'service'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

export const dbConnectionsActive = new Gauge({
  name: 'ndp_db_connections_active',
  help: 'Number of active database connections',
  labelNames: ['service'],
  registers: [registry],
});

export const dbConnectionsIdle = new Gauge({
  name: 'ndp_db_connections_idle',
  help: 'Number of idle database connections',
  labelNames: ['service'],
  registers: [registry],
});

export const dbConnectionsWaiting = new Gauge({
  name: 'ndp_db_connections_waiting',
  help: 'Number of clients waiting for connections',
  labelNames: ['service'],
  registers: [registry],
});

// ============================================================================
// Kafka Metrics
// ============================================================================

export const kafkaMessagesProduced = new Counter({
  name: 'ndp_kafka_messages_produced_total',
  help: 'Total number of Kafka messages produced',
  labelNames: ['topic', 'event_type', 'service'],
  registers: [registry],
});

export const kafkaMessagesConsumed = new Counter({
  name: 'ndp_kafka_messages_consumed_total',
  help: 'Total number of Kafka messages consumed',
  labelNames: ['topic', 'event_type', 'consumer_group', 'service'],
  registers: [registry],
});

export const kafkaConsumerLag = new Gauge({
  name: 'ndp_kafka_consumer_lag',
  help: 'Kafka consumer lag (messages behind)',
  labelNames: ['topic', 'partition', 'consumer_group'],
  registers: [registry],
});

// ============================================================================
// Cache Metrics
// ============================================================================

export const cacheHitsTotal = new Counter({
  name: 'ndp_cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache_name', 'operation', 'service'],
  registers: [registry],
});

export const cacheMissesTotal = new Counter({
  name: 'ndp_cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache_name', 'operation', 'service'],
  registers: [registry],
});

// ============================================================================
// External Service Metrics
// ============================================================================

export const externalServiceDuration = new Histogram({
  name: 'ndp_external_service_duration_seconds',
  help: 'External service call duration in seconds',
  labelNames: ['service', 'operation', 'status'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const externalServiceErrorsTotal = new Counter({
  name: 'ndp_external_service_errors_total',
  help: 'Total number of external service errors',
  labelNames: ['service', 'operation', 'error_type'],
  registers: [registry],
});

// ============================================================================
// Express Metrics Middleware
// ============================================================================

export function metricsMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = process.hrtime.bigint();
    
    // Normalize path to avoid high cardinality
    const normalizedPath = normalizePath(req.path);
    
    // Track request size
    const requestSize = parseInt(req.headers['content-length'] || '0', 10);
    if (requestSize > 0) {
      httpRequestSize.observe(
        { method: req.method, path: normalizedPath, service: serviceName },
        requestSize
      );
    }
    
    // Intercept response
    const originalSend = res.send;
    res.send = function (body): Response {
      // Calculate duration
      const endTime = process.hrtime.bigint();
      const durationSeconds = Number(endTime - startTime) / 1e9;
      
      // Record metrics
      httpRequestsTotal.inc({
        method: req.method,
        path: normalizedPath,
        status: res.statusCode.toString(),
        service: serviceName,
      });
      
      httpRequestDuration.observe(
        {
          method: req.method,
          path: normalizedPath,
          status: res.statusCode.toString(),
          service: serviceName,
        },
        durationSeconds
      );
      
      // Track response size
      const responseSize = Buffer.byteLength(body || '', 'utf8');
      httpResponseSize.observe(
        { method: req.method, path: normalizedPath, service: serviceName },
        responseSize
      );
      
      return originalSend.call(this, body);
    };
    
    next();
  };
}

// ============================================================================
// Metrics Endpoint Handler
// ============================================================================

export async function metricsHandler(req: Request, res: Response): Promise<void> {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (error) {
    res.status(500).end(error instanceof Error ? error.message : String(error));
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function normalizePath(path: string): string {
  // Replace UUIDs with :id
  let normalized = path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id'
  );
  
  // Replace numeric IDs with :id
  normalized = normalized.replace(/\/\d+/g, '/:id');
  
  // Replace prescription numbers (RX-YYYY-NNNNNNN)
  normalized = normalized.replace(/RX-\d{4}-\d+/gi, ':prescription_number');
  
  // Replace national IDs (14 digits)
  normalized = normalized.replace(/\/\d{14}/g, '/:national_id');
  
  return normalized;
}

// ============================================================================
// Database Metrics Helper
// ============================================================================

export function trackDatabaseQuery<T>(
  serviceName: string,
  operation: string,
  table: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const startTime = process.hrtime.bigint();
  
  return queryFn()
    .then((result) => {
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      dbQueryDuration.observe({ operation, table, service: serviceName }, duration);
      return result;
    })
    .catch((error) => {
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      dbQueryDuration.observe({ operation, table, service: serviceName }, duration);
      throw error;
    });
}

// ============================================================================
// External Service Metrics Helper
// ============================================================================

export function trackExternalCall<T>(
  serviceName: string,
  operation: string,
  callFn: () => Promise<T>
): Promise<T> {
  const startTime = process.hrtime.bigint();
  
  return callFn()
    .then((result) => {
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      externalServiceDuration.observe(
        { service: serviceName, operation, status: 'success' },
        duration
      );
      return result;
    })
    .catch((error) => {
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      externalServiceDuration.observe(
        { service: serviceName, operation, status: 'error' },
        duration
      );
      externalServiceErrorsTotal.inc({
        service: serviceName,
        operation,
        error_type: error.name || 'unknown',
      });
      throw error;
    });
}

// ============================================================================
// Registry Export
// ============================================================================

export { registry };

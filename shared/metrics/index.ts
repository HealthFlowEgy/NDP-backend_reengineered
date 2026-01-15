/**
 * NDP Metrics Module
 * Re-exports all metrics-related functionality
 */

export {
  // Registry
  registry,
  
  // HTTP Metrics
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestSize,
  httpResponseSize,
  
  // Business Metrics
  prescriptionsTotal,
  dispensesTotal,
  validationChecksTotal,
  notificationsSentTotal,
  drugRecallsTotal,
  
  // Database Metrics
  dbQueryDuration,
  dbConnectionsActive,
  dbConnectionsIdle,
  dbConnectionsWaiting,
  
  // Kafka Metrics
  kafkaMessagesProduced,
  kafkaMessagesConsumed,
  kafkaConsumerLag,
  
  // Cache Metrics
  cacheHitsTotal,
  cacheMissesTotal,
  
  // External Service Metrics
  externalServiceDuration,
  externalServiceErrorsTotal,
  
  // Middleware & Handlers
  metricsMiddleware,
  metricsHandler,
  
  // Helpers
  trackDatabaseQuery,
  trackExternalCall,
} from './prometheus';

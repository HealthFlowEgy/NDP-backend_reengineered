/**
 * NDP Elasticsearch Module
 * Re-exports all Elasticsearch-related functionality
 */

export {
  // Types
  AuditLogEntry,
  AuditEventType,
  AuditSearchParams,
  AuditSearchResult,
  
  // Classes
  AuditLogger,
  
  // Functions
  getAuditLogger,
  auditMiddleware,
} from './audit-logger';

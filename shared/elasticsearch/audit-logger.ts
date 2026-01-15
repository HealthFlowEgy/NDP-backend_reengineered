/**
 * NDP Elasticsearch Audit Logger
 * Provides centralized audit logging with Elasticsearch backend
 */

import { Client, estypes } from '@elastic/elasticsearch';

// ============================================================================
// Types
// ============================================================================

export interface AuditLogEntry {
  '@timestamp': string;
  eventType: AuditEventType;
  service: string;
  action: string;
  resourceType: string;
  resourceId: string;
  userId?: string;
  userRole?: string;
  userName?: string;
  userLicense?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
  duration?: number;
  result: 'success' | 'failure' | 'warning';
  statusCode?: number;
  errorMessage?: string;
  errorStack?: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
  geo?: {
    country?: string;
    city?: string;
    region?: string;
  };
}

export type AuditEventType =
  | 'authentication'
  | 'authorization'
  | 'prescription.create'
  | 'prescription.read'
  | 'prescription.update'
  | 'prescription.sign'
  | 'prescription.cancel'
  | 'dispense.create'
  | 'dispense.read'
  | 'medication.search'
  | 'medication.recall'
  | 'notification.send'
  | 'report.generate'
  | 'admin.action'
  | 'security.alert';

export interface AuditSearchParams {
  startDate?: Date;
  endDate?: Date;
  eventType?: AuditEventType;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  result?: 'success' | 'failure' | 'warning';
  service?: string;
  limit?: number;
  offset?: number;
}

export interface AuditSearchResult {
  total: number;
  entries: AuditLogEntry[];
  aggregations?: {
    byEventType?: Record<string, number>;
    byResult?: Record<string, number>;
    byService?: Record<string, number>;
  };
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_ES_CONFIG = {
  node: process.env.ELASTICSEARCH_URL || 'http://elasticsearch.ndp-logging:9200',
  auth: {
    username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
    password: process.env.ELASTICSEARCH_PASSWORD || 'CHANGE_ME_IN_PRODUCTION',
  },
  maxRetries: 3,
  requestTimeout: 30000,
  sniffOnStart: false,
};

const AUDIT_INDEX_PREFIX = 'ndp-audit';
const AUDIT_INDEX_PATTERN = `${AUDIT_INDEX_PREFIX}-*`;

// ============================================================================
// Index Template
// ============================================================================

const AUDIT_INDEX_TEMPLATE: estypes.IndicesPutIndexTemplateRequest = {
  name: 'ndp-audit-template',
  index_patterns: [AUDIT_INDEX_PATTERN],
  template: {
    settings: {
      number_of_shards: 3,
      number_of_replicas: 1,
      'index.lifecycle.name': 'ndp-audit-policy',
      'index.lifecycle.rollover_alias': AUDIT_INDEX_PREFIX,
    },
    mappings: {
      dynamic: 'strict',
      properties: {
        '@timestamp': { type: 'date' },
        eventType: { type: 'keyword' },
        service: { type: 'keyword' },
        action: { type: 'keyword' },
        resourceType: { type: 'keyword' },
        resourceId: { type: 'keyword' },
        userId: { type: 'keyword' },
        userRole: { type: 'keyword' },
        userName: { type: 'text', fields: { keyword: { type: 'keyword' } } },
        userLicense: { type: 'keyword' },
        ipAddress: { type: 'ip' },
        userAgent: { type: 'text' },
        requestId: { type: 'keyword' },
        correlationId: { type: 'keyword' },
        duration: { type: 'integer' },
        result: { type: 'keyword' },
        statusCode: { type: 'integer' },
        errorMessage: { type: 'text' },
        errorStack: { type: 'text', index: false },
        oldValue: { type: 'object', enabled: false },
        newValue: { type: 'object', enabled: false },
        metadata: { type: 'object', enabled: false },
        geo: {
          type: 'object',
          properties: {
            country: { type: 'keyword' },
            city: { type: 'keyword' },
            region: { type: 'keyword' },
          },
        },
      },
    },
  },
};

// ============================================================================
// Audit Logger Class
// ============================================================================

export class AuditLogger {
  private client: Client;
  private serviceName: string;
  private isInitialized: boolean = false;
  private buffer: AuditLogEntry[] = [];
  private bufferSize: number;
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(
    serviceName: string,
    options?: {
      esConfig?: Partial<typeof DEFAULT_ES_CONFIG>;
      bufferSize?: number;
      flushIntervalMs?: number;
    }
  ) {
    this.serviceName = serviceName;
    this.bufferSize = options?.bufferSize || 100;
    
    this.client = new Client({
      ...DEFAULT_ES_CONFIG,
      ...options?.esConfig,
    });

    // Start periodic flush
    const flushIntervalMs = options?.flushIntervalMs || 5000;
    this.flushInterval = setInterval(() => this.flush(), flushIntervalMs);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check connection
      await this.client.ping();

      // Create index template if not exists
      const templateExists = await this.client.indices.existsIndexTemplate({
        name: AUDIT_INDEX_TEMPLATE.name,
      });

      if (!templateExists) {
        await this.client.indices.putIndexTemplate(AUDIT_INDEX_TEMPLATE);
        console.log(`[${this.serviceName}] Created Elasticsearch index template`);
      }

      // Create initial index if not exists
      const indexName = this.getCurrentIndexName();
      const indexExists = await this.client.indices.exists({ index: indexName });

      if (!indexExists) {
        await this.client.indices.create({
          index: indexName,
          aliases: {
            [AUDIT_INDEX_PREFIX]: { is_write_index: true },
          },
        });
        console.log(`[${this.serviceName}] Created Elasticsearch index: ${indexName}`);
      }

      this.isInitialized = true;
      console.log(`[${this.serviceName}] Elasticsearch audit logger initialized`);
    } catch (error) {
      console.error(`[${this.serviceName}] Failed to initialize Elasticsearch:`, error);
      // Don't throw - allow service to continue without audit logging
    }
  }

  private getCurrentIndexName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${AUDIT_INDEX_PREFIX}-${year}.${month}`;
  }

  async log(entry: Partial<AuditLogEntry>): Promise<void> {
    const fullEntry: AuditLogEntry = {
      '@timestamp': new Date().toISOString(),
      service: this.serviceName,
      action: 'unknown',
      resourceType: 'unknown',
      resourceId: '',
      result: 'success',
      eventType: 'admin.action',
      ...entry,
    };

    this.buffer.push(fullEntry);

    // Flush if buffer is full
    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entriesToFlush = [...this.buffer];
    this.buffer = [];

    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const operations = entriesToFlush.flatMap((entry) => [
        { index: { _index: AUDIT_INDEX_PREFIX } },
        entry,
      ]);

      const result = await this.client.bulk({
        operations,
        refresh: false,
      });

      if (result.errors) {
        const errorItems = result.items.filter((item) => item.index?.error);
        console.error(`[${this.serviceName}] Bulk index errors:`, errorItems.slice(0, 5));
      }

      console.log(`[${this.serviceName}] Flushed ${entriesToFlush.length} audit entries`);
    } catch (error) {
      console.error(`[${this.serviceName}] Failed to flush audit entries:`, error);
      // Re-add entries to buffer for retry
      this.buffer.unshift(...entriesToFlush);
    }
  }

  async search(params: AuditSearchParams): Promise<AuditSearchResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const must: estypes.QueryDslQueryContainer[] = [];

    if (params.startDate || params.endDate) {
      must.push({
        range: {
          '@timestamp': {
            ...(params.startDate && { gte: params.startDate.toISOString() }),
            ...(params.endDate && { lte: params.endDate.toISOString() }),
          },
        },
      });
    }

    if (params.eventType) {
      must.push({ term: { eventType: params.eventType } });
    }

    if (params.userId) {
      must.push({ term: { userId: params.userId } });
    }

    if (params.resourceType) {
      must.push({ term: { resourceType: params.resourceType } });
    }

    if (params.resourceId) {
      must.push({ term: { resourceId: params.resourceId } });
    }

    if (params.result) {
      must.push({ term: { result: params.result } });
    }

    if (params.service) {
      must.push({ term: { service: params.service } });
    }

    const response = await this.client.search<AuditLogEntry>({
      index: AUDIT_INDEX_PATTERN,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} },
      sort: [{ '@timestamp': 'desc' }],
      size: params.limit || 100,
      from: params.offset || 0,
      aggs: {
        byEventType: { terms: { field: 'eventType', size: 20 } },
        byResult: { terms: { field: 'result', size: 5 } },
        byService: { terms: { field: 'service', size: 20 } },
      },
    });

    const total = typeof response.hits.total === 'number' 
      ? response.hits.total 
      : response.hits.total?.value || 0;

    const aggregations: AuditSearchResult['aggregations'] = {};

    if (response.aggregations?.byEventType) {
      const buckets = (response.aggregations.byEventType as estypes.AggregationsStringTermsAggregate).buckets;
      if (Array.isArray(buckets)) {
        aggregations.byEventType = Object.fromEntries(
          buckets.map((b: any) => [b.key, b.doc_count])
        );
      }
    }

    if (response.aggregations?.byResult) {
      const buckets = (response.aggregations.byResult as estypes.AggregationsStringTermsAggregate).buckets;
      if (Array.isArray(buckets)) {
        aggregations.byResult = Object.fromEntries(
          buckets.map((b: any) => [b.key, b.doc_count])
        );
      }
    }

    if (response.aggregations?.byService) {
      const buckets = (response.aggregations.byService as estypes.AggregationsStringTermsAggregate).buckets;
      if (Array.isArray(buckets)) {
        aggregations.byService = Object.fromEntries(
          buckets.map((b: any) => [b.key, b.doc_count])
        );
      }
    }

    return {
      total,
      entries: response.hits.hits.map((hit) => hit._source as AuditLogEntry),
      aggregations,
    };
  }

  async getRecentActivity(userId: string, limit: number = 50): Promise<AuditLogEntry[]> {
    const result = await this.search({
      userId,
      limit,
    });
    return result.entries;
  }

  async getSecurityAlerts(startDate: Date, endDate: Date): Promise<AuditLogEntry[]> {
    const result = await this.search({
      eventType: 'security.alert',
      startDate,
      endDate,
      limit: 1000,
    });
    return result.entries;
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.flush();
    await this.client.close();
    console.log(`[${this.serviceName}] Elasticsearch audit logger shutdown`);
  }

  // Convenience logging methods
  async logAuthentication(
    userId: string,
    userName: string,
    result: 'success' | 'failure',
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      eventType: 'authentication',
      action: 'login',
      resourceType: 'session',
      resourceId: userId,
      userId,
      userName,
      result,
      metadata,
    });
  }

  async logPrescriptionAccess(
    action: 'create' | 'read' | 'update' | 'sign' | 'cancel',
    prescriptionId: string,
    userId: string,
    result: 'success' | 'failure',
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      eventType: `prescription.${action}` as AuditEventType,
      action,
      resourceType: 'prescription',
      resourceId: prescriptionId,
      userId,
      result,
      metadata,
    });
  }

  async logDispenseAccess(
    action: 'create' | 'read',
    dispenseId: string,
    userId: string,
    result: 'success' | 'failure',
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      eventType: `dispense.${action}` as AuditEventType,
      action,
      resourceType: 'dispense',
      resourceId: dispenseId,
      userId,
      result,
      metadata,
    });
  }

  async logSecurityAlert(
    message: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      eventType: 'security.alert',
      action: 'alert',
      resourceType: 'security',
      resourceId: `alert-${Date.now()}`,
      result: 'warning',
      errorMessage: message,
      metadata: { severity, ...metadata },
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let loggerInstance: AuditLogger | null = null;

export function getAuditLogger(serviceName?: string): AuditLogger {
  if (!loggerInstance) {
    loggerInstance = new AuditLogger(serviceName || process.env.SERVICE_NAME || 'ndp-service');
  }
  return loggerInstance;
}

// ============================================================================
// Express Middleware
// ============================================================================

import { Request, Response, NextFunction } from 'express';

export function auditMiddleware(
  options?: { excludePaths?: string[] }
): (req: Request, res: Response, next: NextFunction) => void {
  const excludePaths = options?.excludePaths || ['/health', '/ready', '/metrics'];
  const logger = getAuditLogger();

  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip excluded paths
    if (excludePaths.some((path) => req.path.startsWith(path))) {
      return next();
    }

    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string || `req-${Date.now()}`;

    // Capture response
    const originalSend = res.send;
    res.send = function (body): Response {
      const duration = Date.now() - startTime;
      const result: 'success' | 'failure' = res.statusCode < 400 ? 'success' : 'failure';

      // Extract resource info from URL
      const urlParts = req.path.split('/').filter(Boolean);
      let resourceType = urlParts[0] || 'unknown';
      let resourceId = urlParts[1] || '';

      // Map FHIR resources
      if (resourceType === 'fhir' && urlParts[1]) {
        resourceType = urlParts[1];
        resourceId = urlParts[2] || '';
      }

      // Log asynchronously
      logger.log({
        eventType: 'admin.action',
        action: req.method,
        resourceType,
        resourceId,
        userId: (req as any).user?.id,
        userRole: (req as any).user?.role,
        userName: (req as any).user?.name,
        userLicense: (req as any).user?.license,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        requestId,
        correlationId: req.headers['x-correlation-id'] as string,
        duration,
        result,
        statusCode: res.statusCode,
        errorMessage: result === 'failure' ? String(body).slice(0, 500) : undefined,
      }).catch((err) => console.error('Audit logging failed:', err));

      return originalSend.call(this, body);
    };

    next();
  };
}

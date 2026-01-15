/**
 * Elasticsearch Audit Logging Service
 * Centralized audit logging with full-text search
 * National Digital Prescription Platform - Egypt
 */

import { Client, estypes } from '@elastic/elasticsearch';

// ============================================================================
// Configuration
// ============================================================================

const ES_NODE = process.env['ELASTICSEARCH_URL'] || 'http://localhost:9200';
const ES_USERNAME = process.env['ELASTICSEARCH_USERNAME'] || '';
const ES_PASSWORD = process.env['ELASTICSEARCH_PASSWORD'] || '';
const ES_INDEX_PREFIX = process.env['ELASTICSEARCH_INDEX_PREFIX'] || 'ndp';

// ============================================================================
// Index Names
// ============================================================================

export const ES_INDICES = {
  AUDIT_LOGS: `${ES_INDEX_PREFIX}-audit-logs`,
  ACCESS_LOGS: `${ES_INDEX_PREFIX}-access-logs`,
  COMPLIANCE_ALERTS: `${ES_INDEX_PREFIX}-compliance-alerts`,
  ERROR_LOGS: `${ES_INDEX_PREFIX}-error-logs`,
  PRESCRIPTION_ANALYTICS: `${ES_INDEX_PREFIX}-prescription-analytics`,
  DISPENSE_ANALYTICS: `${ES_INDEX_PREFIX}-dispense-analytics`,
} as const;

// ============================================================================
// Document Types
// ============================================================================

export interface AuditLogDocument {
  '@timestamp': string;
  eventId: string;
  action: string;
  category: 'authentication' | 'authorization' | 'data_access' | 'data_modification' | 'system' | 'compliance';
  resourceType: string;
  resourceId: string;
  actor: {
    id: string;
    name: string;
    role: string;
    license?: string;
    type: 'physician' | 'pharmacist' | 'patient' | 'regulator' | 'system';
  };
  request?: {
    method: string;
    path: string;
    ipAddress: string;
    userAgent: string;
    sessionId?: string;
  };
  outcome: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  duration?: number;
  facility?: {
    id: string;
    name: string;
    type: 'clinic' | 'hospital' | 'pharmacy' | 'regulator';
    governorate?: string;
  };
  patient?: {
    nationalIdHash: string;
    ageGroup?: string;
  };
  prescription?: {
    prescriptionNumber: string;
    status: string;
    medicationCount: number;
  };
  details?: Record<string, unknown>;
  tags?: string[];
}

export interface AccessLogDocument {
  '@timestamp': string;
  requestId: string;
  method: string;
  path: string;
  query?: string;
  statusCode: number;
  responseTime: number;
  bytesIn?: number;
  bytesOut?: number;
  ipAddress: string;
  userAgent: string;
  userId?: string;
  userRole?: string;
  sessionId?: string;
  errorMessage?: string;
  service: string;
}

export interface ComplianceAlertDocument {
  '@timestamp': string;
  alertId: string;
  alertType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  entityType: 'physician' | 'pharmacist' | 'pharmacy' | 'patient';
  entityId: string;
  entityName: string;
  description: string;
  metrics?: Record<string, number>;
  threshold?: number;
  actualValue?: number;
  assignedTo?: string;
  resolvedAt?: string;
  resolution?: string;
  relatedResources?: Array<{
    type: string;
    id: string;
  }>;
}

export interface PrescriptionAnalyticsDocument {
  '@timestamp': string;
  prescriptionId: string;
  prescriptionNumber: string;
  status: string;
  physicianLicense: string;
  physicianSpecialty?: string;
  facilityId: string;
  facilityType: string;
  governorate: string;
  patientAgeGroup: string;
  patientGender?: string;
  medicationCount: number;
  medications: Array<{
    edaCode: string;
    category: string;
    isControlled: boolean;
  }>;
  hasAIWarnings: boolean;
  warningTypes?: string[];
  totalValue?: number;
  insuranceCovered: boolean;
}

// ============================================================================
// Elasticsearch Service Class
// ============================================================================

export class ElasticsearchAuditService {
  private client: Client;
  private initialized = false;

  constructor() {
    this.client = new Client({
      node: ES_NODE,
      auth: ES_USERNAME && ES_PASSWORD ? {
        username: ES_USERNAME,
        password: ES_PASSWORD,
      } : undefined,
      tls: {
        rejectUnauthorized: process.env['NODE_ENV'] === 'production',
      },
      maxRetries: 3,
      requestTimeout: 30000,
    });
  }

  /**
   * Initialize indices with mappings
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Check connection
      await this.client.ping();
      console.log('[Elasticsearch] Connection established');

      // Create audit logs index
      await this.createIndexIfNotExists(ES_INDICES.AUDIT_LOGS, {
        properties: {
          '@timestamp': { type: 'date' },
          eventId: { type: 'keyword' },
          action: { type: 'keyword' },
          category: { type: 'keyword' },
          resourceType: { type: 'keyword' },
          resourceId: { type: 'keyword' },
          actor: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              role: { type: 'keyword' },
              license: { type: 'keyword' },
              type: { type: 'keyword' },
            },
          },
          request: {
            properties: {
              method: { type: 'keyword' },
              path: { type: 'keyword' },
              ipAddress: { type: 'ip' },
              userAgent: { type: 'text' },
              sessionId: { type: 'keyword' },
            },
          },
          outcome: { type: 'keyword' },
          errorCode: { type: 'keyword' },
          errorMessage: { type: 'text' },
          duration: { type: 'integer' },
          facility: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              type: { type: 'keyword' },
              governorate: { type: 'keyword' },
            },
          },
          patient: {
            properties: {
              nationalIdHash: { type: 'keyword' },
              ageGroup: { type: 'keyword' },
            },
          },
          prescription: {
            properties: {
              prescriptionNumber: { type: 'keyword' },
              status: { type: 'keyword' },
              medicationCount: { type: 'integer' },
            },
          },
          details: { type: 'object', enabled: true },
          tags: { type: 'keyword' },
        },
      });

      // Create access logs index
      await this.createIndexIfNotExists(ES_INDICES.ACCESS_LOGS, {
        properties: {
          '@timestamp': { type: 'date' },
          requestId: { type: 'keyword' },
          method: { type: 'keyword' },
          path: { type: 'keyword' },
          query: { type: 'text' },
          statusCode: { type: 'integer' },
          responseTime: { type: 'integer' },
          bytesIn: { type: 'integer' },
          bytesOut: { type: 'integer' },
          ipAddress: { type: 'ip' },
          userAgent: { type: 'text' },
          userId: { type: 'keyword' },
          userRole: { type: 'keyword' },
          sessionId: { type: 'keyword' },
          errorMessage: { type: 'text' },
          service: { type: 'keyword' },
        },
      });

      // Create compliance alerts index
      await this.createIndexIfNotExists(ES_INDICES.COMPLIANCE_ALERTS, {
        properties: {
          '@timestamp': { type: 'date' },
          alertId: { type: 'keyword' },
          alertType: { type: 'keyword' },
          severity: { type: 'keyword' },
          status: { type: 'keyword' },
          entityType: { type: 'keyword' },
          entityId: { type: 'keyword' },
          entityName: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          description: { type: 'text' },
          metrics: { type: 'object', enabled: true },
          threshold: { type: 'float' },
          actualValue: { type: 'float' },
          assignedTo: { type: 'keyword' },
          resolvedAt: { type: 'date' },
          resolution: { type: 'text' },
          relatedResources: {
            type: 'nested',
            properties: {
              type: { type: 'keyword' },
              id: { type: 'keyword' },
            },
          },
        },
      });

      this.initialized = true;
      console.log('[Elasticsearch] Indices initialized');
    } catch (error) {
      console.error('[Elasticsearch] Initialization failed:', error);
      throw error;
    }
  }

  private async createIndexIfNotExists(index: string, mappings: estypes.MappingTypeMapping): Promise<void> {
    const exists = await this.client.indices.exists({ index });
    if (!exists) {
      await this.client.indices.create({
        index,
        body: {
          settings: {
            number_of_shards: 3,
            number_of_replicas: 1,
            'index.lifecycle.name': 'ndp-audit-policy',
          },
          mappings,
        },
      });
      console.log(`[Elasticsearch] Created index: ${index}`);
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    await this.client.close();
    console.log('[Elasticsearch] Connection closed');
  }

  // ============================================================================
  // Audit Logging Methods
  // ============================================================================

  /**
   * Log audit event
   */
  async logAudit(doc: Omit<AuditLogDocument, '@timestamp' | 'eventId'>): Promise<string> {
    const document: AuditLogDocument = {
      '@timestamp': new Date().toISOString(),
      eventId: crypto.randomUUID(),
      ...doc,
    };

    const result = await this.client.index({
      index: ES_INDICES.AUDIT_LOGS,
      document,
      refresh: false,
    });

    return result._id;
  }

  /**
   * Log access request
   */
  async logAccess(doc: Omit<AccessLogDocument, '@timestamp' | 'requestId'>): Promise<void> {
    const document: AccessLogDocument = {
      '@timestamp': new Date().toISOString(),
      requestId: crypto.randomUUID(),
      ...doc,
    };

    await this.client.index({
      index: ES_INDICES.ACCESS_LOGS,
      document,
      refresh: false,
    });
  }

  /**
   * Log compliance alert
   */
  async logComplianceAlert(doc: Omit<ComplianceAlertDocument, '@timestamp'>): Promise<string> {
    const document: ComplianceAlertDocument = {
      '@timestamp': new Date().toISOString(),
      ...doc,
    };

    const result = await this.client.index({
      index: ES_INDICES.COMPLIANCE_ALERTS,
      id: doc.alertId,
      document,
      refresh: true,
    });

    return result._id;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Search audit logs
   */
  async searchAuditLogs(params: {
    action?: string;
    category?: string;
    resourceType?: string;
    resourceId?: string;
    actorId?: string;
    actorRole?: string;
    outcome?: string;
    fromDate?: string;
    toDate?: string;
    governorate?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ total: number; logs: AuditLogDocument[] }> {
    const must: estypes.QueryDslQueryContainer[] = [];
    const filter: estypes.QueryDslQueryContainer[] = [];

    if (params.action) filter.push({ term: { action: params.action } });
    if (params.category) filter.push({ term: { category: params.category } });
    if (params.resourceType) filter.push({ term: { resourceType: params.resourceType } });
    if (params.resourceId) filter.push({ term: { resourceId: params.resourceId } });
    if (params.actorId) filter.push({ term: { 'actor.id': params.actorId } });
    if (params.actorRole) filter.push({ term: { 'actor.role': params.actorRole } });
    if (params.outcome) filter.push({ term: { outcome: params.outcome } });
    if (params.governorate) filter.push({ term: { 'facility.governorate': params.governorate } });

    if (params.fromDate || params.toDate) {
      filter.push({
        range: {
          '@timestamp': {
            ...(params.fromDate && { gte: params.fromDate }),
            ...(params.toDate && { lte: params.toDate }),
          },
        },
      });
    }

    const page = params.page || 1;
    const pageSize = params.pageSize || 50;

    const result = await this.client.search<AuditLogDocument>({
      index: ES_INDICES.AUDIT_LOGS,
      body: {
        query: {
          bool: {
            must: must.length > 0 ? must : [{ match_all: {} }],
            filter,
          },
        },
        sort: [{ '@timestamp': { order: 'desc' } }],
        from: (page - 1) * pageSize,
        size: pageSize,
      },
    });

    const total = typeof result.hits.total === 'number'
      ? result.hits.total
      : result.hits.total?.value || 0;

    return {
      total,
      logs: result.hits.hits.map(hit => hit._source!),
    };
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(fromDate: string, toDate: string): Promise<{
    totalEvents: number;
    byAction: Record<string, number>;
    byOutcome: Record<string, number>;
    byCategory: Record<string, number>;
    byActorRole: Record<string, number>;
    byGovernorate: Record<string, number>;
    timeline: Array<{ date: string; count: number }>;
  }> {
    const result = await this.client.search({
      index: ES_INDICES.AUDIT_LOGS,
      body: {
        query: {
          range: {
            '@timestamp': { gte: fromDate, lte: toDate },
          },
        },
        size: 0,
        aggs: {
          by_action: { terms: { field: 'action', size: 50 } },
          by_outcome: { terms: { field: 'outcome', size: 10 } },
          by_category: { terms: { field: 'category', size: 10 } },
          by_actor_role: { terms: { field: 'actor.role', size: 10 } },
          by_governorate: { terms: { field: 'facility.governorate', size: 30 } },
          timeline: {
            date_histogram: {
              field: '@timestamp',
              calendar_interval: 'day',
            },
          },
        },
      },
    });

    const aggs = result.aggregations as Record<string, any>;
    const total = typeof result.hits.total === 'number'
      ? result.hits.total
      : result.hits.total?.value || 0;

    const bucketsToRecord = (buckets: any[] = []) =>
      buckets.reduce((acc, b) => ({ ...acc, [b.key]: b.doc_count }), {});

    return {
      totalEvents: total,
      byAction: bucketsToRecord(aggs.by_action?.buckets),
      byOutcome: bucketsToRecord(aggs.by_outcome?.buckets),
      byCategory: bucketsToRecord(aggs.by_category?.buckets),
      byActorRole: bucketsToRecord(aggs.by_actor_role?.buckets),
      byGovernorate: bucketsToRecord(aggs.by_governorate?.buckets),
      timeline: (aggs.timeline?.buckets || []).map((b: any) => ({
        date: b.key_as_string,
        count: b.doc_count,
      })),
    };
  }

  /**
   * Search compliance alerts
   */
  async searchComplianceAlerts(params: {
    status?: string;
    severity?: string;
    alertType?: string;
    entityType?: string;
    entityId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<ComplianceAlertDocument[]> {
    const filter: estypes.QueryDslQueryContainer[] = [];

    if (params.status) filter.push({ term: { status: params.status } });
    if (params.severity) filter.push({ term: { severity: params.severity } });
    if (params.alertType) filter.push({ term: { alertType: params.alertType } });
    if (params.entityType) filter.push({ term: { entityType: params.entityType } });
    if (params.entityId) filter.push({ term: { entityId: params.entityId } });

    if (params.fromDate || params.toDate) {
      filter.push({
        range: {
          '@timestamp': {
            ...(params.fromDate && { gte: params.fromDate }),
            ...(params.toDate && { lte: params.toDate }),
          },
        },
      });
    }

    const result = await this.client.search<ComplianceAlertDocument>({
      index: ES_INDICES.COMPLIANCE_ALERTS,
      body: {
        query: {
          bool: {
            filter: filter.length > 0 ? filter : [{ match_all: {} }],
          },
        },
        sort: [{ '@timestamp': { order: 'desc' } }],
        size: 100,
      },
    });

    return result.hits.hits.map(hit => hit._source!);
  }

  /**
   * Update compliance alert status
   */
  async updateAlertStatus(
    alertId: string,
    status: 'investigating' | 'resolved' | 'dismissed',
    resolution?: string,
    assignedTo?: string
  ): Promise<void> {
    await this.client.update({
      index: ES_INDICES.COMPLIANCE_ALERTS,
      id: alertId,
      body: {
        doc: {
          status,
          ...(resolution && { resolution }),
          ...(assignedTo && { assignedTo }),
          ...(status === 'resolved' && { resolvedAt: new Date().toISOString() }),
        },
      },
    });
  }

  /**
   * Get actor activity report
   */
  async getActorActivity(actorId: string, fromDate: string, toDate: string): Promise<{
    totalActions: number;
    successRate: number;
    actionBreakdown: Record<string, number>;
    dailyActivity: Array<{ date: string; count: number }>;
    topResources: Array<{ resourceType: string; count: number }>;
  }> {
    const result = await this.client.search({
      index: ES_INDICES.AUDIT_LOGS,
      body: {
        query: {
          bool: {
            filter: [
              { term: { 'actor.id': actorId } },
              { range: { '@timestamp': { gte: fromDate, lte: toDate } } },
            ],
          },
        },
        size: 0,
        aggs: {
          outcomes: { terms: { field: 'outcome' } },
          actions: { terms: { field: 'action', size: 20 } },
          daily: {
            date_histogram: {
              field: '@timestamp',
              calendar_interval: 'day',
            },
          },
          resources: { terms: { field: 'resourceType', size: 10 } },
        },
      },
    });

    const aggs = result.aggregations as Record<string, any>;
    const total = typeof result.hits.total === 'number'
      ? result.hits.total
      : result.hits.total?.value || 0;

    const outcomes = aggs.outcomes?.buckets || [];
    const successBucket = outcomes.find((b: any) => b.key === 'success');
    const successCount = successBucket?.doc_count || 0;

    return {
      totalActions: total,
      successRate: total > 0 ? (successCount / total) * 100 : 0,
      actionBreakdown: (aggs.actions?.buckets || []).reduce(
        (acc: any, b: any) => ({ ...acc, [b.key]: b.doc_count }),
        {}
      ),
      dailyActivity: (aggs.daily?.buckets || []).map((b: any) => ({
        date: b.key_as_string,
        count: b.doc_count,
      })),
      topResources: (aggs.resources?.buckets || []).map((b: any) => ({
        resourceType: b.key,
        count: b.doc_count,
      })),
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ElasticsearchAuditService | null = null;

export function getElasticsearchService(): ElasticsearchAuditService {
  if (!instance) {
    instance = new ElasticsearchAuditService();
  }
  return instance;
}

export async function initElasticsearch(): Promise<ElasticsearchAuditService> {
  const service = getElasticsearchService();
  await service.initialize();
  return service;
}

export async function shutdownElasticsearch(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

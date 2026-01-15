/**
 * NDP Database Client with PgBouncer Support
 * Provides connection pooling through PgBouncer for high-scale deployments
 */

import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

// ============================================================================
// Types
// ============================================================================

export interface DatabaseConfig {
  // Direct connection (for development/testing)
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  
  // PgBouncer connection (for production)
  usePgBouncer?: boolean;
  pgBouncerHost?: string;
  pgBouncerPort?: number;
  
  // Pool settings
  maxConnections?: number;
  minConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  
  // SSL settings
  ssl?: boolean | { rejectUnauthorized: boolean };
}

export interface QueryOptions {
  timeout?: number;
  name?: string; // For prepared statements
}

// ============================================================================
// Configuration
// ============================================================================

const getDefaultConfig = (): DatabaseConfig => ({
  // Direct connection defaults
  host: process.env.DB_HOST || 'postgresql',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'ndp',
  user: process.env.DB_USER || 'ndp',
  password: process.env.DB_PASSWORD || 'CHANGE_ME_IN_PRODUCTION',
  
  // PgBouncer defaults
  usePgBouncer: process.env.USE_PGBOUNCER === 'true',
  pgBouncerHost: process.env.PGBOUNCER_HOST || 'pgbouncer',
  pgBouncerPort: parseInt(process.env.PGBOUNCER_PORT || '6432', 10),
  
  // Pool defaults
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  minConnections: parseInt(process.env.DB_MIN_CONNECTIONS || '5', 10),
  idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000', 10),
  
  // SSL
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// ============================================================================
// Database Client Class
// ============================================================================

export class DatabaseClient {
  private pool: Pool;
  private serviceName: string;
  private config: DatabaseConfig;
  private isConnected: boolean = false;

  constructor(serviceName: string, config?: Partial<DatabaseConfig>) {
    this.serviceName = serviceName;
    this.config = { ...getDefaultConfig(), ...config };
    
    const poolConfig = this.buildPoolConfig();
    this.pool = new Pool(poolConfig);
    
    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error(`[${this.serviceName}] Database pool error:`, err);
    });
    
    this.pool.on('connect', () => {
      if (!this.isConnected) {
        this.isConnected = true;
        const target = this.config.usePgBouncer ? 'PgBouncer' : 'PostgreSQL';
        console.log(`[${this.serviceName}] Connected to ${target}`);
      }
    });
  }

  private buildPoolConfig(): PoolConfig {
    const { usePgBouncer, pgBouncerHost, pgBouncerPort, ...baseConfig } = this.config;
    
    // Use PgBouncer in production
    const host = usePgBouncer ? pgBouncerHost : baseConfig.host;
    const port = usePgBouncer ? pgBouncerPort : baseConfig.port;
    
    return {
      host,
      port,
      database: baseConfig.database,
      user: baseConfig.user,
      password: baseConfig.password,
      max: baseConfig.maxConnections,
      min: baseConfig.minConnections,
      idleTimeoutMillis: baseConfig.idleTimeoutMs,
      connectionTimeoutMillis: baseConfig.connectionTimeoutMs,
      ssl: baseConfig.ssl,
      // Application name for monitoring
      application_name: this.serviceName,
      // Statement timeout (30 seconds default)
      statement_timeout: 30000,
    };
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.release();
      console.log(`[${this.serviceName}] Database connection verified`);
    } catch (error) {
      console.error(`[${this.serviceName}] Failed to connect to database:`, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      console.log(`[${this.serviceName}] Database connection closed`);
    } catch (error) {
      console.error(`[${this.serviceName}] Error closing database connection:`, error);
    }
  }

  async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[],
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    
    try {
      const result = await this.pool.query<T>({
        text,
        values: params,
        name: options?.name,
      });
      
      const duration = Date.now() - start;
      
      if (duration > 1000) {
        console.warn(`[${this.serviceName}] Slow query (${duration}ms):`, text.slice(0, 100));
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`[${this.serviceName}] Query failed (${duration}ms):`, error);
      throw error;
    }
  }

  async queryOne<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] || null;
  }

  async queryAll<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  async transaction<T>(
    callback: (client: TransactionClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const transactionClient = new TransactionClient(client, this.serviceName);
      const result = await callback(transactionClient);
      
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Health check for Kubernetes probes
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    
    try {
      await this.pool.query('SELECT 1');
      return {
        healthy: true,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Pool statistics for monitoring
  getPoolStats(): {
    total: number;
    idle: number;
    waiting: number;
  } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }
}

// ============================================================================
// Transaction Client
// ============================================================================

export class TransactionClient {
  constructor(
    private client: any,
    private serviceName: string
  ) {}

  async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    
    try {
      const result = await this.client.query<T>(text, params);
      const duration = Date.now() - start;
      
      if (duration > 1000) {
        console.warn(`[${this.serviceName}] Slow transaction query (${duration}ms):`, text.slice(0, 100));
      }
      
      return result;
    } catch (error) {
      console.error(`[${this.serviceName}] Transaction query failed:`, error);
      throw error;
    }
  }

  async queryOne<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] || null;
  }

  async queryAll<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  // Savepoint support for nested transactions
  async savepoint(name: string): Promise<void> {
    await this.client.query(`SAVEPOINT ${name}`);
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.client.query(`RELEASE SAVEPOINT ${name}`);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let dbInstance: DatabaseClient | null = null;

export function getDatabase(serviceName?: string, config?: Partial<DatabaseConfig>): DatabaseClient {
  if (!dbInstance) {
    dbInstance = new DatabaseClient(
      serviceName || process.env.SERVICE_NAME || 'ndp-service',
      config
    );
  }
  return dbInstance;
}

// ============================================================================
// Migration Helper
// ============================================================================

export async function runMigrations(db: DatabaseClient, migrationsDir: string): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  
  // Create migrations table if not exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  
  // Get applied migrations
  const appliedResult = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  const appliedVersions = new Set(appliedResult.rows.map((r) => r.version));
  
  // Get migration files
  const files = fs.readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();
  
  for (const file of files) {
    const version = file.replace('.sql', '');
    
    if (appliedVersions.has(version)) {
      console.log(`Migration ${version} already applied`);
      continue;
    }
    
    console.log(`Applying migration ${version}...`);
    
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    
    await db.transaction(async (tx) => {
      await tx.query(sql);
      await tx.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version]
      );
    });
    
    console.log(`Migration ${version} applied successfully`);
  }
}

// ============================================================================
// FHIR JSON Helpers
// ============================================================================

export const fhirJsonHelpers = {
  // Extract value from JSONB path
  extractPath: (column: string, ...path: string[]): string => {
    const jsonPath = path.map((p) => `'${p}'`).join('->');
    return `${column}->${jsonPath}`;
  },
  
  // Extract text value from JSONB path
  extractText: (column: string, ...path: string[]): string => {
    const jsonPath = path.slice(0, -1).map((p) => `'${p}'`).join('->');
    const lastPath = path[path.length - 1];
    return jsonPath 
      ? `${column}->${jsonPath}->>'${lastPath}'`
      : `${column}->>'${lastPath}'`;
  },
  
  // Search in JSONB array
  arrayContains: (column: string, value: string): string => {
    return `${column} @> '["${value}"]'::jsonb`;
  },
  
  // Search for key existence
  hasKey: (column: string, key: string): string => {
    return `${column} ? '${key}'`;
  },
};

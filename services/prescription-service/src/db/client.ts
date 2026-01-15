/**
 * Database Client - Prescription Service
 */

import pg from 'pg';
import { AppConfig } from '../../../shared/config/index.js';
import { createLogger } from '../../../shared/utils/index.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
const logger = createLogger('prescription-service:db');

export async function initDatabase(config: AppConfig): Promise<pg.Pool> {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    min: config.database.poolMin,
    max: config.database.poolMax,
  });

  // Test connection
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    logger.info('Database connection established', {
      host: config.database.host,
      database: config.database.database,
    });
  } catch (error) {
    logger.error('Failed to connect to database', error);
    throw error;
  }

  // Handle pool errors
  pool.on('error', (err) => {
    logger.error('Unexpected database pool error', err);
  });

  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return pool;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection closed');
  }
}

// Transaction helper
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

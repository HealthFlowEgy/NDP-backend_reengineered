/**
 * Shared Configuration - NDP Backend
 * Environment-based configuration with defaults
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  poolMin: number;
  poolMax: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
}

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  groupId: string;
  ssl: boolean;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenExpiresIn: string;
  sunbirdRcUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  keycloakClientSecret: string;
}

export interface AIValidationConfig {
  enabled: boolean;
  url: string;
  timeout: number;
  skipOnError: boolean;
}

export interface AppConfig {
  env: 'development' | 'staging' | 'production';
  port: number;
  serviceName: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  corsOrigins: string[];
  rateLimitPerMinute: number;
  database: DatabaseConfig;
  redis: RedisConfig;
  kafka: KafkaConfig;
  auth: AuthConfig;
  aiValidation: AIValidationConfig;
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

function getEnvInt(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${key} is required`);
  }
  return parseInt(value, 10);
}

function getEnvBool(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${key} is required`);
  }
  return value.toLowerCase() === 'true';
}

export function loadConfig(serviceName: string): AppConfig {
  return {
    env: getEnv('NODE_ENV', 'development') as AppConfig['env'],
    port: getEnvInt('PORT', 3000),
    serviceName,
    logLevel: getEnv('LOG_LEVEL', 'info') as AppConfig['logLevel'],
    corsOrigins: getEnv('CORS_ORIGINS', '*').split(','),
    rateLimitPerMinute: getEnvInt('RATE_LIMIT_PER_MINUTE', 60),
    
    database: {
      host: getEnv('DB_HOST', 'localhost'),
      port: getEnvInt('DB_PORT', 5432),
      database: getEnv('DB_NAME', 'ndp'),
      user: getEnv('DB_USER', 'ndp'),
      password: getEnv('DB_PASSWORD', 'ndp_password'),
      ssl: getEnvBool('DB_SSL', false),
      poolMin: getEnvInt('DB_POOL_MIN', 2),
      poolMax: getEnvInt('DB_POOL_MAX', 10),
    },
    
    redis: {
      host: getEnv('REDIS_HOST', 'localhost'),
      port: getEnvInt('REDIS_PORT', 6379),
      password: process.env['REDIS_PASSWORD'],
      db: getEnvInt('REDIS_DB', 0),
      keyPrefix: getEnv('REDIS_KEY_PREFIX', 'ndp:'),
    },
    
    kafka: {
      brokers: getEnv('KAFKA_BROKERS', 'localhost:9092').split(','),
      clientId: getEnv('KAFKA_CLIENT_ID', serviceName),
      groupId: getEnv('KAFKA_GROUP_ID', `${serviceName}-group`),
      ssl: getEnvBool('KAFKA_SSL', false),
    },
    
    auth: {
      jwtSecret: getEnv('JWT_SECRET', 'development-secret-change-in-production'),
      jwtExpiresIn: getEnv('JWT_EXPIRES_IN', '1h'),
      refreshTokenExpiresIn: getEnv('REFRESH_TOKEN_EXPIRES_IN', '7d'),
      sunbirdRcUrl: getEnv('SUNBIRD_RC_URL', 'http://localhost:8081'),
      keycloakUrl: getEnv('KEYCLOAK_URL', 'http://localhost:8080'),
      keycloakRealm: getEnv('KEYCLOAK_REALM', 'ndp'),
      keycloakClientId: getEnv('KEYCLOAK_CLIENT_ID', 'ndp-backend'),
      keycloakClientSecret: getEnv('KEYCLOAK_CLIENT_SECRET', ''),
    },
    
    aiValidation: {
      enabled: getEnvBool('AI_VALIDATION_ENABLED', true),
      url: getEnv('AI_VALIDATION_URL', 'http://67.207.74.0'),
      timeout: getEnvInt('AI_VALIDATION_TIMEOUT', 5000),
      skipOnError: getEnvBool('AI_VALIDATION_SKIP_ON_ERROR', true),
    },
  };
}

// Egyptian-specific constants
export const EgyptianConstants = {
  // National ID format: 14 digits
  NATIONAL_ID_REGEX: /^[0-9]{14}$/,
  
  // EDA (Egyptian Drug Authority) code format
  EDA_CODE_REGEX: /^[0-9]{1,10}$/,
  
  // Prescription number format: RX-YYYY-XXXXXXXX
  PRESCRIPTION_NUMBER_PREFIX: 'RX',
  
  // Default prescription validity in days
  DEFAULT_PRESCRIPTION_VALIDITY_DAYS: 30,
  
  // Default allowed dispenses
  DEFAULT_ALLOWED_DISPENSES: 1,
  
  // Maximum allowed dispenses for controlled substances
  MAX_DISPENSES_CONTROLLED: 1,
  MAX_DISPENSES_REGULAR: 3,
  MAX_DISPENSES_CHRONIC: 12,
  
  // FHIR Coding Systems
  CODING_SYSTEMS: {
    EDA: 'http://eda.mohp.gov.eg/medications',
    SNOMED_CT: 'http://snomed.info/sct',
    ICD10: 'http://hl7.org/fhir/sid/icd-10',
    UCUM: 'http://unitsofmeasure.org',
    NDP_PRESCRIPTION: 'http://ndp.egypt.gov.eg/fhir/prescription-id',
    NDP_DISPENSE: 'http://ndp.egypt.gov.eg/fhir/dispense-id',
  },
  
  // Organization OIDs
  OIDS: {
    EDA: '2.16.818.1.113883.3.7.1',
    MOHP: '2.16.818.1.113883.3.7',
    NDP: '2.16.818.1.113883.3.7.2',
  },
} as const;

// Kafka topic names
export const KafkaTopics = {
  PRESCRIPTION_CREATED: 'ndp.prescription.created',
  PRESCRIPTION_SIGNED: 'ndp.prescription.signed',
  PRESCRIPTION_CANCELLED: 'ndp.prescription.cancelled',
  PRESCRIPTION_EXPIRED: 'ndp.prescription.expired',
  DISPENSE_CREATED: 'ndp.dispense.created',
  DISPENSE_COMPLETED: 'ndp.dispense.completed',
  DISPENSE_CANCELLED: 'ndp.dispense.cancelled',
  MEDICATION_UPDATED: 'ndp.medication.updated',
  MEDICATION_RECALLED: 'ndp.medication.recalled',
  AUDIT_LOG: 'ndp.audit.log',
} as const;

// Redis key patterns
export const RedisKeys = {
  SESSION: (userId: string) => `session:${userId}`,
  PRESCRIPTION: (id: string) => `prescription:${id}`,
  MEDICATION: (edaCode: string) => `medication:${edaCode}`,
  RATE_LIMIT: (userId: string, endpoint: string) => `ratelimit:${userId}:${endpoint}`,
  CACHE_MEDICATION_SEARCH: (query: string) => `cache:medication:search:${query}`,
} as const;

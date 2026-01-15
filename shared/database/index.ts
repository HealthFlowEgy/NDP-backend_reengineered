/**
 * NDP Database Module
 * Re-exports all database-related functionality
 */

export {
  // Types
  DatabaseConfig,
  QueryOptions,
  
  // Classes
  DatabaseClient,
  TransactionClient,
  
  // Functions
  getDatabase,
  runMigrations,
  
  // Helpers
  fhirJsonHelpers,
} from './client';

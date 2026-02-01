import { loadConfig } from '../../../../shared/config/index.js';

export const config = loadConfig('auth-service');

export const KEYCLOAK_CONFIG = {
  url: config.auth.keycloakUrl,
  realm: config.auth.keycloakRealm,
  clientId: config.auth.keycloakClientId,
  clientSecret: config.auth.keycloakClientSecret,
};

export const SUNBIRD_RC_CONFIG = {
  url: config.auth.sunbirdRcUrl,
  hprEndpoint: '/api/v1/HealthcareProfessional',
  credentialEndpoint: '/api/v1/credentials',
  signingEndpoint: '/api/v1/signatures',
};

export const JWT_CONFIG = {
  secret: config.auth.jwtSecret,
  expiresIn: config.auth.jwtExpiresIn,
  refreshExpiresIn: config.auth.refreshTokenExpiresIn,
  algorithm: 'HS256' as const,
};

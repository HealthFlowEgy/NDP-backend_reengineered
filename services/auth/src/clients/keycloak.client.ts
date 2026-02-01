import { KEYCLOAK_CONFIG } from '../config/index.js';
import { NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';
import { createLogger } from '../../../../shared/utils/index.js';

const logger = createLogger('auth-service:keycloak');

export interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
  scope: string;
}

export interface KeycloakUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  preferred_username: string;
  name: string;
  given_name: string;
  family_name: string;
  realm_access?: {
    roles: string[];
  };
}

export class KeycloakClient {
  private baseUrl: string;
  private realm: string;
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.baseUrl = KEYCLOAK_CONFIG.url;
    this.realm = KEYCLOAK_CONFIG.realm;
    this.clientId = KEYCLOAK_CONFIG.clientId;
    this.clientSecret = KEYCLOAK_CONFIG.clientSecret;
  }

  private get tokenEndpoint(): string {
    return `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`;
  }

  private get userInfoEndpoint(): string {
    return `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/userinfo`;
  }

  async authenticate(username: string, password: string): Promise<KeycloakTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username,
      password,
      scope: 'openid profile email',
    });

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      if (!response.ok) {
        const error = await response.json();
        logger.error('Keycloak authentication failed', { error });
        throw new NDPError(ErrorCodes.UNAUTHORIZED, 'Invalid credentials', 401);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Keycloak connection error', error);
      throw new NDPError(ErrorCodes.SERVICE_UNAVAILABLE, 'Authentication service unavailable', 503);
    }
  }

  async refreshToken(refreshToken: string): Promise<KeycloakTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      if (!response.ok) {
        throw new NDPError(ErrorCodes.TOKEN_EXPIRED, 'Refresh token expired', 401);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Token refresh error', error);
      throw new NDPError(ErrorCodes.SERVICE_UNAVAILABLE, 'Authentication service unavailable', 503);
    }
  }

  async getUserInfo(accessToken: string): Promise<KeycloakUserInfo> {
    try {
      const response = await fetch(this.userInfoEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new NDPError(ErrorCodes.INVALID_TOKEN, 'Invalid access token', 401);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof NDPError) throw error;
      logger.error('Get user info error', error);
      throw new NDPError(ErrorCodes.SERVICE_UNAVAILABLE, 'Authentication service unavailable', 503);
    }
  }

  async logout(refreshToken: string): Promise<void> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });

    try {
      await fetch(
        `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/logout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        }
      );
    } catch (error) {
      logger.error('Logout error', error);
    }
  }
}

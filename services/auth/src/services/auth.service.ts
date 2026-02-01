import { KeycloakClient, KeycloakUserInfo } from '../clients/keycloak.client.js';
import { SunbirdRCClient, PractitionerInfo, SignatureResponse } from '../clients/sunbird.client.js';
import { TokenService } from './token.service.js';
import { AuthToken, AuthUser, UserRole, NDPError, ErrorCodes } from '../../../../shared/types/ndp.types.js';
import { createLogger } from '../../../../shared/utils/index.js';

const logger = createLogger('auth-service');

const keycloakClient = new KeycloakClient();
const sunbirdClient = new SunbirdRCClient();
const tokenService = new TokenService();

export class AuthService {
  async login(username: string, password: string): Promise<AuthToken> {
    const keycloakToken = await keycloakClient.authenticate(username, password);
    const userInfo = await keycloakClient.getUserInfo(keycloakToken.access_token);

    const licenseNumber = this.extractLicenseNumber(userInfo);
    let practitionerInfo: PractitionerInfo | null = null;

    if (licenseNumber) {
      practitionerInfo = await sunbirdClient.getPractitionerInfo(licenseNumber);
      
      if (practitionerInfo) {
        const verification = await sunbirdClient.verifyCredential(practitionerInfo.credentialId);
        if (!verification.verified) {
          throw new NDPError(ErrorCodes.CERTIFICATE_EXPIRED, `Practitioner credential is not valid: ${verification.reason}`, 403);
        }
        if (practitionerInfo.status !== 'active') {
          throw new NDPError(ErrorCodes.FORBIDDEN, `Practitioner license is ${practitionerInfo.status}`, 403);
        }
      }
    }

    const user: AuthUser = {
      id: userInfo.sub,
      license: practitionerInfo?.license || licenseNumber || userInfo.preferred_username,
      name: practitionerInfo?.name || userInfo.name,
      role: this.mapRole(userInfo.realm_access?.roles || []),
      specialty: practitionerInfo?.specialty,
      facilityId: practitionerInfo?.facilityId,
      facilityName: practitionerInfo?.facilityName,
      scopes: this.getScopesForRole(this.mapRole(userInfo.realm_access?.roles || [])),
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const token = tokenService.generateToken(user);
    logger.info('User logged in', { userId: user.id, license: user.license, role: user.role });
    return token;
  }

  async refreshToken(refreshToken: string): Promise<AuthToken> {
    const user = tokenService.verifyToken(refreshToken);
    if (!user) throw new NDPError(ErrorCodes.TOKEN_EXPIRED, 'Invalid or expired refresh token', 401);

    if (user.license) {
      const practitionerInfo = await sunbirdClient.getPractitionerInfo(user.license);
      if (practitionerInfo && practitionerInfo.status !== 'active') {
        throw new NDPError(ErrorCodes.FORBIDDEN, `Practitioner license is ${practitionerInfo.status}`, 403);
      }
    }

    return tokenService.generateToken(user);
  }

  verifyToken(token: string): AuthUser {
    const user = tokenService.verifyToken(token);
    if (!user) throw new NDPError(ErrorCodes.INVALID_TOKEN, 'Invalid or expired token', 401);
    return user;
  }

  async getPractitionerInfo(licenseNumber: string): Promise<PractitionerInfo> {
    const info = await sunbirdClient.getPractitionerInfo(licenseNumber);
    if (!info) throw new NDPError(ErrorCodes.CERTIFICATE_NOT_FOUND, 'Practitioner not found', 404);
    return info;
  }

  async signDocument(documentHash: string, documentType: 'prescription' | 'dispense', user: AuthUser): Promise<SignatureResponse> {
    if (!user.scopes.includes(`${documentType}.sign`)) {
      throw new NDPError(ErrorCodes.FORBIDDEN, `No permission to sign ${documentType}`, 403);
    }

    const practitionerInfo = await sunbirdClient.getPractitionerInfo(user.license);
    if (!practitionerInfo || practitionerInfo.status !== 'active') {
      throw new NDPError(ErrorCodes.CERTIFICATE_EXPIRED, 'Practitioner credential is not active', 403);
    }

    const signature = await sunbirdClient.signDocument({
      documentHash,
      documentType,
      practitionerLicense: user.license,
    });

    logger.info('Document signed', { documentType, signerLicense: user.license, certificateId: signature.certificateId });
    return signature;
  }

  async verifySignature(documentHash: string, signature: string, signerLicense: string): Promise<{ valid: boolean; reason?: string }> {
    return sunbirdClient.verifySignature(documentHash, signature, signerLicense);
  }

  async logout(refreshToken: string): Promise<void> {
    await keycloakClient.logout(refreshToken);
    logger.info('User logged out');
  }

  private extractLicenseNumber(userInfo: KeycloakUserInfo): string | null {
    const licensePattern = /^(EMS|PH|NS|DT)-\d{5,}$/;
    if (userInfo.preferred_username && licensePattern.test(userInfo.preferred_username)) return userInfo.preferred_username;
    const emailPrefix = userInfo.email?.split('@')[0];
    if (emailPrefix && licensePattern.test(emailPrefix)) return emailPrefix;
    return null;
  }

  private mapRole(keycloakRoles: string[]): UserRole {
    if (keycloakRoles.includes('admin')) return 'admin';
    if (keycloakRoles.includes('regulator') || keycloakRoles.includes('eda_regulator')) return 'regulator';
    if (keycloakRoles.includes('physician') || keycloakRoles.includes('doctor')) return 'physician';
    if (keycloakRoles.includes('pharmacist')) return 'pharmacist';
    if (keycloakRoles.includes('nurse')) return 'nurse';
    if (keycloakRoles.includes('integrator')) return 'integrator';
    return 'physician';
  }

  private getScopesForRole(role: UserRole): string[] {
    const scopes: Record<UserRole, string[]> = {
      physician: ['prescription.create', 'prescription.sign', 'prescription.view', 'prescription.cancel', 'patient.read', 'medication.read'],
      pharmacist: ['prescription.view', 'dispense.create', 'dispense.sign', 'dispense.view', 'patient.read', 'medication.read'],
      nurse: ['prescription.view', 'patient.read', 'medication.read'],
      regulator: ['prescription.view', 'dispense.view', 'medication.read', 'medication.update', 'medication.recall', 'audit.read'],
      admin: ['user.manage', 'system.configure', 'audit.read', 'prescription.view', 'dispense.view', 'medication.read'],
      integrator: ['prescription.create', 'prescription.view', 'dispense.create', 'dispense.view', 'medication.read'],
    };
    return scopes[role] || [];
  }
}

export const authService = new AuthService();

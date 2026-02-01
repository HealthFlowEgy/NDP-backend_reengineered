import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { KEYCLOAK_CONFIG } from '../config/index.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'auth-service', timestamp: new Date().toISOString() });
});

router.post('/api/auth/login', authController.login.bind(authController));
router.post('/api/auth/refresh', authController.refresh.bind(authController));
router.get('/api/auth/verify', authController.verify.bind(authController));
router.post('/api/auth/logout', authController.logout.bind(authController));

router.get('/api/practitioners/:license', authController.getPractitionerInfo.bind(authController));
router.post('/api/sign', authController.sign.bind(authController));
router.post('/api/verify-signature', authController.verifySignature.bind(authController));

router.get('/.well-known/openid-configuration', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/auth`,
    token_endpoint: `${baseUrl}/api/auth/login`,
    userinfo_endpoint: `${baseUrl}/api/auth/verify`,
    jwks_uri: `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/certs`,
    scopes_supported: ['openid', 'profile', 'email', 'prescription.create', 'prescription.sign', 'dispense.create'],
    response_types_supported: ['code', 'token'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'password'],
  });
});

export default router;

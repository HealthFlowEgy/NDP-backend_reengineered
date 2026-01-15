# NDP Backend - Quick Reference Card

## ⚠️ IMPORTANT: Which Package to Use?

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ✅ USE: ndp-backend-sprint6-final.zip                     │
│                                                             │
│   ❌ DELETE THESE (superseded):                             │
│      - ndp-backend-sprint1.zip                              │
│      - ndp-backend-sprint2.zip                              │
│      - ndp-backend-sprint3.zip                              │
│      - ndp-backend-sprint4.zip                              │
│      - ndp-backend-sprint5.zip                              │
│                                                             │
│   Each sprint is CUMULATIVE. Sprint 6 = EVERYTHING          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Deploy in 5 Minutes

```bash
# 1. Extract
unzip ndp-backend-sprint6-final.zip && cd ndp-backend

# 2. Update secrets (REQUIRED!)
vi infrastructure/k8s/00-namespace.yaml
# Change: DB_PASSWORD, JWT_SECRET, etc.

# 3. Update image registry
sed -i 's|ghcr.io/healthflow|YOUR-REGISTRY|g' infrastructure/k8s/*.yaml

# 4. Deploy
kubectl apply -f infrastructure/k8s/

# 5. Verify
kubectl -n ndp get pods
```

## 📊 Services at a Glance

```
┌──────────────────────┬──────┬─────────────────────────────────┐
│ Service              │ Port │ Purpose                         │
├──────────────────────┼──────┼─────────────────────────────────┤
│ api-gateway          │ 3000 │ Entry point, routing            │
│ prescription-service │ 3001 │ Create/manage prescriptions     │
│ dispense-service     │ 3002 │ Pharmacy dispense tracking      │
│ medication-directory │ 3003 │ 47,292 Egyptian medicines       │
│ auth-service         │ 3004 │ Authentication (Keycloak)       │
│ signing-service      │ 3005 │ Digital signatures (PKI)        │
│ ai-validation-service│ 3006 │ Drug interactions, dosing       │
│ legacy-adapter       │ 3007 │ SOAP compatibility              │
│ notification-service │ 3008 │ SMS, Email, WhatsApp, Push      │
│ regulator-service    │ 3009 │ EDA oversight, drug recalls     │
│ reporting-service    │ 3010 │ Reports & analytics             │
├──────────────────────┼──────┼─────────────────────────────────┤
│ postgresql           │ 5432 │ Main database                   │
│ redis                │ 6379 │ Cache                           │
└──────────────────────┴──────┴─────────────────────────────────┘
```

## 🔧 Common Commands

```bash
# View all pods
kubectl -n ndp get pods

# View logs
kubectl -n ndp logs -f deployment/api-gateway

# Restart service
kubectl -n ndp rollout restart deployment/prescription-service

# Scale up
kubectl -n ndp scale deployment/prescription-service --replicas=10

# Update image
kubectl -n ndp set image deployment/api-gateway \
  api-gateway=your-registry/api-gateway:v1.1.0

# Port forward for testing
kubectl -n ndp port-forward svc/api-gateway 3000:3000

# Run database migration
kubectl -n ndp exec -it $(kubectl -n ndp get pod -l app.kubernetes.io/name=postgresql -o name) -- \
  psql -U ndp -d ndp -f /tmp/001_initial_schema.sql
```

## 🌐 Production URLs

| Endpoint | URL |
|----------|-----|
| REST API | https://api.ndp.egypt.gov.eg |
| SOAP API | https://soap.ndp.egypt.gov.eg |
| Regulator | https://regulator.ndp.egypt.gov.eg |
| Health | https://api.ndp.egypt.gov.eg/health |
| FHIR | https://api.ndp.egypt.gov.eg/fhir/metadata |

## 🔐 Secrets to Configure

```yaml
# infrastructure/k8s/00-namespace.yaml - Secret section
DB_PASSWORD:           # openssl rand -base64 32
JWT_SECRET:            # openssl rand -base64 64
KEYCLOAK_CLIENT_SECRET: # From Keycloak admin
SMS_API_KEY:           # From SMS provider
SMTP_USER:             # Email username
SMTP_PASSWORD:         # Email password
WHATSAPP_API_KEY:      # From Meta Business
FCM_SERVER_KEY:        # From Firebase
```

## 🧪 Test Scripts

```bash
./scripts/test-api.sh           # Core API tests
./scripts/test-ai-validation.sh # AI validation
./scripts/test-legacy-soap.sh   # SOAP endpoints
./scripts/test-notifications.sh # Notifications
./scripts/test-regulator.sh     # Regulator portal
```

## 📁 Key Files

```
infrastructure/k8s/00-namespace.yaml  ← Edit secrets here
infrastructure/k8s/06-networking.yaml ← Edit domains here
infrastructure/scripts/001_initial_schema.sql ← Database schema
docker-compose.yml                    ← Local development
```

## 🆘 Quick Troubleshoot

```bash
# Pod won't start?
kubectl -n ndp describe pod <pod-name>
kubectl -n ndp logs <pod-name> --previous

# Can't connect to DB?
kubectl -n ndp exec -it <pod> -- nc -zv postgresql 5432

# Image pull error?
kubectl -n ndp get events --sort-by='.lastTimestamp'
```

---
**Full guide: docs/DEVOPS_GUIDE.md**

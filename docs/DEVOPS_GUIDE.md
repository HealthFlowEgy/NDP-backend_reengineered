# NDP Backend - DevOps Deployment Guide

## 📦 Package Overview

You have received 6 sprint packages. **Use only the final package** for deployment:

| Package | Status | Action |
|---------|--------|--------|
| `ndp-backend-sprint1.zip` | ❌ Superseded | **DELETE** - Do not use |
| `ndp-backend-sprint2.zip` | ❌ Superseded | **DELETE** - Do not use |
| `ndp-backend-sprint3.zip` | ❌ Superseded | **DELETE** - Do not use |
| `ndp-backend-sprint4.zip` | ❌ Superseded | **DELETE** - Do not use |
| `ndp-backend-sprint5.zip` | ❌ Superseded | **DELETE** - Do not use |
| `ndp-backend-sprint6-final.zip` | ✅ **CURRENT** | **USE THIS** - Complete codebase |

> ⚠️ **IMPORTANT**: Each sprint package is CUMULATIVE and contains ALL previous sprint code. Sprint 6 contains the complete, production-ready codebase.

---

## 🚀 Quick Start (Single Command)

```bash
# 1. Extract the FINAL package only
unzip ndp-backend-sprint6-final.zip
cd ndp-backend

# 2. Deploy everything
./scripts/deploy.sh -e production -v v1.0.0
```

---

## 📁 Directory Structure After Extraction

```
ndp-backend/
├── .github/
│   └── workflows/
│       └── ci-cd.yml                 # GitHub Actions pipeline
├── infrastructure/
│   ├── docker/
│   │   ├── Dockerfile.service        # Development Dockerfile
│   │   └── Dockerfile.production     # Production multi-stage
│   ├── helm/
│   │   └── values-production.yaml    # Helm chart values
│   ├── k8s/
│   │   ├── 00-namespace.yaml         # Namespace, ConfigMap, Secrets
│   │   ├── 01-database.yaml          # PostgreSQL, Redis
│   │   ├── 02-api-gateway.yaml       # API Gateway + HPA
│   │   ├── 03-core-services.yaml     # Prescription, Dispense, Med
│   │   ├── 04-security-services.yaml # Auth, Signing, AI
│   │   ├── 05-supporting-services.yaml # Legacy, Notif, Regulator
│   │   └── 06-networking.yaml        # Ingress, NetworkPolicy
│   ├── keycloak/
│   │   └── ndp-realm.json            # Keycloak realm config
│   └── scripts/
│       └── 001_initial_schema.sql    # Database schema
├── services/
│   ├── api-gateway/                  # Port 3000
│   ├── prescription-service/         # Port 3001
│   ├── dispense-service/             # Port 3002
│   ├── medication-directory/         # Port 3003
│   ├── auth-service/                 # Port 3004
│   ├── signing-service/              # Port 3005
│   ├── ai-validation-service/        # Port 3006
│   ├── legacy-adapter/               # Port 3007
│   ├── notification-service/         # Port 3008
│   ├── regulator-service/            # Port 3009
│   └── reporting-service/            # Port 3010
├── shared/
│   ├── config/
│   ├── types/
│   └── utils/
├── scripts/
│   ├── deploy.sh                     # Deployment script
│   ├── test-api.sh                   # API tests
│   ├── test-ai-validation.sh         # AI validation tests
│   ├── test-legacy-soap.sh           # SOAP tests
│   ├── test-notifications.sh         # Notification tests
│   └── test-regulator.sh             # Regulator tests
├── docker-compose.yml                # Local development
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔧 Step-by-Step Deployment

### Step 1: Prerequisites

```bash
# Required tools
kubectl version --client    # v1.28+
docker --version           # 24.0+
helm version               # 3.12+ (optional)
node --version             # 20+ (for local dev)

# Required access
- Kubernetes cluster (EKS/GKE/AKS or on-prem)
- Container registry (ghcr.io or private)
- Domain DNS configured
- TLS certificates (or cert-manager installed)
```

### Step 2: Extract Package

```bash
# Extract ONLY the final package
unzip ndp-backend-sprint6-final.zip
cd ndp-backend

# Verify structure
ls -la
ls -la infrastructure/k8s/
ls -la services/
```

### Step 3: Configure Secrets

```bash
# Edit secrets before deployment
vi infrastructure/k8s/00-namespace.yaml

# Update these values in the Secret resource:
# - DB_PASSWORD: Generate with `openssl rand -base64 32`
# - JWT_SECRET: Generate with `openssl rand -base64 64`
# - KEYCLOAK_CLIENT_SECRET: From Keycloak admin console
# - SMS_API_KEY: From your SMS provider
# - SMTP_USER / SMTP_PASSWORD: Email credentials
# - WHATSAPP_API_KEY: From Meta Business
# - FCM_SERVER_KEY: From Firebase console
```

### Step 4: Configure Domains

```bash
# Edit ingress configuration
vi infrastructure/k8s/06-networking.yaml

# Update hostnames:
# - api.ndp.egypt.gov.eg      → Your API domain
# - soap.ndp.egypt.gov.eg     → Your SOAP domain
# - regulator.ndp.egypt.gov.eg → Your regulator domain

# Update TLS secret names if using existing certificates
```

### Step 5: Build Docker Images

```bash
# Option A: Build locally and push
export REGISTRY="your-registry.com/ndp"
export VERSION="v1.0.0"

for service in api-gateway prescription-service dispense-service \
  medication-directory auth-service signing-service \
  ai-validation-service legacy-adapter notification-service \
  regulator-service reporting-service; do
  
  docker build -t $REGISTRY/$service:$VERSION \
    --build-arg SERVICE_NAME=$service \
    -f infrastructure/docker/Dockerfile.production .
  
  docker push $REGISTRY/$service:$VERSION
done

# Option B: Use CI/CD (recommended)
# Push to GitHub and let Actions build images
git push origin main
```

### Step 6: Update Image References

```bash
# If using private registry, update all deployment files:
sed -i 's|ghcr.io/healthflow|your-registry.com/ndp|g' infrastructure/k8s/*.yaml

# Or edit each file manually
vi infrastructure/k8s/02-api-gateway.yaml
# Change: image: ghcr.io/healthflow/ndp-api-gateway:latest
# To:     image: your-registry.com/ndp/api-gateway:v1.0.0
```

### Step 7: Deploy to Kubernetes

```bash
# Create namespace and configs first
kubectl apply -f infrastructure/k8s/00-namespace.yaml

# Deploy database
kubectl apply -f infrastructure/k8s/01-database.yaml

# Wait for database to be ready
kubectl -n ndp wait --for=condition=ready pod -l app.kubernetes.io/name=postgresql --timeout=300s

# Run migrations
kubectl -n ndp cp infrastructure/scripts/001_initial_schema.sql \
  $(kubectl -n ndp get pod -l app.kubernetes.io/name=postgresql -o jsonpath='{.items[0].metadata.name}'):/tmp/
kubectl -n ndp exec -it $(kubectl -n ndp get pod -l app.kubernetes.io/name=postgresql -o jsonpath='{.items[0].metadata.name}') -- \
  sh -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/001_initial_schema.sql'

# Deploy services
kubectl apply -f infrastructure/k8s/02-api-gateway.yaml
kubectl apply -f infrastructure/k8s/03-core-services.yaml
kubectl apply -f infrastructure/k8s/04-security-services.yaml
kubectl apply -f infrastructure/k8s/05-supporting-services.yaml

# Deploy networking (production only)
kubectl apply -f infrastructure/k8s/06-networking.yaml

# Verify deployment
kubectl -n ndp get pods
kubectl -n ndp get svc
kubectl -n ndp get ingress
```

### Step 8: Verify Deployment

```bash
# Check all pods are running
kubectl -n ndp get pods -w

# Check logs for errors
kubectl -n ndp logs -l app.kubernetes.io/name=api-gateway --tail=100

# Test health endpoints
kubectl -n ndp port-forward svc/api-gateway 3000:3000 &
curl http://localhost:3000/health

# Test from ingress (if DNS configured)
curl https://api.ndp.egypt.gov.eg/health
curl https://api.ndp.egypt.gov.eg/fhir/metadata
```

---

## 🔄 Updating the Application

### Scenario 1: New Version Release

```bash
# Pull new version
export NEW_VERSION="v1.1.0"

# Update all deployments
for deployment in api-gateway prescription-service dispense-service \
  medication-directory auth-service signing-service \
  ai-validation-service legacy-adapter notification-service \
  regulator-service reporting-service; do
  
  kubectl -n ndp set image deployment/$deployment \
    $deployment=$REGISTRY/$deployment:$NEW_VERSION
done

# Wait for rollout
kubectl -n ndp rollout status deployment/api-gateway
```

### Scenario 2: Configuration Change

```bash
# Edit ConfigMap
kubectl -n ndp edit configmap ndp-common-config

# Restart affected deployments
kubectl -n ndp rollout restart deployment/prescription-service
```

### Scenario 3: Secret Update

```bash
# Update secrets (e.g., new API keys)
kubectl -n ndp edit secret ndp-secrets

# Restart all services to pick up new secrets
kubectl -n ndp rollout restart deployment --all
```

### Scenario 4: Scale Services

```bash
# Manual scaling
kubectl -n ndp scale deployment prescription-service --replicas=10

# Or update HPA limits
kubectl -n ndp edit hpa prescription-service-hpa
```

---

## 📊 Service Port Reference

| Service | Internal Port | External Exposure |
|---------|---------------|-------------------|
| API Gateway | 3000 | https://api.ndp.egypt.gov.eg |
| Prescription | 3001 | Internal only |
| Dispense | 3002 | Internal only |
| Medication | 3003 | Internal only |
| Auth | 3004 | Internal only |
| Signing | 3005 | Internal only |
| AI Validation | 3006 | Internal only |
| Legacy Adapter | 3007 | https://soap.ndp.egypt.gov.eg |
| Notification | 3008 | Internal only |
| Regulator | 3009 | https://regulator.ndp.egypt.gov.eg |
| Reporting | 3010 | Internal only |
| PostgreSQL | 5432 | Internal only |
| Redis | 6379 | Internal only |

---

## 🔐 Security Checklist

Before going to production:

- [ ] Change all default passwords in `ndp-secrets`
- [ ] Generate new JWT_SECRET (`openssl rand -base64 64`)
- [ ] Configure TLS certificates (Let's Encrypt or enterprise CA)
- [ ] Enable NetworkPolicy (included in 06-networking.yaml)
- [ ] Configure IP whitelist for regulator portal
- [ ] Set up monitoring and alerting
- [ ] Enable audit logging
- [ ] Configure backup for PostgreSQL PVC
- [ ] Review and test disaster recovery plan

---

## 🧪 Testing After Deployment

```bash
# Run all test scripts
cd ndp-backend

# Set base URL to your deployment
export BASE_URL="https://api.ndp.egypt.gov.eg"

# Test core API
./scripts/test-api.sh

# Test AI validation
./scripts/test-ai-validation.sh

# Test SOAP endpoints
./scripts/test-legacy-soap.sh

# Test notifications (will simulate, not send real messages)
./scripts/test-notifications.sh

# Test regulator portal
./scripts/test-regulator.sh
```

---

## 🆘 Troubleshooting

### Pods not starting
```bash
kubectl -n ndp describe pod <pod-name>
kubectl -n ndp logs <pod-name> --previous
```

### Database connection issues
```bash
# Check PostgreSQL is running
kubectl -n ndp get pods -l app.kubernetes.io/name=postgresql

# Check connection from service
kubectl -n ndp exec -it <service-pod> -- sh -c 'nc -zv postgresql 5432'
```

### Service discovery issues
```bash
# Check DNS resolution
kubectl -n ndp exec -it <pod> -- nslookup prescription-service
```

### Image pull errors
```bash
# Check image pull secrets
kubectl -n ndp get secrets
kubectl -n ndp describe pod <pod-name> | grep -A5 "Events:"
```

---

## 📞 Support

For issues or questions:
- Review logs: `kubectl -n ndp logs -l app.kubernetes.io/part-of=ndp --tail=500`
- Check events: `kubectl -n ndp get events --sort-by='.lastTimestamp'`
- Monitor: `kubectl -n ndp top pods`

---

## 📋 Quick Reference Commands

```bash
# View all resources
kubectl -n ndp get all

# View logs for a service
kubectl -n ndp logs -f deployment/prescription-service

# Execute shell in container
kubectl -n ndp exec -it deployment/api-gateway -- sh

# Port forward for local testing
kubectl -n ndp port-forward svc/api-gateway 3000:3000

# Restart a deployment
kubectl -n ndp rollout restart deployment/api-gateway

# Check deployment status
kubectl -n ndp rollout status deployment/api-gateway

# View resource usage
kubectl -n ndp top pods

# Delete and recreate (if needed)
kubectl -n ndp delete -f infrastructure/k8s/03-core-services.yaml
kubectl -n ndp apply -f infrastructure/k8s/03-core-services.yaml
```

---

**Remember: Only use `ndp-backend-sprint6-final.zip` - it contains the complete, production-ready codebase!**

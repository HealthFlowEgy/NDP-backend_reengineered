# 🏥 NDP Backend - National Digital Prescription Platform

> **Egypt's FHIR-compliant digital prescription system serving 105 million citizens**

[![CI/CD](https://github.com/healthflow/ndp-backend/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/healthflow/ndp-backend/actions)
[![License](https://img.shields.io/badge/license-Proprietary-blue.svg)]()
[![FHIR R4](https://img.shields.io/badge/FHIR-R4-orange.svg)](https://www.hl7.org/fhir/)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Services](#-services)
- [Quick Start](#-quick-start)
- [API Reference](#-api-reference)
- [Deployment](#-deployment)
- [Security](#-security)
- [Testing](#-testing)
- [Project Status](#-project-status)
- [Documentation](#-documentation)

---

## 🎯 Overview

The National Digital Prescription (NDP) Platform is Egypt's unified digital infrastructure for electronic prescriptions, connecting:

- **Physicians** - Create and sign digital prescriptions
- **Pharmacies** - Verify and dispense medications
- **Patients** - Access prescriptions via national ID
- **Regulators (EDA)** - Monitor compliance and manage drug recalls

### Key Features

| Feature | Description |
|---------|-------------|
| 🏥 **FHIR R4 Compliant** | International healthcare interoperability standard |
| 💊 **47,292 Medications** | Complete Egyptian Drug Authority (EDA) directory |
| 🤖 **AI Validation** | Drug interactions, dosing, contraindications |
| ✍️ **Digital Signatures** | PKI-based prescription signing |
| 📱 **Multi-channel Notifications** | SMS, Email, WhatsApp, Push |
| 🔌 **Legacy SOAP Support** | Backward compatibility for existing systems |
| 📊 **Real-time Analytics** | Dashboard for regulators |
| ☸️ **Cloud Native** | Kubernetes-ready microservices |

---

## 🏗 Architecture

```
                                    ┌─────────────────┐
                                    │   Load Balancer │
                                    │  (Ingress NGINX)│
                                    └────────┬────────┘
                                             │
              ┌──────────────────────────────┼──────────────────────────────┐
              │                              │                              │
              ▼                              ▼                              ▼
    ┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
    │ api.ndp.egypt   │           │ soap.ndp.egypt  │           │regulator.ndp    │
    │    .gov.eg      │           │    .gov.eg      │           │  .egypt.gov.eg  │
    └────────┬────────┘           └────────┬────────┘           └────────┬────────┘
             │                             │                             │
             ▼                             ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
    │   API Gateway   │           │  Legacy Adapter │           │ Regulator Svc   │
    │   (Port 3000)   │           │   (Port 3007)   │           │   (Port 3009)   │
    └────────┬────────┘           └─────────────────┘           └─────────────────┘
             │
             ├─────────────┬─────────────┬─────────────┬─────────────┐
             ▼             ▼             ▼             ▼             ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Prescription │ │   Dispense   │ │  Medication  │ │     Auth     │ │     AI       │
    │   Service    │ │   Service    │ │  Directory   │ │   Service    │ │  Validation  │
    │  (Port 3001) │ │  (Port 3002) │ │  (Port 3003) │ │  (Port 3004) │ │  (Port 3006) │
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────────────┘ └──────────────┘
           │                │                │
           └────────────────┴────────────────┘
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
           ┌─────────────┐   ┌─────────────┐
           │ PostgreSQL  │   │    Redis    │
           │   (5432)    │   │   (6379)    │
           └─────────────┘   └─────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 20 LTS |
| **Language** | TypeScript 5.3 |
| **Framework** | Express.js |
| **Database** | PostgreSQL 15 |
| **Cache** | Redis 7 |
| **Auth** | Keycloak + Sunbird RC |
| **Container** | Docker |
| **Orchestration** | Kubernetes |
| **CI/CD** | GitHub Actions |

---

## 🔧 Services

### Core Services

| Service | Port | Description | FHIR Resource |
|---------|------|-------------|---------------|
| **API Gateway** | 3000 | Request routing, rate limiting, auth | - |
| **Prescription Service** | 3001 | Create, sign, cancel prescriptions | MedicationRequest |
| **Dispense Service** | 3002 | Record pharmacy dispenses | MedicationDispense |
| **Medication Directory** | 3003 | 47,292 Egyptian medicines | MedicationKnowledge |

### Security Services

| Service | Port | Description |
|---------|------|-------------|
| **Auth Service** | 3004 | JWT authentication, Keycloak integration |
| **Signing Service** | 3005 | RSA-2048 digital signatures, PKI |
| **AI Validation** | 3006 | Drug interactions, dosing checks |

### Supporting Services

| Service | Port | Description |
|---------|------|-------------|
| **Legacy Adapter** | 3007 | SOAP to REST bridge, WSDL |
| **Notification Service** | 3008 | SMS, Email, WhatsApp, Push |
| **Regulator Service** | 3009 | EDA dashboard, drug recalls, compliance |
| **Reporting Service** | 3010 | Report generation (PDF, CSV, Excel) |

---

## 🚀 Quick Start

### Prerequisites

```bash
node --version    # v20+
docker --version  # v24+
```

### Local Development

```bash
# Clone repository
git clone https://github.com/healthflow/ndp-backend.git
cd ndp-backend

# Install dependencies
npm install

# Start infrastructure
docker-compose up -d postgres redis

# Run database migrations
psql -h localhost -U ndp -d ndp -f infrastructure/scripts/001_initial_schema.sql

# Start all services
docker-compose up -d

# Verify
curl http://localhost:3000/health
```

### Docker Compose (Full Stack)

```bash
# Start everything including Keycloak
docker-compose --profile with-keycloak up -d

# View logs
docker-compose logs -f api-gateway

# Stop
docker-compose down
```

---

## 📚 API Reference

### FHIR Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/fhir/MedicationRequest` | Create prescription |
| `GET` | `/fhir/MedicationRequest/{id}` | Get prescription |
| `GET` | `/fhir/MedicationRequest?patient={nid}` | Search by patient |
| `POST` | `/fhir/MedicationRequest/{id}/$sign` | Sign prescription |
| `POST` | `/fhir/MedicationRequest/{id}/$cancel` | Cancel prescription |
| `POST` | `/fhir/MedicationDispense` | Record dispense |
| `GET` | `/fhir/MedicationDispense?prescription={id}` | Get dispenses |
| `GET` | `/fhir/MedicationKnowledge?name={query}` | Search medications |
| `GET` | `/fhir/MedicationKnowledge/{edaCode}` | Get medication |
| `GET` | `/fhir/metadata` | FHIR capability statement |

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/validate` | AI prescription validation |
| `POST` | `/api/interactions/check` | Drug interaction check |
| `POST` | `/api/notifications/send` | Send notification |
| `GET` | `/api/regulator/dashboard` | Regulator statistics |
| `POST` | `/api/regulator/recalls` | Initiate drug recall |
| `POST` | `/api/reports` | Generate report |

### SOAP Endpoints

| Endpoint | Description |
|----------|-------------|
| `/soap/prescription` | SOAP service endpoint |
| `/soap/prescription?wsdl` | WSDL definition |

**SOAP Actions:** `CreatePrescription`, `GetPrescription`, `SignPrescription`, `CancelPrescription`, `RecordDispense`, `SearchDrugs`

### Example: Create Prescription

```bash
curl -X POST http://localhost:3000/fhir/MedicationRequest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "patientNationalId": "29901011234567",
    "patientName": "أحمد محمد",
    "medications": [{
      "edaCode": "PAR001",
      "medicationName": "Paracetamol 500mg",
      "quantity": 20,
      "unit": "tablet",
      "dosageInstruction": "Take 1-2 tablets every 6 hours as needed",
      "frequency": "every 6 hours",
      "duration": "7 days",
      "route": "oral"
    }],
    "allowedDispenses": 1,
    "validityDays": 30
  }'
```

---

## ☸️ Deployment

### Kubernetes

```bash
# Apply all manifests
kubectl apply -f infrastructure/k8s/

# Or use deployment script
./scripts/deploy.sh -e production -v v1.0.0
```

### Manifest Files

| File | Contents |
|------|----------|
| `00-namespace.yaml` | Namespace, ConfigMap, Secrets, RBAC |
| `01-database.yaml` | PostgreSQL StatefulSet, Redis |
| `02-api-gateway.yaml` | API Gateway, HPA, PDB |
| `03-core-services.yaml` | Prescription, Dispense, Medication |
| `04-security-services.yaml` | Auth, Signing, AI Validation |
| `05-supporting-services.yaml` | Legacy, Notification, Regulator, Reporting |
| `06-networking.yaml` | Ingress, NetworkPolicy |

### Production URLs

| Service | URL |
|---------|-----|
| REST API | `https://api.ndp.egypt.gov.eg` |
| SOAP API | `https://soap.ndp.egypt.gov.eg` |
| Regulator Portal | `https://regulator.ndp.egypt.gov.eg` |

---

## 🔐 Security

### Authentication

- **JWT Tokens** - Keycloak-issued access tokens
- **SMART on FHIR** - Healthcare-specific OAuth2 scopes
- **Sunbird RC** - Healthcare Professional Registry integration

### Authorization Roles

| Role | Permissions |
|------|-------------|
| `physician` | Create, sign prescriptions |
| `pharmacist` | View, dispense prescriptions |
| `patient` | View own prescriptions |
| `regulator` | Full read access, recalls, compliance |
| `admin` | Full system access |

### Security Features

- ✅ TLS 1.3 encryption
- ✅ Rate limiting (1000 req/min)
- ✅ Network policies (pod isolation)
- ✅ Non-root containers
- ✅ Read-only filesystems
- ✅ Audit logging
- ✅ IP whitelisting (regulator portal)

### Secrets Configuration

```yaml
# infrastructure/k8s/00-namespace.yaml
DB_PASSWORD: <generate: openssl rand -base64 32>
JWT_SECRET: <generate: openssl rand -base64 64>
KEYCLOAK_CLIENT_SECRET: <from Keycloak admin>
SMS_API_KEY: <from SMS provider>
SMTP_PASSWORD: <email password>
WHATSAPP_API_KEY: <from Meta Business>
FCM_SERVER_KEY: <from Firebase>
```

---

## 🧪 Testing

### Test Scripts

```bash
# Core API tests
./scripts/test-api.sh

# AI validation tests
./scripts/test-ai-validation.sh

# SOAP endpoint tests
./scripts/test-legacy-soap.sh

# Notification tests
./scripts/test-notifications.sh

# Regulator portal tests
./scripts/test-regulator.sh
```

### Unit & Integration Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Integration tests (requires DB)
npm run test:integration
```

---

## 📊 Project Status

### Sprint Completion

| Sprint | Focus | Status |
|--------|-------|--------|
| Sprint 1 | Core Services (Prescription, Dispense, Medication) | ✅ Complete |
| Sprint 2 | Authentication & Digital Signing | ✅ Complete |
| Sprint 3 | AI Validation (Drug interactions, Dosing) | ✅ Complete |
| Sprint 4 | Legacy SOAP Adapter & Notifications | ✅ Complete |
| Sprint 5 | Regulator Portal & Reporting | ✅ Complete |
| Sprint 6 | Kubernetes & CI/CD Pipeline | ✅ Complete |

### Feature Summary

| Category | Features |
|----------|----------|
| **Prescriptions** | Create, sign, cancel, search, verify |
| **Dispenses** | Full/partial dispense, tracking, history |
| **Medications** | 47,292 drugs, FHIR MedicationKnowledge |
| **AI Validation** | 10+ drug interactions, renal/hepatic dosing |
| **Notifications** | SMS, Email, WhatsApp, Push (Arabic/English) |
| **Regulator** | Dashboard, drug recalls, compliance alerts |
| **Reports** | Prescription, dispense, controlled substances |
| **Legacy** | SOAP/WSDL, backward compatibility |

---

## 📖 Documentation

| Document | Location | Description |
|----------|----------|-------------|
| **DevOps Guide** | `docs/DEVOPS_GUIDE.md` | Complete deployment instructions |
| **Quick Reference** | `docs/QUICK_REFERENCE.md` | One-page command cheat sheet |
| **API Reference** | `docs/API.md` | Detailed API documentation |
| **Architecture** | `docs/ARCHITECTURE.md` | System design decisions |

---

## 📁 Project Structure

```
ndp-backend/
├── .github/workflows/          # CI/CD pipeline
├── docs/                       # Documentation
├── infrastructure/
│   ├── docker/                 # Dockerfiles
│   ├── helm/                   # Helm values
│   ├── k8s/                    # Kubernetes manifests
│   ├── keycloak/               # Keycloak config
│   └── scripts/                # Database migrations
├── services/
│   ├── api-gateway/            # Port 3000
│   ├── prescription-service/   # Port 3001
│   ├── dispense-service/       # Port 3002
│   ├── medication-directory/   # Port 3003
│   ├── auth-service/           # Port 3004
│   ├── signing-service/        # Port 3005
│   ├── ai-validation-service/  # Port 3006
│   ├── legacy-adapter/         # Port 3007
│   ├── notification-service/   # Port 3008
│   ├── regulator-service/      # Port 3009
│   └── reporting-service/      # Port 3010
├── shared/
│   ├── config/                 # Configuration loader
│   ├── types/                  # TypeScript types
│   └── utils/                  # Shared utilities
├── scripts/                    # Test & deploy scripts
├── docker-compose.yml          # Local development
├── package.json
└── tsconfig.json
```

---

## 🤝 Contributing

1. Create a feature branch from `develop`
2. Make changes with tests
3. Submit PR for review
4. Merge after approval

---

## 📞 Support

- **Technical Issues**: Create GitHub issue
- **Security Vulnerabilities**: security@healthflow.eg
- **General Inquiries**: support@ndp.egypt.gov.eg

---

## 📄 License

Proprietary - HealthFlow Group © 2026

---

<div align="center">

**Built with ❤️ for Egypt's Healthcare**

[API Docs](https://api.ndp.egypt.gov.eg/docs) • [Status](https://status.ndp.egypt.gov.eg) • [Support](mailto:support@ndp.egypt.gov.eg)

</div>

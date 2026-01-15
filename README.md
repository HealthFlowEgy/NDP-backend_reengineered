# NDP Backend - National Digital Prescription Platform

Egypt's FHIR-compliant digital prescription backend system.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          API Gateway                                │
│                         (Port 3000)                                 │
├─────────────────────────────────────────────────────────────────────┤
│                              │                                      │
│    ┌─────────────────────────┼─────────────────────────┐           │
│    │           │             │             │           │           │
│    ▼           ▼             ▼             ▼           ▼           │
│ ┌───────┐ ┌───────┐    ┌───────┐    ┌───────┐    ┌───────┐       │
│ │ Auth  │ │Signing│    │Prescrip│   │Dispense│   │  Med  │       │
│ │Service│ │Service│    │ tion  │    │Service │   │ Dir   │       │
│ │ 3004  │ │ 3005  │    │ 3001  │    │ 3002   │   │ 3003  │       │
│ └───┬───┘ └───┬───┘    └───┬───┘    └───┬────┘   └───┬───┘       │
│     │         │            │            │            │            │
│     │    ┌────┴────────────┴────────────┴────────────┘            │
│     │    │                                                         │
│     ▼    ▼                                                         │
│ ┌──────────────┐        ┌─────────────────────────┐               │
│ │  Keycloak    │        │      PostgreSQL         │               │
│ │  (SSO/IAM)   │        │    + Redis Cache        │               │
│ └──────────────┘        └─────────────────────────┘               │
│         │                                                          │
│         ▼                                                          │
│ ┌──────────────┐                                                   │
│ │ Sunbird RC   │                                                   │
│ │    (HPR)     │                                                   │
│ └──────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 15+ (or use Docker)

### Development Setup

```bash
# Clone and install
cd ndp-backend
npm install

# Start infrastructure (PostgreSQL, Redis)
docker-compose up -d postgres redis

# Run database migrations
psql -h localhost -U ndp -d ndp -f infrastructure/scripts/001_initial_schema.sql

# Start services (in separate terminals)
npm run dev:prescription  # Port 3001
npm run dev:dispense      # Port 3002
npm run dev:medication    # Port 3003
npm run dev:gateway       # Port 3000
```

### Using Docker Compose

```bash
# Start everything
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## 📚 API Endpoints

### FHIR Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/fhir/MedicationRequest` | Create prescription |
| GET | `/fhir/MedicationRequest/{id}` | Get prescription |
| GET | `/fhir/MedicationRequest?patient={nid}` | Search prescriptions |
| POST | `/fhir/MedicationRequest/{id}/$sign` | Sign prescription |
| POST | `/fhir/MedicationDispense` | Record dispense |
| GET | `/fhir/MedicationDispense/{id}` | Get dispense |
| GET | `/fhir/MedicationKnowledge?name={query}` | Search medications |
| GET | `/fhir/MedicationKnowledge/{id}` | Get medication |

### Internal API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/prescriptions/{id}` | Get full prescription record |
| GET | `/api/prescriptions/patient/{nid}/active` | Get active prescriptions |
| POST | `/api/medications/validate` | Validate medication codes |
| POST | `/api/medications/{code}/recall` | Recall medication |

## 🏃 Sprint Implementation

### Sprint 1 ✅ (Weeks 1-2)
- [x] FHIR data models and types
- [x] PostgreSQL database schema
- [x] Medication Directory Service
- [x] Basic Prescription Service
- [x] Dispense Service
- [x] API Gateway

### Sprint 2 ✅ (Weeks 3-4)
- [x] Auth Service (Keycloak integration)
- [x] Sunbird RC HPR client
- [x] Digital Signature Service (PKI)
- [x] JWT token management
- [x] Role-based access control (RBAC)
- [x] Certificate management
- [x] Prescription signing workflow
- [x] Signature verification

### Sprint 3 (Weeks 5-6)
- [ ] AI validation service integration
- [ ] Drug-drug interaction checks
- [ ] Dosage validation
- [ ] Contraindication alerts

### Sprint 4 (Weeks 7-8)
- [ ] Pharmacist signing for dispenses
- [ ] Partial dispense tracking
- [ ] Dispense reversal

### Sprint 5 (Weeks 9-10)
- [ ] Legacy adapter
- [x] API Gateway
- [ ] Backward compatibility testing

### Sprint 6 (Weeks 11-12)
- [ ] Regulator portal API
- [ ] Drug recalls
- [ ] Production deployment

## 🔐 Security

- JWT-based authentication
- Role-based access control (RBAC)
- SMART on FHIR scopes
- TLS encryption
- Audit logging

## 📁 Project Structure

```
ndp-backend/
├── services/
│   ├── prescription-service/   # FHIR MedicationRequest
│   ├── dispense-service/       # FHIR MedicationDispense
│   ├── medication-directory/   # FHIR MedicationKnowledge
│   └── api-gateway/            # Request routing
├── shared/
│   ├── types/                  # FHIR & NDP types
│   ├── config/                 # Configuration
│   └── utils/                  # Utilities
├── infrastructure/
│   ├── docker/                 # Dockerfiles
│   ├── k8s/                    # Kubernetes manifests
│   └── scripts/                # Database migrations
├── docker-compose.yml
├── package.json
└── README.md
```

## 🧪 Testing

```bash
# Create a prescription
curl -X POST http://localhost:3000/fhir/MedicationRequest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "patientNationalId": "29901011234567",
    "medications": [{
      "edaCode": "12345",
      "medicationName": "Paracetamol 500mg",
      "quantity": 20,
      "unit": "tablet",
      "dosageInstruction": "Take 1 tablet every 6 hours"
    }]
  }'

# Search prescriptions by patient
curl http://localhost:3000/fhir/MedicationRequest?patient=29901011234567

# Search medications
curl http://localhost:3000/fhir/MedicationKnowledge?name=paracetamol
```

## 📄 License

Copyright © 2026 HealthFlow Group. All rights reserved.

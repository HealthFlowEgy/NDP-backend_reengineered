# National Digital Prescription (NDP) Backend

## Project Overview
Egypt's unified digital infrastructure for electronic prescriptions, designed to handle 5M+ daily prescriptions with FHIR R4 compliance. This repository is a monolithic repository (monorepo) hosting the microservices backend.

### Key Technologies
- **Runtime:** Node.js v20 (LTS)
- **Language:** TypeScript 5.3
- **Framework:** Express.js
- **Database:** PostgreSQL 15 (with PgBouncer)
- **Caching:** Redis 7
- **Messaging:** Apache Kafka 3.6
- **Orchestration:** Kubernetes 1.28+

## Architecture
The system is composed of loosely coupled microservices located in the `services/` directory, sharing common utilities and types via the `shared/` directory.

### Core Services
- **`services/gateway`**: API Gateway (Entry point, Routing, Rate limiting).
- **`services/fhir-gateway`**: [NEW] Smart FHIR Proxy (Compliance, Auth, Proxy to HAPI).
- **`services/prescription`**: Core logic for MedicationRequest management.
- **`services/dispense`**: MedicationDispense management for pharmacies.
- **`services/medication`**: Drug directory and validation against EDA database.

### Infrastructure
- **HAPI FHIR**: Central Clinical Data Repository (Java/Postgres).

### Support Services
- **`services/auth`**: Authentication & Authorization (Keycloak & Sunbird RC).
- **`services/signing`**: PKI-based digital signature handling.
- **`services/ai-validator`**: Clinical decision support (Interactions, Dosing).
- **`services/notification`**: Multi-channel alerts (SMS, Email, WhatsApp).
- **`services/regulator`**: Dashboard and tools for the Egyptian Drug Authority.
- **`services/reporting`**: Async report generation service.

### Legacy Integration
- **`services/legacy-soap`**: High-performance V2 adapter (Async/Kafka-based).
- **`services/legacy-soap-sync`**: V1 adapter (Synchronous) for backward compatibility.

## Building and Running

### Prerequisites
- Node.js >= 18
- Docker & Docker Compose

### Development Commands
*   **Install Dependencies:**
    ```bash
    npm install
    ```
*   **Start Infrastructure (DB & Redis):**
    ```bash
    docker-compose up -d postgres redis
    ```
*   **Start All Services (Dev Mode):**
    ```bash
    npm run dev:all
    ```
*   **Start Specific Service:**
    ```bash
    npm run dev --workspace=services/prescription
    ```

### Testing
*   **Run All Tests:**
    ```bash
    npm test
    ```
*   **Integration Scripts:**
    Located in `scripts/`:
    - `test-api.sh`: Core API flows.
    - `test-legacy-soap.sh`: SOAP endpoint validation.

## Directory Structure

```text
/
├── services/           # Microservices source code
│   ├── prescription/   # [Reference Implementation] Layered architecture
│   ├── dispense/       # Dispensing logic
│   ├── ...             # Other services
├── shared/             # Shared code library
│   ├── config/         # Environment configuration
│   ├── database/       # DB Client & migrations
│   ├── types/          # Shared TypeScript interfaces (FHIR/NDP)
│   └── utils/          # Common helpers
├── infrastructure/     # DevOps configuration
│   ├── k8s/            # Kubernetes manifests
│   ├── docker/         # Dockerfiles
│   └── helm/           # Helm charts
└── docs/               # Project documentation
```

## Conventions
*   **Architecture:** Prefer layered architecture (Controller -> Service -> Repository) over monolithic `index.ts` files.
*   **Standards:** Strict adherence to FHIR R4 resources for clinical data.
*   **Naming:** Service directories use short, functional names (e.g., `prescription` not `prescription-service`).
*   **Commits:** Follow conventional commits (feat, fix, chore, etc.).

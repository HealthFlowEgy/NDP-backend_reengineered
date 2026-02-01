# FHIR Gateway Service

## Overview
The **FHIR Gateway** is the "Smart Guard" of the NDP platform. It acts as a secure, compliant proxy in front of the centralized **HAPI FHIR Server**. It enforces Egypt's National Digital Health standards and ensures that all data entering the system is valid and authorized.

## Features
- **Profile Validation:** Enforces strict adherence to Egypt's FHIR Profiles (e.g., verifying National ID formats, EDA coding systems).
- **Authorization:** Intercepts requests to enforce granular Scope-Based Access Control (SBAC). Checks if the user has the correct JWT scopes (e.g., `prescription.create`) for the requested FHIR interaction.
- **Proxy:** Forwards valid, authorized requests to the internal HAPI FHIR server.

## API Reference
The Gateway exposes the standard FHIR R4 REST API but secured.

*   **Base URL:** `http://fhir-gateway:3011`
*   **Endpoints:** Supports all standard FHIR interactions (`GET /ResourceType`, `POST /ResourceType`, etc.).

## Security
*   **Authentication:** Requires a valid Bearer Token (JWT).
*   **Validation:** Rejects requests that do not conform to `services/fhir-gateway/src/middleware/validate-profile.middleware.ts`.

## Architecture
*   **Tech Stack:** Node.js, Express, `http-proxy-middleware`.
*   **Upstream:** Proxies to `hapi-fhir:8080`.

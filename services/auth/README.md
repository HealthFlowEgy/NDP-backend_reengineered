# Auth Service

## Overview
The **Auth Service** handles Authentication (Who are you?) and Authorization (What can you do?). It integrates with **Keycloak** for SSO and **Sunbird RC** for Healthcare Professional Registry (HPR) verification. It issues enriched JWTs containing professional license details and scopes.

## Features
- **Keycloak Integration:** SSO login and token management.
- **Sunbird RC Integration:** Verifies credentials against the National HPR.
- **Enriched Tokens:** Adds license number, facility ID, and scopes to the JWT.
- **Role Mapping:** Maps Keycloak roles (e.g., `doctor`) to granular scopes (`prescription.create`).

## API Reference

### Login
*   **Endpoint:** `POST /api/auth/login`
*   **Body:** `{ username, password }`
*   **Description:** Returns an access token enriched with practitioner data.

### Refresh Token
*   **Endpoint:** `POST /api/auth/refresh`
*   **Body:** `{ refreshToken }`
*   **Description:** Refreshes the session.

### Verify Token
*   **Endpoint:** `GET /api/auth/verify`
*   **Header:** `Authorization: Bearer <token>`
*   **Description:** Validates the token and returns user details.

### Sign Document (Delegated)
*   **Endpoint:** `POST /api/sign`
*   **Body:** `SignatureRequest`
*   **Description:** Signs a document hash using the user's stored key (via Sunbird).

## Architecture
*   **Layered Design:** Routes -> Controller -> Service -> Clients (Keycloak, Sunbird).
*   **Security:** Token generation uses RS256/HS256.

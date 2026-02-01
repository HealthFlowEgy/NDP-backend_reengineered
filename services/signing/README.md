# Signing Service

## Overview
The **Signing Service** provides PKI-based digital signature capabilities. It manages the cryptographic signing of FHIR resources (`MedicationRequest`, `MedicationDispense`) to ensure non-repudiation and integrity. It also generates FHIR `Provenance` resources to track the lineage of signatures.

## Features
- **Digital Signing:** Signs document hashes using stored private keys (Simulated HSM).
- **Verification:** Verifies signatures against public keys/certificates.
- **Provenance Generation:** Automatically creates FHIR `Provenance` resources linking the signature to the data.
- **Certificate Management:** Checks validity (expiry, revocation) of signer certificates.

## API Reference

### Sign Document
*   **Endpoint:** `POST /api/signatures/sign`
*   **Body:** `SigningRequest`
*   **Description:** Returns a digital signature for the provided document hash.

### Verify Signature
*   **Endpoint:** `POST /api/signatures/verify`
*   **Body:** `VerificationRequest`
*   **Description:** Verifies if a signature is valid for a given hash and license.

### Create Provenance
*   **Endpoint:** `POST /fhir/Provenance`
*   **Body:** FHIR Provenance Resource (Partial)
*   **Description:** Convenience endpoint to sign and wrap in a Provenance resource.

## Architecture
*   **Layered Design:** Routes -> Controller -> Service -> Stores (Certificate, Signature).
*   **Stores:** Currently uses in-memory Map stores (POC). Production should use Vault/HSM.

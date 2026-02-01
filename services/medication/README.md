# Medication Directory Service

## Overview
The **Medication Directory Service** acts as the authoritative source for pharmaceutical data (`MedicationKnowledge`). It serves as a search interface for the Egyptian Drug Authority (EDA) database, allowing other services to validate drug codes and retrieve clinical details.

## Features
- **Drug Search:** Fast search by name, EDA code, or active ingredients.
- **Validation:** Verifies if a list of drug codes is valid and active.
- **Recall Management:** Allows the regulator to flag medications as `recalled` or `inactive`.

## API Reference

### Search Medications
*   **Endpoint:** `GET /fhir/MedicationKnowledge`
*   **Query Params:** `name`, `code`, `status`
*   **Description:** Searches the medication directory.

### Get Medication
*   **Endpoint:** `GET /api/medications/:edaCode`
*   **Description:** Retrieves full details for a specific drug code.

### Validate List
*   **Endpoint:** `POST /api/medications/validate`
*   **Body:** `{ edaCodes: string[] }`
*   **Description:** Batch validation of drug codes (checks for recalls/expiry).

### Recall Medication
*   **Endpoint:** `POST /api/medications/:edaCode/recall`
*   **Body:** `{ reason: string, batchNumbers: string[] }`
*   **Description:** Marks a medication as recalled (Regulator only).

## Architecture
*   **Layered Design:** Routes -> Controller -> Service -> Repository.
*   **Data Source:** Proxies read/write operations to the **FHIR Gateway**.

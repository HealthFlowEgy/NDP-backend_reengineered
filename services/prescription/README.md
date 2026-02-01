# Prescription Service

## Overview
The **Prescription Service** is the core component for managing the lifecycle of digital prescriptions (`MedicationRequest` in FHIR). It handles creation, signing, cancellation, and retrieval of prescriptions. It integrates with the **FHIR Gateway** for persistence and the **AI Validator** for clinical safety checks.

## Features
- **Create Prescription:** Validates and creates a draft `MedicationRequest`.
- **Sign Prescription:** Transitions a prescription from `draft` to `active` using a digital signature.
- **Cancel Prescription:** Allows a physician to cancel their own prescriptions.
- **Search:** query prescriptions by patient, status, date, or prescriber.
- **AI Validation:** Automatically checks for drug interactions and dosing errors before creation.

## API Reference

### Create Prescription
*   **Endpoint:** `POST /fhir/MedicationRequest`
*   **Body:** `CreatePrescriptionRequest`
*   **Description:** Creates a draft prescription after AI validation.

### Sign Prescription
*   **Endpoint:** `POST /api/prescriptions/:id/sign`
*   **Body:** `{ signature: string }`
*   **Description:** Activates a prescription.

### Cancel Prescription
*   **Endpoint:** `POST /fhir/MedicationRequest/:id/$cancel`
*   **Body:** `{ reason: string }`
*   **Description:** Cancels an active or draft prescription.

### Get Prescription
*   **Endpoint:** `GET /fhir/MedicationRequest/:id`
*   **Description:** Retrieves a specific prescription by ID.

### Search Prescriptions
*   **Endpoint:** `GET /fhir/MedicationRequest`
*   **Query Params:** `patient`, `identifier`, `status`, `date`
*   **Description:** Searches the prescription registry.

## Architecture
*   **Layered Design:** Routes -> Controller -> Service -> Repository.
*   **Data Source:** Proxies all data operations to the **FHIR Gateway**.

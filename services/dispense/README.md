# Dispense Service

## Overview
The **Dispense Service** manages the fulfillment of prescriptions by pharmacies. It handles the creation of `MedicationDispense` records, validation of dispense eligibility (e.g., remaining quantity, expiry), and updates the status of the original prescription.

## Features
- **Record Dispense:** Creates a `MedicationDispense` record linked to a `MedicationRequest`.
- **Eligibility Check:** Verifies if a prescription is active and has remaining dispenses.
- **Partial Fills:** Supports partial dispensing logic.
- **Search:** Allows pharmacists to find dispense records.

## API Reference

### Create Dispense
*   **Endpoint:** `POST /fhir/MedicationDispense`
*   **Body:** `CreateDispenseRequest`
*   **Description:** Records a dispense event. Updates the linked prescription's remaining dispenses.

### Get Dispense
*   **Endpoint:** `GET /fhir/MedicationDispense/:id`
*   **Description:** Retrieves a specific dispense record.

### Search Dispenses
*   **Endpoint:** `GET /fhir/MedicationDispense`
*   **Query Params:** `patient`, `prescription`
*   **Description:** Searches dispense history.

## Architecture
*   **Layered Design:** Routes -> Controller -> Service -> Repository.
*   **Data Source:** Proxies all data operations to the **FHIR Gateway**.

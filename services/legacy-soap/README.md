# Legacy SOAP Adapter (v2.0)

## Overview
The **Legacy SOAP Adapter** is a high-performance bridge that enables legacy Hospital Information Systems (HIS) to communicate with the NDP platform using SOAP/XML. It translates SOAP requests into internal REST/FHIR calls.

## Features
- **Protocol Translation:** SOAP (XML) <-> REST (JSON).
- **Asynchronous Processing:** Uses **Apache Kafka** to handle high-volume write operations (Create, Dispense) asynchronously.
- **Caching:** Uses **Redis** to cache read operations (GetPrescription) for low latency.
- **Resilience:** Implements Circuit Breakers and Rate Limiting to protect backend services.

## API Reference

### SOAP Endpoint
*   **URL:** `POST /soap/prescription`
*   **Content-Type:** `text/xml`
*   **Actions:**
    *   `CreatePrescription` (Async)
    *   `GetPrescription` (Sync)
    *   `RecordDispense` (Async)
    *   `GetStatus` (Poll for async result)

### WSDL
*   **URL:** `GET /soap/prescription?wsdl`
*   **Description:** Returns the service definition.

### Async Status
*   **URL:** `GET /api/legacy/status/:trackingId`
*   **Description:** Check the status of an asynchronous SOAP request.

## Architecture
*   **Layered Design:** Routes -> Controller -> Service -> Utils.
*   **Dependencies:** Kafka, Redis, Prescription Service, Dispense Service.

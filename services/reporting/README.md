# Reporting Service

## Overview
The **Reporting Service** is an asynchronous job engine for generating detailed reports in various formats (JSON, CSV). It allows administrators and regulators to extract deep insights from the platform.

## Features
- **Async Job Queue:** Handles long-running report generation without blocking the API.
- **Multiple Formats:** Supports JSON and CSV export.
- **Report Types:** Prescription Summary, Dispense Summary, Patient History, Physician Activity.

## API Reference

### Create Report
*   **Endpoint:** `POST /api/reports`
*   **Body:** `{ type: string, parameters: object }`
*   **Description:** Queues a new report generation job.

### Get Job Status
*   **Endpoint:** `GET /api/reports/:id`
*   **Description:** Checks if a report is ready.

### Download Report
*   **Endpoint:** `GET /api/reports/:id/download`
*   **Description:** Downloads the generated report data.

## Architecture
*   **Layered Design:** Routes -> Controller -> Service -> Report Generators.

# Regulator Portal Service

## Overview
The **Regulator Portal Service** provides tools for the Egyptian Drug Authority (EDA) to oversee the national prescription ecosystem. It manages drug recalls, monitors compliance alerts, and aggregates platform statistics.

## Features
- **Drug Recalls:** Initiate and manage Class I, II, and III recalls. Automatically notifies affected patients and blocks dispensing.
- **Compliance Alerts:** Automated detection of suspicious activities (e.g., over-prescribing opioids).
- **Dashboard:** Real-time statistics on prescription volume, dispensing rates, and active alerts.

## API Reference

### Dashboard
*   **Endpoint:** `GET /api/regulator/dashboard`
*   **Description:** Returns aggregated system metrics.

### Recalls
*   **Endpoint:** `POST /api/regulator/recalls`
*   **Body:** `InitiateRecallRequest`
*   **Description:** Creates a new drug recall.

### Alerts
*   **Endpoint:** `GET /api/regulator/alerts`
*   **Description:** Lists compliance alerts.

## Architecture
*   **Layered Design:** Routes -> Controller -> Services (Recall, Compliance, Analytics).

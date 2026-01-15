#!/bin/bash
# ============================================================================
# NDP Regulator Portal & Reporting Test Script
# Tests drug recalls, compliance alerts, analytics, and reports
# ============================================================================

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "================================================"
echo "NDP Regulator Portal & Reporting Test Suite"
echo "Base URL: $BASE_URL"
echo "================================================"

# ============================================================================
# 1. Health Checks
# ============================================================================
echo ""
echo "1. Health Checks"
echo "----------------"

curl -s "http://localhost:3009/health" | jq '.' 2>/dev/null || echo "Regulator service not responding"
curl -s "http://localhost:3010/health" | jq '.' 2>/dev/null || echo "Reporting service not responding"

# ============================================================================
# 2. Dashboard Statistics
# ============================================================================
echo ""
echo "2. Dashboard Statistics"
echo "-----------------------"

curl -s "$BASE_URL/api/regulator/dashboard" \
    -H "Content-Type: application/json" \
    -H "x-user-role: regulator" | jq '{
    prescriptions: .prescriptions.today,
    dispenses: .dispenses.today,
    activeRecalls: .activeRecalls,
    openAlerts: .openAlerts,
    topMedications: [.topPrescribedMedications[0:3][] | .name]
}' 2>/dev/null

# ============================================================================
# 3. Prescription Trends
# ============================================================================
echo ""
echo "3. Prescription Trends (Last 7 Days)"
echo "-------------------------------------"

curl -s "$BASE_URL/api/regulator/trends?days=7" \
    -H "Content-Type: application/json" \
    -H "x-user-role: regulator" | jq '.[0:3]' 2>/dev/null

# ============================================================================
# 4. Initiate Drug Recall
# ============================================================================
echo ""
echo "4. Initiate Drug Recall"
echo "-----------------------"

RECALL_RESPONSE=$(curl -s -X POST "$BASE_URL/api/regulator/recalls" \
    -H "Content-Type: application/json" \
    -H "x-user-role: regulator" \
    -H "x-user-id: REG-00001" \
    -d '{
        "edaCode": "TEST001",
        "medicationName": "Test Medication 500mg",
        "manufacturer": "Test Pharma Co",
        "batchNumbers": ["BATCH-2024-001", "BATCH-2024-002"],
        "recallType": "mandatory",
        "recallClass": "II",
        "reason": "Potential contamination detected during routine quality testing",
        "healthHazard": "Low risk of adverse effects. Discontinue use as precaution.",
        "instructions": "Return unused medication to pharmacy.",
        "affectedRegions": ["Cairo", "Alexandria", "Giza"]
    }')

echo "$RECALL_RESPONSE" | jq '{
    id: .id,
    medicationName: .medicationName,
    recallClass: .recallClass,
    status: .status
}' 2>/dev/null

RECALL_ID=$(echo "$RECALL_RESPONSE" | jq -r '.id' 2>/dev/null)

# ============================================================================
# 5. Get Active Recalls
# ============================================================================
echo ""
echo "5. Get Active Recalls"
echo "---------------------"

curl -s "$BASE_URL/api/regulator/recalls/active" \
    -H "x-user-role: regulator" | jq '[.[] | {id: .id[0:8], medication: .medicationName, class: .recallClass}]' 2>/dev/null

# ============================================================================
# 6. Compliance Alerts
# ============================================================================
echo ""
echo "6. Open Compliance Alerts"
echo "-------------------------"

curl -s "$BASE_URL/api/regulator/alerts/open" \
    -H "x-user-role: regulator" | jq 'length' 2>/dev/null
echo " alerts found"

# ============================================================================
# 7. Run Compliance Checks
# ============================================================================
echo ""
echo "7. Run Compliance Checks"
echo "------------------------"

curl -s -X POST "$BASE_URL/api/regulator/compliance/check" \
    -H "x-user-role: regulator" | jq '.' 2>/dev/null

# ============================================================================
# 8. Medication Analytics
# ============================================================================
echo ""
echo "8. Medication Analytics (Paracetamol)"
echo "-------------------------------------"

curl -s "$BASE_URL/api/regulator/medications/PAR001/analytics" \
    -H "x-user-role: regulator" | jq '{
    totalPrescribed: .totalPrescribed,
    totalDispensed: .totalDispensed,
    avgQuantity: .avgQuantityPerPrescription
}' 2>/dev/null

# ============================================================================
# 9. Practitioner Analytics
# ============================================================================
echo ""
echo "9. Practitioner Analytics"
echo "-------------------------"

curl -s "$BASE_URL/api/regulator/practitioners/EMS-12345/analytics" \
    -H "x-user-role: regulator" | jq '{
    name: .name,
    specialty: .specialty,
    prescriptionCount: .prescriptionCount,
    complianceScore: .complianceScore
}' 2>/dev/null

# ============================================================================
# 10. Generate Prescription Summary Report
# ============================================================================
echo ""
echo "10. Generate Prescription Summary Report"
echo "----------------------------------------"

REPORT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/reports" \
    -H "Content-Type: application/json" \
    -H "x-user-id: REG-00001" \
    -d '{
        "type": "prescription_summary",
        "format": "json",
        "parameters": {
            "fromDate": "2026-01-01",
            "toDate": "2026-01-15"
        }
    }')

echo "$REPORT_RESPONSE" | jq '{id: .id, type: .type, status: .status}' 2>/dev/null

REPORT_ID=$(echo "$REPORT_RESPONSE" | jq -r '.id' 2>/dev/null)

# Wait for report
sleep 1

# ============================================================================
# 11. Quick Daily Summary Report
# ============================================================================
echo ""
echo "11. Quick Daily Summary Report"
echo "------------------------------"

curl -s "$BASE_URL/api/reports/quick/daily" | jq '{
    title: .title,
    metrics: [.rows[0:3][] | {metric: .[0], value: .[1]}]
}' 2>/dev/null

# ============================================================================
# 12. Controlled Substances Report
# ============================================================================
echo ""
echo "12. Controlled Substances Report"
echo "--------------------------------"

curl -s "$BASE_URL/api/regulator/reports/controlled-substances" \
    -H "x-user-role: regulator" | jq '{
    substances: .controlledSubstances,
    alertCount: (.alerts | length)
}' 2>/dev/null

# ============================================================================
# 13. Audit Log
# ============================================================================
echo ""
echo "13. Audit Log (Recent)"
echo "----------------------"

curl -s "$BASE_URL/api/regulator/audit?limit=3" \
    -H "x-user-role: regulator" | jq '[.[] | {action: .action, resource: .resourceType}]' 2>/dev/null

# ============================================================================
# 14. List Recent Reports
# ============================================================================
echo ""
echo "14. Recent Report Jobs"
echo "----------------------"

curl -s "$BASE_URL/api/reports?limit=3" | jq '[.[] | {type: .type, status: .status}]' 2>/dev/null

# ============================================================================
# 15. Download Report as CSV
# ============================================================================
echo ""
echo "15. Download Report as CSV (First 5 lines)"
echo "-------------------------------------------"

if [ -n "$REPORT_ID" ] && [ "$REPORT_ID" != "null" ]; then
    curl -s "$BASE_URL/api/reports/$REPORT_ID/download?format=csv" | head -5
fi

echo ""
echo "================================================"
echo "Regulator & Reporting Test Complete"
echo "================================================"
echo ""
echo "Report Types: prescription_summary, dispense_summary,"
echo "  medication_usage, controlled_substances, daily_summary"
echo ""
echo "Recall Classes: I (severe), II (moderate), III (minor)"

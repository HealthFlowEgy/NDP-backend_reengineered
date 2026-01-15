#!/bin/bash
# ============================================================================
# NDP AI Validation Test Script
# Tests drug interactions, dosing alerts, and contraindications
# ============================================================================

BASE_URL="${BASE_URL:-http://localhost:3000}"
AI_URL="${AI_URL:-http://localhost:3006}"

echo "================================================"
echo "NDP AI Validation Test Suite"
echo "Base URL: $BASE_URL"
echo "AI Service URL: $AI_URL"
echo "================================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ============================================================================
# 1. Health Check
# ============================================================================
echo ""
echo "1. Health Check"
echo "---------------"

curl -s "$AI_URL/health" | jq '.' 2>/dev/null || echo "AI service not responding"

# ============================================================================
# 2. Test Drug-Drug Interaction: Warfarin + Ibuprofen
# ============================================================================
echo ""
echo "2. Drug Interaction Test: Warfarin + Ibuprofen (MAJOR)"
echo "------------------------------------------------------"

INTERACTION_TEST=$(curl -s -X POST "$BASE_URL/api/validate" \
    -H "Content-Type: application/json" \
    -d '{
        "patientNationalId": "29901011234567",
        "medications": [
            {
                "edaCode": "WAR001",
                "name": "Warfarin 5mg",
                "dose": 5,
                "doseUnit": "mg",
                "frequency": "once daily"
            },
            {
                "edaCode": "IBU001",
                "name": "Ibuprofen 400mg",
                "dose": 400,
                "doseUnit": "mg",
                "frequency": "three times daily"
            }
        ]
    }')

echo "$INTERACTION_TEST" | jq '{
    passed: .passed,
    score: .overallScore,
    interactions: [.drugInteractions[] | {drugs: "\(.drug1Name) + \(.drug2Name)", severity: .severity, description: .description}]
}' 2>/dev/null || echo "$INTERACTION_TEST"

# ============================================================================
# 3. Test Contraindicated Combination: SSRI + MAOI
# ============================================================================
echo ""
echo "3. Contraindicated Combination: SSRI + MAOI"
echo "-------------------------------------------"

CONTRAINDICATED_TEST=$(curl -s -X POST "$BASE_URL/api/validate" \
    -H "Content-Type: application/json" \
    -d '{
        "patientNationalId": "29901011234567",
        "medications": [
            {
                "edaCode": "FLU001",
                "name": "Fluoxetine 20mg",
                "dose": 20,
                "doseUnit": "mg",
                "frequency": "once daily"
            },
            {
                "edaCode": "PHE001",
                "name": "Phenelzine 15mg",
                "dose": 15,
                "doseUnit": "mg",
                "frequency": "twice daily"
            }
        ]
    }')

echo "$CONTRAINDICATED_TEST" | jq '{
    passed: .passed,
    score: .overallScore,
    summary: .summary,
    interactions: .drugInteractions
}' 2>/dev/null || echo "$CONTRAINDICATED_TEST"

# ============================================================================
# 4. Test Dosing Alert: Paracetamol Overdose
# ============================================================================
echo ""
echo "4. Dosing Alert Test: Paracetamol Overdose (>4g/day)"
echo "----------------------------------------------------"

DOSE_TEST=$(curl -s -X POST "$BASE_URL/api/validate" \
    -H "Content-Type: application/json" \
    -d '{
        "patientNationalId": "29901011234567",
        "medications": [
            {
                "edaCode": "PAR001",
                "name": "Paracetamol 1000mg",
                "dose": 1000,
                "doseUnit": "mg",
                "frequency": "every 4 hours"
            }
        ]
    }')

echo "$DOSE_TEST" | jq '{
    passed: .passed,
    score: .overallScore,
    dosingAlerts: .dosingAlerts
}' 2>/dev/null || echo "$DOSE_TEST"

# ============================================================================
# 5. Test Renal Adjustment: Metformin in Renal Impairment
# ============================================================================
echo ""
echo "5. Renal Adjustment Test: Metformin in Severe Renal Impairment"
echo "--------------------------------------------------------------"

RENAL_TEST=$(curl -s -X POST "$BASE_URL/api/validate" \
    -H "Content-Type: application/json" \
    -d '{
        "patientNationalId": "29901011234567",
        "renalFunction": "severe",
        "medications": [
            {
                "edaCode": "MET001",
                "name": "Metformin 500mg",
                "dose": 500,
                "doseUnit": "mg",
                "frequency": "twice daily"
            }
        ]
    }')

echo "$RENAL_TEST" | jq '{
    passed: .passed,
    score: .overallScore,
    dosingAlerts: .dosingAlerts
}' 2>/dev/null || echo "$RENAL_TEST"

# ============================================================================
# 6. Test Allergy Alert
# ============================================================================
echo ""
echo "6. Allergy Alert Test: Penicillin Allergy + Amoxicillin"
echo "-------------------------------------------------------"

ALLERGY_TEST=$(curl -s -X POST "$BASE_URL/api/validate" \
    -H "Content-Type: application/json" \
    -d '{
        "patientNationalId": "29901011234567",
        "patientAllergies": ["Penicillin"],
        "medications": [
            {
                "edaCode": "AMO001",
                "name": "Amoxicillin 500mg",
                "genericName": "Amoxicillin",
                "dose": 500,
                "doseUnit": "mg",
                "frequency": "three times daily"
            }
        ]
    }')

echo "$ALLERGY_TEST" | jq '{
    passed: .passed,
    score: .overallScore,
    allergyAlerts: .allergyAlerts
}' 2>/dev/null || echo "$ALLERGY_TEST"

# ============================================================================
# 7. Test Contraindication: NSAIDs in Peptic Ulcer
# ============================================================================
echo ""
echo "7. Contraindication Test: NSAIDs in Peptic Ulcer"
echo "------------------------------------------------"

CONTRA_TEST=$(curl -s -X POST "$BASE_URL/api/validate" \
    -H "Content-Type: application/json" \
    -d '{
        "patientNationalId": "29901011234567",
        "patientConditions": ["Peptic Ulcer Disease"],
        "medications": [
            {
                "edaCode": "DIC001",
                "name": "Diclofenac 50mg",
                "dose": 50,
                "doseUnit": "mg",
                "frequency": "twice daily"
            }
        ]
    }')

echo "$CONTRA_TEST" | jq '{
    passed: .passed,
    score: .overallScore,
    contraindicationAlerts: .contraindicationAlerts
}' 2>/dev/null || echo "$CONTRA_TEST"

# ============================================================================
# 8. Test Duplicate Therapy
# ============================================================================
echo ""
echo "8. Duplicate Therapy Test: Two SSRIs"
echo "-------------------------------------"

DUPLICATE_TEST=$(curl -s -X POST "$BASE_URL/api/validate" \
    -H "Content-Type: application/json" \
    -d '{
        "patientNationalId": "29901011234567",
        "medications": [
            {
                "edaCode": "SER001",
                "name": "Sertraline 50mg",
                "genericName": "Sertraline",
                "dose": 50,
                "doseUnit": "mg",
                "frequency": "once daily"
            },
            {
                "edaCode": "FLU001",
                "name": "Fluoxetine 20mg",
                "genericName": "Fluoxetine",
                "dose": 20,
                "doseUnit": "mg",
                "frequency": "once daily"
            }
        ]
    }')

echo "$DUPLICATE_TEST" | jq '{
    passed: .passed,
    score: .overallScore,
    duplicateTherapyAlerts: .duplicateTherapyAlerts
}' 2>/dev/null || echo "$DUPLICATE_TEST"

# ============================================================================
# 9. Test Clean Prescription (Should Pass)
# ============================================================================
echo ""
echo "9. Clean Prescription Test (Should Pass)"
echo "----------------------------------------"

CLEAN_TEST=$(curl -s -X POST "$BASE_URL/api/validate" \
    -H "Content-Type: application/json" \
    -d '{
        "patientNationalId": "29901011234567",
        "medications": [
            {
                "edaCode": "PAR001",
                "name": "Paracetamol 500mg",
                "dose": 500,
                "doseUnit": "mg",
                "frequency": "every 6 hours"
            },
            {
                "edaCode": "AMO001",
                "name": "Amoxicillin 500mg",
                "dose": 500,
                "doseUnit": "mg",
                "frequency": "three times daily"
            }
        ]
    }')

echo "$CLEAN_TEST" | jq '{
    passed: .passed,
    score: .overallScore,
    summary: .summary,
    recommendations: .recommendations
}' 2>/dev/null || echo "$CLEAN_TEST"

# ============================================================================
# 10. Quick Interaction Check API
# ============================================================================
echo ""
echo "10. Quick Interaction Check API"
echo "-------------------------------"

QUICK_CHECK=$(curl -s -X POST "$BASE_URL/api/interactions/check" \
    -H "Content-Type: application/json" \
    -d '{
        "medications": [
            {"edaCode": "DIG001", "name": "Digoxin 0.25mg"},
            {"edaCode": "AMI001", "name": "Amiodarone 200mg"}
        ]
    }')

echo "$QUICK_CHECK" | jq '.' 2>/dev/null || echo "$QUICK_CHECK"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "================================================"
echo "Test Complete"
echo "================================================"
echo ""
echo "Interaction severity levels:"
echo "  - minor: Low risk, monitor"
echo "  - moderate: May require dose adjustment"
echo "  - major: Significant risk, avoid if possible"
echo "  - contraindicated: Should not be combined"
echo ""

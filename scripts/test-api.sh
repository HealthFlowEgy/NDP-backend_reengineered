#!/bin/bash
# ============================================================================
# NDP Backend API Test Script
# Tests authentication, prescription creation, signing, and dispensing
# ============================================================================

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_URL="${AUTH_URL:-http://localhost:3004}"

echo "================================================"
echo "NDP Backend API Test Suite"
echo "Base URL: $BASE_URL"
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function
check_response() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ $2${NC}"
    else
        echo -e "${RED}✗ $2${NC}"
        return 1
    fi
}

# ============================================================================
# 1. Health Checks
# ============================================================================
echo ""
echo "1. Health Checks"
echo "----------------"

curl -s "$BASE_URL/health" > /dev/null
check_response $? "API Gateway health"

curl -s "http://localhost:3001/health" > /dev/null 2>&1
check_response $? "Prescription Service health"

curl -s "http://localhost:3002/health" > /dev/null 2>&1
check_response $? "Dispense Service health"

curl -s "http://localhost:3003/health" > /dev/null 2>&1
check_response $? "Medication Directory health"

curl -s "http://localhost:3004/health" > /dev/null 2>&1
check_response $? "Auth Service health"

curl -s "http://localhost:3005/health" > /dev/null 2>&1
check_response $? "Signing Service health"

# ============================================================================
# 2. Authentication Tests
# ============================================================================
echo ""
echo "2. Authentication Tests"
echo "-----------------------"

# Login as physician
echo "Logging in as physician (EMS-12345)..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "EMS-12345",
        "password": "password123"
    }')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -n "$ACCESS_TOKEN" ]; then
    echo -e "${GREEN}✓ Physician login successful${NC}"
    echo "  Token: ${ACCESS_TOKEN:0:50}..."
else
    echo -e "${YELLOW}⚠ Auth service not available, using mock token${NC}"
    # Generate mock token for testing
    ACCESS_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJsaWNlbnNlIjoiRU1TLTEyMzQ1IiwibmFtZSI6IkRyLiBBaG1lZCBNb2hhbWVkIiwicm9sZSI6InBoeXNpY2lhbiIsInNwZWNpYWx0eSI6IkludGVybmFsIE1lZGljaW5lIiwiZmFjaWxpdHlfaWQiOiJIT1NQLTAwMSIsImZhY2lsaXR5X25hbWUiOiJDYWlybyBHZW5lcmFsIEhvc3BpdGFsIiwic2NvcGVzIjpbInByZXNjcmlwdGlvbi5jcmVhdGUiLCJwcmVzY3JpcHRpb24uc2lnbiIsInByZXNjcmlwdGlvbi52aWV3Il0sImlhdCI6MTcwNTAwMDAwMCwiZXhwIjoxODA1MDAwMDAwfQ."
fi

# Verify token
echo "Verifying token..."
VERIFY_RESPONSE=$(curl -s "$BASE_URL/api/auth/verify" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
echo "  Verify response: ${VERIFY_RESPONSE:0:100}..."

# ============================================================================
# 3. Medication Directory Tests
# ============================================================================
echo ""
echo "3. Medication Directory Tests"
echo "-----------------------------"

# Search medications
echo "Searching medications..."
MEDS_RESPONSE=$(curl -s "$BASE_URL/fhir/MedicationKnowledge?name=para&_count=5")
MEDS_COUNT=$(echo $MEDS_RESPONSE | grep -o '"total":[0-9]*' | cut -d':' -f2)
echo "  Found medications: $MEDS_COUNT"

# Get medication by code (if exists)
echo "Getting medication by EDA code..."
MED_RESPONSE=$(curl -s "$BASE_URL/api/medications/12345")
echo "  Response: ${MED_RESPONSE:0:100}..."

# ============================================================================
# 4. Prescription Tests
# ============================================================================
echo ""
echo "4. Prescription Tests"
echo "---------------------"

# Create prescription
echo "Creating prescription..."
CREATE_RX_RESPONSE=$(curl -s -X POST "$BASE_URL/fhir/MedicationRequest" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d '{
        "patientNationalId": "29901011234567",
        "patientName": "Test Patient",
        "medications": [
            {
                "edaCode": "12345",
                "medicationName": "Paracetamol 500mg",
                "quantity": 20,
                "unit": "tablet",
                "dosageInstruction": "Take 1 tablet every 6 hours as needed for pain",
                "frequency": "every 6 hours",
                "duration": "7 days",
                "route": "oral"
            },
            {
                "edaCode": "67890",
                "medicationName": "Amoxicillin 500mg",
                "quantity": 21,
                "unit": "capsule",
                "dosageInstruction": "Take 1 capsule three times daily",
                "frequency": "three times daily",
                "duration": "7 days",
                "route": "oral"
            }
        ],
        "notes": "Patient has no known allergies",
        "allowedDispenses": 1,
        "validityDays": 30
    }')

PRESCRIPTION_ID=$(echo $CREATE_RX_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
PRESCRIPTION_NUMBER=$(echo $CREATE_RX_RESPONSE | grep -o '"prescriptionNumber":"[^"]*"' | cut -d'"' -f4)

if [ -n "$PRESCRIPTION_ID" ]; then
    echo -e "${GREEN}✓ Prescription created${NC}"
    echo "  ID: $PRESCRIPTION_ID"
    echo "  Number: $PRESCRIPTION_NUMBER"
else
    echo -e "${RED}✗ Failed to create prescription${NC}"
    echo "  Response: $CREATE_RX_RESPONSE"
fi

# Get prescription
if [ -n "$PRESCRIPTION_ID" ]; then
    echo "Getting prescription..."
    GET_RX_RESPONSE=$(curl -s "$BASE_URL/fhir/MedicationRequest/$PRESCRIPTION_ID" \
        -H "Authorization: Bearer $ACCESS_TOKEN")
    RX_STATUS=$(echo $GET_RX_RESPONSE | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    echo "  Status: $RX_STATUS"
fi

# ============================================================================
# 5. Digital Signature Tests
# ============================================================================
echo ""
echo "5. Digital Signature Tests"
echo "--------------------------"

# Get certificate info
echo "Getting certificate info..."
CERT_RESPONSE=$(curl -s "$BASE_URL/api/certificates/EMS-12345")
CERT_ID=$(echo $CERT_RESPONSE | grep -o '"certificateId":"[^"]*"' | cut -d'"' -f4)
if [ -n "$CERT_ID" ]; then
    echo -e "${GREEN}✓ Certificate found: $CERT_ID${NC}"
else
    echo -e "${YELLOW}⚠ Certificate not found (signing service may not be running)${NC}"
fi

# Sign prescription
if [ -n "$PRESCRIPTION_ID" ]; then
    echo "Signing prescription..."
    SIGN_RESPONSE=$(curl -s -X POST "$BASE_URL/fhir/MedicationRequest/$PRESCRIPTION_ID/\$sign" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $ACCESS_TOKEN")
    
    SIGNED_STATUS=$(echo $SIGN_RESPONSE | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    SIGNATURE=$(echo $SIGN_RESPONSE | grep -o '"signatureData":"[^"]*"' | cut -d'"' -f4)
    
    if [ "$SIGNED_STATUS" = "active" ] || [ -n "$SIGNATURE" ]; then
        echo -e "${GREEN}✓ Prescription signed${NC}"
        echo "  New status: $SIGNED_STATUS"
        echo "  Signature: ${SIGNATURE:0:50}..."
    else
        echo -e "${YELLOW}⚠ Signing may have issues${NC}"
        echo "  Response: ${SIGN_RESPONSE:0:200}..."
    fi
fi

# ============================================================================
# 6. Dispense Tests
# ============================================================================
echo ""
echo "6. Dispense Tests"
echo "-----------------"

# Login as pharmacist
echo "Logging in as pharmacist (PH-11111)..."
PHARM_LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "PH-11111",
        "password": "password123"
    }')

PHARM_TOKEN=$(echo $PHARM_LOGIN | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$PHARM_TOKEN" ]; then
    echo -e "${YELLOW}⚠ Using mock pharmacist token${NC}"
    PHARM_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwaGFybS11c2VyIiwibGljZW5zZSI6IlBILTExMTExIiwibmFtZSI6IkRyLiBPbWFyIFBoYXJtYWN5Iiwicm9sZSI6InBoYXJtYWNpc3QiLCJmYWNpbGl0eV9pZCI6IlBIQVJNLTAwMSIsImZhY2lsaXR5X25hbWUiOiJDZW50cmFsIFBoYXJtYWN5Iiwic2NvcGVzIjpbImRpc3BlbnNlLmNyZWF0ZSIsImRpc3BlbnNlLnZpZXciLCJwcmVzY3JpcHRpb24udmlldyJdLCJpYXQiOjE3MDUwMDAwMDAsImV4cCI6MTgwNTAwMDAwMH0."
fi

# Create dispense
if [ -n "$PRESCRIPTION_ID" ]; then
    echo "Creating dispense..."
    DISPENSE_RESPONSE=$(curl -s -X POST "$BASE_URL/fhir/MedicationDispense" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $PHARM_TOKEN" \
        -d "{
            \"prescriptionId\": \"$PRESCRIPTION_ID\",
            \"pharmacyId\": \"PHARM-001\",
            \"pharmacyName\": \"Central Pharmacy\",
            \"dispensedItems\": [
                {
                    \"medicationCode\": \"12345\",
                    \"dispensedQuantity\": 20,
                    \"batchNumber\": \"BATCH-2024-001\"
                },
                {
                    \"medicationCode\": \"67890\",
                    \"dispensedQuantity\": 21,
                    \"batchNumber\": \"BATCH-2024-002\"
                }
            ],
            \"notes\": \"Full dispense\"
        }")
    
    DISPENSE_ID=$(echo $DISPENSE_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    DISPENSE_STATUS=$(echo $DISPENSE_RESPONSE | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$DISPENSE_ID" ]; then
        echo -e "${GREEN}✓ Dispense created${NC}"
        echo "  ID: $DISPENSE_ID"
        echo "  Status: $DISPENSE_STATUS"
    else
        echo -e "${YELLOW}⚠ Dispense may have issues${NC}"
        echo "  Response: ${DISPENSE_RESPONSE:0:200}..."
    fi
fi

# ============================================================================
# 7. Search Tests
# ============================================================================
echo ""
echo "7. Search Tests"
echo "---------------"

# Search prescriptions by patient
echo "Searching prescriptions by patient..."
SEARCH_RESPONSE=$(curl -s "$BASE_URL/fhir/MedicationRequest?patient=29901011234567" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
SEARCH_TOTAL=$(echo $SEARCH_RESPONSE | grep -o '"total":[0-9]*' | cut -d':' -f2)
echo "  Found prescriptions for patient: $SEARCH_TOTAL"

# Search active prescriptions
echo "Searching active prescriptions..."
ACTIVE_RESPONSE=$(curl -s "$BASE_URL/fhir/MedicationRequest?status=active" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
ACTIVE_TOTAL=$(echo $ACTIVE_RESPONSE | grep -o '"total":[0-9]*' | cut -d':' -f2)
echo "  Active prescriptions: $ACTIVE_TOTAL"

# ============================================================================
# 8. FHIR Capability Statement
# ============================================================================
echo ""
echo "8. FHIR Capability Statement"
echo "----------------------------"

CAPABILITY_RESPONSE=$(curl -s "$BASE_URL/fhir/metadata")
FHIR_VERSION=$(echo $CAPABILITY_RESPONSE | grep -o '"fhirVersion":"[^"]*"' | cut -d'"' -f4)
echo "  FHIR Version: $FHIR_VERSION"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "================================================"
echo "Test Summary"
echo "================================================"
echo "Prescription ID: $PRESCRIPTION_ID"
echo "Prescription Number: $PRESCRIPTION_NUMBER"
echo "Dispense ID: $DISPENSE_ID"
echo ""
echo "To run individual tests:"
echo "  curl $BASE_URL/fhir/MedicationRequest/$PRESCRIPTION_ID"
echo "  curl $BASE_URL/fhir/MedicationDispense/$DISPENSE_ID"
echo ""

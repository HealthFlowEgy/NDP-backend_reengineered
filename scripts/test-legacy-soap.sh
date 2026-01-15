#!/bin/bash
# ============================================================================
# NDP Legacy SOAP API Test Script
# Tests SOAP endpoints for backward compatibility
# ============================================================================

BASE_URL="${BASE_URL:-http://localhost:3000}"
SOAP_URL="${SOAP_URL:-http://localhost:3007}"

echo "================================================"
echo "NDP Legacy SOAP API Test Suite"
echo "SOAP Endpoint: $BASE_URL/soap/prescription"
echo "================================================"

# ============================================================================
# 1. Health Check
# ============================================================================
echo ""
echo "1. Health Check"
echo "---------------"
curl -s "$SOAP_URL/health" | jq '.' 2>/dev/null || echo "Service not responding"

# ============================================================================
# 2. Get WSDL
# ============================================================================
echo ""
echo "2. WSDL Endpoint"
echo "----------------"
echo "WSDL available at: $BASE_URL/soap/prescription?wsdl"
curl -s "$BASE_URL/soap/prescription?wsdl" | head -20

# ============================================================================
# 3. Create Prescription (SOAP)
# ============================================================================
echo ""
echo ""
echo "3. Create Prescription (SOAP)"
echo "-----------------------------"

CREATE_SOAP='<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ndp="http://ndp.egypt.gov.eg/soap/prescription">
  <soap:Header>
    <ndp:AuthToken>test-token</ndp:AuthToken>
  </soap:Header>
  <soap:Body>
    <ndp:CreatePrescription>
      <Prescription>
        <PatientNationalID>29901011234567</PatientNationalID>
        <PatientName>أحمد محمد</PatientName>
        <Medications>
          <Medication>
            <DrugCode>PAR001</DrugCode>
            <DrugName>Paracetamol 500mg</DrugName>
            <Quantity>20</Quantity>
            <Unit>tablet</Unit>
            <Dosage>500mg</Dosage>
            <Frequency>every 6 hours</Frequency>
            <Duration>7 days</Duration>
            <Route>oral</Route>
          </Medication>
        </Medications>
        <Notes>Test prescription via SOAP</Notes>
        <AllowedDispenses>1</AllowedDispenses>
      </Prescription>
    </ndp:CreatePrescription>
  </soap:Body>
</soap:Envelope>'

echo "$CREATE_SOAP" | curl -s -X POST "$BASE_URL/soap/prescription" \
    -H "Content-Type: text/xml; charset=utf-8" \
    -H "SOAPAction: CreatePrescription" \
    -d @- | head -30

# ============================================================================
# 4. Get Prescription (SOAP)
# ============================================================================
echo ""
echo ""
echo "4. Get Prescription (SOAP)"
echo "--------------------------"

GET_SOAP='<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ndp="http://ndp.egypt.gov.eg/soap/prescription">
  <soap:Body>
    <ndp:GetPrescription>
      <PrescriptionNumber>RX-2026-00000001</PrescriptionNumber>
    </ndp:GetPrescription>
  </soap:Body>
</soap:Envelope>'

echo "$GET_SOAP" | curl -s -X POST "$BASE_URL/soap/prescription" \
    -H "Content-Type: text/xml; charset=utf-8" \
    -H "SOAPAction: GetPrescription" \
    -d @- | head -50

# ============================================================================
# 5. Search Drugs (SOAP)
# ============================================================================
echo ""
echo ""
echo "5. Search Drugs (SOAP)"
echo "----------------------"

SEARCH_DRUGS_SOAP='<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ndp="http://ndp.egypt.gov.eg/soap/prescription">
  <soap:Body>
    <ndp:SearchDrugs>
      <SearchTerm>paracetamol</SearchTerm>
      <MaxResults>5</MaxResults>
    </ndp:SearchDrugs>
  </soap:Body>
</soap:Envelope>'

echo "$SEARCH_DRUGS_SOAP" | curl -s -X POST "$BASE_URL/soap/prescription" \
    -H "Content-Type: text/xml; charset=utf-8" \
    -H "SOAPAction: SearchDrugs" \
    -d @- | head -30

# ============================================================================
# 6. Verify Prescription (SOAP)
# ============================================================================
echo ""
echo ""
echo "6. Verify Prescription (SOAP)"
echo "-----------------------------"

VERIFY_SOAP='<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ndp="http://ndp.egypt.gov.eg/soap/prescription">
  <soap:Body>
    <ndp:VerifyPrescription>
      <PrescriptionNumber>RX-2026-00000001</PrescriptionNumber>
      <PatientNationalID>29901011234567</PatientNationalID>
    </ndp:VerifyPrescription>
  </soap:Body>
</soap:Envelope>'

echo "$VERIFY_SOAP" | curl -s -X POST "$BASE_URL/soap/prescription" \
    -H "Content-Type: text/xml; charset=utf-8" \
    -H "SOAPAction: VerifyPrescription" \
    -d @- | head -20

# ============================================================================
# 7. REST Compatibility Endpoints
# ============================================================================
echo ""
echo ""
echo "7. REST Compatibility Endpoints"
echo "-------------------------------"

echo "Creating prescription via REST compatibility endpoint..."
curl -s -X POST "$BASE_URL/api/legacy/prescription" \
    -H "Content-Type: application/json" \
    -d '{
        "PatientNationalID": "29901011234567",
        "PatientName": "Test Patient",
        "Medications": [{
            "DrugCode": "AMO001",
            "DrugName": "Amoxicillin 500mg",
            "Quantity": 21,
            "Unit": "capsule",
            "Dosage": "500mg",
            "Frequency": "three times daily"
        }]
    }' | jq '.' 2>/dev/null || echo "Error"

echo ""
echo "================================================"
echo "SOAP Test Complete"
echo "================================================"

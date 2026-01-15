#!/bin/bash
# ============================================================================
# NDP Notification Service Test Script
# Tests SMS, Email, WhatsApp, and Push notification endpoints
# ============================================================================

BASE_URL="${BASE_URL:-http://localhost:3000}"
NOTIF_URL="${NOTIF_URL:-http://localhost:3008}"

echo "================================================"
echo "NDP Notification Service Test Suite"
echo "Base URL: $BASE_URL"
echo "================================================"

# ============================================================================
# 1. Health Check
# ============================================================================
echo ""
echo "1. Health Check (Channel Status)"
echo "--------------------------------"
curl -s "$NOTIF_URL/health" | jq '.' 2>/dev/null || echo "Service not responding"

# ============================================================================
# 2. Send Prescription Created Notification
# ============================================================================
echo ""
echo "2. Prescription Created Notification (SMS + Email)"
echo "---------------------------------------------------"

curl -s -X POST "$BASE_URL/api/notifications/send" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "prescription_created",
        "channel": ["sms", "email"],
        "recipient": {
            "nationalId": "29901011234567",
            "phone": "+201234567890",
            "email": "patient@example.com",
            "name": "Ahmed Mohamed"
        },
        "data": {
            "prescriptionNumber": "RX-2026-00000001",
            "physicianName": "Dr. Fatima Hassan",
            "expiryDate": "2026-02-15",
            "medicationList": "1. Paracetamol 500mg - 20 tablets"
        }
    }' | jq '.' 2>/dev/null

# ============================================================================
# 3. Send Prescription Dispensed Notification
# ============================================================================
echo ""
echo "3. Prescription Dispensed Notification"
echo "--------------------------------------"

curl -s -X POST "$BASE_URL/api/notifications/send" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "prescription_dispensed",
        "channel": "sms",
        "recipient": {
            "phone": "+201234567890",
            "name": "Ahmed Mohamed"
        },
        "data": {
            "prescriptionNumber": "RX-2026-00000001",
            "pharmacyName": "Central Pharmacy",
            "pharmacistName": "Dr. Omar",
            "dispenseDate": "2026-01-15",
            "itemCount": 2,
            "remainingDispenses": 0
        }
    }' | jq '.' 2>/dev/null

# ============================================================================
# 4. Send Verification Code
# ============================================================================
echo ""
echo "4. Verification Code SMS"
echo "------------------------"

curl -s -X POST "$BASE_URL/api/notifications/verify" \
    -H "Content-Type: application/json" \
    -d '{
        "phone": "+201234567890",
        "code": "123456",
        "validMinutes": 5
    }' | jq '.' 2>/dev/null

# ============================================================================
# 5. Send Medication Recall Alert
# ============================================================================
echo ""
echo "5. Medication Recall Alert"
echo "--------------------------"

curl -s -X POST "$BASE_URL/api/notifications/send" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "medication_recalled",
        "channel": ["sms", "email"],
        "recipient": {
            "phone": "+201234567890",
            "email": "patient@example.com",
            "name": "Ahmed Mohamed"
        },
        "data": {
            "medicationName": "Brand X Paracetamol 500mg",
            "batchNumbers": "BATCH-2024-001",
            "recallReason": "Quality testing issue"
        },
        "priority": "high"
    }' | jq '.' 2>/dev/null

# ============================================================================
# 6. Get Notifications by Recipient
# ============================================================================
echo ""
echo "6. Get Notifications by Recipient"
echo "----------------------------------"

curl -s "$BASE_URL/api/notifications/recipient/29901011234567?limit=5" | jq '.' 2>/dev/null

echo ""
echo "================================================"
echo "Notification Test Complete"
echo "================================================"
echo ""
echo "Note: All notifications are simulated in development."
echo "Enable SMS_ENABLED, EMAIL_ENABLED, etc. in production."

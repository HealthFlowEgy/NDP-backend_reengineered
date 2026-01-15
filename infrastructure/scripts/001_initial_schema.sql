-- ============================================================================
-- NDP Backend - Database Schema Migration
-- National Digital Prescription Platform - Egypt
-- Version: 1.0.0
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- PRESCRIPTIONS TABLE (FHIR MedicationRequest)
-- ============================================================================

CREATE TABLE IF NOT EXISTS prescriptions (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Business identifiers
    prescription_number VARCHAR(20) UNIQUE NOT NULL,
    
    -- FHIR Resource (stored as JSONB)
    fhir_resource JSONB NOT NULL,
    
    -- Denormalized fields for efficient querying
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    patient_national_id VARCHAR(14) NOT NULL,
    patient_name VARCHAR(255),
    prescriber_license VARCHAR(50) NOT NULL,
    prescriber_name VARCHAR(255),
    facility_id VARCHAR(50),
    facility_name VARCHAR(255),
    
    -- Dispense tracking
    allowed_dispenses INTEGER NOT NULL DEFAULT 1,
    remaining_dispenses INTEGER NOT NULL DEFAULT 1,
    
    -- Digital signature
    signature JSONB,
    
    -- AI Validation result
    ai_validation JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT valid_status CHECK (status IN (
        'draft', 'active', 'on-hold', 'cancelled', 'completed', 'entered-in-error'
    )),
    CONSTRAINT valid_dispenses CHECK (
        remaining_dispenses >= 0 AND 
        remaining_dispenses <= allowed_dispenses
    ),
    CONSTRAINT valid_national_id CHECK (patient_national_id ~ '^[0-9]{14}$')
);

-- Indexes for prescriptions
CREATE INDEX idx_prescriptions_patient_id ON prescriptions(patient_national_id);
CREATE INDEX idx_prescriptions_status ON prescriptions(status);
CREATE INDEX idx_prescriptions_prescriber ON prescriptions(prescriber_license);
CREATE INDEX idx_prescriptions_facility ON prescriptions(facility_id);
CREATE INDEX idx_prescriptions_created_at ON prescriptions(created_at DESC);
CREATE INDEX idx_prescriptions_expires_at ON prescriptions(expires_at) WHERE status = 'active';
CREATE INDEX idx_prescriptions_number ON prescriptions(prescription_number);

-- GIN index for FHIR resource queries
CREATE INDEX idx_prescriptions_fhir ON prescriptions USING GIN (fhir_resource);

-- ============================================================================
-- DISPENSES TABLE (FHIR MedicationDispense)
-- ============================================================================

CREATE TABLE IF NOT EXISTS dispenses (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Foreign key to prescription
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE RESTRICT,
    prescription_number VARCHAR(20) NOT NULL,
    
    -- FHIR Resource (stored as JSONB)
    fhir_resource JSONB NOT NULL,
    
    -- Denormalized fields for efficient querying
    status VARCHAR(20) NOT NULL DEFAULT 'preparation',
    pharmacist_license VARCHAR(50) NOT NULL,
    pharmacist_name VARCHAR(255),
    pharmacy_id VARCHAR(50) NOT NULL,
    pharmacy_name VARCHAR(255),
    
    -- Dispense tracking
    dispense_number INTEGER NOT NULL,
    is_partial BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Items dispensed (denormalized for quick access)
    dispensed_items JSONB NOT NULL DEFAULT '[]',
    
    -- Digital signature
    signature JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT valid_dispense_status CHECK (status IN (
        'preparation', 'in-progress', 'cancelled', 'on-hold', 'completed', 'declined'
    )),
    CONSTRAINT unique_dispense_number UNIQUE (prescription_id, dispense_number)
);

-- Indexes for dispenses
CREATE INDEX idx_dispenses_prescription ON dispenses(prescription_id);
CREATE INDEX idx_dispenses_prescription_number ON dispenses(prescription_number);
CREATE INDEX idx_dispenses_pharmacist ON dispenses(pharmacist_license);
CREATE INDEX idx_dispenses_pharmacy ON dispenses(pharmacy_id);
CREATE INDEX idx_dispenses_status ON dispenses(status);
CREATE INDEX idx_dispenses_created_at ON dispenses(created_at DESC);

-- GIN index for FHIR resource queries
CREATE INDEX idx_dispenses_fhir ON dispenses USING GIN (fhir_resource);

-- ============================================================================
-- MEDICATIONS TABLE (FHIR MedicationKnowledge - EDA Drug Directory)
-- ============================================================================

CREATE TABLE IF NOT EXISTS medications (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- EDA identifier
    eda_code VARCHAR(20) UNIQUE NOT NULL,
    
    -- FHIR Resource (stored as JSONB)
    fhir_resource JSONB NOT NULL,
    
    -- Denormalized fields for efficient querying
    commercial_name VARCHAR(500) NOT NULL,
    generic_name VARCHAR(500),
    manufacturer VARCHAR(255),
    dose_form VARCHAR(100),
    strength VARCHAR(100),
    packaging_info VARCHAR(255),
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    
    -- Recall information
    recalled_at TIMESTAMPTZ,
    recall_reason TEXT,
    recall_batch_numbers TEXT[],
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_medication_status CHECK (status IN ('active', 'inactive', 'recalled'))
);

-- Indexes for medications
CREATE INDEX idx_medications_eda_code ON medications(eda_code);
CREATE INDEX idx_medications_status ON medications(status);
CREATE INDEX idx_medications_commercial_name ON medications(commercial_name);
CREATE INDEX idx_medications_generic_name ON medications(generic_name);

-- Full text search index for medication names
CREATE INDEX idx_medications_name_search ON medications 
    USING GIN (to_tsvector('english', commercial_name || ' ' || COALESCE(generic_name, '')));

-- GIN index for FHIR resource queries
CREATE INDEX idx_medications_fhir ON medications USING GIN (fhir_resource);

-- ============================================================================
-- AUDIT LOG TABLE (FHIR AuditEvent)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Event details
    event_type VARCHAR(100) NOT NULL,
    action CHAR(1) NOT NULL, -- C=Create, R=Read, U=Update, D=Delete
    outcome VARCHAR(20) NOT NULL, -- success, failure
    
    -- Actor
    user_id VARCHAR(100) NOT NULL,
    user_role VARCHAR(50) NOT NULL,
    user_license VARCHAR(50),
    
    -- Resource
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100),
    
    -- Patient context (for PHI access tracking)
    patient_national_id VARCHAR(14),
    
    -- Request context
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(100),
    
    -- Timestamp
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Additional details (JSONB for flexibility)
    details JSONB,
    
    -- FHIR AuditEvent resource
    fhir_resource JSONB,
    
    -- Constraints
    CONSTRAINT valid_action CHECK (action IN ('C', 'R', 'U', 'D')),
    CONSTRAINT valid_outcome CHECK (outcome IN ('success', 'failure'))
);

-- Indexes for audit logs
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_patient ON audit_logs(patient_national_id);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);

-- ============================================================================
-- PRACTITIONER CACHE TABLE (cached from Sunbird RC)
-- ============================================================================

CREATE TABLE IF NOT EXISTS practitioner_cache (
    -- Primary key (license number)
    license VARCHAR(50) PRIMARY KEY,
    
    -- Practitioner details
    name VARCHAR(255) NOT NULL,
    name_arabic VARCHAR(255),
    specialty VARCHAR(100),
    facility_id VARCHAR(50),
    facility_name VARCHAR(255),
    
    -- Credential status
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    credential_type VARCHAR(50),
    
    -- Cache metadata
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- Full credential data from Sunbird RC
    credential_data JSONB,
    
    -- Constraints
    CONSTRAINT valid_practitioner_status CHECK (status IN ('active', 'suspended', 'revoked', 'expired'))
);

-- Index for cache expiry cleanup
CREATE INDEX idx_practitioner_cache_expires ON practitioner_cache(expires_at);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for prescriptions
CREATE TRIGGER update_prescriptions_updated_at
    BEFORE UPDATE ON prescriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for medications
CREATE TRIGGER update_medications_updated_at
    BEFORE UPDATE ON medications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to generate prescription number
CREATE OR REPLACE FUNCTION generate_prescription_number()
RETURNS VARCHAR(20) AS $$
DECLARE
    new_number VARCHAR(20);
    year_part VARCHAR(4);
    random_part VARCHAR(8);
BEGIN
    year_part := EXTRACT(YEAR FROM NOW())::VARCHAR;
    random_part := LPAD(FLOOR(RANDOM() * 100000000)::VARCHAR, 8, '0');
    new_number := 'RX-' || year_part || '-' || random_part;
    RETURN new_number;
END;
$$ language 'plpgsql';

-- Function to update prescription status after dispense
CREATE OR REPLACE FUNCTION update_prescription_after_dispense()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        UPDATE prescriptions
        SET 
            remaining_dispenses = remaining_dispenses - 1,
            status = CASE 
                WHEN remaining_dispenses - 1 = 0 THEN 'completed'
                WHEN NEW.is_partial THEN 'on-hold'
                ELSE status
            END,
            updated_at = NOW()
        WHERE id = NEW.prescription_id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to update prescription after dispense completion
CREATE TRIGGER trigger_update_prescription_after_dispense
    AFTER UPDATE OF status ON dispenses
    FOR EACH ROW
    WHEN (NEW.status = 'completed')
    EXECUTE FUNCTION update_prescription_after_dispense();

-- ============================================================================
-- PARTITIONING (for audit_logs - daily partitions)
-- ============================================================================

-- Note: For production, implement table partitioning for audit_logs
-- This would be done with pg_partman or manual partition management
-- Example partition creation (run monthly via cron):
-- CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs
--     FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for active prescriptions ready for dispensing
CREATE OR REPLACE VIEW active_prescriptions AS
SELECT 
    p.id,
    p.prescription_number,
    p.patient_national_id,
    p.patient_name,
    p.prescriber_license,
    p.prescriber_name,
    p.facility_name,
    p.allowed_dispenses,
    p.remaining_dispenses,
    p.created_at,
    p.signed_at,
    p.expires_at,
    p.fhir_resource
FROM prescriptions p
WHERE p.status = 'active'
  AND p.remaining_dispenses > 0
  AND (p.expires_at IS NULL OR p.expires_at > NOW());

-- View for prescription summary with dispense history
CREATE OR REPLACE VIEW prescription_summary AS
SELECT 
    p.id,
    p.prescription_number,
    p.status,
    p.patient_national_id,
    p.prescriber_license,
    p.allowed_dispenses,
    p.remaining_dispenses,
    p.created_at,
    p.signed_at,
    p.expires_at,
    COUNT(d.id) as total_dispenses,
    MAX(d.created_at) as last_dispense_at
FROM prescriptions p
LEFT JOIN dispenses d ON p.id = d.prescription_id AND d.status = 'completed'
GROUP BY p.id;

-- ============================================================================
-- GRANTS (adjust based on your user setup)
-- ============================================================================

-- Grant permissions to application user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ndp_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ndp_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ndp_app;

-- ============================================================================
-- SEED DATA (Egyptian Drug Authority organization)
-- ============================================================================

-- This will be populated by the medication directory seed script

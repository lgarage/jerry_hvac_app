-- Migration 005: Update job number format to sequential counter + location + type
-- Format: 0001NRP (4-digit sequential + location code + 2-letter job type)

-- Drop old job number generation function and trigger
DROP TRIGGER IF EXISTS auto_job_number ON jobs;
DROP FUNCTION IF EXISTS set_job_number();
DROP FUNCTION IF EXISTS generate_job_number();

-- Create job counter table for atomic increments
CREATE TABLE IF NOT EXISTS job_counter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  current_value INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Initialize counter
INSERT INTO job_counter (id, current_value)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- Create location codes table (configurable)
CREATE TABLE IF NOT EXISTS location_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default location (Neenah)
INSERT INTO location_codes (code, name, is_default)
VALUES ('N', 'Neenah', true)
ON CONFLICT (code) DO NOTHING;

-- Add job_type_code to jobs table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'job_type_code'
  ) THEN
    ALTER TABLE jobs ADD COLUMN job_type_code VARCHAR(2);
  END IF;
END $$;

-- Add location_code to jobs table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'location_code'
  ) THEN
    ALTER TABLE jobs ADD COLUMN location_code VARCHAR(10) DEFAULT 'N';
  END IF;
END $$;

-- Function to get next job number atomically
CREATE OR REPLACE FUNCTION get_next_job_number()
RETURNS INTEGER AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Atomic increment using SELECT FOR UPDATE
  UPDATE job_counter
  SET current_value = current_value + 1,
      updated_at = NOW()
  WHERE id = 1
  RETURNING current_value INTO next_number;

  RETURN next_number;
END;
$$ LANGUAGE plpgsql;

-- Function to generate full job number with format: 0001NRP
CREATE OR REPLACE FUNCTION generate_job_number(
  p_job_type VARCHAR DEFAULT 'service',
  p_location_code VARCHAR DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  sequential_number INTEGER;
  location_code_value VARCHAR(10);
  job_type_code VARCHAR(2);
  formatted_number TEXT;
  new_job_number TEXT;
BEGIN
  -- Get next sequential number (atomic)
  sequential_number := get_next_job_number();

  -- Get location code (use provided or default)
  IF p_location_code IS NOT NULL THEN
    location_code_value := p_location_code;
  ELSE
    SELECT code INTO location_code_value
    FROM location_codes
    WHERE is_default = true
    LIMIT 1;

    -- Fallback to 'N' if no default found
    IF location_code_value IS NULL THEN
      location_code_value := 'N';
    END IF;
  END IF;

  -- Map job_type to job_type_code
  CASE p_job_type
    WHEN 'repair' THEN job_type_code := 'RP';
    WHEN 'quoted_repair' THEN job_type_code := 'QR';
    WHEN 'service' THEN job_type_code := 'SC';
    WHEN 'service_call' THEN job_type_code := 'SC';
    WHEN 'pm' THEN job_type_code := 'PM';
    WHEN 'preventive_maintenance' THEN job_type_code := 'PM';
    WHEN 'install' THEN job_type_code := 'SC'; -- Default to Service Call
    WHEN 'diagnostic' THEN job_type_code := 'SC'; -- Default to Service Call
    ELSE job_type_code := 'SC'; -- Default to Service Call
  END CASE;

  -- Format: 4-digit number padded with zeros
  formatted_number := LPAD(sequential_number::TEXT, 4, '0');

  -- Combine: [number][location][type]
  new_job_number := formatted_number || location_code_value || job_type_code;

  RETURN new_job_number;
END;
$$ LANGUAGE plpgsql;

-- Function to set job number on insert
CREATE OR REPLACE FUNCTION set_job_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Only generate if job_number is not provided or is empty
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    NEW.job_number := generate_job_number(
      COALESCE(NEW.job_type, 'service'),
      NEW.location_code
    );

    -- Also set the job_type_code based on job_type
    CASE NEW.job_type
      WHEN 'repair' THEN NEW.job_type_code := 'RP';
      WHEN 'quoted_repair' THEN NEW.job_type_code := 'QR';
      WHEN 'service' THEN NEW.job_type_code := 'SC';
      WHEN 'service_call' THEN NEW.job_type_code := 'SC';
      WHEN 'pm' THEN NEW.job_type_code := 'PM';
      WHEN 'preventive_maintenance' THEN NEW.job_type_code := 'PM';
      ELSE NEW.job_type_code := 'SC';
    END CASE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto job number generation
CREATE TRIGGER auto_job_number
BEFORE INSERT ON jobs
FOR EACH ROW
EXECUTE FUNCTION set_job_number();

-- Create index on job_number for fast lookups
CREATE INDEX IF NOT EXISTS jobs_job_number_idx ON jobs(job_number);

-- Comments
COMMENT ON TABLE job_counter IS 'Atomic counter for job number generation (never resets)';
COMMENT ON TABLE location_codes IS 'Location codes for job numbers (e.g., N = Neenah)';
COMMENT ON FUNCTION generate_job_number(VARCHAR, VARCHAR) IS 'Generates job numbers in format 0001NRP (sequential + location + type)';
COMMENT ON FUNCTION get_next_job_number() IS 'Atomically increments and returns next sequential job number';

-- View to see current counter value
CREATE OR REPLACE VIEW job_counter_status AS
SELECT
  current_value,
  current_value + 1 AS next_number,
  LPAD((current_value + 1)::TEXT, 4, '0') AS next_formatted,
  updated_at AS last_increment
FROM job_counter
WHERE id = 1;

COMMENT ON VIEW job_counter_status IS 'Shows current job counter value and next number';

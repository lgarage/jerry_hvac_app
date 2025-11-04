-- Migration 007: Create Timecards Table
-- Purpose: Track labor hours per job with repair completion checklist
-- One timecard per job per visit/day

CREATE TABLE IF NOT EXISTS timecards (
  id SERIAL PRIMARY KEY,
  job_number VARCHAR(20) NOT NULL,  -- Links to jobs.job_number (e.g., 0100NSC)
  tech_name VARCHAR(100) NOT NULL,
  work_date DATE NOT NULL,
  hours_worked DECIMAL(4,2) NOT NULL CHECK (hours_worked > 0 AND hours_worked <= 24),
  status VARCHAR(20) NOT NULL CHECK (status IN ('complete', 'incomplete')),
  signature_base64 TEXT NOT NULL,
  notes TEXT,  -- Optional notes about the work
  repairs_completed JSONB,  -- Tracks checkbox states for each repair
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast job lookup
CREATE INDEX idx_timecards_job ON timecards(job_number);

-- Index for tech timecard queries
CREATE INDEX idx_timecards_tech_date ON timecards(tech_name, work_date);

-- Index for status queries
CREATE INDEX idx_timecards_status ON timecards(status);

-- Add foreign key constraint to jobs table
ALTER TABLE timecards
ADD CONSTRAINT fk_timecards_job
FOREIGN KEY (job_number)
REFERENCES jobs(job_number)
ON DELETE CASCADE;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_timecard_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_update_timecard_timestamp
BEFORE UPDATE ON timecards
FOR EACH ROW
EXECUTE FUNCTION update_timecard_timestamp();

-- Function to get timecard summary for a job
CREATE OR REPLACE FUNCTION get_job_timecard_summary(p_job_number VARCHAR)
RETURNS TABLE (
  total_hours DECIMAL,
  visit_count INTEGER,
  status VARCHAR,
  tech_names TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    SUM(hours_worked)::DECIMAL(4,2) as total_hours,
    COUNT(*)::INTEGER as visit_count,
    (ARRAY_AGG(timecards.status ORDER BY created_at DESC))[1] as status,
    ARRAY_AGG(DISTINCT tech_name) as tech_names
  FROM timecards
  WHERE job_number = p_job_number
  GROUP BY job_number;
END;
$$ LANGUAGE plpgsql;

-- Function to get tech's hours for a date range
CREATE OR REPLACE FUNCTION get_tech_hours(
  p_tech_name VARCHAR,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  work_date DATE,
  total_hours DECIMAL,
  job_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    timecards.work_date,
    SUM(hours_worked)::DECIMAL(4,2) as total_hours,
    COUNT(DISTINCT job_number)::INTEGER as job_count
  FROM timecards
  WHERE tech_name = p_tech_name
    AND timecards.work_date BETWEEN p_start_date AND p_end_date
  GROUP BY timecards.work_date
  ORDER BY timecards.work_date DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE timecards IS 'Tracks labor hours per job with repair completion checklist. One timecard per job per visit/day.';
COMMENT ON COLUMN timecards.job_number IS 'References jobs.job_number. One job can have multiple timecards across different days.';
COMMENT ON COLUMN timecards.repairs_completed IS 'JSONB tracking checkbox states: {"RTU-6": {"filters_20x25x1": true, "contactor": false}}';
COMMENT ON COLUMN timecards.status IS 'Auto-detected: complete (all repairs checked) or incomplete (some unchecked)';

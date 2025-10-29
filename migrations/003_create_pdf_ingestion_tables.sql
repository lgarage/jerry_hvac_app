-- Create tables for PDF ingestion and terminology learning

-- Table to track uploaded manuals
CREATE TABLE IF NOT EXISTS manuals (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT,
  uploaded_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
  page_count INTEGER,
  error_message TEXT,
  metadata JSONB DEFAULT '{}', -- manufacturer, model, year, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for status queries
CREATE INDEX IF NOT EXISTS manuals_status_idx ON manuals(status);
CREATE INDEX IF NOT EXISTS manuals_uploaded_at_idx ON manuals(uploaded_at DESC);

-- Table to track which terms came from which manuals (provenance)
CREATE TABLE IF NOT EXISTS hvac_term_provenance (
  id SERIAL PRIMARY KEY,
  terminology_id INTEGER REFERENCES hvac_terminology(id) ON DELETE CASCADE,
  manual_id INTEGER REFERENCES manuals(id) ON DELETE CASCADE,
  page_number INTEGER,
  context_snippet TEXT, -- surrounding text for reference
  confidence_score FLOAT, -- AI confidence in extraction
  extraction_method VARCHAR(50), -- 'gpt-4', 'manual', 'csv-import'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(terminology_id, manual_id, page_number)
);

-- Index for provenance lookups
CREATE INDEX IF NOT EXISTS provenance_terminology_idx ON hvac_term_provenance(terminology_id);
CREATE INDEX IF NOT EXISTS provenance_manual_idx ON hvac_term_provenance(manual_id);

-- Table to track extracted parts from manuals
CREATE TABLE IF NOT EXISTS manual_parts_extracted (
  id SERIAL PRIMARY KEY,
  manual_id INTEGER REFERENCES manuals(id) ON DELETE CASCADE,
  part_id INTEGER REFERENCES parts(id) ON DELETE SET NULL, -- null if not matched yet
  extracted_name VARCHAR(255) NOT NULL,
  extracted_number VARCHAR(100),
  page_number INTEGER,
  context_snippet TEXT,
  confidence_score FLOAT,
  status VARCHAR(50) DEFAULT 'pending', -- pending, matched, rejected
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for parts extraction
CREATE INDEX IF NOT EXISTS manual_parts_manual_idx ON manual_parts_extracted(manual_id);
CREATE INDEX IF NOT EXISTS manual_parts_status_idx ON manual_parts_extracted(status);

-- Table to track manual processing jobs
CREATE TABLE IF NOT EXISTS manual_processing_jobs (
  id SERIAL PRIMARY KEY,
  manual_id INTEGER REFERENCES manuals(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL, -- 'terminology', 'parts', 'full'
  status VARCHAR(50) DEFAULT 'pending', -- pending, running, completed, failed
  progress INTEGER DEFAULT 0, -- 0-100
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  results JSONB DEFAULT '{}', -- extracted counts, etc.
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for job tracking
CREATE INDEX IF NOT EXISTS jobs_manual_idx ON manual_processing_jobs(manual_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON manual_processing_jobs(status);

-- Function to update manual updated_at timestamp
CREATE OR REPLACE FUNCTION update_manual_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for manuals
CREATE TRIGGER update_manuals_updated_at
BEFORE UPDATE ON manuals
FOR EACH ROW
EXECUTE FUNCTION update_manual_updated_at();

-- View for manual statistics
CREATE OR REPLACE VIEW manual_stats AS
SELECT
  m.id,
  m.filename,
  m.status,
  m.uploaded_at,
  m.processed_at,
  COUNT(DISTINCT htp.terminology_id) as terms_extracted,
  COUNT(DISTINCT mpe.id) as parts_extracted,
  m.page_count
FROM manuals m
LEFT JOIN hvac_term_provenance htp ON htp.manual_id = m.id
LEFT JOIN manual_parts_extracted mpe ON mpe.manual_id = m.id
GROUP BY m.id, m.filename, m.status, m.uploaded_at, m.processed_at, m.page_count;

-- Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE ON manuals TO your_app_user;
-- GRANT SELECT, INSERT ON hvac_term_provenance TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON manual_parts_extracted TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON manual_processing_jobs TO your_app_user;
-- GRANT SELECT ON manual_stats TO your_app_user;

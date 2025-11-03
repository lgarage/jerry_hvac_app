-- Migration 006: Add transcript tracking, unit linking, and timestamps
-- This migration enables:
-- 1. Voice transcript storage at job level with ISO8601 timestamps
-- 2. Linking transcripts to specific units (RTU-6, RTU-2, etc.)
-- 3. Tracking session context for "add to that" commands
-- 4. Grouping repairs by unit for better UI organization

-- Add transcripts column to jobs table
-- Stores array of transcript objects with timestamps and unit links
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS transcripts JSONB DEFAULT '[]';

-- Add session_context column for tracking "last mentioned unit" during active sessions
-- This supports follow-up commands like "add batteries to that too"
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS session_context JSONB DEFAULT '{}';

-- Create index for transcript timestamp queries
-- Enables fast sorting by when transcripts were created
CREATE INDEX IF NOT EXISTS jobs_transcripts_timestamp_idx
ON jobs USING GIN ((transcripts));

-- Create index for job_number lookups (already exists but ensuring it's optimal)
CREATE INDEX IF NOT EXISTS jobs_job_number_lookup_idx
ON jobs(job_number) WHERE job_number IS NOT NULL;

-- Create composite index for job number + created_at for chronological queries
CREATE INDEX IF NOT EXISTS jobs_job_number_created_idx
ON jobs(job_number, created_at DESC);

-- Function to add a transcript to a job
-- This ensures consistent transcript structure across the app
CREATE OR REPLACE FUNCTION add_transcript_to_job(
  p_job_number VARCHAR,
  p_transcript_text TEXT,
  p_units_mentioned TEXT[] DEFAULT '{}',
  p_session_id VARCHAR DEFAULT NULL,
  p_was_follow_up BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  new_transcript JSONB;
  transcript_id TEXT;
  current_timestamp TEXT;
BEGIN
  -- Generate unique transcript ID
  transcript_id := gen_random_uuid()::TEXT;

  -- Get current ISO8601 timestamp with milliseconds
  current_timestamp := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  -- Build transcript object
  new_transcript := jsonb_build_object(
    'id', transcript_id,
    'timestamp', current_timestamp,
    'text', p_transcript_text,
    'unitsMentioned', p_units_mentioned,
    'repairIds', '[]'::jsonb,
    'context', jsonb_build_object(
      'sessionId', COALESCE(p_session_id, gen_random_uuid()::TEXT),
      'wasFollowUp', p_was_follow_up,
      'lastMentionedUnit', CASE
        WHEN array_length(p_units_mentioned, 1) > 0
        THEN p_units_mentioned[1]
        ELSE NULL
      END
    )
  );

  -- Append to transcripts array
  UPDATE jobs
  SET transcripts = transcripts || new_transcript,
      updated_at = NOW()
  WHERE job_number = p_job_number;

  RETURN new_transcript;
END;
$$ LANGUAGE plpgsql;

-- Function to get transcripts for a specific unit
-- Returns all transcripts that mentioned a particular unit (e.g., "RTU-6")
CREATE OR REPLACE FUNCTION get_unit_transcripts(
  p_job_number VARCHAR,
  p_unit_name TEXT
)
RETURNS TABLE (
  transcript_id TEXT,
  timestamp TEXT,
  text TEXT,
  was_follow_up BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t->>'id' AS transcript_id,
    t->>'timestamp' AS timestamp,
    t->>'text' AS text,
    (t->'context'->>'wasFollowUp')::BOOLEAN AS was_follow_up
  FROM jobs j,
  jsonb_array_elements(j.transcripts) AS t
  WHERE j.job_number = p_job_number
    AND t->'unitsMentioned' ? p_unit_name
  ORDER BY t->>'timestamp' ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to get all transcripts for a job, sorted chronologically
CREATE OR REPLACE FUNCTION get_job_transcripts(
  p_job_number VARCHAR,
  p_sort_order TEXT DEFAULT 'DESC' -- 'ASC' for oldest first, 'DESC' for newest first
)
RETURNS TABLE (
  transcript_id TEXT,
  timestamp TEXT,
  text TEXT,
  units_mentioned TEXT[],
  was_follow_up BOOLEAN,
  session_id TEXT
) AS $$
BEGIN
  RETURN QUERY
  EXECUTE format(
    'SELECT
      t->>''id'' AS transcript_id,
      t->>''timestamp'' AS timestamp,
      t->>''text'' AS text,
      ARRAY(SELECT jsonb_array_elements_text(t->''unitsMentioned'')) AS units_mentioned,
      (t->''context''->>''wasFollowUp'')::BOOLEAN AS was_follow_up,
      t->''context''->>''sessionId'' AS session_id
    FROM jobs j,
    jsonb_array_elements(j.transcripts) AS t
    WHERE j.job_number = $1
    ORDER BY t->>''timestamp'' %s',
    p_sort_order
  )
  USING p_job_number;
END;
$$ LANGUAGE plpgsql;

-- Function to update session context (for "last mentioned unit" tracking)
CREATE OR REPLACE FUNCTION update_session_context(
  p_job_number VARCHAR,
  p_session_id VARCHAR,
  p_last_mentioned_unit TEXT DEFAULT NULL,
  p_active_units TEXT[] DEFAULT '{}'
)
RETURNS VOID AS $$
BEGIN
  UPDATE jobs
  SET session_context = jsonb_build_object(
    'sessionId', p_session_id,
    'lastMentionedUnit', p_last_mentioned_unit,
    'activeUnits', p_active_units,
    'lastUpdated', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  updated_at = NOW()
  WHERE job_number = p_job_number;
END;
$$ LANGUAGE plpgsql;

-- Function to get units mentioned across all transcripts for a job
-- Useful for displaying unit grouping in the UI
CREATE OR REPLACE FUNCTION get_job_units(
  p_job_number VARCHAR
)
RETURNS TABLE (
  unit_name TEXT,
  mention_count BIGINT,
  first_mentioned TEXT,
  last_mentioned TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    unit,
    COUNT(*) AS mention_count,
    MIN(t->>'timestamp') AS first_mentioned,
    MAX(t->>'timestamp') AS last_mentioned
  FROM jobs j,
  jsonb_array_elements(j.transcripts) AS t,
  jsonb_array_elements_text(t->'unitsMentioned') AS unit
  WHERE j.job_number = p_job_number
  GROUP BY unit
  ORDER BY first_mentioned ASC;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON COLUMN jobs.transcripts IS 'Array of voice transcripts with timestamps, units mentioned, and session context';
COMMENT ON COLUMN jobs.session_context IS 'Current session context tracking last mentioned unit for follow-up commands';

COMMENT ON FUNCTION add_transcript_to_job(VARCHAR, TEXT, TEXT[], VARCHAR, BOOLEAN) IS
  'Adds a new transcript to a job with ISO8601 timestamp and unit tracking';

COMMENT ON FUNCTION get_unit_transcripts(VARCHAR, TEXT) IS
  'Returns all transcripts that mentioned a specific unit, sorted chronologically';

COMMENT ON FUNCTION get_job_transcripts(VARCHAR, TEXT) IS
  'Returns all transcripts for a job with optional sort order (ASC/DESC)';

COMMENT ON FUNCTION update_session_context(VARCHAR, VARCHAR, TEXT, TEXT[]) IS
  'Updates session context for tracking last mentioned unit and active units';

COMMENT ON FUNCTION get_job_units(VARCHAR) IS
  'Returns all units mentioned in job transcripts with mention counts and timestamps';

-- Example usage:
--
-- Add a transcript:
-- SELECT add_transcript_to_job(
--   '0001NRP',
--   'RTU-6 needs 2 filters and 4 AA batteries',
--   ARRAY['RTU-6'],
--   'session-123',
--   false
-- );
--
-- Get all transcripts for a job:
-- SELECT * FROM get_job_transcripts('0001NRP', 'DESC');
--
-- Get transcripts for specific unit:
-- SELECT * FROM get_unit_transcripts('0001NRP', 'RTU-6');
--
-- Get all units mentioned in a job:
-- SELECT * FROM get_job_units('0001NRP');
--
-- Update session context:
-- SELECT update_session_context('0001NRP', 'session-123', 'RTU-6', ARRAY['RTU-6', 'RTU-2']);

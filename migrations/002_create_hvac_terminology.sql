-- Create HVAC terminology table for semantic term normalization
CREATE TABLE IF NOT EXISTS hvac_terminology (
  id SERIAL PRIMARY KEY,

  -- The correct/standardized term
  standard_term VARCHAR(255) NOT NULL,

  -- Category for organization
  category VARCHAR(100) NOT NULL,
  -- Categories: refrigerant, equipment, voltage, measurement, part_type, action, brand

  -- Common variations and misspellings
  variations TEXT[] NOT NULL,
  -- e.g., ['R410', 'R4-10', 'R 410', 'four ten', '410A', 'R410A']

  -- Description/context
  description TEXT,

  -- Vector embedding for semantic search
  embedding vector(1536),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS hvac_terminology_embedding_idx ON hvac_terminology
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create index for category filtering
CREATE INDEX IF NOT EXISTS hvac_terminology_category_idx ON hvac_terminology(category);

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create parts table with vector embeddings
CREATE TABLE IF NOT EXISTS parts (
  id SERIAL PRIMARY KEY,
  part_number VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('inventory', 'consumable')),
  price DECIMAL(10, 2),
  thumbnail_url TEXT,
  common_uses TEXT[],
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS parts_embedding_idx ON parts
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create index for category searches
CREATE INDEX IF NOT EXISTS parts_category_idx ON parts(category);
CREATE INDEX IF NOT EXISTS parts_type_idx ON parts(type);

-- Create function to search parts by semantic similarity
CREATE OR REPLACE FUNCTION search_parts_by_similarity(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id INT,
  part_number VARCHAR,
  name VARCHAR,
  description TEXT,
  category VARCHAR,
  type VARCHAR,
  price DECIMAL,
  thumbnail_url TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    parts.id,
    parts.part_number,
    parts.name,
    parts.description,
    parts.category,
    parts.type,
    parts.price,
    parts.thumbnail_url,
    1 - (parts.embedding <=> query_embedding) AS similarity
  FROM parts
  WHERE 1 - (parts.embedding <=> query_embedding) > match_threshold
  ORDER BY parts.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

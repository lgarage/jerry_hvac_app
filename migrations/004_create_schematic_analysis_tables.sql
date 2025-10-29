-- Create tables for HVAC schematic analysis (Fireworks Llama4 Maverick integration)

-- Table to track schematics found in manuals
CREATE TABLE IF NOT EXISTS manual_schematics (
  id SERIAL PRIMARY KEY,
  manual_id INTEGER REFERENCES manuals(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  schematic_type VARCHAR(100), -- 'wiring_diagram', 'refrigerant_flow', 'control_circuit', 'unknown'
  detection_confidence FLOAT, -- AI confidence that this is a schematic (0.0-1.0)
  image_path TEXT, -- path to extracted schematic image
  extracted_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}', -- additional metadata from vision model
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for finding schematics by manual
CREATE INDEX IF NOT EXISTS schematics_manual_idx ON manual_schematics(manual_id);
CREATE INDEX IF NOT EXISTS schematics_type_idx ON manual_schematics(schematic_type);

-- Table to store components extracted from schematics
CREATE TABLE IF NOT EXISTS schematic_components (
  id SERIAL PRIMARY KEY,
  schematic_id INTEGER REFERENCES manual_schematics(id) ON DELETE CASCADE,
  component_name VARCHAR(255) NOT NULL, -- 'Compressor', 'Contactor', 'Capacitor', etc.
  part_number VARCHAR(100), -- extracted part number (e.g., '48HC*A07', 'CBB65 45/5 MFD')
  component_type VARCHAR(100), -- 'compressor', 'contactor', 'capacitor', 'fan', 'sensor', etc.
  confidence FLOAT, -- AI confidence in this extraction (0.0-1.0)
  voltage_rating VARCHAR(50), -- e.g., '240V', '24VAC'
  amperage_rating VARCHAR(50), -- e.g., '30A', '5A'
  part_id INTEGER REFERENCES parts(id) ON DELETE SET NULL, -- link to parts database if matched
  metadata JSONB DEFAULT '{}', -- full component data from vision model
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(schematic_id, component_name, part_number) -- prevent duplicates
);

-- Indexes for component lookups
CREATE INDEX IF NOT EXISTS schematic_components_schematic_idx ON schematic_components(schematic_id);
CREATE INDEX IF NOT EXISTS schematic_components_type_idx ON schematic_components(component_type);
CREATE INDEX IF NOT EXISTS schematic_components_part_idx ON schematic_components(part_id);

-- Table to store wire connections between components
CREATE TABLE IF NOT EXISTS schematic_connections (
  id SERIAL PRIMARY KEY,
  schematic_id INTEGER REFERENCES manual_schematics(id) ON DELETE CASCADE,
  wire_id VARCHAR(50), -- e.g., 'W1', 'W2' from vision model
  from_component_id INTEGER REFERENCES schematic_components(id) ON DELETE CASCADE,
  to_component_id INTEGER REFERENCES schematic_components(id) ON DELETE CASCADE,
  wire_color VARCHAR(50), -- 'red', 'black', 'white', 'yellow', etc.
  wire_gauge VARCHAR(20), -- '10 AWG', '12 AWG', '14 AWG', etc.
  from_terminal VARCHAR(50), -- 'L1', 'L2', 'C', 'HERM', etc.
  to_terminal VARCHAR(50), -- terminal on destination component
  confidence FLOAT, -- AI confidence in this connection
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for connection lookups
CREATE INDEX IF NOT EXISTS connections_schematic_idx ON schematic_connections(schematic_id);
CREATE INDEX IF NOT EXISTS connections_from_component_idx ON schematic_connections(from_component_id);
CREATE INDEX IF NOT EXISTS connections_to_component_idx ON schematic_connections(to_component_id);

-- View for schematic statistics
CREATE OR REPLACE VIEW schematic_stats AS
SELECT
  m.id as manual_id,
  m.filename,
  COUNT(DISTINCT ms.id) as schematics_found,
  COUNT(DISTINCT sc.id) as components_extracted,
  COUNT(DISTINCT scon.id) as connections_mapped,
  ARRAY_AGG(DISTINCT ms.schematic_type) FILTER (WHERE ms.schematic_type IS NOT NULL) as schematic_types,
  MAX(ms.extracted_at) as last_extraction
FROM manuals m
LEFT JOIN manual_schematics ms ON ms.manual_id = m.id
LEFT JOIN schematic_components sc ON sc.schematic_id = ms.id
LEFT JOIN schematic_connections scon ON scon.schematic_id = ms.id
GROUP BY m.id, m.filename;

-- View for component inventory from schematics
CREATE OR REPLACE VIEW schematic_component_inventory AS
SELECT
  sc.component_name,
  sc.component_type,
  sc.part_number,
  COUNT(*) as occurrence_count,
  ARRAY_AGG(DISTINCT m.filename) as found_in_manuals,
  AVG(sc.confidence) as avg_confidence,
  MAX(sc.created_at) as last_seen
FROM schematic_components sc
JOIN manual_schematics ms ON ms.id = sc.schematic_id
JOIN manuals m ON m.id = ms.manual_id
GROUP BY sc.component_name, sc.component_type, sc.part_number
ORDER BY occurrence_count DESC;

-- Function to link schematic components to parts database
CREATE OR REPLACE FUNCTION link_schematic_component_to_part(
  p_component_id INTEGER,
  p_part_id INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE schematic_components
  SET part_id = p_part_id
  WHERE id = p_component_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE ON manual_schematics TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON schematic_components TO your_app_user;
-- GRANT SELECT, INSERT ON schematic_connections TO your_app_user;
-- GRANT SELECT ON schematic_stats TO your_app_user;
-- GRANT SELECT ON schematic_component_inventory TO your_app_user;

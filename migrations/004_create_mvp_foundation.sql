-- Phase 1 MVP Foundation: Customers, Equipment, and Jobs
-- This migration creates the core tables needed for job tracking and asset management

-- Table to track customers (businesses with multiple locations)
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255), -- e.g., "Planet Fitness - Downtown", "Planet Fitness - Mall"
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  zip VARCHAR(20),
  contact_name VARCHAR(255),
  contact_phone VARCHAR(50),
  contact_email VARCHAR(255),
  notes TEXT,
  metadata JSONB DEFAULT '{}', -- flexible storage for custom fields
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for customer searches
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name);
CREATE INDEX IF NOT EXISTS customers_location_idx ON customers(location);
CREATE INDEX IF NOT EXISTS customers_created_at_idx ON customers(created_at DESC);

-- Table to track HVAC equipment/units
CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  equipment_name VARCHAR(255), -- e.g., "RTU-1", "Rooftop Unit #3"
  equipment_type VARCHAR(100), -- e.g., "RTU", "Split System", "Package Unit"
  manufacturer VARCHAR(100), -- e.g., "York", "Carrier", "Trane"
  model VARCHAR(100) NOT NULL, -- Required for parts ordering
  serial_number VARCHAR(100), -- May be blank until first service
  tonnage DECIMAL(5,2), -- e.g., 3.5, 5.0, 10.0
  refrigerant VARCHAR(50), -- e.g., "R-410A", "R-22"
  voltage VARCHAR(50), -- e.g., "208/230V", "460V"
  install_date DATE,
  location_detail TEXT, -- e.g., "Roof - North Side", "Back Room"
  warranty_expires DATE,
  notes TEXT,
  last_service_date DATE,
  metadata JSONB DEFAULT '{}', -- OCR extracted data, custom specs
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for equipment lookups
CREATE INDEX IF NOT EXISTS equipment_customer_idx ON equipment(customer_id);
CREATE INDEX IF NOT EXISTS equipment_model_idx ON equipment(model);
CREATE INDEX IF NOT EXISTS equipment_serial_idx ON equipment(serial_number);
CREATE INDEX IF NOT EXISTS equipment_manufacturer_idx ON equipment(manufacturer);
CREATE INDEX IF NOT EXISTS equipment_last_service_idx ON equipment(last_service_date DESC);

-- Table to track service jobs (work orders)
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  job_number VARCHAR(50) UNIQUE NOT NULL, -- Auto-generated: JOB-2025-001
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  job_type VARCHAR(50) DEFAULT 'service', -- service, repair, pm, install, diagnostic
  status VARCHAR(50) DEFAULT 'scheduled', -- scheduled, in_progress, completed, cancelled
  priority VARCHAR(20) DEFAULT 'normal', -- urgent, high, normal, low

  -- Tech notes and documentation
  tech_notes TEXT, -- Raw notes from technician
  problem_description TEXT, -- What customer reported
  work_performed TEXT, -- What tech did
  recommendations TEXT, -- Future work needed

  -- Parts and labor
  parts_used JSONB DEFAULT '[]', -- Array of parts used
  labor_hours DECIMAL(5,2), -- Hours worked
  tech_signature TEXT, -- Digital signature or name

  -- Photos
  photos JSONB DEFAULT '[]', -- Array of photo URLs/paths
  nameplate_photos JSONB DEFAULT '[]', -- Specifically nameplate photos

  -- Timestamps
  scheduled_date DATE,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  signed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Metadata
  metadata JSONB DEFAULT '{}' -- Custom fields, AI analysis, etc.
);

-- Indexes for job tracking
CREATE INDEX IF NOT EXISTS jobs_job_number_idx ON jobs(job_number);
CREATE INDEX IF NOT EXISTS jobs_customer_idx ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS jobs_equipment_idx ON jobs(equipment_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_scheduled_date_idx ON jobs(scheduled_date DESC);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_job_type_idx ON jobs(job_type);

-- Function to auto-generate job numbers
CREATE OR REPLACE FUNCTION generate_job_number()
RETURNS TEXT AS $$
DECLARE
  current_year TEXT;
  next_number INTEGER;
  new_job_number TEXT;
BEGIN
  -- Get current year
  current_year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;

  -- Find the highest job number for this year
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(job_number FROM 'JOB-' || current_year || '-(\d+)')
        AS INTEGER
      )
    ),
    0
  ) + 1
  INTO next_number
  FROM jobs
  WHERE job_number LIKE 'JOB-' || current_year || '-%';

  -- Format: JOB-2025-001
  new_job_number := 'JOB-' || current_year || '-' || LPAD(next_number::TEXT, 3, '0');

  RETURN new_job_number;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate job number on insert
CREATE OR REPLACE FUNCTION set_job_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    NEW.job_number := generate_job_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_job_number
BEFORE INSERT ON jobs
FOR EACH ROW
EXECUTE FUNCTION set_job_number();

-- Function to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_equipment_updated_at
BEFORE UPDATE ON equipment
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Trigger to update equipment.last_service_date when job completed
CREATE OR REPLACE FUNCTION update_equipment_last_service()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.equipment_id IS NOT NULL THEN
    UPDATE equipment
    SET last_service_date = COALESCE(NEW.completed_at::DATE, CURRENT_DATE)
    WHERE id = NEW.equipment_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_last_service_date
AFTER UPDATE ON jobs
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
EXECUTE FUNCTION update_equipment_last_service();

-- View for equipment with customer info (convenient for queries)
CREATE OR REPLACE VIEW equipment_with_customer AS
SELECT
  e.id,
  e.equipment_name,
  e.equipment_type,
  e.manufacturer,
  e.model,
  e.serial_number,
  e.tonnage,
  e.refrigerant,
  e.location_detail,
  e.last_service_date,
  c.id as customer_id,
  c.name as customer_name,
  c.location as customer_location,
  c.city,
  c.state,
  c.contact_name,
  c.contact_phone,
  e.created_at,
  e.updated_at
FROM equipment e
JOIN customers c ON e.customer_id = c.id;

-- View for job summary with customer and equipment details
CREATE OR REPLACE VIEW job_summary AS
SELECT
  j.id,
  j.job_number,
  j.job_type,
  j.status,
  j.priority,
  c.name as customer_name,
  c.location as customer_location,
  e.equipment_name,
  e.manufacturer,
  e.model,
  j.problem_description,
  j.labor_hours,
  j.scheduled_date,
  j.completed_at,
  j.created_at
FROM jobs j
LEFT JOIN customers c ON j.customer_id = c.id
LEFT JOIN equipment e ON j.equipment_id = e.id
ORDER BY j.created_at DESC;

-- View for equipment repair history
CREATE OR REPLACE VIEW equipment_repair_history AS
SELECT
  e.id as equipment_id,
  e.equipment_name,
  e.manufacturer,
  e.model,
  e.serial_number,
  c.name as customer_name,
  c.location as customer_location,
  COUNT(j.id) as total_jobs,
  MAX(j.completed_at) as last_service,
  ARRAY_AGG(j.job_number ORDER BY j.created_at DESC) FILTER (WHERE j.status = 'completed') as completed_jobs
FROM equipment e
JOIN customers c ON e.customer_id = c.id
LEFT JOIN jobs j ON j.equipment_id = e.id
GROUP BY e.id, e.equipment_name, e.manufacturer, e.model, e.serial_number, c.name, c.location;

-- Comments for documentation
COMMENT ON TABLE customers IS 'Businesses and locations served';
COMMENT ON TABLE equipment IS 'HVAC units tracked for each customer';
COMMENT ON TABLE jobs IS 'Service calls, repairs, and PM work';
COMMENT ON FUNCTION generate_job_number() IS 'Auto-generates sequential job numbers per year (JOB-2025-001)';
COMMENT ON VIEW equipment_with_customer IS 'Equipment joined with customer info for easy queries';
COMMENT ON VIEW job_summary IS 'Job overview with customer and equipment details';
COMMENT ON VIEW equipment_repair_history IS 'Complete service history per equipment unit';

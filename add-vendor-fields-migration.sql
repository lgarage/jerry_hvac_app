-- Migration to add vendor and part number fields to parts table
-- Run this in your Supabase SQL Editor

ALTER TABLE parts
ADD COLUMN IF NOT EXISTS brand TEXT,
ADD COLUMN IF NOT EXISTS vendor TEXT,
ADD COLUMN IF NOT EXISTS vendor_part_number TEXT,
ADD COLUMN IF NOT EXISTS manufacturer_part_number TEXT;

-- Add indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_parts_brand ON parts(brand);
CREATE INDEX IF NOT EXISTS idx_parts_vendor ON parts(vendor);
CREATE INDEX IF NOT EXISTS idx_parts_vendor_part_number ON parts(vendor_part_number);
CREATE INDEX IF NOT EXISTS idx_parts_manufacturer_part_number ON parts(manufacturer_part_number);

-- Verify the new columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'parts'
ORDER BY ordinal_position;

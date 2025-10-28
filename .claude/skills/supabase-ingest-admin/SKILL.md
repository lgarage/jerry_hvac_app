---
name: supabase-ingest-admin
description: Manage Supabase schema migrations and the PDF ingestion worker that learns HVAC terminology. Use when adding tables, wiring Storage, or promoting variants.
allowed-tools: Run, Read
---

# Supabase Ingest Admin

## Instructions

1. Generate SQL for tables: hvac_terms, hvac_variants, hvac_term_provenance, manuals, parser_corrections.
2. Write a single migration to /supabase/migrations with idempotent guards.
3. Provide Node scripts to:
   - upload PDFs to Storage
   - extract text/OCR
   - embed candidates and upsert variants+provenance via pgvector
4. Add npm scripts and README snippets.

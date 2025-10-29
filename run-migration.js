#!/usr/bin/env node

/**
 * Database Migration Runner
 *
 * This script runs pending database migrations.
 * Usage: node run-migration.js [migration-file]
 *
 * Examples:
 *   node run-migration.js migrations/003_create_pdf_ingestion_tables.sql
 *   node run-migration.js  (runs all pending migrations)
 */

const { sql } = require('./db.js');
const fs = require('fs');
const path = require('path');

async function runMigration(migrationPath) {
  try {
    console.log(`\n📄 Running migration: ${path.basename(migrationPath)}`);
    console.log('─'.repeat(60));

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Split by semicolons to execute statements separately (helps with error reporting)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`📊 Found ${statements.length} SQL statements to execute\n`);

    let successCount = 0;
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement) continue;

      try {
        await sql.unsafe(statement);
        successCount++;

        // Show progress
        const preview = statement.substring(0, 60).replace(/\n/g, ' ');
        console.log(`✓ [${i + 1}/${statements.length}] ${preview}...`);
      } catch (error) {
        // Some errors are okay (e.g., "already exists")
        if (error.message.includes('already exists')) {
          console.log(`⊙ [${i + 1}/${statements.length}] Already exists (skipping)`);
        } else {
          console.error(`✗ [${i + 1}/${statements.length}] Failed:`, error.message);
          console.error(`   Statement: ${statement.substring(0, 100)}...`);
        }
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`✅ Migration completed: ${successCount}/${statements.length} statements executed`);

    return true;
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    return false;
  }
}

async function verifyTables() {
  console.log('\n🔍 Verifying tables...\n');

  const tables = [
    'manuals',
    'hvac_term_provenance',
    'manual_parts_extracted',
    'manual_processing_jobs'
  ];

  for (const table of tables) {
    try {
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = ${table}
        )
      `;

      if (result[0].exists) {
        console.log(`✓ Table '${table}' exists`);
      } else {
        console.log(`✗ Table '${table}' NOT found`);
      }
    } catch (error) {
      console.error(`✗ Error checking table '${table}':`, error.message);
    }
  }

  // Check view
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.views
        WHERE table_schema = 'public'
        AND table_name = 'manual_stats'
      )
    `;

    if (result[0].exists) {
      console.log(`✓ View 'manual_stats' exists`);
    } else {
      console.log(`✗ View 'manual_stats' NOT found`);
    }
  } catch (error) {
    console.error(`✗ Error checking view 'manual_stats':`, error.message);
  }
}

async function main() {
  const args = process.argv.slice(2);

  console.log('🚀 PDF Ingestion Database Migration Runner');
  console.log('═'.repeat(60));

  try {
    // Test database connection first
    console.log('\n📡 Testing database connection...');
    await sql`SELECT NOW()`;
    console.log('✓ Connected to database successfully\n');

    if (args.length === 0) {
      // Run the PDF ingestion migration by default
      const migrationPath = './migrations/003_create_pdf_ingestion_tables.sql';

      if (!fs.existsSync(migrationPath)) {
        console.error(`❌ Migration file not found: ${migrationPath}`);
        process.exit(1);
      }

      const success = await runMigration(migrationPath);

      if (success) {
        await verifyTables();
      }

      process.exit(success ? 0 : 1);
    } else {
      // Run specified migration
      const migrationPath = args[0];

      if (!fs.existsSync(migrationPath)) {
        console.error(`❌ Migration file not found: ${migrationPath}`);
        process.exit(1);
      }

      const success = await runMigration(migrationPath);
      process.exit(success ? 0 : 1);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();

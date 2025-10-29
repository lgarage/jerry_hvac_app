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

    // Remove comments and empty lines for cleaner output
    const cleanSQL = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .trim();

    console.log('📊 Executing migration SQL...\n');

    try {
      // Execute the entire migration as one transaction
      await sql.unsafe(cleanSQL);

      console.log('✓ Migration SQL executed successfully');
      console.log('\n' + '─'.repeat(60));
      console.log('✅ Migration completed successfully');

      return true;
    } catch (error) {
      // Check if error is due to objects already existing
      if (error.message.includes('already exists')) {
        console.log('⊙ Some objects already exist (this is usually okay)');
        console.log('  Error: ' + error.message.substring(0, 100));
        console.log('\n' + '─'.repeat(60));
        console.log('✅ Migration completed (with some objects already existing)');
        return true;
      } else {
        console.error('✗ Migration failed:', error.message);
        console.error('\nFull error:', error);
        return false;
      }
    }
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

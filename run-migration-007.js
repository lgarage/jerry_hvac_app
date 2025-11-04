const { sql } = require('./db');
const fs = require('fs');

async function runMigration() {
  try {
    console.log('Running migration 007: Create timecards table...\n');

    const migrationSQL = fs.readFileSync('./migrations/007_create_timecards_table.sql', 'utf8');

    // Execute migration
    await sql.unsafe(migrationSQL);

    console.log('✓ Migration 007 completed successfully\n');

    // Verify table was created
    const columns = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'timecards'
      ORDER BY ordinal_position
    `;

    console.log('Timecards table columns:');
    columns.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

    // Verify functions were created
    const functions = await sql`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_name IN (
        'get_job_timecard_summary',
        'get_tech_hours',
        'update_timecard_timestamp'
      )
    `;

    console.log('\nCreated functions:');
    functions.forEach(row => {
      console.log(`  - ${row.routine_name}()`);
    });

    await sql.end();
    console.log('\n✓ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigration();

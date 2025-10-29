// Check what tables exist in your Supabase database
require('dotenv').config();
const { sql } = require('./db');

(async () => {
  try {
    console.log('🔍 Checking database tables...\n');

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    if (tables.length === 0) {
      console.log('❌ No tables found - migrations need to be run\n');
      console.log('Next step: Run the migrations (see DATABASE_SETUP.md)');
    } else {
      console.log('✅ Found tables:');
      tables.forEach(t => console.log(`   - ${t.table_name}`));

      // Check if our main tables exist
      const tableNames = tables.map(t => t.table_name);
      const hasParts = tableNames.includes('parts');
      const hasTerminology = tableNames.includes('hvac_terminology');

      console.log('\n📋 Status:');
      console.log(`   parts table: ${hasParts ? '✅' : '❌'}`);
      console.log(`   hvac_terminology table: ${hasTerminology ? '✅' : '❌'}`);

      if (hasParts && hasTerminology) {
        console.log('\n🎉 Migrations already run! Database is ready.');
        console.log('\nNext steps:');
        console.log('   1. Run: node seed-terminology.js');
        console.log('   2. Run: node setup-database.js');
        console.log('   3. Run: node test-db.js');
      } else {
        console.log('\n⚠️  Some tables missing - run migrations first');
      }
    }

    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    console.error('\nTroubleshooting:');
    console.error('   - Check .env has correct DATABASE_URL');
    console.error('   - Check internet connection');
    console.error('   - Verify Supabase project is active');
    process.exit(1);
  }
})();

require('dotenv').config();
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10
});

async function runDbTest() {
  try {
    console.log('🔍 Testing Database Connection...\n');

    // Test 1: Basic connection
    const now = await sql`SELECT NOW()`;
    console.log('✅ Connection: SUCCESS');
    console.log(`   Current time: ${now[0].now}\n`);

    // Test 2: Count parts
    const partCount = await sql`SELECT COUNT(*) as count FROM parts`;
    console.log(`📦 Parts in database: ${partCount[0].count}`);

    // Test 3: Count by category
    const categoryCount = await sql`
      SELECT category, COUNT(*) as count
      FROM parts
      GROUP BY category
      ORDER BY count DESC
    `;
    console.log('\n📊 Parts by category:');
    categoryCount.forEach(row => {
      console.log(`   ${row.category}: ${row.count}`);
    });

    // Test 4: Check lexicon corrections (if file exists)
    const fs = require('fs');
    const correctionsPath = './data/lexicon_corrections.json';
    if (fs.existsSync(correctionsPath)) {
      const corrections = JSON.parse(fs.readFileSync(correctionsPath, 'utf8'));
      console.log(`\n📝 Corrections logged: ${corrections.length}`);
    } else {
      console.log('\n📝 Corrections logged: 0 (file not yet created)');
    }

    console.log('\n✅ Database Status: HEALTHY');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Database Status: FAILED');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

runDbTest();

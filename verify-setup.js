require('dotenv').config();
const { sql } = require('./db.js');

async function verifySetup() {
  console.log('\n🔍 Verifying Jerry HVAC Setup...\n');

  try {
    // Check terminology database
    console.log('1. Checking terminology database...');
    const terminologyCount = await sql`SELECT COUNT(*) as count FROM hvac_terminology`;

    if (terminologyCount[0].count > 0) {
      console.log(`   ✅ Terminology database has ${terminologyCount[0].count} terms`);

      // Show some examples
      const samples = await sql`
        SELECT standard_term, category, array_length(variations, 1) as variation_count
        FROM hvac_terminology
        ORDER BY category, standard_term
        LIMIT 5
      `;

      console.log('   Sample terms:');
      samples.forEach(s => {
        console.log(`     - ${s.standard_term} (${s.category}): ${s.variation_count} variations`);
      });
    } else {
      console.log('   ❌ Terminology database is EMPTY');
      console.log('   → Run: node seed-terminology.js');
    }

    console.log('');

    // Check parts database
    console.log('2. Checking parts database...');
    const partsCount = await sql`SELECT COUNT(*) as count FROM parts`;

    if (partsCount[0].count > 0) {
      console.log(`   ✅ Parts database has ${partsCount[0].count} parts`);

      // Check for R-410A specifically
      const r410a = await sql`
        SELECT name, part_number, type, price
        FROM parts
        WHERE name ILIKE '%R-410A%' OR name ILIKE '%410A%'
        LIMIT 5
      `;

      if (r410a.length > 0) {
        console.log('   ✅ R-410A refrigerant found:');
        r410a.forEach(p => {
          console.log(`     - ${p.name} (${p.part_number}): $${p.price} - ${p.type}`);
        });
      } else {
        console.log('   ⚠️  R-410A refrigerant NOT found in parts database');
        console.log('     This is why auto-matching isn\'t working!');
      }

    } else {
      console.log('   ❌ Parts database is EMPTY');
      console.log('   → Run: node setup-database.js');
    }

    console.log('');

    // Check for RTU in terminology
    console.log('3. Checking RTU terminology...');
    const rtuTerm = await sql`
      SELECT standard_term, variations
      FROM hvac_terminology
      WHERE standard_term ILIKE '%RTU%' OR 'RTU' = ANY(variations)
      LIMIT 1
    `;

    if (rtuTerm.length > 0) {
      console.log(`   ✅ RTU terminology found: ${rtuTerm[0].standard_term}`);
      console.log(`   Variations: ${rtuTerm[0].variations.join(', ')}`);
    } else {
      console.log('   ⚠️  RTU terminology not found');
      console.log('     This is why "RTU-10" is being heard as "R-210"');
    }

    console.log('');

    // Overall status
    const terminologyOk = terminologyCount[0].count > 0;
    const partsOk = partsCount[0].count > 0;

    if (terminologyOk && partsOk) {
      console.log('✅ Setup looks good! Both databases are populated.\n');
    } else {
      console.log('⚠️  Setup incomplete. Please run the missing seed scripts:\n');
      if (!terminologyOk) {
        console.log('   → node seed-terminology.js  (for voice recognition)');
      }
      if (!partsOk) {
        console.log('   → node setup-database.js    (for auto-matching parts)');
      }
      console.log('');
    }

    process.exit(0);

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    console.log('\nPossible issues:');
    console.log('  - Database not set up (check .env for DATABASE_URL)');
    console.log('  - Tables not created (run migrations)');
    console.log('  - Connection issues (check Supabase credentials)');
    process.exit(1);
  }
}

verifySetup();

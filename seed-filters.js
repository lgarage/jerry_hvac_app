#!/usr/bin/env node

/**
 * Seed Filter Inventory into Parts Table
 *
 * Imports the 36 filter sizes from data/filter-sizes.json into the parts table
 */

const { sql } = require('./db.js');
const fs = require('fs');
const path = require('path');

async function seedFilters() {
  try {
    console.log('\n🌱 Seeding Filter Inventory...');
    console.log('═'.repeat(60));

    // Test database connection
    console.log('\n📡 Testing database connection...');
    await sql`SELECT NOW()`;
    console.log('✓ Connected to database\n');

    // Load filter data
    const filterDataPath = path.join(__dirname, 'data', 'filter-sizes.json');

    if (!fs.existsSync(filterDataPath)) {
      console.error('❌ Filter data file not found:', filterDataPath);
      process.exit(1);
    }

    const filterDataRaw = JSON.parse(fs.readFileSync(filterDataPath, 'utf8'));
    const filterData = filterDataRaw.filters || filterDataRaw; // Handle both {filters: [...]} and [...] formats
    console.log(`📦 Loaded ${filterData.length} filter sizes from JSON\n`);

    // Check if parts table exists
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'parts'
      )
    `;

    if (!tableCheck[0].exists) {
      console.error('❌ Parts table does not exist. Run migrations first!');
      process.exit(1);
    }

    console.log('✓ Parts table exists\n');

    // Check for existing filters
    const existing = await sql`
      SELECT COUNT(*) as count
      FROM parts
      WHERE category = 'Filters'
    `;

    console.log(`📊 Currently ${existing[0].count} filters in database\n`);

    if (existing[0].count > 0) {
      console.log('⚠️  Database already has filters.');
      console.log('Options:');
      console.log('  1. Skip import (database already seeded)');
      console.log('  2. Delete existing filters and re-import');
      console.log('\nTo re-import, run: node seed-filters.js --force\n');

      if (!process.argv.includes('--force')) {
        console.log('Skipping import. Use --force to override.');
        process.exit(0);
      }

      console.log('🗑️  Deleting existing filters...');
      await sql`DELETE FROM parts WHERE category = 'Filters'`;
      console.log('✓ Existing filters deleted\n');
    }

    // Insert filters
    console.log('📥 Importing filters...\n');
    let imported = 0;
    let skipped = 0;

    for (const filter of filterData) {
      try {
        // Use tier 1 pricing as default price
        const price = filter.pricing.tier1.price;

        // Build description
        const description = `${filter.width}x${filter.height}x${filter.depth} inch filter, MERV ${filter.merv}, ${filter.qtyPerCase} per case. ${filter.popular ? 'Popular size.' : ''}`.trim();

        // Build common uses array from common names and pricing info
        const commonUsesArray = [
          ...filter.commonNames,
          `Tier pricing: 12qty=$${filter.pricing.tier1.price}, 36qty=$${filter.pricing.tier2.price}, 60+qty=$${filter.pricing.tier3.price}`,
          `${filter.qtyPerCase} per case`,
          filter.popular ? 'POPULAR SIZE' : 'Standard size'
        ];

        await sql`
          INSERT INTO parts (
            part_number,
            name,
            description,
            category,
            type,
            price,
            common_uses
          ) VALUES (
            ${'FILTER-' + filter.size.replace(/x/g, '-')},
            ${filter.size + ' Air Filter'},
            ${description},
            ${'Filters'},
            ${'Consumable'},
            ${price},
            ${commonUsesArray}
          )
        `;

        imported++;
        console.log(`  ✓ ${filter.size} - $${price} (${filter.popular ? 'POPULAR' : 'standard'})`);

      } catch (error) {
        skipped++;
        console.error(`  ✗ ${filter.size} - Error: ${error.message}`);
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`✅ Import complete!`);
    console.log(`   Imported: ${imported} filters`);
    if (skipped > 0) {
      console.log(`   Skipped:  ${skipped} (errors)`);
    }
    console.log('═'.repeat(60) + '\n');

    // Verify import
    const final = await sql`
      SELECT COUNT(*) as count
      FROM parts
      WHERE category = 'Filters'
    `;

    console.log(`📊 Total filters in database: ${final[0].count}`);

    // Show popular filters
    const popular = await sql`
      SELECT part_number, name, price
      FROM parts
      WHERE category = 'Filters'
        AND 'POPULAR SIZE' = ANY(common_uses)
      ORDER BY name
      LIMIT 10
    `;

    if (popular.length > 0) {
      console.log('\n⭐ Popular filters:');
      popular.forEach(p => {
        console.log(`   • ${p.name} (${p.part_number}) - $${p.price}`);
      });
    }

    console.log('\n✓ Ready to use! Visit http://localhost:3000/manage-parts.html\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

seedFilters();

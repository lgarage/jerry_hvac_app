require('dotenv').config();
const { sql } = require('./db.js');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// HVAC terminology database - easily expandable
const hvacTerminology = [
  // Refrigerants
  {
    standard_term: 'R-410A',
    category: 'refrigerant',
    variations: ['R410A', 'R410', 'R 410', 'R-410', 'R4-10', 'R 4 10', 'R 4-10', '410A', '410', 'four ten', 'R four ten', 'four hundred ten'],
    description: 'R-410A refrigerant, common in modern HVAC systems'
  },
  {
    standard_term: 'R-22',
    category: 'refrigerant',
    variations: ['R22', 'R 22', 'twenty two', 'R twenty two', 'freon', 'Freon 22'],
    description: 'R-22 refrigerant (Freon), legacy HVAC refrigerant'
  },
  {
    standard_term: 'R-134A',
    category: 'refrigerant',
    variations: ['R134A', 'R134', 'R 134', 'R-134', 'R 134A', '134A', 'one thirty four'],
    description: 'R-134A refrigerant, common in automotive AC'
  },
  {
    standard_term: 'R-404A',
    category: 'refrigerant',
    variations: ['R404A', 'R404', 'R 404', 'R-404', '404A', 'four oh four'],
    description: 'R-404A refrigerant, used in commercial refrigeration'
  },
  {
    standard_term: 'R-407C',
    category: 'refrigerant',
    variations: ['R407C', 'R407', 'R 407', 'R-407', '407C', 'four oh seven'],
    description: 'R-407C refrigerant'
  },
  {
    standard_term: 'R-32',
    category: 'refrigerant',
    variations: ['R32', 'R 32', 'thirty two', 'R thirty two'],
    description: 'R-32 refrigerant, newer eco-friendly option'
  },

  // Equipment types
  {
    standard_term: 'RTU',
    category: 'equipment',
    variations: ['rooftop unit', 'roof top unit', 'rooftop', 'packaged unit'],
    description: 'Rooftop Unit - packaged HVAC system'
  },
  {
    standard_term: 'AHU',
    category: 'equipment',
    variations: ['air handler', 'air handling unit', 'air handler unit'],
    description: 'Air Handling Unit'
  },
  {
    standard_term: 'FCU',
    category: 'equipment',
    variations: ['fan coil', 'fan coil unit'],
    description: 'Fan Coil Unit'
  },
  {
    standard_term: 'MAU',
    category: 'equipment',
    variations: ['makeup air', 'make up air', 'makeup air unit', 'make-up air unit'],
    description: 'Makeup Air Unit'
  },
  {
    standard_term: 'VRF',
    category: 'equipment',
    variations: ['variable refrigerant flow', 'VRV'],
    description: 'Variable Refrigerant Flow system'
  },

  // Voltages
  {
    standard_term: '24V',
    category: 'voltage',
    variations: ['24 volt', '24 volts', '24v', '24 v', 'twenty four volt'],
    description: '24 volt control voltage'
  },
  {
    standard_term: '120V',
    category: 'voltage',
    variations: ['120 volt', '120 volts', '120v', '120 v', 'one twenty volt'],
    description: '120 volt power'
  },
  {
    standard_term: '240V',
    category: 'voltage',
    variations: ['240 volt', '240 volts', '240v', '240 v', 'two forty volt'],
    description: '240 volt power'
  },
  {
    standard_term: '208V',
    category: 'voltage',
    variations: ['208 volt', '208 volts', '208v', '208 v', 'two oh eight volt'],
    description: '208 volt three-phase power'
  },
  {
    standard_term: '480V',
    category: 'voltage',
    variations: ['480 volt', '480 volts', '480v', '480 v', 'four eighty volt'],
    description: '480 volt three-phase power'
  },

  // Common parts
  {
    standard_term: 'contactor',
    category: 'part_type',
    variations: ['contractor', 'contacter', 'relay switch'],
    description: 'Electrical contactor for compressor/fan control'
  },
  {
    standard_term: 'capacitor',
    category: 'part_type',
    variations: ['cap', 'run cap', 'start cap', 'run capacitor', 'start capacitor'],
    description: 'Run or start capacitor for motors'
  },
  {
    standard_term: 'compressor',
    category: 'part_type',
    variations: ['comp', 'scroll compressor', 'reciprocating compressor'],
    description: 'Refrigerant compressor'
  },
  {
    standard_term: 'condenser',
    category: 'part_type',
    variations: ['condensing unit', 'outdoor coil', 'condenser coil'],
    description: 'Condenser coil or condensing unit'
  },
  {
    standard_term: 'evaporator',
    category: 'part_type',
    variations: ['evap', 'evaporator coil', 'indoor coil', 'A coil'],
    description: 'Evaporator coil'
  },
  {
    standard_term: 'TXV',
    category: 'part_type',
    variations: ['TXV valve', 'expansion valve', 'thermostatic expansion valve', 'metering device'],
    description: 'Thermostatic Expansion Valve'
  },
  {
    standard_term: 'damper actuator',
    category: 'part_type',
    variations: ['actuator', 'damper motor', 'economizer actuator'],
    description: 'Motorized damper actuator'
  },
  {
    standard_term: 'blower motor',
    category: 'part_type',
    variations: ['blower', 'fan motor', 'indoor fan'],
    description: 'Indoor blower motor'
  },
  {
    standard_term: 'condenser fan motor',
    category: 'part_type',
    variations: ['condenser fan', 'outdoor fan', 'fan motor'],
    description: 'Outdoor condenser fan motor'
  },

  // Measurements
  {
    standard_term: 'lbs',
    category: 'measurement',
    variations: ['lb', 'pound', 'pounds'],
    description: 'Pounds (weight measurement)'
  },
  {
    standard_term: 'CFM',
    category: 'measurement',
    variations: ['cubic feet per minute', 'airflow'],
    description: 'Cubic Feet per Minute (airflow)'
  },
  {
    standard_term: 'tons',
    category: 'measurement',
    variations: ['ton', 'tonnage', 'cooling capacity'],
    description: 'Tons of cooling capacity'
  },
  {
    standard_term: 'PSI',
    category: 'measurement',
    variations: ['pounds per square inch', 'pressure'],
    description: 'Pounds per Square Inch (pressure)'
  },
  {
    standard_term: 'superheat',
    category: 'measurement',
    variations: ['super heat', 'SH'],
    description: 'Refrigerant superheat measurement'
  },
  {
    standard_term: 'subcool',
    category: 'measurement',
    variations: ['sub cool', 'subcooling', 'SC'],
    description: 'Refrigerant subcooling measurement'
  },

  // Common actions
  {
    standard_term: 'leak check',
    category: 'action',
    variations: ['check for leaks', 'leak test', 'pressure test'],
    description: 'Test system for refrigerant leaks'
  },
  {
    standard_term: 'recharge',
    category: 'action',
    variations: ['charge', 'add refrigerant', 'top off', 'refill'],
    description: 'Add refrigerant to system'
  },
  {
    standard_term: 'vacuum',
    category: 'action',
    variations: ['pull vacuum', 'evacuate', 'evacuation'],
    description: 'Pull vacuum on refrigerant system'
  },
  {
    standard_term: 'replace',
    category: 'action',
    variations: ['swap', 'change out', 'install new', 'swap out'],
    description: 'Replace a component'
  }
];

async function seedTerminology() {
  console.log('🌱 Seeding HVAC terminology database...\n');

  try {
    // Run migration first
    console.log('📋 Running migration...');
    const migration = require('fs').readFileSync('./migrations/002_create_hvac_terminology.sql', 'utf8');
    await sql.unsafe(migration);
    console.log('✓ Migration complete\n');

    // Clear existing data
    await sql`DELETE FROM hvac_terminology`;
    console.log('✓ Cleared existing terminology\n');

    let successCount = 0;

    for (const term of hvacTerminology) {
      try {
        console.log(`Processing: ${term.standard_term} (${term.category})`);

        // Create a comprehensive text for embedding that includes:
        // 1. The standard term
        // 2. All variations
        // 3. The description
        const embeddingText = [
          term.standard_term,
          ...term.variations,
          term.description
        ].join(' ');

        // Generate embedding
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: embeddingText,
        });

        const embedding = embeddingResponse.data[0].embedding;
        const embeddingStr = JSON.stringify(embedding);

        // Insert into database
        await sql`
          INSERT INTO hvac_terminology (
            standard_term,
            category,
            variations,
            description,
            embedding
          ) VALUES (
            ${term.standard_term},
            ${term.category},
            ${term.variations},
            ${term.description},
            ${embeddingStr}::vector(1536)
          )
        `;

        successCount++;
        console.log(`  ✓ Added with ${term.variations.length} variations\n`);

      } catch (error) {
        console.error(`  ✗ Failed to add ${term.standard_term}:`, error.message);
      }
    }

    console.log(`\n✅ Successfully seeded ${successCount}/${hvacTerminology.length} terms`);

    // Show summary by category
    const categorySummary = await sql`
      SELECT category, COUNT(*) as count
      FROM hvac_terminology
      GROUP BY category
      ORDER BY count DESC
    `;

    console.log('\n📊 Terms by category:');
    categorySummary.forEach(row => {
      console.log(`  ${row.category}: ${row.count}`);
    });

    process.exit(0);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedTerminology();

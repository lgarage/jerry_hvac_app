require('dotenv').config();
const { sql, testConnection } = require('./db');
const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Sample HVAC parts data
const sampleParts = [
  {
    part_number: 'CONT-24V-30A',
    name: '24V Contactor 30A',
    description: 'Single pole 24 volt contactor rated for 30 amps. Used in air conditioning and heat pump systems to control compressor operation.',
    category: 'Electrical',
    type: 'inventory',
    price: 45.99,
    thumbnail_url: 'https://via.placeholder.com/150?text=Contactor',
    common_uses: ['RTU', 'Split System', 'Heat Pump']
  },
  {
    part_number: 'CAP-440-35-5',
    name: 'Dual Run Capacitor 35/5 440V',
    description: 'Dual run capacitor 35+5 MFD 440 volt. For compressor and fan motor starting and running.',
    category: 'Electrical',
    type: 'inventory',
    price: 28.50,
    thumbnail_url: 'https://via.placeholder.com/150?text=Capacitor',
    common_uses: ['Condensing Unit', 'RTU', 'Split System']
  },
  {
    part_number: 'R410A-LB',
    name: 'R-410A Refrigerant (per lb)',
    description: 'R-410A refrigerant for air conditioning systems. Sold per pound. High pressure refrigerant used in modern AC systems.',
    category: 'Refrigerant',
    type: 'consumable',
    price: 12.00,
    thumbnail_url: 'https://via.placeholder.com/150?text=R410A',
    common_uses: ['RTU', 'Split System', 'Heat Pump']
  },
  {
    part_number: 'R22-LB',
    name: 'R-22 Refrigerant (per lb)',
    description: 'R-22 (Freon) refrigerant for legacy air conditioning systems. Sold per pound. Being phased out, used in older systems.',
    category: 'Refrigerant',
    type: 'consumable',
    price: 85.00,
    thumbnail_url: 'https://via.placeholder.com/150?text=R22',
    common_uses: ['RTU', 'Split System', 'Legacy Equipment']
  },
  {
    part_number: 'FILT-20X25X1',
    name: 'Air Filter 20x25x1 MERV 8',
    description: 'Pleated air filter 20x25x1 inch MERV 8 rating. Standard residential and light commercial filter.',
    category: 'Filters',
    type: 'consumable',
    price: 8.99,
    thumbnail_url: 'https://via.placeholder.com/150?text=Filter',
    common_uses: ['Air Handler', 'Furnace', 'RTU']
  },
  {
    part_number: 'ACTUATOR-24V',
    name: 'Economizer Damper Actuator 24V',
    description: '24 volt modulating actuator for economizer dampers. Spring return, 2-10VDC or 4-20mA control.',
    category: 'Controls',
    type: 'inventory',
    price: 185.00,
    thumbnail_url: 'https://via.placeholder.com/150?text=Actuator',
    common_uses: ['RTU', 'Economizer']
  },
  {
    part_number: 'RELAY-90-340',
    name: 'Fan Relay 90-340',
    description: 'SPST fan relay 24V coil rated 90-340 FLA. Controls fan motor operation in HVAC equipment.',
    category: 'Electrical',
    type: 'inventory',
    price: 22.00,
    thumbnail_url: 'https://via.placeholder.com/150?text=Relay',
    common_uses: ['Air Handler', 'Furnace']
  },
  {
    part_number: 'TAPE-FOIL-3IN',
    name: 'Foil Tape 3" x 50yd',
    description: 'Aluminum foil tape for sealing ductwork and insulation. 3 inch width, 50 yard roll.',
    category: 'Supplies',
    type: 'consumable',
    price: 15.99,
    thumbnail_url: 'https://via.placeholder.com/150?text=Tape',
    common_uses: ['Ductwork', 'Insulation']
  },
  {
    part_number: 'FUSE-3A-250V',
    name: 'Fuse 3A 250V AGC',
    description: 'Glass fuse 3 amp 250 volt AGC type. Common control circuit protection for HVAC equipment.',
    category: 'Electrical',
    type: 'consumable',
    price: 2.50,
    thumbnail_url: 'https://via.placeholder.com/150?text=Fuse',
    common_uses: ['Control Board', 'Transformer']
  },
  {
    part_number: 'TSTAT-PRO-WIFI',
    name: 'WiFi Programmable Thermostat',
    description: 'WiFi enabled programmable thermostat with 7-day scheduling. Compatible with most HVAC systems including heat pumps.',
    category: 'Controls',
    type: 'inventory',
    price: 149.99,
    thumbnail_url: 'https://via.placeholder.com/150?text=Thermostat',
    common_uses: ['Residential', 'Light Commercial']
  },
  {
    part_number: 'MOTOR-1HP-1075',
    name: 'Blower Motor 1HP 1075 RPM',
    description: '1 horsepower blower motor 1075 RPM multi-speed. For air handlers and furnaces.',
    category: 'Motors',
    type: 'inventory',
    price: 285.00,
    thumbnail_url: 'https://via.placeholder.com/150?text=Motor',
    common_uses: ['Air Handler', 'Furnace']
  },
  {
    part_number: 'WIRE-18-2-50FT',
    name: 'Thermostat Wire 18/2 50ft',
    description: '18 gauge 2 conductor thermostat wire. 50 foot roll for HVAC control wiring.',
    category: 'Supplies',
    type: 'consumable',
    price: 18.50,
    thumbnail_url: 'https://via.placeholder.com/150?text=Wire',
    common_uses: ['Thermostat', 'Controls']
  },
  {
    part_number: 'COMP-2TON-R410',
    name: 'Compressor 2 Ton R-410A',
    description: 'Scroll compressor 2 ton capacity for R-410A refrigerant. 208-230V single phase.',
    category: 'Compressors',
    type: 'inventory',
    price: 650.00,
    thumbnail_url: 'https://via.placeholder.com/150?text=Compressor',
    common_uses: ['Condensing Unit', 'Heat Pump']
  },
  {
    part_number: 'SWITCH-PRESS-HIGH',
    name: 'High Pressure Switch',
    description: 'High pressure safety switch for refrigeration systems. Automatic reset, adjustable cut-out.',
    category: 'Controls',
    type: 'inventory',
    price: 35.00,
    thumbnail_url: 'https://via.placeholder.com/150?text=Switch',
    common_uses: ['Condensing Unit', 'RTU']
  },
  {
    part_number: 'BELT-5VX-670',
    name: 'V-Belt 5VX670',
    description: '5VX670 cogged V-belt for blower assemblies. High efficiency belt for HVAC applications.',
    category: 'Supplies',
    type: 'consumable',
    price: 12.99,
    thumbnail_url: 'https://via.placeholder.com/150?text=Belt',
    common_uses: ['Blower', 'Air Handler']
  },
  {
    part_number: 'TRANS-40VA-24V',
    name: 'Transformer 40VA 24V',
    description: 'Step down transformer 120V to 24V 40VA. Control circuit transformer for HVAC systems.',
    category: 'Electrical',
    type: 'inventory',
    price: 32.00,
    thumbnail_url: 'https://via.placeholder.com/150?text=Transformer',
    common_uses: ['Furnace', 'Air Handler', 'Control Panel']
  }
];

async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error.message);
    throw error;
  }
}

async function runMigration() {
  console.log('\n📋 Running database migration...');

  const migrationSQL = fs.readFileSync('./migrations/001_create_tables.sql', 'utf8');

  try {
    await sql.unsafe(migrationSQL);
    console.log('✓ Migration completed successfully');
    return true;
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  }
}

async function seedParts() {
  console.log('\n🌱 Seeding parts database...');
  console.log(`Processing ${sampleParts.length} parts...`);

  let successCount = 0;

  for (const part of sampleParts) {
    try {
      // Generate embedding from part name + description
      const embeddingText = `${part.name} ${part.description} ${part.common_uses.join(' ')}`;
      console.log(`  Generating embedding for: ${part.name}...`);

      const embedding = await generateEmbedding(embeddingText);

      // Insert part with embedding
      await sql`
        INSERT INTO parts (
          part_number,
          name,
          description,
          category,
          type,
          price,
          thumbnail_url,
          common_uses,
          embedding
        ) VALUES (
          ${part.part_number},
          ${part.name},
          ${part.description},
          ${part.category},
          ${part.type},
          ${part.price},
          ${part.thumbnail_url},
          ${part.common_uses},
          ${JSON.stringify(embedding)}
        )
        ON CONFLICT (part_number) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          type = EXCLUDED.type,
          price = EXCLUDED.price,
          thumbnail_url = EXCLUDED.thumbnail_url,
          common_uses = EXCLUDED.common_uses,
          embedding = EXCLUDED.embedding,
          updated_at = NOW()
      `;

      successCount++;
      console.log(`  ✓ Added: ${part.name}`);

    } catch (error) {
      console.error(`  ✗ Failed to add ${part.name}:`, error.message);
    }
  }

  console.log(`\n✓ Successfully seeded ${successCount}/${sampleParts.length} parts`);
}

async function main() {
  console.log('🚀 Starting database setup...\n');

  // Test connection
  const connected = await testConnection();
  if (!connected) {
    console.error('\n❌ Cannot proceed without database connection');
    process.exit(1);
  }

  // Run migration
  await runMigration();

  // Seed parts
  await seedParts();

  // Test search
  console.log('\n🔍 Testing semantic search...');
  const testQuery = 'I need something to control my compressor';
  console.log(`Query: "${testQuery}"`);

  const queryEmbedding = await generateEmbedding(testQuery);
  const results = await sql`
    SELECT * FROM search_parts_by_similarity(
      ${JSON.stringify(queryEmbedding)}::vector(1536),
      0.5,
      5
    )
  `;

  console.log(`\nFound ${results.length} matching parts:`);
  results.forEach((part, i) => {
    console.log(`  ${i + 1}. ${part.name} (${(part.similarity * 100).toFixed(1)}% match)`);
  });

  console.log('\n✅ Database setup complete!\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});

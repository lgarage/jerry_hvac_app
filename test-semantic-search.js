// Test semantic search functionality
require('dotenv').config();
const { sql } = require('./db');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testSemanticSearch() {
  try {
    console.log('🔍 Testing Semantic Search...\n');

    // Test 1: Check if parts have embeddings
    console.log('Test 1: Checking embeddings...');
    const partsWithEmbeddings = await sql`
      SELECT name, embedding IS NOT NULL as has_embedding
      FROM parts
      LIMIT 5
    `;

    console.log('Sample parts:');
    partsWithEmbeddings.forEach(p => {
      console.log(`  ${p.name}: ${p.has_embedding ? '✅ Has embedding' : '❌ No embedding'}`);
    });

    const totalWithEmbeddings = await sql`
      SELECT COUNT(*) as count
      FROM parts
      WHERE embedding IS NOT NULL
    `;
    console.log(`\nTotal parts with embeddings: ${totalWithEmbeddings[0].count}/20\n`);

    // Test 2: Try a simple search
    if (totalWithEmbeddings[0].count > 0) {
      console.log('Test 2: Testing search for "contactor"...');

      const embedding = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'contactor',
      });

      const queryEmbedding = JSON.stringify(embedding.data[0].embedding);

      const results = await sql`
        SELECT
          name,
          category,
          price,
          1 - (embedding <=> ${queryEmbedding}::vector) as similarity
        FROM parts
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${queryEmbedding}::vector
        LIMIT 3
      `;

      console.log('Results:');
      results.forEach(r => {
        console.log(`  ${r.name} (${r.category}): ${(r.similarity * 100).toFixed(1)}% match`);
      });
    } else {
      console.log('⚠️  No embeddings found - parts need embeddings generated');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testSemanticSearch();

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const OpenAI = require('openai');
const { sql } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post('/api/parse', async (req, res) => {
  try {
    const { audio, text } = req.body;
    let transcription = text || '';

    if (audio && !text) {
      transcription = await transcribeAudio(audio);
    }

    if (!transcription) {
      return res.status(400).json({ error: 'No input provided' });
    }

    const parsedRepairs = await parseRepairs(transcription);

    // Auto-match parts from catalog for each repair
    const repairsWithParts = await autoMatchParts(parsedRepairs);

    res.json({
      transcription,
      repairs: repairsWithParts
    });

  } catch (error) {
    console.error('Error in /api/parse:', error);
    res.status(500).json({ error: error.message });
  }
});

async function transcribeAudio(base64Audio) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const audioBuffer = Buffer.from(base64Audio.split(',')[1] || base64Audio, 'base64');

    const file = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1'
    });

    return transcription.text || '';

  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

async function parseRepairs(transcription) {
  try {
    const systemPrompt = `You are an HVAC repair documentation assistant. Parse the technician's notes into structured repair items.

Return a JSON array where each item has:
- equipment: string (e.g., "RTU-1", "AHU-2")
- problem: string (brief description)
- parts: array of strings (parts needed)
- actions: array of strings (actions to take)
- notes: string (additional context)

Example input: "RTU-1 low on charge needs 4 pounds 410A, economizer damper actuator is broken, and RTU-2 contactor is buzzing."

Example output:
[
  {
    "equipment": "RTU-1",
    "problem": "Low refrigerant",
    "parts": ["4 lbs R410A"],
    "actions": ["Leak check", "Recharge"],
    "notes": ""
  },
  {
    "equipment": "RTU-1",
    "problem": "Broken economizer damper actuator",
    "parts": ["Economizer actuator"],
    "actions": ["Replace actuator"],
    "notes": ""
  },
  {
    "equipment": "RTU-2",
    "problem": "Contactor buzzing",
    "parts": ["Contactor"],
    "actions": ["Replace contactor"],
    "notes": ""
  }
]

Return ONLY valid JSON array, no additional text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcription }
      ],
      temperature: 0.3
    });

    const content = completion.choices[0].message.content.trim();

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No valid JSON array found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [parsed];

  } catch (error) {
    console.error('Parsing error:', error);
    throw new Error(`Failed to parse repairs: ${error.message}`);
  }
}

// Auto-match parts from catalog using semantic search
async function autoMatchParts(repairs) {
  if (!repairs || repairs.length === 0) return repairs;

  console.log('\n🔍 Auto-matching parts from catalog...');

  for (const repair of repairs) {
    if (!repair.parts || repair.parts.length === 0) continue;

    repair.selectedParts = [];

    for (const partString of repair.parts) {
      try {
        // Extract quantity from part string (e.g., "4 lbs R410A" → qty: 4, search: "R410A refrigerant")
        const { quantity, searchTerm } = extractQuantityAndTerm(partString);

        // Search parts database using semantic search
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: searchTerm,
        });

        const queryEmbedding = embeddingResponse.data[0].embedding;
        const embeddingStr = JSON.stringify(queryEmbedding);

        // Find best matching part
        const results = await sql`
          SELECT
            id,
            part_number,
            name,
            description,
            category,
            type,
            price,
            1 - (embedding <=> ${embeddingStr}::vector(1536)) AS similarity
          FROM parts
          ORDER BY embedding <=> ${embeddingStr}::vector(1536)
          LIMIT 1
        `;

        if (results.length > 0 && results[0].similarity > 0.3) {
          const matchedPart = results[0];

          repair.selectedParts.push({
            part_number: matchedPart.part_number,
            name: matchedPart.name,
            price: matchedPart.price,
            type: matchedPart.type,
            quantity: quantity,
            auto_matched: true,
            original_text: partString,
            match_confidence: parseFloat(matchedPart.similarity)
          });

          console.log(`  ✓ "${partString}" → ${matchedPart.name} (qty: ${quantity}, ${(matchedPart.similarity * 100).toFixed(0)}% match)`);
        } else {
          console.log(`  ✗ "${partString}" → No match found (best: ${results[0] ? (results[0].similarity * 100).toFixed(0) : 0}%)`);
        }

      } catch (error) {
        console.error(`  Error matching part "${partString}":`, error.message);
      }
    }
  }

  console.log('✓ Auto-matching complete\n');
  return repairs;
}

// Extract quantity and clean search term from part string
function extractQuantityAndTerm(partString) {
  let quantity = 1;
  let searchTerm = partString.toLowerCase();

  // Match patterns like "4 lbs", "5 pounds", "2x", "3 units", etc.
  const quantityPatterns = [
    /(\d+)\s*(?:lbs?|pounds?)/i,  // "4 lbs", "5 pounds"
    /(\d+)\s*(?:x|×)/i,            // "2x", "3×"
    /(\d+)\s+/,                     // "4 " (number followed by space)
  ];

  for (const pattern of quantityPatterns) {
    const match = partString.match(pattern);
    if (match) {
      quantity = parseInt(match[1]);
      // Remove the quantity from search term
      searchTerm = partString.replace(pattern, '').trim();
      break;
    }
  }

  // Clean up search term for better matching
  searchTerm = searchTerm
    .replace(/\blbs?\b/gi, '') // Remove "lb", "lbs"
    .replace(/\bpounds?\b/gi, '')
    .replace(/\bunits?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { quantity, searchTerm };
}

// In-memory storage for submitted repairs
let submittedRepairs = [];

app.post('/api/submit-repairs', (req, res) => {
  try {
    const { repairs } = req.body;

    if (!repairs || !Array.isArray(repairs)) {
      return res.status(400).json({ error: 'Invalid repairs data' });
    }

    // Store repairs with timestamp
    const submission = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      repairs: repairs,
      count: repairs.length
    };

    submittedRepairs.push(submission);

    console.log(`\n=== REPAIR SUBMISSION ===`);
    console.log(`Time: ${submission.timestamp}`);
    console.log(`Total Repairs: ${submission.count}`);
    console.log(JSON.stringify(repairs, null, 2));
    console.log(`========================\n`);

    res.json({
      success: true,
      submissionId: submission.id,
      message: `Successfully submitted ${repairs.length} repair(s)`
    });

  } catch (error) {
    console.error('Error submitting repairs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Optional: Get all submitted repairs
app.get('/api/submissions', (req, res) => {
  res.json({
    total: submittedRepairs.length,
    submissions: submittedRepairs
  });
});

// Parts Search Endpoints
app.get('/api/parts/search', async (req, res) => {
  try {
    const { query, type, category, limit = 10 } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    // Generate embedding for the search query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;
    const embeddingStr = JSON.stringify(queryEmbedding);

    // Execute search query - no threshold, just order by similarity
    const results = await sql`
      SELECT
        id,
        part_number,
        name,
        description,
        category,
        type,
        price,
        thumbnail_url,
        common_uses,
        1 - (embedding <=> ${embeddingStr}::vector(1536)) AS similarity
      FROM parts
      ORDER BY embedding <=> ${embeddingStr}::vector(1536)
      LIMIT ${parseInt(limit)}
    `;

    // Filter by type and category in JavaScript if needed
    let filteredResults = results;
    if (type) {
      filteredResults = filteredResults.filter(part => part.type === type);
    }
    if (category) {
      filteredResults = filteredResults.filter(part => part.category === category);
    }

    res.json({
      query,
      count: filteredResults.length,
      parts: filteredResults
    });

  } catch (error) {
    console.error('Parts search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all parts by category
app.get('/api/parts/category/:category', async (req, res) => {
  try {
    const { category } = req.params;

    const parts = await sql`
      SELECT * FROM parts
      WHERE category = ${category}
      ORDER BY name
    `;

    res.json({
      category,
      count: parts.length,
      parts
    });

  } catch (error) {
    console.error('Error fetching parts by category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get consumables vs inventory
app.get('/api/parts/type/:type', async (req, res) => {
  try {
    const { type } = req.params;

    if (!['consumable', 'inventory'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "consumable" or "inventory"' });
    }

    const parts = await sql`
      SELECT * FROM parts
      WHERE type = ${type}
      ORDER BY category, name
    `;

    res.json({
      type,
      count: parts.length,
      parts
    });

  } catch (error) {
    console.error('Error fetching parts by type:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all categories
app.get('/api/parts/categories', async (req, res) => {
  try {
    const categories = await sql`
      SELECT category, COUNT(*) as count
      FROM parts
      GROUP BY category
      ORDER BY category
    `;

    res.json({ categories });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dave Mode server running on http://localhost:${PORT}`);
  console.log(`Configured with OpenAI: ${!!process.env.OPENAI_API_KEY}`);
});

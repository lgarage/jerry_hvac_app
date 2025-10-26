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

    res.json({
      transcription,
      repairs: parsedRepairs
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

    // Build the search query with optional filters
    let searchQuery = sql`
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
        1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536)) AS similarity
      FROM parts
      WHERE 1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536)) > 0.5
    `;

    // Add type filter if provided
    if (type) {
      searchQuery = sql`
        ${searchQuery}
        AND type = ${type}
      `;
    }

    // Add category filter if provided
    if (category) {
      searchQuery = sql`
        ${searchQuery}
        AND category = ${category}
      `;
    }

    // Complete the query with order and limit
    const results = await sql`
      ${searchQuery}
      ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536)
      LIMIT ${parseInt(limit)}
    `;

    res.json({
      query,
      count: results.length,
      parts: results
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

// Check if parts exist in database
app.post('/api/parts/check', async (req, res) => {
  try {
    const { parts } = req.body;

    if (!parts || !Array.isArray(parts)) {
      return res.status(400).json({ error: 'Parts array is required' });
    }

    const results = [];

    for (const partName of parts) {
      // Use semantic search to check if part exists
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: partName,
      });

      const queryEmbedding = embeddingResponse.data[0].embedding;

      const matches = await sql`
        SELECT
          id,
          part_number,
          name,
          description,
          1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536)) AS similarity
        FROM parts
        WHERE 1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536)) > 0.7
        ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536)
        LIMIT 1
      `;

      results.push({
        part: partName,
        exists: matches.length > 0,
        match: matches.length > 0 ? matches[0] : null
      });
    }

    res.json({ results });

  } catch (error) {
    console.error('Error checking parts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Parse part details from voice input
app.post('/api/parts/parse-details', async (req, res) => {
  try {
    const { audio, text, partName } = req.body;
    let transcription = text || '';

    if (audio && !text) {
      transcription = await transcribeAudio(audio);
    }

    if (!transcription) {
      return res.status(400).json({ error: 'No input provided' });
    }

    // Use AI to extract structured part details
    const systemPrompt = `You are an HVAC parts database assistant. Parse the spoken part details into structured data.

Return a JSON object with:
- name: string (part name)
- part_number: string (manufacturer part number if mentioned, otherwise empty)
- description: string (detailed description)
- category: string (one of: "Electrical", "Mechanical", "Refrigeration", "Controls", "Filters", "Other")
- type: string (either "consumable" or "inventory")
- price: number (price if mentioned, otherwise 0)
- common_uses: string (common applications or uses)

If a field is not mentioned, make a reasonable inference based on the part name and context.

Example input: "This is a Honeywell economizer actuator, part number M847D. It's used for damper control in RTUs. Costs about 150 dollars. This is an inventory item for mechanical systems."

Example output:
{
  "name": "Honeywell Economizer Actuator",
  "part_number": "M847D",
  "description": "Honeywell economizer actuator for damper control",
  "category": "Mechanical",
  "type": "inventory",
  "price": 150,
  "common_uses": "Damper control in RTUs, economizer systems"
}

Return ONLY valid JSON object, no additional text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Part being described: ${partName}\n\nUser's description: ${transcription}` }
      ],
      temperature: 0.3
    });

    const content = completion.choices[0].message.content.trim();

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON object found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    res.json({
      transcription,
      partDetails: parsed
    });

  } catch (error) {
    console.error('Error parsing part details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add new part to database
app.post('/api/parts/add', async (req, res) => {
  try {
    const { name, part_number, description, category, type, price, common_uses } = req.body;

    if (!name || !category || !type) {
      return res.status(400).json({ error: 'Name, category, and type are required' });
    }

    // Generate embedding for the part
    const embeddingText = `${name} ${part_number || ''} ${description || ''} ${common_uses || ''}`;
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingText,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Insert into database
    const result = await sql`
      INSERT INTO parts (part_number, name, description, category, type, price, common_uses, embedding)
      VALUES (
        ${part_number || ''},
        ${name},
        ${description || ''},
        ${category},
        ${type},
        ${price || 0},
        ${common_uses || ''},
        ${JSON.stringify(embedding)}::vector(1536)
      )
      RETURNING *
    `;

    res.json({
      success: true,
      part: result[0]
    });

  } catch (error) {
    console.error('Error adding part:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dave Mode server running on http://localhost:${PORT}`);
  console.log(`Configured with OpenAI: ${!!process.env.OPENAI_API_KEY}`);
});

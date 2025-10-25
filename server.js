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

// Normalize HVAC terminology using semantic search against terminology database
async function normalizeHVACTerms(text) {
  if (!text) return text;

  try {
    console.log('\n🔍 Normalizing HVAC terminology...');

    // Extract candidate phrases (n-grams from 1-4 words)
    const words = text.split(/\s+/);
    const candidates = new Set();

    // Generate n-grams (phrases of 1-4 words)
    for (let n = 1; n <= 4; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const phrase = words.slice(i, i + n).join(' ');
        // Only add phrases that might be technical terms (contain letters or numbers)
        if (/[a-zA-Z0-9]/.test(phrase) && phrase.length > 1) {
          candidates.add({
            phrase: phrase,
            startIndex: text.toLowerCase().indexOf(phrase.toLowerCase()),
            length: phrase.length
          });
        }
      }
    }

    // Convert to array and sort by length (longest first) to handle overlapping matches
    const sortedCandidates = Array.from(candidates).sort((a, b) => b.length - a.length);

    // Find matches in terminology database
    const replacements = [];

    for (const candidate of sortedCandidates) {
      try {
        // Generate embedding for the candidate phrase
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: candidate.phrase,
        });

        const queryEmbedding = embeddingResponse.data[0].embedding;
        const embeddingStr = JSON.stringify(queryEmbedding);

        // Search terminology database
        const results = await sql`
          SELECT
            standard_term,
            category,
            variations,
            1 - (embedding <=> ${embeddingStr}::vector(1536)) AS similarity
          FROM hvac_terminology
          ORDER BY embedding <=> ${embeddingStr}::vector(1536)
          LIMIT 1
        `;

        // If we have a strong match (>70% similarity), consider it
        if (results.length > 0 && results[0].similarity > 0.70) {
          const match = results[0];

          // Also check if the phrase is in the variations array (exact match gets priority)
          const isExactVariation = match.variations.some(v =>
            v.toLowerCase() === candidate.phrase.toLowerCase()
          );

          const finalSimilarity = isExactVariation ? 1.0 : match.similarity;

          if (finalSimilarity > 0.70) {
            replacements.push({
              original: candidate.phrase,
              replacement: match.standard_term,
              category: match.category,
              similarity: finalSimilarity,
              startIndex: candidate.startIndex
            });
          }
        }

      } catch (error) {
        // Skip this candidate if embedding fails
        console.error(`  Error processing "${candidate.phrase}":`, error.message);
      }
    }

    // Sort replacements by start index (reverse order) to avoid index shifting
    replacements.sort((a, b) => b.startIndex - a.startIndex);

    // Remove overlapping replacements (keep the longest/best match)
    const finalReplacements = [];
    const usedRanges = new Set();

    for (const replacement of replacements.sort((a, b) => b.similarity - a.similarity)) {
      const endIndex = replacement.startIndex + replacement.original.length;
      let hasOverlap = false;

      for (let i = replacement.startIndex; i < endIndex; i++) {
        if (usedRanges.has(i)) {
          hasOverlap = true;
          break;
        }
      }

      if (!hasOverlap) {
        finalReplacements.push(replacement);
        for (let i = replacement.startIndex; i < endIndex; i++) {
          usedRanges.add(i);
        }
      }
    }

    // Apply replacements
    let normalized = text;
    for (const replacement of finalReplacements.sort((a, b) => b.startIndex - a.startIndex)) {
      const regex = new RegExp(replacement.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      normalized = normalized.replace(regex, replacement.replacement);

      console.log(`  ✓ "${replacement.original}" → "${replacement.replacement}" (${(replacement.similarity * 100).toFixed(0)}% match, ${replacement.category})`);
    }

    if (finalReplacements.length === 0) {
      console.log('  No terminology matches found');
    }

    return normalized;

  } catch (error) {
    console.error('❌ Terminology normalization failed:', error.message);
    // Return original text if normalization fails
    return text;
  }
}

async function transcribeAudio(base64Audio) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const audioBuffer = Buffer.from(base64Audio.split(',')[1] || base64Audio, 'base64');

    const file = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });

    // Add HVAC-specific context to improve transcription accuracy
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      prompt: 'HVAC technician documenting repairs. Common terms: R-410A, R-22, R-134A refrigerant, RTU, AHU, FCU, contactor, capacitor, compressor, condenser, evaporator, damper actuator, thermistor, TXV valve, leak check, subcool, superheat, micron, vacuum, CFM.'
    });

    const rawText = transcription.text || '';
    const normalizedText = await normalizeHVACTerms(rawText);

    console.log('Raw transcription:', rawText);
    if (rawText !== normalizedText) {
      console.log('Normalized transcription:', normalizedText);
    }

    return normalizedText;

  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

async function parseRepairs(transcription) {
  try {
    const systemPrompt = `You are an HVAC repair documentation assistant. Parse the technician's notes into structured repair items.

IMPORTANT: Use proper HVAC terminology:
- Refrigerants: R-410A (not R410, R4-10, or 410A), R-22, R-134A, R-404A, R-407C, R-32
- Equipment: RTU-1, AHU-2, FCU-3, MAU-1 (with dashes)
- Voltages: 24V, 120V, 240V, 208V, 480V
- Units: lbs (for pounds), CFM, tons, BTU

Return a JSON array where each item has:
- equipment: string (e.g., "RTU-1", "AHU-2")
- problem: string (brief description)
- parts: array of strings (parts needed, with proper formatting)
- actions: array of strings (actions to take)
- notes: string (additional context)

Example input: "RTU-1 low on charge needs 4 pounds 410A, economizer damper actuator is broken, and RTU-2 contactor is buzzing."

Example output:
[
  {
    "equipment": "RTU-1",
    "problem": "Low refrigerant",
    "parts": ["4 lbs R-410A"],
    "actions": ["Leak check", "Recharge"],
    "notes": ""
  },
  {
    "equipment": "RTU-1",
    "problem": "Broken economizer damper actuator",
    "parts": ["Economizer damper actuator"],
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

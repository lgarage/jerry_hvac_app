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
    let rawTranscription = text || '';
    let transcription = text || '';
    let suggestions = [];
    let newTerms = [];

    if (audio && !text) {
      const result = await transcribeAudio(audio);
      rawTranscription = result.rawText; // Save original transcription
      transcription = result.text; // Normalized version
      suggestions = result.suggestions || [];
      newTerms = result.newTerms || [];
    } else if (text) {
      // Also normalize typed text
      rawTranscription = text; // Keep original typed text
      const { normalized, suggestions: textSuggestions, newTerms: textNewTerms } = await normalizeHVACTerms(text);
      transcription = normalized;
      suggestions = textSuggestions || [];
      newTerms = textNewTerms || [];
    }

    if (!transcription) {
      return res.status(400).json({ error: 'No input provided' });
    }

    // Pass both raw and normalized text to GPT-4 for better context
    const parsedRepairs = await parseRepairs(transcription, rawTranscription);

    // Auto-match parts from catalog for each repair
    const repairsWithParts = await autoMatchParts(parsedRepairs);

    res.json({
      raw_transcription: rawTranscription, // Original text before normalization
      transcription, // Normalized text with standard terminology
      repairs: repairsWithParts,
      suggestions, // Send terminology suggestions to frontend for confirmation
      newTerms // Send potential new terms to add to glossary
    });

  } catch (error) {
    console.error('Error in /api/parse:', error);
    res.status(500).json({ error: error.message });
  }
});

// Agent 1: Terminology Quality Check
// Uses GPT-4o-mini to intelligently decide if terminology matches need user confirmation
async function evaluateTerminologyMatches(matches) {
  if (!matches || matches.length === 0) return [];

  try {
    console.log('\n🤖 Agent 1: Evaluating terminology matches...');

    const systemPrompt = `You are a terminology quality check agent for an HVAC repair documentation system.

Your job: Decide if terminology matches need user confirmation or can be auto-accepted.

AUTO-ACCEPT (no user confirmation needed) if ANY of these apply:
1. IDENTICAL TERMS (e.g., "compressor" → "compressor") - even with low similarity score
2. Only punctuation differences (e.g., "damper actuator." → "damper actuator")
3. Only capitalization differences (e.g., "RTU" → "rtu")
4. Only preposition/article removal (e.g., "of R-22" → "R-22", "a compressor" → "compressor")
5. Obvious abbreviations (e.g., "lb" → "lbs", "R410A" → "R-410A")
6. Formatting differences (e.g., "24 volt" → "24V", "four ten" → "410")
7. High confidence (>85%) AND clearly same technical term

REQUIRE CONFIRMATION only if:
1. Actually different words/concepts (e.g., "contactor" → "capacitor")
2. Ambiguous transcription (e.g., "R-210" → "RTU-10")
3. Low confidence (<70%) AND could be wrong term
4. Multiple possible interpretations

CRITICAL: If the original and suggested are the SAME WORD (ignoring case/punctuation), always auto-accept regardless of similarity score.

Return a JSON object with "decisions" array. Each decision:
{
  "needs_confirmation": boolean,
  "reason": "brief explanation",
  "auto_accept": boolean
}

Be very generous with auto-accept. Err on the side of auto-accepting unless genuinely ambiguous.`;

    const matchDescriptions = matches.map((m, idx) =>
      `Match ${idx + 1}: original="${m.original}" suggested="${m.suggested}" similarity=${(m.confidence * 100).toFixed(0)}% category=${m.category}`
    ).join('\n');

    const userPrompt = `Evaluate these terminology matches and return decisions:\n\n${matchDescriptions}\n\nReturn format: {"decisions": [{"needs_confirmation": bool, "reason": "...", "auto_accept": bool}, ...]}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('  Agent 1 raw response:', responseText);

    const result = JSON.parse(responseText);
    const decisions = result.decisions || [];

    if (decisions.length !== matches.length) {
      console.error(`  ⚠️  Agent 1 returned ${decisions.length} decisions for ${matches.length} matches`);
    }

    decisions.forEach((decision, idx) => {
      const match = matches[idx];
      if (match) {
        const status = decision.needs_confirmation ? '❓ Needs confirmation' : '✅ Auto-accept';
        console.log(`  ${status}: "${match.original}" → "${match.suggested}" - ${decision.reason}`);
      }
    });

    return decisions;

  } catch (error) {
    console.error('❌ Agent 1 evaluation failed:', error.message);
    console.error('   Stack:', error.stack);
    // Fallback: if agent fails, use conservative approach (require confirmation for <90%)
    return matches.map(m => ({
      needs_confirmation: m.confidence < 0.90,
      reason: 'Agent evaluation failed, using fallback threshold',
      auto_accept: m.confidence >= 0.90
    }));
  }
}

// Normalize HVAC terminology using semantic search against terminology database
async function normalizeHVACTerms(text) {
  if (!text) return { normalized: text, suggestions: [], newTerms: [] };

  try {
    console.log('\n🔍 Normalizing HVAC terminology...');

    // Extract candidate phrases (n-grams from 1-4 words)
    const words = text.split(/\s+/);
    const candidates = new Set();

    // Generate n-grams (phrases of 1-4 words)
    for (let n = 1; n <= 4; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        let phrase = words.slice(i, i + n).join(' ');

        // Strip trailing punctuation from the phrase
        phrase = phrase.replace(/[.,;:!?]+$/, '');

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
    const potentialNewTerms = []; // Track phrases that might be new terminology

    for (const candidate of sortedCandidates) {
      try {
        // Skip very common words
        const commonWords = ['the', 'and', 'for', 'with', 'needs', 'need', 'has', 'is', 'are', 'was', 'were', 'be', 'been', 'being'];
        if (candidate.phrase.split(' ').length === 1 && commonWords.includes(candidate.phrase.toLowerCase())) {
          continue;
        }

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

        const bestMatch = results.length > 0 ? results[0] : null;
        const similarity = bestMatch ? bestMatch.similarity : 0;

        // Check if this looks like a technical term that should be in glossary
        // Must be a clean technical phrase, not a sentence fragment

        // First, exclude phrases with sentence fragments
        const excludeWords = [
          // Common verbs that indicate sentence fragments
          'replaced', 'needs', 'needing', 'along', 'that', 'this', 'these', 'those',
          'was', 'were', 'been', 'being', 'have', 'has', 'had',
          // Prepositions and conjunctions
          'with', 'without', 'along', 'at', 'from', 'into', 'onto', 'upon'
        ];

        const phraseWords = candidate.phrase.toLowerCase().split(/\s+/);
        const hasExcludedWord = excludeWords.some(word => phraseWords.includes(word));

        // Exclude phrases with punctuation (sentence fragments)
        const hasPunctuation = /[.,:;!?]/.test(candidate.phrase);

        // Only consider it technical if it has technical indicators AND is clean
        const hasTechnicalIndicators =
          /\d/.test(candidate.phrase) || // Contains numbers (24V, R-410A, etc.)
          /[A-Z]{2,}/.test(candidate.phrase) || // Has acronyms (RTU, AHU, etc.)
          (candidate.phrase.includes('-') && /\d/.test(candidate.phrase)) || // Has hyphen with number
          /\d+V\b/.test(candidate.phrase); // Voltage pattern (24V, 120V, etc.)

        const looksTechnical =
          hasTechnicalIndicators &&
          !hasExcludedWord &&
          !hasPunctuation &&
          candidate.phrase.split(' ').length >= 2 && // Multi-word
          candidate.phrase.split(' ').length <= 5; // But not too long (likely sentence)

        // If similarity is low (<50%) and it looks technical, suggest adding to glossary
        if (looksTechnical && similarity < 0.50) {
          potentialNewTerms.push({
            phrase: candidate.phrase,
            bestMatch: bestMatch ? bestMatch.standard_term : null,
            similarity: similarity
          });
          console.log(`  💡 Potential new term: "${candidate.phrase}" (best match: ${similarity > 0 ? (similarity * 100).toFixed(0) + '% - ' + bestMatch.standard_term : 'none'})`);
        }

        // If we have a strong match (>70% similarity), use it
        if (similarity > 0.70) {
          const match = bestMatch;

          // Also check if the phrase is in the variations array (exact match gets priority)
          const isExactVariation = match.variations.some(v =>
            v.toLowerCase() === candidate.phrase.toLowerCase()
          );

          const finalSimilarity = isExactVariation ? 1.0 : similarity;

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

    // Apply replacements and track potential suggestions for Agent 1 evaluation
    let normalized = text;
    const potentialSuggestions = []; // Candidates for confirmation

    for (const replacement of finalReplacements.sort((a, b) => b.startIndex - a.startIndex)) {
      const regex = new RegExp(replacement.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      normalized = normalized.replace(regex, replacement.replacement);

      const confidencePercent = (replacement.similarity * 100).toFixed(0);
      console.log(`  ✓ "${replacement.original}" → "${replacement.replacement}" (${confidencePercent}% match, ${replacement.category})`);

      // Collect all matches below 95% confidence for Agent 1 to evaluate
      // Agent 1 will decide which actually need confirmation
      if (replacement.similarity < 0.95) {
        potentialSuggestions.push({
          original: replacement.original,
          suggested: replacement.replacement,
          confidence: replacement.similarity,
          category: replacement.category
        });
      }
    }

    // Use Agent 1 to intelligently filter which matches need confirmation
    let suggestions = [];
    if (potentialSuggestions.length > 0) {
      const decisions = await evaluateTerminologyMatches(potentialSuggestions);
      suggestions = potentialSuggestions.filter((suggestion, idx) => {
        const decision = decisions[idx];
        return decision && decision.needs_confirmation;
      });
    }

    if (finalReplacements.length === 0) {
      console.log('  No terminology matches found');
    }

    // Remove duplicate new terms and filter overlaps with replacements
    const usedPhrases = new Set(finalReplacements.map(r => r.original.toLowerCase()));
    const uniqueNewTerms = potentialNewTerms
      .filter(nt => !usedPhrases.has(nt.phrase.toLowerCase()))
      .slice(0, 3); // Limit to top 3 to avoid overwhelming user

    return { normalized, suggestions, newTerms: uniqueNewTerms };

  } catch (error) {
    console.error('❌ Terminology normalization failed:', error.message);
    // Return original text if normalization fails
    return { normalized: text, suggestions: [], newTerms: [] };
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
    const { normalized, suggestions, newTerms } = await normalizeHVACTerms(rawText);

    console.log('Raw transcription:', rawText);
    if (rawText !== normalized) {
      console.log('Normalized transcription:', normalized);
    }

    return {
      rawText, // Original Whisper transcription
      text: normalized, // Normalized with standard terminology
      suggestions,
      newTerms
    };

  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

async function parseRepairs(transcription, rawTranscription = null) {
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

    // Build user message with both raw and normalized text for better context
    let userMessage = transcription;
    if (rawTranscription && rawTranscription !== transcription) {
      userMessage = `Original voice transcription: "${rawTranscription}"\n\nNormalized with standard terminology: "${transcription}"\n\nPlease parse the normalized version, but reference the original if needed for context.`;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
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
        const { quantity, searchTerm, refrigerantCode } = extractQuantityAndTerm(partString);

        let matchedPart = null;

        // CRITICAL SAFETY CHECK: For refrigerants, require EXACT code match
        // Never allow cross-refrigerant matching (R-22 ≠ R-410A)
        if (refrigerantCode) {
          console.log(`  🔒 Refrigerant detected: ${refrigerantCode} - using exact match only`);

          // Try exact match first (handles R-410A, R410A, R-22, etc.)
          const exactMatch = await sql`
            SELECT
              id,
              part_number,
              name,
              description,
              category,
              type,
              price,
              1.0 AS similarity
            FROM parts
            WHERE (
              name ILIKE ${`%${refrigerantCode}%`} OR
              part_number ILIKE ${`%${refrigerantCode}%`} OR
              description ILIKE ${`%${refrigerantCode}%`}
            )
            AND (
              name ILIKE '%refrigerant%' OR
              category = 'refrigerant'
            )
            LIMIT 1
          `;

          if (exactMatch.length > 0) {
            matchedPart = exactMatch[0];
            console.log(`  ✓ "${partString}" → ${matchedPart.name} (qty: ${quantity}, EXACT refrigerant match)`);
          } else {
            console.log(`  ✗ "${partString}" → No exact refrigerant match for ${refrigerantCode}`);
          }

        } else {
          // Non-refrigerant parts: use semantic search
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

          if (results.length > 0 && results[0].similarity > 0.6) {
            matchedPart = results[0];
            console.log(`  ✓ "${partString}" → ${matchedPart.name} (qty: ${quantity}, ${(matchedPart.similarity * 100).toFixed(0)}% match)`);
          } else {
            console.log(`  ✗ "${partString}" → No match found (best: ${results[0] ? (results[0].similarity * 100).toFixed(0) : 0}%)`);
          }
        }

        // Add matched part to repair
        if (matchedPart) {
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
  let refrigerantCode = null;

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

  // CRITICAL: Detect refrigerant codes for exact matching
  // Matches: R-410A, R410A, R-22, R22, R-134A, etc.
  const refrigerantMatch = searchTerm.match(/R-?\d{2,3}[A-Z]?/i);
  if (refrigerantMatch) {
    refrigerantCode = refrigerantMatch[0].toUpperCase();
    // Normalize format: ensure hyphen (R410A → R-410A, R22 → R-22)
    if (!refrigerantCode.includes('-')) {
      refrigerantCode = refrigerantCode.replace(/^R(\d)/, 'R-$1');
    }
    console.log(`  🔒 Refrigerant code detected: ${refrigerantCode}`);
  }

  // Enhance search term for non-refrigerant parts
  if (!refrigerantCode) {
    // If it looks like a voltage spec (24V, 120V, etc.), add context
    if (/\d+V\b/i.test(searchTerm) && !/contactor|transformer|relay/i.test(searchTerm)) {
      // Already has voltage, no need to enhance
    }
  }

  return { quantity, searchTerm, refrigerantCode };
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

// Terminology Management Endpoints

// Confirm and save a terminology variation
app.post('/api/terminology/confirm', async (req, res) => {
  try {
    const { original, corrected, category } = req.body;

    if (!original || !corrected) {
      return res.status(400).json({ error: 'original and corrected are required' });
    }

    console.log(`\n📝 Confirming terminology: "${original}" → "${corrected}"`);

    // Check if the corrected term already exists in the database
    const existing = await sql`
      SELECT id, standard_term, variations, description, category
      FROM hvac_terminology
      WHERE standard_term ILIKE ${corrected}
      LIMIT 1
    `;

    if (existing.length > 0) {
      // Add the original as a variation to the existing term
      const term = existing[0];

      // Check if variation already exists
      if (term.variations.some(v => v.toLowerCase() === original.toLowerCase())) {
        console.log(`  ✓ Variation "${original}" already exists for "${term.standard_term}"`);
        return res.json({
          success: true,
          message: 'Variation already exists',
          term
        });
      }

      // Add new variation
      const updatedVariations = [...term.variations, original];

      // Regenerate embedding with new variation
      const embeddingText = [
        term.standard_term,
        ...updatedVariations,
        term.description || ''
      ].join(' ');

      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: embeddingText,
      });

      const embedding = embeddingResponse.data[0].embedding;
      const embeddingStr = JSON.stringify(embedding);

      // Update the term
      const result = await sql`
        UPDATE hvac_terminology
        SET
          variations = ${updatedVariations},
          embedding = ${embeddingStr}::vector(1536),
          updated_at = NOW()
        WHERE id = ${term.id}
        RETURNING id, standard_term, variations, category
      `;

      console.log(`  ✓ Added "${original}" as variation of "${term.standard_term}"`);

      res.json({
        success: true,
        message: 'Variation added successfully',
        term: result[0]
      });

    } else {
      // Create new terminology entry
      const finalCategory = category || 'other';

      const embeddingText = [corrected, original].join(' ');

      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: embeddingText,
      });

      const embedding = embeddingResponse.data[0].embedding;
      const embeddingStr = JSON.stringify(embedding);

      const result = await sql`
        INSERT INTO hvac_terminology (
          standard_term,
          category,
          variations,
          description,
          embedding
        ) VALUES (
          ${corrected},
          ${finalCategory},
          ${[original]},
          ${'Auto-learned from user input'},
          ${embeddingStr}::vector(1536)
        )
        RETURNING id, standard_term, category, variations
      `;

      console.log(`  ✓ Created new term "${corrected}" with variation "${original}"`);

      res.json({
        success: true,
        message: 'New term created successfully',
        term: result[0]
      });
    }

  } catch (error) {
    console.error('Error confirming terminology:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all terminology
app.get('/api/terminology', async (req, res) => {
  try {
    const { category } = req.query;

    let terms;
    if (category) {
      terms = await sql`
        SELECT id, standard_term, category, variations, description, created_at
        FROM hvac_terminology
        WHERE category = ${category}
        ORDER BY standard_term
      `;
    } else {
      terms = await sql`
        SELECT id, standard_term, category, variations, description, created_at
        FROM hvac_terminology
        ORDER BY category, standard_term
      `;
    }

    res.json({ terms });

  } catch (error) {
    console.error('Error fetching terminology:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get terminology categories
app.get('/api/terminology/categories', async (req, res) => {
  try {
    const categories = await sql`
      SELECT category, COUNT(*) as count
      FROM hvac_terminology
      GROUP BY category
      ORDER BY category
    `;

    res.json({ categories });

  } catch (error) {
    console.error('Error fetching terminology categories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add new terminology
app.post('/api/terminology', async (req, res) => {
  try {
    const { standard_term, category, variations, description } = req.body;

    if (!standard_term || !category || !variations || variations.length === 0) {
      return res.status(400).json({ error: 'standard_term, category, and variations are required' });
    }

    // Create comprehensive embedding text
    const embeddingText = [
      standard_term,
      ...variations,
      description || ''
    ].join(' ');

    // Generate embedding
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingText,
    });

    const embedding = embeddingResponse.data[0].embedding;
    const embeddingStr = JSON.stringify(embedding);

    // Insert into database
    const result = await sql`
      INSERT INTO hvac_terminology (
        standard_term,
        category,
        variations,
        description,
        embedding
      ) VALUES (
        ${standard_term},
        ${category},
        ${variations},
        ${description || ''},
        ${embeddingStr}::vector(1536)
      )
      RETURNING id, standard_term, category, variations, description, created_at
    `;

    console.log(`✓ Added new term: ${standard_term} (${category})`);

    res.json({
      success: true,
      term: result[0]
    });

  } catch (error) {
    console.error('Error adding terminology:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update terminology
app.put('/api/terminology/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { standard_term, category, variations, description } = req.body;

    if (!standard_term || !category || !variations || variations.length === 0) {
      return res.status(400).json({ error: 'standard_term, category, and variations are required' });
    }

    // Create comprehensive embedding text
    const embeddingText = [
      standard_term,
      ...variations,
      description || ''
    ].join(' ');

    // Generate new embedding
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingText,
    });

    const embedding = embeddingResponse.data[0].embedding;
    const embeddingStr = JSON.stringify(embedding);

    // Update in database
    const result = await sql`
      UPDATE hvac_terminology
      SET
        standard_term = ${standard_term},
        category = ${category},
        variations = ${variations},
        description = ${description || ''},
        embedding = ${embeddingStr}::vector(1536),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, standard_term, category, variations, description, updated_at
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Term not found' });
    }

    console.log(`✓ Updated term: ${standard_term} (${category})`);

    res.json({
      success: true,
      term: result[0]
    });

  } catch (error) {
    console.error('Error updating terminology:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete terminology
app.delete('/api/terminology/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await sql`
      DELETE FROM hvac_terminology
      WHERE id = ${id}
      RETURNING standard_term, category
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Term not found' });
    }

    console.log(`✓ Deleted term: ${result[0].standard_term} (${result[0].category})`);

    res.json({
      success: true,
      deleted: result[0]
    });

  } catch (error) {
    console.error('Error deleting terminology:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dave Mode server running on http://localhost:${PORT}`);
  console.log(`Configured with OpenAI: ${!!process.env.OPENAI_API_KEY}`);
});

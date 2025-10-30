require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
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

// ========== LEXICON CACHE ==========
let lexiconCache = [];
let lexiconLastUpdated = Date.now();

function loadLexicon() {
  try {
    const lexiconPath = path.join(__dirname, 'data', 'lexicon.json');
    const data = fs.readFileSync(lexiconPath, 'utf8');
    lexiconCache = JSON.parse(data);
    lexiconLastUpdated = Date.now();
    console.log(`✓ Loaded lexicon: ${lexiconCache.length} entries`);
  } catch (error) {
    console.error('Error loading lexicon:', error);
    lexiconCache = [];
  }
}

function saveLexicon() {
  try {
    const lexiconPath = path.join(__dirname, 'data', 'lexicon.json');
    fs.writeFileSync(lexiconPath, JSON.stringify(lexiconCache, null, 2), 'utf8');
    lexiconLastUpdated = Date.now();
    console.log(`✓ Saved lexicon: ${lexiconCache.length} entries`);
  } catch (error) {
    console.error('Error saving lexicon:', error);
  }
}

// Load lexicon on startup
loadLexicon();

// ========== CORRECTIONS LOG ==========
let correctionsCache = [];
const correctionsPath = path.join(__dirname, 'data', 'lexicon_corrections.json');

function loadCorrections() {
  try {
    if (!fs.existsSync(correctionsPath)) {
      // Create empty file if it doesn't exist
      fs.writeFileSync(correctionsPath, JSON.stringify([], null, 2), 'utf8');
      console.log('✓ Created lexicon_corrections.json');
      correctionsCache = [];
      return;
    }

    const data = fs.readFileSync(correctionsPath, 'utf8');
    correctionsCache = JSON.parse(data);
    console.log(`✓ Loaded corrections log: ${correctionsCache.length} entries`);
  } catch (error) {
    console.error('Error loading corrections:', error);
    correctionsCache = [];
  }
}

function saveCorrections() {
  try {
    // Ensure data directory exists
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Write with pretty formatting
    fs.writeFileSync(correctionsPath, JSON.stringify(correctionsCache, null, 2), 'utf8');
    console.log(`✓ Saved corrections log: ${correctionsCache.length} entries`);
  } catch (error) {
    console.error('Error saving corrections:', error);
  }
}

// Load corrections on startup
loadCorrections();

// ========== CHAT HISTORY ==========
// Store chat conversations (in-memory for now, can move to DB later)
const chatSessions = new Map(); // sessionId -> { messages: [], uploadedFiles: [] }

function getChatSession(sessionId = 'default') {
  if (!chatSessions.has(sessionId)) {
    chatSessions.set(sessionId, {
      messages: [],
      uploadedFiles: [],
      lastActivity: Date.now()
    });
  }
  return chatSessions.get(sessionId);
}

// Clean up old sessions (older than 24 hours)
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  for (const [sessionId, session] of chatSessions.entries()) {
    if (now - session.lastActivity > maxAge) {
      chatSessions.delete(sessionId);
      console.log(`🗑️ Cleaned up chat session: ${sessionId}`);
    }
  }
}, 60 * 60 * 1000); // Run every hour

// ========== MESSAGE TYPE DETECTION ==========
async function detectMessageType(text) {
  try {
    const systemPrompt = `You are a message classifier for an HVAC documentation system.

Classify the input text into ONE of these categories:

1. "conversational" - Questions, discussions, requests for information, greetings, general chat
   Examples:
   - "What's the difference between R-410A and R-22?"
   - "How do I test a capacitor?"
   - "Can you explain how this schematic works?"
   - "Tell me about the manual I just uploaded"
   - "Hello, how are you?"

2. "parts_documentation" - HVAC repair notes with equipment, problems, parts needed, actions
   Examples:
   - "RTU-1 low on charge needs 4 pounds 410A"
   - "AHU-2 contactor is buzzing, need to replace"
   - "Need two 24x24x2 pleated filters and one damper actuator"

3. "mixed" - Contains BOTH conversational elements AND repair documentation
   Examples:
   - "Hey Jerry, RTU-1 needs refrigerant. Can you tell me what type?"
   - "I'm working on AHU-2, it has a bad contactor. What's the part number for this model?"

Return JSON:
{
  "message_type": "conversational" | "parts_documentation" | "mixed",
  "confidence": 0-100,
  "reason": "brief explanation",
  "contains_parts": boolean,
  "contains_question": boolean
}

Be accurate - parts documentation should have equipment identifiers (RTU-1, AHU-2) and specific parts/problems.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.2
    });

    const responseText = completion.choices[0].message.content.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      // Default to conversational if detection fails
      return {
        message_type: 'conversational',
        confidence: 50,
        reason: 'Detection failed, defaulting to conversational',
        contains_parts: false,
        contains_question: true
      };
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log(`📝 Message type detected: ${result.message_type} (confidence: ${result.confidence}%)`);

    return result;

  } catch (error) {
    console.error('❌ Message type detection failed:', error.message);
    // Default to conversational on error
    return {
      message_type: 'conversational',
      confidence: 50,
      reason: 'Error in detection, defaulting to conversational',
      contains_parts: false,
      contains_question: true
    };
  }
}

// ========== CONVERSATIONAL CHAT ENDPOINT ==========
app.post('/api/chat', async (req, res) => {
  try {
    const { text, sessionId = 'default', uploadedFiles = [] } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    // Get or create chat session
    const session = getChatSession(sessionId);
    session.lastActivity = Date.now();

    // Add uploaded files to session context if provided
    if (uploadedFiles && uploadedFiles.length > 0) {
      session.uploadedFiles = [...session.uploadedFiles, ...uploadedFiles];
    }

    // Build context from chat history and uploaded files
    const contextMessages = [];

    // System message
    const systemMessage = {
      role: 'system',
      content: `You are Jerry, a concise AI assistant for HVAC technicians.

IMPORTANT: Keep responses SHORT (2-3 sentences max) unless the user asks for more detail.

Answer questions about HVAC systems, equipment, procedures, and troubleshooting.
${session.uploadedFiles.length > 0 ? `\nUploaded files: ${session.uploadedFiles.map(f => f.name).join(', ')}` : ''}

Be brief, technical, and direct. If you don't know, say so.`
    };
    contextMessages.push(systemMessage);

    // Add recent chat history (last 10 messages)
    const recentHistory = session.messages.slice(-10);
    contextMessages.push(...recentHistory);

    // Add current user message
    contextMessages.push({
      role: 'user',
      content: text
    });

    // Get response from GPT-4
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Using mini for cost efficiency, can upgrade to gpt-4o for better responses
      messages: contextMessages,
      temperature: 0.7,
      max_tokens: 200 // Reduced to encourage concise responses
    });

    const jerryResponse = completion.choices[0].message.content.trim();

    // Store messages in history
    session.messages.push({
      role: 'user',
      content: text,
      timestamp: Date.now()
    });
    session.messages.push({
      role: 'assistant',
      content: jerryResponse,
      timestamp: Date.now()
    });

    // Return response
    res.json({
      response: jerryResponse,
      sessionId,
      message_type: 'conversational',
      chat_history: session.messages.slice(-10) // Return last 10 messages for UI
    });

  } catch (error) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({ error: error.message });
  }
});

// Simple transcription endpoint for conversational prompts
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'No audio provided' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const audioBuffer = Buffer.from(audio.split(',')[1] || audio, 'base64');
    const file = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      prompt: 'HVAC technician providing information. Common terms: R-410A, R-22, refrigerant, parts, prices, Honeywell, Carrier, Trane, damper, actuator, contactor, capacitor, compressor.'
    });

    const text = transcription.text || '';
    console.log('📝 Transcribed (conversational):', text);

    res.json({ text });

  } catch (error) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({ error: 'Transcription failed: ' + error.message });
  }
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

    // STEP 1: Check if this is a voice command (add part/term)
    const voiceCommand = await detectVoiceCommand(rawTranscription);

    if (voiceCommand && voiceCommand.command_type === 'add_part') {
      // Handle "add new part" command
      const partDetails = await parsePartFromVoice(rawTranscription);

      if (!partDetails.success) {
        // Return partial data and prompt for missing fields
        return res.json({
          command_type: 'add_part',
          success: false,
          needs_more_info: true,
          partial_data: partDetails,
          missing_fields: partDetails.missing_fields || ['name', 'price'],
          message: `Starting to add a new part. I'll ask you for the details.`,
          raw_transcription: rawTranscription
        });
      }

      // Auto-generate part number from name
      const partNumber = partDetails.name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '-')
        .substring(0, 20);

      // Add part to database
      try {
        // Generate embedding
        const embeddingText = [partDetails.name, partDetails.description || '', partDetails.category].join(' ');
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: embeddingText,
        });
        const embedding = embeddingResponse.data[0].embedding;
        const embeddingStr = JSON.stringify(embedding);

        // Insert into database
        const result = await sql`
          INSERT INTO parts (
            part_number, name, description, category, type, price,
            thumbnail_url, common_uses, embedding,
            brand, vendor, vendor_part_number, manufacturer_part_number
          ) VALUES (
            ${partNumber}, ${partDetails.name}, ${partDetails.description || rawTranscription},
            ${partDetails.category || 'Other'}, ${partDetails.type || 'inventory'},
            ${parseFloat(partDetails.price)},
            ${'https://via.placeholder.com/150?text=' + encodeURIComponent(partDetails.name.substring(0, 10))},
            ${[]}, ${embeddingStr}::vector(1536),
            ${partDetails.brand || null}, ${partDetails.vendor || null},
            ${partDetails.vendor_part_number || null}, ${partDetails.manufacturer_part_number || null}
          )
          RETURNING id, part_number, name, category, type, price, brand, vendor, vendor_part_number, manufacturer_part_number
        `;

        console.log(`✅ Added new part via voice: ${partDetails.name}`);

        return res.json({
          command_type: 'add_part',
          success: true,
          message: `Added "${partDetails.name}" to parts catalog at $${parseFloat(partDetails.price).toFixed(2)}`,
          part: result[0],
          raw_transcription: rawTranscription
        });

      } catch (dbError) {
        console.error('Database error adding part:', dbError);
        return res.json({
          command_type: 'add_part',
          success: false,
          message: `Failed to add part: ${dbError.message}`,
          raw_transcription: rawTranscription
        });
      }
    }

    if (voiceCommand && voiceCommand.command_type === 'add_term') {
      // Handle "add new term" command
      const termDetails = await parseTermFromVoice(rawTranscription);

      if (!termDetails.success) {
        // Return partial data and prompt for missing fields
        return res.json({
          command_type: 'add_term',
          success: false,
          needs_more_info: true,
          partial_data: termDetails,
          missing_fields: termDetails.missing_fields || ['standard_term', 'category'],
          message: `Starting to add a new term. I'll ask you for the details.`,
          raw_transcription: rawTranscription
        });
      }

      // Add term to database
      try {
        // Generate embedding for semantic search
        const embeddingText = [termDetails.standard_term, termDetails.description || '', ...termDetails.variations].join(' ');
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: embeddingText,
        });
        const embedding = embeddingResponse.data[0].embedding;
        const embeddingStr = JSON.stringify(embedding);

        // Insert into database
        const result = await sql`
          INSERT INTO terminology (
            standard_term, category, variations, description, embedding
          ) VALUES (
            ${termDetails.standard_term}, ${termDetails.category || 'other'},
            ${termDetails.variations}, ${termDetails.description || ''},
            ${embeddingStr}::vector(1536)
          )
          RETURNING id, standard_term, category, variations
        `;

        console.log(`✅ Added new term via voice: ${termDetails.standard_term}`);

        return res.json({
          command_type: 'add_term',
          success: true,
          message: `Added "${termDetails.standard_term}" to terminology (${termDetails.variations.length} variations)`,
          term: result[0],
          raw_transcription: rawTranscription
        });

      } catch (dbError) {
        console.error('Database error adding term:', dbError);
        return res.json({
          command_type: 'add_term',
          success: false,
          message: `Failed to add term: ${dbError.message}`,
          raw_transcription: rawTranscription
        });
      }
    }

    // STEP 2: Detect message type (conversational vs parts documentation vs mixed)
    const messageType = await detectMessageType(rawTranscription);
    console.log(`📋 Message type: ${messageType.message_type} (confidence: ${messageType.confidence}%)`);

    // Handle based on message type
    if (messageType.message_type === 'conversational' && !messageType.contains_parts) {
      // Pure conversational - route to chat endpoint
      try {
        const chatResponse = await fetch(`http://localhost:${PORT}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: transcription,
            sessionId: req.body.sessionId || 'default'
          })
        });

        const chatData = await chatResponse.json();

        return res.json({
          message_type: 'conversational',
          response: chatData.response,
          chat_history: chatData.chat_history,
          raw_transcription: rawTranscription,
          transcription,
          suggestions,
          newTerms
        });
      } catch (chatError) {
        console.error('Error routing to chat:', chatError);
        // Fall through to parts parsing if chat fails
      }
    }

    // For mixed messages or parts documentation, do parts parsing
    // (Mixed messages will get both parsing AND chat response)
    const parsedRepairs = await parseRepairs(transcription, rawTranscription);

    // Auto-match parts from catalog for each repair
    const { repairs: repairsWithParts, unmatchedParts } = await autoMatchParts(parsedRepairs);

    // Use Agent 3 to filter garbage from real parts (more lenient than Agent 2)
    let newParts = [];
    if (unmatchedParts.length > 0) {
      const evaluations = await filterPartSuggestions(unmatchedParts);
      newParts = unmatchedParts
        .filter((part, idx) => {
          const evaluation = evaluations[idx];
          return evaluation && evaluation.is_valid_part;
        })
        .slice(0, 3); // Limit to top 3 to avoid overwhelming user
    }

    // For mixed messages, also get a chat response
    let chatResponse = null;
    if (messageType.message_type === 'mixed' && messageType.contains_question) {
      try {
        const chatReq = await fetch(`http://localhost:${PORT}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: transcription,
            sessionId: req.body.sessionId || 'default'
          })
        });
        const chatData = await chatReq.json();
        chatResponse = chatData.response;
      } catch (chatError) {
        console.error('Error getting chat response for mixed message:', chatError);
      }
    }

    res.json({
      message_type: messageType.message_type,
      raw_transcription: rawTranscription, // Original text before normalization
      transcription, // Normalized text with standard terminology
      repairs: repairsWithParts,
      suggestions, // Send terminology suggestions to frontend for confirmation
      newTerms, // Send potential new terms to add to glossary
      newParts, // Send potential new parts to add to catalog
      chat_response: chatResponse // Include chat response for mixed messages
    });

  } catch (error) {
    console.error('Error in /api/parse:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle conversational command - fill in missing information step by step
app.post('/api/continue-command', async (req, res) => {
  try {
    const { commandType, currentData, fieldToFill, userResponse } = req.body;

    console.log(`\n🗣️ Continuing ${commandType} command, filling: ${fieldToFill}`);
    console.log(`   User said: "${userResponse}"`);

    // Use AI to extract the specific field value from the user's response
    const systemPrompt = `Extract the ${fieldToFill} value from the user's response. Return ONLY the extracted value, cleaned up.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userResponse }
      ],
      temperature: 0.0
    });

    const extractedValue = completion.choices[0].message.content.trim();
    console.log(`   Extracted ${fieldToFill}: "${extractedValue}"`);

    // Update the data with the new field
    const updatedData = { ...currentData, [fieldToFill]: extractedValue };

    // Determine what's still missing
    let missingFields = [];
    if (commandType === 'add_part') {
      if (!updatedData.name) missingFields.push('name');
      if (!updatedData.price) missingFields.push('price');
      // Category and type are optional, will have defaults
    } else if (commandType === 'add_term') {
      if (!updatedData.standard_term) missingFields.push('standard_term');
      if (!updatedData.category) missingFields.push('category');
      // Variations are optional
    }

    // If still missing fields, prompt for the next one
    if (missingFields.length > 0) {
      return res.json({
        command_type: commandType,
        success: false,
        needs_more_info: true,
        partial_data: updatedData,
        missing_fields: missingFields,
        message: `Got it! Now collecting more information...`
      });
    }

    // All required fields collected! Now complete the command
    if (commandType === 'add_part') {
      // Add the part
      const partNumber = (updatedData.name || 'PART')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '-')
        .substring(0, 20);

      const category = updatedData.category || 'Other';
      const type = updatedData.type || 'inventory';
      const price = parseFloat(String(updatedData.price).replace(/[^0-9.]/g, '')) || 0;

      // Generate embedding
      const embeddingText = [updatedData.name, category].join(' ');
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: embeddingText,
      });
      const embedding = embeddingResponse.data[0].embedding;
      const embeddingStr = JSON.stringify(embedding);

      // Insert into database
      const result = await sql`
        INSERT INTO parts (
          part_number, name, description, category, type, price,
          thumbnail_url, common_uses, embedding,
          brand, vendor, vendor_part_number, manufacturer_part_number
        ) VALUES (
          ${partNumber}, ${updatedData.name}, ${'Added via voice command'},
          ${category}, ${type}, ${price},
          ${'https://via.placeholder.com/150?text=' + encodeURIComponent(updatedData.name.substring(0, 10))},
          ${[]}, ${embeddingStr}::vector(1536),
          ${updatedData.brand || null}, ${updatedData.vendor || null},
          ${updatedData.vendor_part_number || null}, ${updatedData.manufacturer_part_number || null}
        )
        RETURNING id, part_number, name, category, type, price, brand, vendor, vendor_part_number, manufacturer_part_number
      `;

      console.log(`✅ Added new part via conversation: ${updatedData.name}`);

      return res.json({
        command_type: 'add_part',
        success: true,
        message: `Added "${updatedData.name}" to parts catalog at $${price.toFixed(2)}`,
        part: result[0]
      });

    } else if (commandType === 'add_term') {
      // Add the term
      const category = updatedData.category || 'other';
      const variations = updatedData.variations || [updatedData.standard_term];

      // Generate embedding
      const embeddingText = [updatedData.standard_term, category, ...variations].join(' ');
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: embeddingText,
      });
      const embedding = embeddingResponse.data[0].embedding;
      const embeddingStr = JSON.stringify(embedding);

      // Insert into database
      const result = await sql`
        INSERT INTO terminology (
          standard_term, category, variations, description, embedding
        ) VALUES (
          ${updatedData.standard_term}, ${category},
          ${Array.isArray(variations) ? variations : [variations]}, ${''},
          ${embeddingStr}::vector(1536)
        )
        RETURNING id, standard_term, category, variations
      `;

      console.log(`✅ Added new term via conversation: ${updatedData.standard_term}`);

      return res.json({
        command_type: 'add_term',
        success: true,
        message: `Added "${updatedData.standard_term}" to terminology`,
        term: result[0]
      });
    }

  } catch (error) {
    console.error('Error in /api/continue-command:', error);
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

// Agent 2: Technical Term Detector
// Uses GPT-4o-mini to intelligently filter sentence fragments from real technical terms
async function filterTechnicalTerms(potentialTerms) {
  if (!potentialTerms || potentialTerms.length === 0) return [];

  try {
    console.log('\n🤖 Agent 2: Filtering technical terms...');

    const systemPrompt = `You are a technical term detection agent for an HVAC repair documentation system.

Your job: Distinguish real HVAC technical terms from sentence fragments in voice transcriptions.

ACCEPT as technical terms:
1. HVAC equipment identifiers: "RTU-5", "AHU-2", "FCU-3", "MAU-1"
2. Part specifications: "24V 3-pole contactor", "5-ton compressor", "3/4 HP motor"
3. Refrigerant codes: "R-410A", "R-22", "R-134A"
4. Technical components: "damper actuator", "TXV valve", "reversing valve"
5. Voltage/electrical specs: "24V transformer", "40VA", "30 amp"
6. Measurement terms: "subcool", "superheat", "CFM", "micron"

REJECT as sentence fragments if ANY apply:
1. Starts with conjunction: "and RTU-6", "but the compressor", "or maybe"
2. Starts with preposition: "of R-22", "with the damper", "at the unit"
3. Contains common verbs: "need 10 pounds", "think RTU-6", "will also need"
4. Contains pronouns: "I think", "it needs", "that is"
5. Incomplete phrase: "also need", "will also", "and then"
6. Contains multiple sentence elements: "And then RTU-6 needs"
7. Just quantity words: "10 pounds", "5 lbs", "4 units"

CRITICAL: Real technical terms are NOUNS or NOUN PHRASES describing specific HVAC parts, equipment, or measurements.
Sentence fragments contain VERBS, CONJUNCTIONS, PREPOSITIONS, or PRONOUNS.

For each term, return:
{
  "is_technical_term": boolean,
  "reason": "brief explanation"
}

Be strict - when in doubt, reject it. Only accept clean, standalone technical terms.`;

    const termDescriptions = potentialTerms.map((term, idx) =>
      `Term ${idx + 1}: "${term.phrase}" (closest match: ${term.bestMatch || 'none'} at ${Math.round(term.similarity * 100)}%)`
    ).join('\n');

    const userPrompt = `Evaluate these potential technical terms:\n\n${termDescriptions}\n\nReturn format: {"evaluations": [{"is_technical_term": bool, "reason": "..."}, ...]}`;

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
    console.log('  Agent 2 raw response:', responseText);

    const result = JSON.parse(responseText);
    const evaluations = result.evaluations || [];

    if (evaluations.length !== potentialTerms.length) {
      console.error(`  ⚠️  Agent 2 returned ${evaluations.length} evaluations for ${potentialTerms.length} terms`);
    }

    evaluations.forEach((evaluation, idx) => {
      const term = potentialTerms[idx];
      if (term) {
        const status = evaluation.is_technical_term ? '✅ Technical term' : '❌ Sentence fragment';
        console.log(`  ${status}: "${term.phrase}" - ${evaluation.reason}`);
      }
    });

    return evaluations;

  } catch (error) {
    console.error('❌ Agent 2 evaluation failed:', error.message);
    console.error('   Stack:', error.stack);
    // Fallback: if agent fails, reject all to avoid showing garbage
    return potentialTerms.map(t => ({
      is_technical_term: false,
      reason: 'Agent evaluation failed, rejecting for safety'
    }));
  }
}

// Agent 3: Part Suggestion Filter (More Lenient than Agent 2)
// Filters unmatched parts to avoid suggesting garbage while accepting unfamiliar brands/models
async function filterPartSuggestions(unmatchedParts) {
  if (!unmatchedParts || unmatchedParts.length === 0) return [];

  try {
    console.log('\n🤖 Agent 3: Filtering part suggestions...');

    const systemPrompt = `You are a part suggestion filter for an HVAC repair documentation system.

Your job: Distinguish real HVAC parts from sentence fragments in voice transcriptions.

ACCEPT as valid parts:
1. Equipment names with ANY brand/model: "XYZ actuator", "ABC compressor", "Model-123 motor"
2. Generic part names: "actuator", "contactor", "capacitor", "compressor", "motor"
3. Part specifications: "24V 3-pole contactor", "5-ton compressor", "3/4 HP motor"
4. Refrigerant codes: "R-410A", "R-22", "R-134A"
5. Technical components: "damper actuator", "TXV valve", "reversing valve"
6. Filters and supplies: "air filter", "filter drier", "refrigerant oil"
7. Parts with unfamiliar brands: Even if you don't recognize the brand name, if it follows the pattern "[Brand/Model] [Part Type]", accept it

REJECT as sentence fragments if ANY apply:
1. Starts with conjunction: "and also need", "but the", "or maybe"
2. Starts with preposition: "of refrigerant", "with the damper", "at the unit"
3. Contains action verbs: "need 10 pounds", "will replace", "should check"
4. Contains pronouns: "I think", "it needs", "that is"
5. Incomplete phrase: "also need", "will also", "and then"
6. Just quantity words: "10 pounds", "5 lbs", "4 units" (without a part name)
7. Non-part phrases: "the system", "the unit", "that thing"

KEY DIFFERENCE from terminology filtering: Be MORE ACCEPTING of unfamiliar brands and model numbers.
- "XYZ actuator" → ACCEPT (actuator is a real part type, even if XYZ is unknown)
- "Honeywell damper" → ACCEPT (damper is a real part)
- "Model-500 contactor" → ACCEPT (contactor is a real part)
- "and also need" → REJECT (sentence fragment)

For each unmatched part, return:
{
  "is_valid_part": boolean,
  "reason": "brief explanation"
}

When in doubt about a brand name but the part type is clear (actuator, motor, etc.), ACCEPT it.`;

    const partDescriptions = unmatchedParts.map((part, idx) =>
      `Part ${idx + 1}: "${part.phrase}" (closest match: ${part.bestMatch || 'none'} at ${Math.round(part.similarity * 100)}%)`
    ).join('\n');

    const userPrompt = `Evaluate these unmatched parts:\n\n${partDescriptions}\n\nReturn format: {"evaluations": [{"is_valid_part": bool, "reason": "..."}, ...]}`;

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
    console.log('  Agent 3 raw response:', responseText);

    const result = JSON.parse(responseText);
    const evaluations = result.evaluations || [];

    if (evaluations.length !== unmatchedParts.length) {
      console.error(`  ⚠️  Agent 3 returned ${evaluations.length} evaluations for ${unmatchedParts.length} parts`);
    }

    evaluations.forEach((evaluation, idx) => {
      const part = unmatchedParts[idx];
      if (part) {
        const status = evaluation.is_valid_part ? '✅ Valid part' : '❌ Sentence fragment';
        console.log(`  ${status}: "${part.phrase}" - ${evaluation.reason}`);
      }
    });

    return evaluations;

  } catch (error) {
    console.error('❌ Agent 3 evaluation failed:', error.message);
    console.error('   Stack:', error.stack);
    // Fallback: if agent fails, accept all (better to suggest than to miss)
    return unmatchedParts.map(p => ({
      is_valid_part: true,
      reason: 'Agent evaluation failed, accepting as fallback'
    }));
  }
}

// Agent 4: Voice Command Detector
// Detects management commands like "add new part" or "add new term"
async function detectVoiceCommand(text) {
  if (!text) return null;

  try {
    console.log('\n🤖 Agent 4: Detecting voice commands...');

    const systemPrompt = `You are a voice command detection agent for an HVAC management system.

Detect if the user is trying to ADD a new part or term to the system, or if they're documenting a repair.

PART ADDITION COMMANDS - Look for phrases like:
- "Add new part..."
- "Add a part called..."
- "Add to parts catalog..."
- "Create new part..."
Example: "Add new part, Honeywell damper actuator, $45, electrical, inventory"

TERM ADDITION COMMANDS - Look for phrases like:
- "Add new term..."
- "Add to glossary..."
- "Add terminology..."
- "Create new term..."
Example: "Add new term, R-22, refrigerant, variations are R22, R 22, twenty-two"

REPAIR DOCUMENTATION - Everything else
Example: "RTU-1 needs a new damper actuator and 4 pounds of R-410A"

Return JSON:
{
  "command_type": "add_part" | "add_term" | "repair_documentation",
  "confidence": 0-100,
  "reason": "brief explanation"
}

Be strict: only detect "add_part" or "add_term" if there's explicit language about ADDING/CREATING. Otherwise assume it's repair documentation.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this input: "${text}"` }
      ],
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('  Agent 4 raw response:', responseText);

    const result = JSON.parse(responseText);

    if (result.command_type === 'add_part' || result.command_type === 'add_term') {
      console.log(`  ✅ Detected command: ${result.command_type} (${result.confidence}% confidence)`);
      console.log(`     Reason: ${result.reason}`);
      return result;
    } else {
      console.log(`  ℹ️  Normal repair documentation detected`);
      return null;
    }

  } catch (error) {
    console.error('❌ Agent 4 command detection failed:', error.message);
    // Fallback: assume repair documentation
    return null;
  }
}

// Parse Part from Voice Command
async function parsePartFromVoice(text) {
  try {
    console.log('\n🔧 Parsing part details from voice...');

    const systemPrompt = `You are a part information extraction agent.

Extract part details from natural speech. Be VERY flexible and try to extract as much as possible from a single utterance.

Look for:
- Part name (REQUIRED): The main name/description of the part
- Price (REQUIRED): Dollar amount - be creative in finding it ("$45", "forty-five dollars", "costs 45", "about $50", "fifty bucks")
- Category: electrical, refrigerant, controls, filters, supplies, other (if not mentioned, infer from part name or use "Other")
- Type: "consumable" or "inventory" (default to "inventory" if not mentioned)
- Brand: The brand or manufacturer (e.g., "Honeywell", "Carrier", "Trane", "Copeland")
- Vendor: Who you buy it from (e.g., "Johnstone", "Ferguson", "Home Depot")
- Vendor part number: The vendor's SKU/part number
- Manufacturer part number: The manufacturer's part number

IMPORTANT:
- Try HARD to find the price in the text, even if it's approximate
- If category isn't mentioned, infer it from the part name
- Extract brand from the part name if present (e.g., "Honeywell damper actuator" → brand: "Honeywell")
- Only name and price are CRITICAL - everything else is optional
- If you can extract name and price, mark success=true
- Only mark success=false if name OR price is truly missing

Examples:
"Add Honeywell damper actuator, $45, electrical, from Johnstone"
→ name: "Honeywell Damper Actuator", price: 45.00, category: "Electrical", brand: "Honeywell", vendor: "Johnstone", success: true

"Add Trane compressor contactor, $35, vendor part number TC123"
→ name: "Trane Compressor Contactor", price: 35.00, category: "Electrical", brand: "Trane", vendor_part_number: "TC123", success: true

"Add Carrier fan motor sixty five dollars from Ferguson part number FM-500, manufacturer number CFM-500"
→ name: "Carrier Fan Motor", price: 65.00, brand: "Carrier", vendor: "Ferguson", vendor_part_number: "FM-500", manufacturer_part_number: "CFM-500", success: true

Return JSON:
{
  "name": "cleaned part name" or null,
  "price": numeric_value or null,
  "category": "category_name" (inferred or "Other"),
  "type": "consumable" or "inventory",
  "brand": "brand name" or null,
  "vendor": "vendor name" or null,
  "vendor_part_number": "vendor SKU" or null,
  "manufacturer_part_number": "manufacturer part number" or null,
  "description": "full utterance",
  "success": true if name AND price found, false otherwise,
  "missing_fields": ["field1"] if CRITICAL fields missing
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract part details: "${text}"` }
      ],
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('  Part extraction response:', responseText);

    const result = JSON.parse(responseText);

    // Ensure we have defaults for optional fields
    if (result.success) {
      result.category = result.category || 'Other';
      result.type = result.type || 'inventory';
    }

    return result;

  } catch (error) {
    console.error('❌ Part parsing failed:', error.message);
    return { success: false, error: error.message, missing_fields: ['name', 'price'] };
  }
}

// Parse Term from Voice Command
async function parseTermFromVoice(text) {
  try {
    console.log('\n📚 Parsing term details from voice...');

    const systemPrompt = `You are a terminology extraction agent for HVAC terminology.

Extract term details from natural speech. Be VERY flexible and try to extract as much as possible from a single utterance.

Look for:
- Standard term (REQUIRED): The correct way to write the term
- Category: refrigerant, equipment, voltage, measurement, part_type, action, brand, other (infer from context if not mentioned)
- Variations: Different ways it might be said/spelled (if mentioned)
- Description: Any context provided

IMPORTANT:
- Try to infer category from the term itself if not explicitly stated
- If you can extract standard_term and category, mark success=true
- Variations are optional - if not mentioned, just use the standard term
- Only mark success=false if standard_term OR category cannot be determined

Examples:
"Add new term, R-22, refrigerant, variations are R22, R 22, twenty-two"
→ standard_term: "R-22", category: "refrigerant", variations: ["R-22", "R22", "R 22", "twenty-two"], success: true

"Add to glossary RTU, equipment type, also called roof top unit"
→ standard_term: "RTU", category: "equipment", variations: ["RTU", "roof top unit", "rooftop unit"], success: true

"Create term damper actuator, it's a part type"
→ standard_term: "damper actuator", category: "part_type", variations: ["damper actuator"], success: true

"Add R-410A refrigerant"
→ standard_term: "R-410A", category: "refrigerant", variations: ["R-410A"], success: true

"Add compressor brand Copeland"
→ standard_term: "Copeland", category: "brand", variations: ["Copeland"], success: true

Return JSON:
{
  "standard_term": "the correct term" or null,
  "category": "category_name" (inferred if possible, or "other"),
  "variations": ["variation1", "variation2"] (always include standard_term),
  "description": "any description provided",
  "success": true if standard_term AND category found, false otherwise,
  "missing_fields": ["field1"] if CRITICAL fields missing
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract term details: "${text}"` }
      ],
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('  Term extraction response:', responseText);

    const result = JSON.parse(responseText);

    // Ensure variations array includes the standard term itself
    if (result.success) {
      result.category = result.category || 'other';

      if (!result.variations || result.variations.length === 0) {
        result.variations = [result.standard_term];
      } else if (!result.variations.includes(result.standard_term)) {
        result.variations.unshift(result.standard_term);
      }
    }

    return result;

  } catch (error) {
    console.error('❌ Term parsing failed:', error.message);
    return { success: false, error: error.message, missing_fields: ['standard_term', 'category'] };
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

        // Collect potential new terms with low similarity for Agent 2 to evaluate
        // Agent 2 will intelligently filter sentence fragments from real technical terms
        if (similarity < 0.50 && candidate.phrase.split(' ').length >= 2) {
          potentialNewTerms.push({
            phrase: candidate.phrase,
            bestMatch: bestMatch ? bestMatch.standard_term : null,
            similarity: similarity
          });
          console.log(`  💡 Candidate for glossary: "${candidate.phrase}" (best match: ${similarity > 0 ? (similarity * 100).toFixed(0) + '% - ' + bestMatch.standard_term : 'none'})`);
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
    const candidateNewTerms = potentialNewTerms
      .filter(nt => !usedPhrases.has(nt.phrase.toLowerCase()));

    // Use Agent 2 to filter sentence fragments from real technical terms
    let newTerms = [];
    if (candidateNewTerms.length > 0) {
      const evaluations = await filterTechnicalTerms(candidateNewTerms);
      newTerms = candidateNewTerms
        .filter((term, idx) => {
          const evaluation = evaluations[idx];
          return evaluation && evaluation.is_technical_term;
        })
        .slice(0, 3); // Limit to top 3 to avoid overwhelming user
    }

    return { normalized, suggestions, newTerms };

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
  if (!repairs || repairs.length === 0) return { repairs, unmatchedParts: [] };

  console.log('\n🔍 Auto-matching parts from catalog...');

  const unmatchedParts = []; // Collect parts that don't match

  for (const repair of repairs) {
    if (!repair.parts || repair.parts.length === 0) continue;

    repair.selectedParts = [];

    for (const partString of repair.parts) {
      try {
        // Extract quantity from part string (e.g., "4 lbs R410A" → qty: 4, search: "R410A refrigerant")
        const { quantity, searchTerm, refrigerantCode } = extractQuantityAndTerm(partString);

        let matchedPart = null;
        let bestMatch = null; // Track best match for unmatched parts

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
            // Collect as unmatched part
            unmatchedParts.push({
              phrase: partString,
              searchTerm: searchTerm,
              bestMatch: null,
              similarity: 0,
              quantity: quantity
            });
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
            bestMatch = results[0];
            console.log(`  ✓ "${partString}" → ${matchedPart.name} (qty: ${quantity}, ${(matchedPart.similarity * 100).toFixed(0)}% match)`);
          } else {
            bestMatch = results[0];
            console.log(`  ✗ "${partString}" → No match found (best: ${results[0] ? (results[0].similarity * 100).toFixed(0) : 0}%)`);
            // Collect as unmatched part
            unmatchedParts.push({
              phrase: partString,
              searchTerm: searchTerm,
              bestMatch: bestMatch ? bestMatch.name : null,
              similarity: bestMatch ? parseFloat(bestMatch.similarity) : 0,
              quantity: quantity
            });
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
            match_confidence: parseFloat(matchedPart.similarity),
            _parsedQuantity: quantity,  // Store original for corrections tracking
            _parsedName: matchedPart.name  // Store original for corrections tracking
          });
        }

      } catch (error) {
        console.error(`  Error matching part "${partString}":`, error.message);
      }
    }
  }

  console.log('✓ Auto-matching complete\n');
  console.log(`  Found ${unmatchedParts.length} unmatched part(s)`);
  return { repairs, unmatchedParts };
}

// Extract quantity and clean search term from part string
function extractQuantityAndTerm(partString) {
  let quantity = 1;
  let searchTerm = partString.toLowerCase();
  let refrigerantCode = null;

  // GUARD: Skip quantity extraction if starts with dimension pattern (e.g., "24x24x2 pleated filters")
  // This prevents treating "24" as quantity when it's part of a dimension
  const DIM_RX = /^\s*\d{1,3}\s*(x|×|\*)\s*\d{1,3}(\s*(x|×|\*)\s*\d{1,3})?/i;
  const hasDimensionAtStart = DIM_RX.test(partString);

  if (!hasDimensionAtStart) {
    // Match patterns like "4 lbs", "5 pounds", "2x", "3 units", etc.
    const quantityPatterns = [
      /^(\d+)\s*(?:lbs?|pounds?)\s+/i,  // "4 lbs ", "5 pounds " (must have space after)
      /^(\d+)\s*(?:x|×)\s+(?![0-9])/i,  // "2x " (but NOT "2x3" which is dimension)
      /^(\d+)\s+/,                       // "4 " (number followed by space at start)
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

// Get all parts (for parts manager)
app.get('/api/parts/all', async (req, res) => {
  try {
    const parts = await sql`
      SELECT id, part_number, name, description, category, type, price, thumbnail_url, common_uses, created_at
      FROM parts
      ORDER BY category, name
    `;

    res.json(parts);

  } catch (error) {
    console.error('Error fetching all parts:', error);
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
      const embeddingStr = JSON.stringify(queryEmbedding);

      const matches = await sql`
        SELECT
          id,
          part_number,
          name,
          description,
          1 - (embedding <=> ${embeddingStr}::vector(1536)) AS similarity
        FROM parts
        WHERE 1 - (embedding <=> ${embeddingStr}::vector(1536)) > 0.7
        ORDER BY embedding <=> ${embeddingStr}::vector(1536)
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
- part_number: string (manufacturer part number if mentioned, otherwise empty string "")
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

// Add new part
app.post('/api/parts', async (req, res) => {
  try {
    const { part_number, name, description, category, type, price, thumbnail_url, common_uses, brand, vendor, vendor_part_number, manufacturer_part_number } = req.body;

    if (!name || !category || !type) {
      return res.status(400).json({ error: 'name, category, and type are required' });
    }

    // Generate embedding for the part
    const embeddingText = [name, description || '', category].join(' ');
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingText,
    });

    const embedding = embeddingResponse.data[0].embedding;
    const embeddingStr = JSON.stringify(embedding);

    // Insert into database
    const result = await sql`
      INSERT INTO parts (
        part_number,
        name,
        description,
        category,
        type,
        price,
        thumbnail_url,
        common_uses,
        embedding,
        brand,
        vendor,
        vendor_part_number,
        manufacturer_part_number
      ) VALUES (
        ${part_number || ''},
        ${name},
        ${description || ''},
        ${category},
        ${type},
        ${parseFloat(price) || 0},
        ${thumbnail_url || ''},
        ${common_uses || []},
        ${embeddingStr}::vector(1536),
        ${brand || null},
        ${vendor || null},
        ${vendor_part_number || null},
        ${manufacturer_part_number || null}
      )
      RETURNING id, part_number, name, category, type, price, brand, vendor, vendor_part_number, manufacturer_part_number
    `;

    console.log(`✓ Added new part: ${name} (${part_number})`);

    res.json({
      success: true,
      part: result[0]
    });

  } catch (error) {
    console.error('Error adding part:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update existing part
app.put('/api/parts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { part_number, name, description, category, type, price, thumbnail_url, common_uses, brand, vendor, vendor_part_number, manufacturer_part_number } = req.body;

    if (!part_number || !name || !category || !type || price === undefined) {
      return res.status(400).json({ error: 'part_number, name, category, type, and price are required' });
    }

    // Regenerate embedding for the updated part
    const embeddingText = [name, description || '', category].join(' ');
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingText,
    });

    const embedding = embeddingResponse.data[0].embedding;
    const embeddingStr = JSON.stringify(embedding);

    // Update in database
    const result = await sql`
      UPDATE parts
      SET
        part_number = ${part_number},
        name = ${name},
        description = ${description || ''},
        category = ${category},
        type = ${type},
        price = ${parseFloat(price)},
        thumbnail_url = ${thumbnail_url || ''},
        common_uses = ${common_uses || []},
        embedding = ${embeddingStr}::vector(1536),
        brand = ${brand || null},
        vendor = ${vendor || null},
        vendor_part_number = ${vendor_part_number || null},
        manufacturer_part_number = ${manufacturer_part_number || null},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, part_number, name, category, type, price, brand, vendor, vendor_part_number, manufacturer_part_number
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    console.log(`✓ Updated part: ${name} (${part_number})`);

    res.json({
      success: true,
      part: result[0]
    });

  } catch (error) {
    console.error('Error updating part:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete part
app.delete('/api/parts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await sql`
      DELETE FROM parts
      WHERE id = ${id}
      RETURNING part_number, name
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    console.log(`✓ Deleted part: ${result[0].name} (${result[0].part_number})`);

    res.json({
      success: true,
      deleted: result[0]
    });

  } catch (error) {
    console.error('Error deleting part:', error);
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

// ========== LEXICON ENDPOINTS ==========

// GET /api/lexicon - Get current lexicon (with optional since parameter for caching)
app.get('/api/lexicon', (req, res) => {
  try {
    const { since } = req.query;

    // If client has cached version and it's still fresh, return 304 Not Modified
    if (since && parseInt(since) >= lexiconLastUpdated) {
      return res.status(304).end();
    }

    res.json({
      lexicon: lexiconCache,
      lastUpdated: lexiconLastUpdated
    });
  } catch (error) {
    console.error('Error fetching lexicon:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/lexicon - Add new lexicon entry
app.post('/api/lexicon', (req, res) => {
  try {
    const { kind, trigger, replacement, score, notes } = req.body;

    // Validate required fields
    if (!kind || !trigger || !replacement) {
      return res.status(400).json({ error: 'kind, trigger, and replacement are required' });
    }

    // Validate kind
    const validKinds = ['synonym', 'replace', 'regex', 'unit', 'category'];
    if (!validKinds.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of: ${validKinds.join(', ')}` });
    }

    // Create new entry
    const newEntry = {
      kind,
      trigger: trigger.toLowerCase(),
      replacement: replacement.toLowerCase(),
      score: score || 1.0,
      notes: notes || '',
      created_at: new Date().toISOString()
    };

    // Check if trigger already exists
    const existingIndex = lexiconCache.findIndex(entry =>
      entry.kind === kind && entry.trigger === newEntry.trigger
    );

    if (existingIndex >= 0) {
      // Update existing entry
      lexiconCache[existingIndex] = { ...lexiconCache[existingIndex], ...newEntry };
      console.log(`✓ Updated lexicon entry: ${trigger} → ${replacement} (${kind})`);
    } else {
      // Add new entry
      lexiconCache.push(newEntry);
      console.log(`✓ Added lexicon entry: ${trigger} → ${replacement} (${kind})`);
    }

    // Save to file
    saveLexicon();

    res.json({
      success: true,
      entry: newEntry,
      lastUpdated: lexiconLastUpdated
    });

  } catch (error) {
    console.error('Error adding lexicon entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/lexicon/:kind/:trigger - Remove lexicon entry
app.delete('/api/lexicon/:kind/:trigger', (req, res) => {
  try {
    const { kind, trigger } = req.params;

    const initialLength = lexiconCache.length;
    lexiconCache = lexiconCache.filter(entry =>
      !(entry.kind === kind && entry.trigger === trigger.toLowerCase())
    );

    if (lexiconCache.length < initialLength) {
      saveLexicon();
      console.log(`✓ Deleted lexicon entry: ${trigger} (${kind})`);
      res.json({
        success: true,
        deleted: { kind, trigger },
        lastUpdated: lexiconLastUpdated
      });
    } else {
      res.status(404).json({ error: 'Entry not found' });
    }

  } catch (error) {
    console.error('Error deleting lexicon entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== CORRECTIONS LOG ENDPOINTS ==========

// POST /api/lexicon/corrections - Log a user correction
app.post('/api/lexicon/corrections', (req, res) => {
  try {
    const { field, raw, normalized, oldValue, newValue, timestamp } = req.body;

    // Validate required fields
    if (!field || !oldValue || !newValue) {
      return res.status(400).json({ error: 'field, oldValue, and newValue are required' });
    }

    // Validate field type
    const validFields = ['name', 'category', 'type', 'price', 'quantity'];
    if (!validFields.includes(field)) {
      return res.status(400).json({ error: `field must be one of: ${validFields.join(', ')}` });
    }

    // Skip if old and new values are the same (no actual correction)
    if (oldValue === newValue) {
      return res.json({ success: true, skipped: true, reason: 'No change detected' });
    }

    // Create correction entry
    const correction = {
      field,
      raw: raw || '',
      normalized: normalized || '',
      oldValue,
      newValue,
      timestamp: timestamp || Date.now(),
      created_at: new Date().toISOString()
    };

    // Add to cache
    correctionsCache.push(correction);

    // Save to file (async to not block response)
    setImmediate(() => saveCorrections());

    console.log(`📝 Correction logged: ${field} "${oldValue}" → "${newValue}"`);

    res.json({ success: true, correction });

  } catch (error) {
    console.error('Error logging correction:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/lexicon/corrections - Retrieve corrections log
app.get('/api/lexicon/corrections', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const field = req.query.field; // Optional filter by field

    let corrections = correctionsCache;

    // Filter by field if specified
    if (field) {
      corrections = corrections.filter(c => c.field === field);
    }

    // Sort by timestamp descending (most recent first)
    corrections = corrections
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit);

    res.json({
      corrections,
      total: correctionsCache.length,
      returned: corrections.length
    });

  } catch (error) {
    console.error('Error fetching corrections:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/lexicon/suggestions - Get suggested synonyms based on recurring corrections
app.get('/api/lexicon/suggestions', (req, res) => {
  try {
    const minOccurrences = parseInt(req.query.minOccurrences) || 2;

    // Group corrections by oldValue → newValue pattern
    const patterns = {};

    correctionsCache.forEach(correction => {
      // Only consider name corrections for synonym suggestions
      if (correction.field === 'name') {
        const key = `${correction.oldValue}→${correction.newValue}`;
        if (!patterns[key]) {
          patterns[key] = {
            oldValue: correction.oldValue,
            newValue: correction.newValue,
            count: 0,
            firstSeen: correction.timestamp,
            lastSeen: correction.timestamp,
            raw: correction.raw,
            normalized: correction.normalized
          };
        }
        patterns[key].count++;
        patterns[key].lastSeen = Math.max(patterns[key].lastSeen, correction.timestamp);
      }
    });

    // Convert to array and filter by minimum occurrences
    const suggestions = Object.values(patterns)
      .filter(p => p.count >= minOccurrences)
      .sort((a, b) => b.count - a.count) // Sort by frequency
      .map(p => ({
        trigger: p.oldValue.toLowerCase(),
        replacement: p.newValue.toLowerCase(),
        kind: 'synonym',
        score: 1.0,
        notes: `Auto-suggested from ${p.count} user corrections`,
        occurrences: p.count,
        firstSeen: new Date(p.firstSeen).toISOString(),
        lastSeen: new Date(p.lastSeen).toISOString()
      }));

    res.json({
      suggestions,
      total: suggestions.length,
      minOccurrences
    });

  } catch (error) {
    console.error('Error generating suggestions:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== PDF INGESTION ENDPOINTS ==========

const multer = require('multer');
const { processPDF } = require('./pdf-processor');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/tiff',
      'image/bmp'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and image files (JPG, PNG, TIFF, BMP) are allowed'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// POST /api/manuals/upload - Upload and process a manual (PDF or image)
app.post('/api/manuals/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`📤 Uploaded: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    // Store manual record in database
    const manual = await sql`
      INSERT INTO manuals (
        filename,
        original_filename,
        storage_path,
        file_size,
        status
      ) VALUES (
        ${req.file.filename},
        ${req.file.originalname},
        ${req.file.path},
        ${req.file.size},
        'pending'
      )
      RETURNING id, filename, original_filename, status
    `;

    const manualId = manual[0].id;

    // Check for processing options via query params
    const schematicsOnly = req.query.schematicsOnly === 'true';
    const processingOptions = {
      extractTerms: !schematicsOnly,
      extractSchematics: true
    };

    // Process PDF asynchronously
    setImmediate(async () => {
      try {
        await processPDF(req.file.path, manualId, processingOptions);
      } catch (error) {
        console.error('Error processing PDF:', error);
      }
    });

    res.json({
      success: true,
      manual: manual[0],
      message: 'PDF uploaded successfully. Processing started in background.'
    });

  } catch (error) {
    console.error('Error uploading PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/manuals - List all uploaded manuals
app.get('/api/manuals', async (req, res) => {
  try {
    const manuals = await sql`
      SELECT
        id,
        filename,
        original_filename,
        file_size,
        uploaded_at,
        processed_at,
        status,
        page_count,
        error_message
      FROM manuals
      ORDER BY uploaded_at DESC
    `;

    res.json({ manuals });

  } catch (error) {
    console.error('Error fetching manuals:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/manuals/:id - Get manual details with statistics
app.get('/api/manuals/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const manual = await sql`
      SELECT * FROM manual_stats
      WHERE id = ${id}
    `;

    if (manual.length === 0) {
      return res.status(404).json({ error: 'Manual not found' });
    }

    // Get extracted terms
    const terms = await sql`
      SELECT
        ht.standard_term,
        ht.category,
        htp.confidence_score,
        htp.created_at
      FROM hvac_term_provenance htp
      JOIN hvac_terminology ht ON ht.id = htp.terminology_id
      WHERE htp.manual_id = ${id}
      ORDER BY htp.created_at DESC
    `;

    // Get extracted parts
    const parts = await sql`
      SELECT
        extracted_name,
        extracted_number,
        status,
        confidence_score,
        created_at
      FROM manual_parts_extracted
      WHERE manual_id = ${id}
      ORDER BY created_at DESC
    `;

    res.json({
      manual: manual[0],
      terms,
      parts
    });

  } catch (error) {
    console.error('Error fetching manual details:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/manuals/:id/status - Check processing status
app.get('/api/manuals/:id/status', async (req, res) => {
  try {
    const { id } = req.params;

    const manual = await sql`
      SELECT status, processed_at, error_message, page_count
      FROM manuals
      WHERE id = ${id}
    `;

    if (manual.length === 0) {
      return res.status(404).json({ error: 'Manual not found' });
    }

    res.json(manual[0]);

  } catch (error) {
    console.error('Error checking status:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/manuals/:id - Delete a manual and its associated data
app.delete('/api/manuals/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get manual info first
    const manual = await sql`
      SELECT filename, storage_path
      FROM manuals
      WHERE id = ${id}
    `;

    if (manual.length === 0) {
      return res.status(404).json({ error: 'Manual not found' });
    }

    // Delete the PDF file
    try {
      if (fs.existsSync(manual[0].storage_path)) {
        fs.unlinkSync(manual[0].storage_path);
      }
    } catch (fileError) {
      console.warn('Could not delete file:', fileError.message);
    }

    // Delete from database (CASCADE will handle related records)
    await sql`DELETE FROM manuals WHERE id = ${id}`;

    res.json({
      success: true,
      message: 'Manual deleted successfully',
      deletedId: id
    });

  } catch (error) {
    console.error('Error deleting manual:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/manuals/:id/retry - Retry processing a failed manual
app.post('/api/manuals/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;

    // Get manual info
    const manual = await sql`
      SELECT id, storage_path, filename, status
      FROM manuals
      WHERE id = ${id}
    `;

    if (manual.length === 0) {
      return res.status(404).json({ error: 'Manual not found' });
    }

    // Only retry if failed or completed
    if (manual[0].status === 'processing' || manual[0].status === 'pending') {
      return res.status(400).json({ error: 'Manual is already being processed' });
    }

    // Reset status to pending
    await sql`
      UPDATE manuals
      SET status = 'pending', error_message = NULL, processed_at = NULL
      WHERE id = ${id}
    `;

    // Start processing in background
    const { processPDF } = require('./pdf-processor');
    setImmediate(async () => {
      try {
        await processPDF(manual[0].storage_path, id);
      } catch (error) {
        console.error('Error retrying PDF processing:', error);
        await sql`
          UPDATE manuals
          SET status = 'failed', error_message = ${error.message}
          WHERE id = ${id}
        `;
      }
    });

    res.json({
      success: true,
      message: 'Processing restarted',
      manual: {
        id: id,
        status: 'pending',
        filename: manual[0].filename
      }
    });

  } catch (error) {
    console.error('Error retrying manual:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// PHASE 1 MVP: EQUIPMENT & JOB MANAGEMENT
// ========================================

// GET /api/customers - List all customers
app.get('/api/customers', async (req, res) => {
  try {
    const customers = await sql`
      SELECT
        c.*,
        COUNT(DISTINCT e.id) as equipment_count,
        COUNT(DISTINCT j.id) as job_count
      FROM customers c
      LEFT JOIN equipment e ON e.customer_id = c.id
      LEFT JOIN jobs j ON j.customer_id = c.id
      GROUP BY c.id
      ORDER BY c.name, c.location
    `;

    res.json({
      success: true,
      count: customers.length,
      customers: customers
    });

  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/equipment - List all equipment
app.get('/api/equipment', async (req, res) => {
  try {
    const { customer_id } = req.query;

    let equipment;
    if (customer_id) {
      equipment = await sql`
        SELECT * FROM equipment_with_customer
        WHERE customer_id = ${customer_id}
        ORDER BY equipment_name
      `;
    } else {
      equipment = await sql`
        SELECT * FROM equipment_with_customer
        ORDER BY customer_name, customer_location, equipment_name
      `;
    }

    res.json({
      success: true,
      count: equipment.length,
      equipment: equipment
    });

  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/jobs - List all jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const { status, customer_id, equipment_id } = req.query;

    let jobs;
    if (status) {
      jobs = await sql`
        SELECT * FROM job_summary
        WHERE status = ${status}
        ORDER BY created_at DESC
      `;
    } else if (customer_id) {
      jobs = await sql`
        SELECT * FROM job_summary
        WHERE customer_id = ${customer_id}
        ORDER BY created_at DESC
      `;
    } else if (equipment_id) {
      jobs = await sql`
        SELECT * FROM jobs
        WHERE equipment_id = ${equipment_id}
        ORDER BY created_at DESC
      `;
    } else {
      jobs = await sql`
        SELECT * FROM job_summary
        ORDER BY created_at DESC
        LIMIT 100
      `;
    }

    res.json({
      success: true,
      count: jobs.length,
      jobs: jobs
    });

  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/equipment/import-csv - Import equipment from CSV
app.post('/api/equipment/import-csv', express.json(), async (req, res) => {
  try {
    const { csvData } = req.body;

    if (!csvData) {
      return res.status(400).json({ error: 'No CSV data provided' });
    }

    // Parse CSV data
    // Expected format: customer_name,location,equipment_name,manufacturer,model,serial_number,tonnage,refrigerant
    const lines = csvData.trim().split('\n');
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());

    console.log('CSV Headers:', headers);

    const imported = {
      customers: 0,
      equipment: 0,
      errors: []
    };

    // Process each line (skip header)
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};

        headers.forEach((header, index) => {
          row[header] = values[index] || null;
        });

        console.log(`Processing row ${i}:`, row);

        // Find or create customer
        let customer = await sql`
          SELECT id FROM customers
          WHERE name = ${row.customer_name || row.customer}
            AND location = ${row.location || row.customer_location}
        `;

        if (customer.length === 0) {
          // Create new customer
          customer = await sql`
            INSERT INTO customers (
              name,
              location,
              address,
              city,
              state,
              contact_name,
              contact_phone
            ) VALUES (
              ${row.customer_name || row.customer},
              ${row.location || row.customer_location},
              ${row.address || null},
              ${row.city || null},
              ${row.state || null},
              ${row.contact_name || null},
              ${row.contact_phone || null}
            )
            RETURNING id
          `;
          imported.customers++;
          console.log(`  Created customer: ${row.customer_name || row.customer} - ${row.location}`);
        }

        const customerId = customer[0].id;

        // Check if equipment already exists
        const existingEquipment = await sql`
          SELECT id FROM equipment
          WHERE customer_id = ${customerId}
            AND model = ${row.model}
            AND (
              serial_number = ${row.serial_number || row.serial}
              OR (serial_number IS NULL AND ${row.serial_number || row.serial} IS NULL)
            )
        `;

        if (existingEquipment.length > 0) {
          console.log(`  Equipment already exists, skipping: ${row.model}`);
          continue;
        }

        // Create equipment
        await sql`
          INSERT INTO equipment (
            customer_id,
            equipment_name,
            equipment_type,
            manufacturer,
            model,
            serial_number,
            tonnage,
            refrigerant,
            voltage,
            location_detail,
            notes
          ) VALUES (
            ${customerId},
            ${row.equipment_name || row.name || null},
            ${row.equipment_type || row.type || 'RTU'},
            ${row.manufacturer || null},
            ${row.model},
            ${row.serial_number || row.serial || null},
            ${row.tonnage ? parseFloat(row.tonnage) : null},
            ${row.refrigerant || null},
            ${row.voltage || null},
            ${row.location_detail || null},
            ${row.notes || null}
          )
        `;
        imported.equipment++;
        console.log(`  Created equipment: ${row.model} (${row.manufacturer})`);

      } catch (rowError) {
        console.error(`Error processing row ${i}:`, rowError);
        imported.errors.push({
          row: i,
          data: lines[i],
          error: rowError.message
        });
      }
    }

    res.json({
      success: true,
      message: 'CSV import completed',
      imported: imported
    });

  } catch (error) {
    console.error('Error importing CSV:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/customers - Create a new customer
app.post('/api/customers', async (req, res) => {
  try {
    const { name, location, address, city, state, zip, contact_name, contact_phone, contact_email, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    const customer = await sql`
      INSERT INTO customers (
        name, location, address, city, state, zip,
        contact_name, contact_phone, contact_email, notes
      ) VALUES (
        ${name}, ${location}, ${address}, ${city}, ${state}, ${zip},
        ${contact_name}, ${contact_phone}, ${contact_email}, ${notes}
      )
      RETURNING *
    `;

    res.json({
      success: true,
      customer: customer[0]
    });

  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/equipment - Create new equipment
app.post('/api/equipment', async (req, res) => {
  try {
    const {
      customer_id, equipment_name, equipment_type, manufacturer,
      model, serial_number, tonnage, refrigerant, voltage,
      install_date, location_detail, warranty_expires, notes
    } = req.body;

    if (!customer_id || !model) {
      return res.status(400).json({ error: 'customer_id and model are required' });
    }

    const equipment = await sql`
      INSERT INTO equipment (
        customer_id, equipment_name, equipment_type, manufacturer,
        model, serial_number, tonnage, refrigerant, voltage,
        install_date, location_detail, warranty_expires, notes
      ) VALUES (
        ${customer_id}, ${equipment_name}, ${equipment_type}, ${manufacturer},
        ${model}, ${serial_number}, ${tonnage}, ${refrigerant}, ${voltage},
        ${install_date}, ${location_detail}, ${warranty_expires}, ${notes}
      )
      RETURNING *
    `;

    res.json({
      success: true,
      equipment: equipment[0]
    });

  } catch (error) {
    console.error('Error creating equipment:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/jobs - Create a new job (auto-generates job number)
app.post('/api/jobs', async (req, res) => {
  try {
    const {
      customer_id, equipment_id, job_type, priority,
      problem_description, scheduled_date
    } = req.body;

    if (!customer_id) {
      return res.status(400).json({ error: 'customer_id is required' });
    }

    // Job number is auto-generated by trigger
    const job = await sql`
      INSERT INTO jobs (
        customer_id, equipment_id, job_type, priority,
        problem_description, scheduled_date, status
      ) VALUES (
        ${customer_id}, ${equipment_id}, ${job_type || 'service'},
        ${priority || 'normal'}, ${problem_description},
        ${scheduled_date || null}, 'scheduled'
      )
      RETURNING *
    `;

    console.log(`✓ Created job: ${job[0].job_number}`);

    res.json({
      success: true,
      job: job[0]
    });

  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/jobs/:id - Update a job
app.patch('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const allowedFields = [
      'status', 'tech_notes', 'work_performed', 'recommendations',
      'parts_used', 'labor_hours', 'tech_signature', 'photos',
      'nameplate_photos', 'started_at', 'completed_at', 'signed_at'
    ];

    const setClause = [];
    const values = [];

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${values.length + 1}`);
        values.push(updates[key]);
      }
    });

    if (setClause.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(id); // For WHERE clause

    const job = await sql.unsafe(`
      UPDATE jobs
      SET ${setClause.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `, values);

    if (job.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      job: job[0]
    });

  } catch (error) {
    console.error('Error updating job:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dave Mode server running on http://localhost:${PORT}`);
  console.log(`Configured with OpenAI: ${!!process.env.OPENAI_API_KEY}`);
});

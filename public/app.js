let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentRepairs = []; // In-memory storage for repairs
let currentRepairIndex = null; // Track which repair is getting parts
let recordingStartTime = null;
let recordingTimerInterval = null;
let partsStatus = {}; // Cache for parts existence status

// Modal variables for adding parts
let modalMediaRecorder = null;
let modalAudioChunks = [];
let isModalRecording = false;
let currentPartToAdd = '';
let modalFieldHistory = {}; // Track previous field values for undo

// Detected-parts queue for multi-part utterances
let pendingPartsQueue = []; // Array of {quantity, name, category, type?, clarify?}
let pendingPartIndex = 0;    // Current item index in queue

// Conversational command state
let conversationState = null; // Tracks multi-step voice commands
// Format: { type: 'add_part' | 'add_term', data: {}, nextField: 'name', rawCommand: '' }

// Lexicon cache for normalization
let LEXICON_CACHE = [];
let LEXICON_LAST_UPDATED = 0;

// Corrections tracking for teaching the system
let lastRawTranscript = '';
let lastNormalizedTranscript = '';

// ========== VOICE PARSER CONFIGURATION ==========
const PARSER_CONFIG = {
  // Hybrid validation settings
  useServerValidation: true, // Toggle to disable GPT-4 validation (cost saving)
  confidenceThreshold: 0.72, // Call GPT-4 only if client confidence < this

  // Fuzzy matching settings
  fuzzyMatchThreshold: 0.72, // Levenshtein similarity threshold

  // Valid dropdown options
  categories: ['Electrical', 'Mechanical', 'Refrigeration', 'Controls', 'Filters', 'Other'],
  types: ['Consumable', 'Inventory'],

  // Quantity multiplier keywords
  multipliers: {
    'pack': 1,
    'packs': 1,
    'pair': 2,
    'pairs': 2,
    'dozen': 12,
    'dozens': 12
  },

  // Word-to-number mapping
  numberWords: {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
    'eighty': 80, 'ninety': 90, 'hundred': 100, 'thousand': 1000,
    'half': 0.5, 'quarter': 0.25, 'quarters': 0.25
  }
};

// ========== LEXICON FUNCTIONS ==========

/**
 * Fetch lexicon from server and cache it
 */
async function fetchLexicon() {
  try {
    const response = await fetch(`/api/lexicon?since=${LEXICON_LAST_UPDATED}`);

    if (response.status === 304) {
      // Cache is still fresh
      console.log('[Lexicon] Cache is up to date');
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to fetch lexicon');
    }

    const data = await response.json();
    LEXICON_CACHE = data.lexicon || [];
    LEXICON_LAST_UPDATED = data.lastUpdated || Date.now();

    console.log(`[Lexicon] Loaded ${LEXICON_CACHE.length} entries`);
  } catch (error) {
    console.error('[Lexicon] Error fetching:', error);
  }
}

/**
 * Add a new lexicon entry (for "Teach" feature)
 */
async function addLexiconEntry(kind, trigger, replacement, notes = '') {
  try {
    const response = await fetch('/api/lexicon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, trigger, replacement, notes })
    });

    if (!response.ok) {
      throw new Error('Failed to add lexicon entry');
    }

    const data = await response.json();
    console.log(`[Lexicon] Added: ${trigger} → ${replacement} (${kind})`);

    // Refresh cache
    await fetchLexicon();

    return data;
  } catch (error) {
    console.error('[Lexicon] Error adding entry:', error);
    throw error;
  }
}

/**
 * Log a user correction for future analysis and auto-suggestions
 * Fire-and-forget - won't block UI if it fails
 */
async function logCorrection(field, oldValue, newValue, raw = '', normalized = '') {
  // Skip if no actual change
  if (oldValue === newValue) return;

  try {
    // Use stored transcripts if not provided
    const correctionData = {
      field,
      oldValue: String(oldValue),
      newValue: String(newValue),
      raw: raw || lastRawTranscript,
      normalized: normalized || lastNormalizedTranscript,
      timestamp: Date.now()
    };

    console.log(`📝 Logging correction: ${field} "${oldValue}" → "${newValue}"`);

    // Fire-and-forget POST
    fetch('/api/lexicon/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(correctionData)
    }).catch(err => {
      // Silently fail - don't block the UI
      console.warn('[Corrections] Failed to log (non-blocking):', err.message);
    });

  } catch (error) {
    // Silently fail - corrections are nice-to-have, not critical
    console.warn('[Corrections] Error logging (non-blocking):', error.message);
  }
}

/**
 * Normalize transcript using lexicon rules
 * Applies regex, synonyms, and unit replacements
 */
function normalizeTranscript(raw, lexicon = LEXICON_CACHE) {
  if (!raw) return '';
  if (!lexicon || !lexicon.length) return raw.trim();

  let t = ' ' + raw.toLowerCase() + ' ';

  console.log('[Normalize] Input:', raw);

  // 1) Apply regex rules first (units, number formats)
  const regexRules = lexicon.filter(e => e.kind === 'regex' && e.trigger && e.replacement);
  for (const rule of regexRules) {
    try {
      const regex = new RegExp(rule.trigger, 'gi');
      const before = t;
      t = t.replace(regex, rule.replacement);
      if (before !== t) {
        console.log(`[Normalize] Regex: ${rule.trigger} →`, t.trim());
      }
    } catch (error) {
      // Silent error for malformed user regex entries
      // (Don't spam console with user mistakes in lexicon)
    }
  }

  // 2) Apply word/phrase synonyms (try word-boundary first, then phrase fallback)
  const synonymRules = lexicon.filter(e =>
    (e.kind === 'synonym' || e.kind === 'replace' || e.kind === 'unit') &&
    e.trigger &&
    e.replacement
  );

  for (const rule of synonymRules) {
    // Escape special regex chars in trigger
    const escapedTrigger = rule.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Try word-boundary match first (more precise)
    const wordBoundaryRegex = new RegExp(`\\b${escapedTrigger}\\b`, 'gi');
    const afterWordBoundary = t.replace(wordBoundaryRegex, rule.replacement);

    if (afterWordBoundary !== t) {
      // Word-boundary match succeeded
      t = afterWordBoundary;
      console.log(`[Normalize] Synonym (word): "${rule.trigger}" → "${rule.replacement}"`);
    } else {
      // Fallback: phrase match (for multi-word phrases like "double a")
      const phraseRegex = new RegExp(escapedTrigger, 'gi');
      const afterPhrase = t.replace(phraseRegex, rule.replacement);

      if (afterPhrase !== t) {
        t = afterPhrase;
        console.log(`[Normalize] Synonym (phrase): "${rule.trigger}" → "${rule.replacement}"`);
      }
    }
  }

  // 2.5) De-dupe pass: collapse repeated tokens (fixes "AA AA battery" glitches)
  // Collapse repeated size tokens like "aa aa battery" -> "aa battery"
  const sizeRep = '(aa|aaa|c|d|9v|cr2032)';
  const beforeDedupe = t;
  t = t.replace(new RegExp(`\\b(${sizeRep})\\s+\\1\\b`, 'gi'), '$1');
  // Collapse repeated noun too (rare speech glitches): "battery battery" -> "battery"
  t = t.replace(/\b(battery)\s+\1\b/gi, '$1');
  if (beforeDedupe !== t) {
    console.log(`[Normalize] De-dupe: removed repeated tokens →`, t.trim());
  }

  // 3) Cleanup: trim and collapse spaces
  const result = t.trim().replace(/\s+/g, ' ');

  console.log('[Normalize] Output:', result);

  return result;
}

// ========== VOICE PARSER HELPER FUNCTIONS ==========

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching categories and types
 */
function levenshteinDistance(str1, str2) {
  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();

  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Calculate similarity score (0-1) between two strings
 */
function similarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Convert word-based numbers to numeric values
 * Examples: "one twenty-five" → 1.25, "ninety-nine" → 99
 */
function wordsToNumber(text) {
  text = text.toLowerCase().trim();
  const words = text.split(/\s+/);
  const numberWords = PARSER_CONFIG.numberWords;

  let result = 0;
  let current = 0;
  let foundNumber = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (numberWords.hasOwnProperty(word)) {
      foundNumber = true;
      const value = numberWords[word];

      if (value >= 100) {
        current = (current || 1) * value;
      } else {
        current += value;
      }
    } else if (word === 'and') {
      // Handle "three and a half" = 3.5
      continue;
    } else if (i > 0 && foundNumber) {
      // Stop when we hit a non-number word after finding numbers
      break;
    }
  }

  result += current;
  return foundNumber ? result : null;
}

/**
 * Extract leading quantity with multipliers
 * Examples:
 *   "2 AA batteries" → { quantity: 2, remaining: "AA batteries" }
 *   "12-pack AA batteries" → { quantity: 12, remaining: "AA batteries" }
 *   "pack of 12 AA batteries" → { quantity: 12, remaining: "AA batteries" }
 *   "two AAA batteries" → { quantity: 2, remaining: "AAA batteries" }
 *   "3/4 ball valve" → null (embedded fraction, not a quantity)
 */
function extractLeadingQuantity(text) {
  text = text.trim();

  // Helper to clean remaining text
  const cleanRemaining = (str) => {
    return str.replace(/^(of\s+|pack\s+|packs\s+)+/i, '').trim();
  };

  // Skip if the phrase starts with an HVAC filter dimension like "24x24x2" or "20 x 25 x 1"
  // This prevents treating "24x24x2 pleated filters" as quantity=24
  const DIM_RX = /^\s*\d{1,3}\s*(x|×|\*)\s*\d{1,3}(\s*(x|×|\*)\s*\d{1,3})?/i;
  if (DIM_RX.test(text)) {
    return null; // do not extract a quantity from leading dimension
  }

  // Skip if starts with fraction pattern (e.g., "3/4 ball valve")
  if (/^\d+\/\d+/.test(text)) {
    return null;
  }

  // Pattern 1: Leading digit(s) with optional decimal
  const digitMatch = text.match(/^(\d+(?:\.\d+)?)\s+(.+)/);
  if (digitMatch) {
    const qty = parseFloat(digitMatch[1]);
    let remaining = digitMatch[2];

    // Check for multipliers after the number (e.g., "2 pack of filters")
    const multiplierMatch = remaining.match(/^(pack|packs|pair|pairs|dozen|dozens)\s+(?:of\s+)?(.+)/i);
    if (multiplierMatch) {
      const multiplierWord = multiplierMatch[1].toLowerCase();
      const multiplier = PARSER_CONFIG.multipliers[multiplierWord] || 1;
      remaining = cleanRemaining(multiplierMatch[2]);
      return { quantity: qty * multiplier, remaining };
    }

    return { quantity: qty, remaining: cleanRemaining(remaining) };
  }

  // Pattern 2: Word-based number at start
  const wordMatch = wordsToNumber(text);
  if (wordMatch !== null) {
    // Find where the number words end
    const words = text.split(/\s+/);
    let endIndex = 0;
    for (let i = 0; i < words.length; i++) {
      if (PARSER_CONFIG.numberWords.hasOwnProperty(words[i].toLowerCase())) {
        endIndex = i + 1;
      } else {
        break;
      }
    }

    let remaining = words.slice(endIndex).join(' ');

    // Check for multipliers
    const multiplierMatch = remaining.match(/^(pack|packs|pair|pairs|dozen|dozens)\s+(?:of\s+)?(.+)/i);
    if (multiplierMatch) {
      const multiplierWord = multiplierMatch[1].toLowerCase();
      const multiplier = PARSER_CONFIG.multipliers[multiplierWord] || 1;
      return { quantity: wordMatch * multiplier, remaining: cleanRemaining(multiplierMatch[2]) };
    }

    return { quantity: wordMatch, remaining: cleanRemaining(remaining) };
  }

  // Pattern 3: Multiplier word with number (e.g., "pack of 6", "dozen AA batteries")
  const packMatch = text.match(/^(pack|packs|pair|pairs|dozen|dozens)(?:\s+of\s+|\s+|-)(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(.+)/i);
  if (packMatch) {
    const multiplierWord = packMatch[1].toLowerCase();
    const multiplier = PARSER_CONFIG.multipliers[multiplierWord] || 1;
    const numberPart = packMatch[2];
    const qty = PARSER_CONFIG.numberWords[numberPart.toLowerCase()] || parseFloat(numberPart);
    return { quantity: qty * multiplier, remaining: cleanRemaining(packMatch[3]) };
  }

  // Pattern 4: "12-pack AA batteries" / "two-pack filters"
  const simplePackMatch = text.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)-(pack|packs|pair|pairs)\s+(.+)/i);
  if (simplePackMatch) {
    const numberPart = simplePackMatch[1];
    const multiplierWord = simplePackMatch[2].toLowerCase();
    const qty = PARSER_CONFIG.numberWords[numberPart.toLowerCase()] || parseFloat(numberPart);
    const multiplier = PARSER_CONFIG.multipliers[multiplierWord] || 1;
    return { quantity: qty * multiplier, remaining: cleanRemaining(simplePackMatch[3]) };
  }

  return null;
}

/**
 * Extract price from text
 * Examples:
 *   "a dollar fifty" → 1.50
 *   "one fifty" → 1.50
 *   "a buck fifty" → 1.50
 *   "one and a quarter" → 1.25
 *   "ninety-nine cents" → 0.99
 *   "price 129" → 129.00
 *   "at 8.50 each" → 8.50
 */
function extractPrice(text) {
  text = text.toLowerCase();

  // Pattern 0A: "one and a quarter" / "one and a half"
  const andFractionMatch = text.match(/(one|two|three|four|five|six|seven|eight|nine|ten)\s+and\s+a\s+(quarter|half)/i);
  if (andFractionMatch) {
    const base = wordsToNumber(andFractionMatch[1]) || 1;
    const fraction = andFractionMatch[2] === 'quarter' ? 0.25 : 0.5;
    return base + fraction;
  }

  // Pattern 0B: "a dollar fifty" / "a dollar and fifty cents"
  const aDollarMatch = text.match(/(?:a|one)\s+dollar(?:\s+and)?\s+([a-z]+)(?:\s+cents)?/i);
  if (aDollarMatch) {
    const cents = wordsToNumber(aDollarMatch[1]);
    if (cents !== null) {
      return 1 + (cents / 100);
    }
  }

  // Pattern 0C: "a buck fifty" / "buck fifty"
  const buckMatch = text.match(/(?:a\s+)?bucks?\s+([a-z]+)/i);
  if (buckMatch) {
    const cents = wordsToNumber(buckMatch[1]);
    if (cents !== null) {
      return 1 + (cents / 100);
    }
  }

  // Pattern 0D: "one fifty" / "two fifty" (standalone, no keyword)
  const oneFiftyMatch = text.match(/\b(one|two|three|four|five|six|seven|eight|nine)\s+(ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(?:each|per))?\b/i);
  if (oneFiftyMatch) {
    const first = wordsToNumber(oneFiftyMatch[1]) || 0;
    const second = wordsToNumber(oneFiftyMatch[2]) || 0;
    return first + (second / 100);
  }

  // Pattern 1: Explicit dollar amount with $ or "dollars"
  const dollarMatch = text.match(/(?:price|cost|costs|at|for)?\s*\$?(\d+(?:\.\d{1,2})?)\s*(?:dollars?|each|per)?/i);
  if (dollarMatch) {
    return parseFloat(dollarMatch[1]);
  }

  // Pattern 2: Cents
  const centsMatch = text.match(/(\d+|[a-z\s]+)\s*cents?/i);
  if (centsMatch) {
    const numberPart = centsMatch[1].trim();
    const value = /^\d+$/.test(numberPart) ? parseFloat(numberPart) : wordsToNumber(numberPart);
    if (value !== null) {
      return value / 100;
    }
  }

  // Pattern 3: Word-based price (e.g., "one twenty-five" = 1.25)
  const priceKeywords = ['price', 'cost', 'costs', 'at', 'for'];
  for (const keyword of priceKeywords) {
    const regex = new RegExp(`${keyword}\\s+([a-z\\s]+?)(?:\\s+(?:dollars?|each|per)|$)`, 'i');
    const match = text.match(regex);
    if (match) {
      const wordsPart = match[1].trim();
      const value = wordsToNumber(wordsPart);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

/**
 * Fuzzy match category with Levenshtein distance
 */
function fuzzyMatchCategory(text) {
  const categories = PARSER_CONFIG.categories;
  const threshold = PARSER_CONFIG.fuzzyMatchThreshold;

  text = text.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  let attempted = false;

  for (const category of categories) {
    const categoryLower = category.toLowerCase();

    // Exact match
    if (text.includes(categoryLower)) {
      return { match: category, attempted: true, error: null };
    }

    // StartsWith match
    if (categoryLower.startsWith(text) || text.startsWith(categoryLower.substring(0, 4))) {
      return { match: category, attempted: true, error: null };
    }

    // Similarity score
    const score = similarity(text, categoryLower);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = category;
      attempted = true;
    }
  }

  if (bestScore >= threshold) {
    return { match: bestMatch, attempted: true, error: null };
  }

  if (attempted) {
    const categoryList = categories.join(', ');
    return {
      match: null,
      attempted: true,
      error: `Unknown category. Try one of: ${categoryList}`
    };
  }

  return { match: null, attempted: false, error: null };
}

/**
 * Fuzzy match type with Levenshtein distance
 */
function fuzzyMatchType(text) {
  const types = PARSER_CONFIG.types;
  const threshold = PARSER_CONFIG.fuzzyMatchThreshold;

  text = text.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  let attempted = false;

  for (const type of types) {
    const typeLower = type.toLowerCase();

    // Exact match
    if (text.includes(typeLower)) {
      return { match: type, attempted: true, error: null };
    }

    // StartsWith match
    if (typeLower.startsWith(text) || text.startsWith(typeLower.substring(0, 4))) {
      return { match: type, attempted: true, error: null };
    }

    // Similarity score
    const score = similarity(text, typeLower);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = type;
      attempted = true;
    }
  }

  if (bestScore >= threshold) {
    return { match: bestMatch, attempted: true, error: null };
  }

  if (attempted) {
    const typeList = types.join(', ');
    return {
      match: null,
      attempted: true,
      error: `Unknown type. Try one of: ${typeList}`
    };
  }

  return { match: null, attempted: false, error: null };
}

/**
 * Extract part number from text
 * Look for patterns like M847D, R410A, etc.
 */
function extractPartNumber(text) {
  // Pattern: uppercase letter(s) followed by numbers and possibly more letters/numbers
  const patterns = [
    /\b([A-Z]\d{3,}[A-Z]?)\b/,  // M847D, R410A
    /\b([A-Z]{2,}\d+[A-Z]*)\b/, // MS9540, ABC123
    /part\s*(?:number|#|num)?\s*:?\s*([A-Za-z0-9-]+)/i, // "part number M847D"
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

// ========== MULTI-PART PARSING FUNCTIONS ==========

/**
 * Infer category from part name keywords using lexicon ONLY
 * No hardcoded fallbacks - 100% data-driven via lexicon.json
 */
function inferCategoryFromName(name, lexicon = LEXICON_CACHE) {
  if (!name) return null;

  const nameLower = name.toLowerCase();

  // Use lexicon category rules ONLY
  const categoryRules = lexicon.filter(e => e.kind === 'category' && e.trigger && e.replacement);

  // Find first matching rule (could enhance with scoring later)
  for (const rule of categoryRules) {
    if (nameLower.includes(rule.trigger.toLowerCase())) {
      console.log(`[Category] Matched "${rule.trigger}" → ${rule.replacement}`);
      return rule.replacement;
    }
  }

  // No match found - return null (no hardcoded fallbacks)
  return null;
}

/**
 * Detect if transcription contains multiple distinct parts
 */
function detectMultipleParts(transcription) {
  const text = transcription.toLowerCase();

  // Look for "and" that separates parts (not dimensions or fractions)
  const segments = [];

  // Split on "and" but be careful
  const andSplit = transcription.split(/\s+and\s+/i);

  if (andSplit.length === 1) {
    return { isMultiple: false, segments: [transcription] };
  }

  // Check each segment to see if it looks like a part description
  for (let i = 0; i < andSplit.length; i++) {
    const segment = andSplit[i].trim();

    // Skip if this looks like a fraction context ("one and a half")
    if (i > 0 && /^(a\s+)?(half|quarter|third)/i.test(segment)) {
      // Merge with previous
      if (segments.length > 0) {
        segments[segments.length - 1] += ' and ' + segment;
      }
      continue;
    }

    // Skip if this looks like dimensional continuation ("by 24 and 2")
    if (i > 0 && /^\d+\s*$/i.test(segment) && /\d+\s*(x|by)\s*\d+$/i.test(andSplit[i-1])) {
      // Merge with previous (dimensions like "24 by 24 and 2")
      if (segments.length > 0) {
        segments[segments.length - 1] += ' and ' + segment;
      }
      continue;
    }

    // Check if segment has a part-like structure (quantity + noun or technical noun)
    const hasQuantity = /^\d+|^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|pair|pack)/i.test(segment);
    const hasNoun = /\b(fuse|filter|battery|batteries|valve|belt|sensor|thermostat|wire|breaker|actuator)\b/i.test(segment);

    if (hasQuantity || hasNoun || segment.length > 5) {
      segments.push(segment);
    }
  }

  return {
    isMultiple: segments.length > 1,
    segments: segments.length > 0 ? segments : [transcription]
  };
}

/**
 * Parse a single part phrase segment
 */
function parsePartPhrase(segment) {
  const result = {
    quantity: null,
    name: null,
    category: null,
    type: null,
    clarify: null
  };

  let remainingText = segment.trim();

  // Extract quantity
  const qtyExtract = extractLeadingQuantity(remainingText);
  if (qtyExtract) {
    result.quantity = qtyExtract.quantity;
    remainingText = qtyExtract.remaining;
  }

  // Clean up name
  let cleanedName = remainingText
    .replace(/^(pack|packs|of|pair|pairs|dozen|dozens)\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Battery token detection (using word boundaries to prevent false matches)
  // Note: lexicon already handles "double a" → "aa battery", "triple a" → "aaa battery"
  const batteryTokens = ['AAA', 'AA', 'C', 'D', '9V', 'CR2032']; // AAA before AA to match longer first
  const foundTokens = [];

  for (const token of batteryTokens) {
    // Use word boundary regex to prevent "AA" matching inside "AAA"
    const tokenRegex = new RegExp(`\\b${token}\\b`, 'i');
    if (tokenRegex.test(segment)) {
      foundTokens.push(token);
      break; // Only match first/longest token (AAA before AA)
    }
  }

  // Handle battery detection (NEVER infer - only use explicitly mentioned types)
  if (foundTokens.length === 1) {
    // Normalize battery name
    const batteryType = foundTokens[0];
    if (!cleanedName.toLowerCase().includes('batter')) {
      cleanedName = `${batteryType} battery`;
    } else {
      cleanedName = cleanedName.replace(/batter(y|ies)/i, `${batteryType} battery`);
    }
  }
  // REMOVED: Don't ask for clarification if battery type not specified
  // Just use "battery" as-is and let user specify type in modal

  // Normalize plural to singular
  if (!result.clarify && cleanedName) {
    cleanedName = cleanedName
      .replace(/filters$/i, 'filter')
      .replace(/fuses$/i, 'fuse')
      .replace(/batteries$/i, 'battery')
      .replace(/valves$/i, 'valve')
      .replace(/sensors$/i, 'sensor')
      .replace(/belts$/i, 'belt');
  }

  result.name = cleanedName;

  // Ensure single size token and singular noun (prevents "AA AA battery")
  // Step 1: Normalize to lowercase for de-duping
  let normalizedName = result.name.toLowerCase();

  // Step 2: De-dupe repeated size tokens (case-insensitive)
  const sizeRep = '(aa|aaa|c|d|9v|cr2032)';
  normalizedName = normalizedName.replace(new RegExp(`\\b(${sizeRep})\\s+\\1\\b`, 'g'), '$1');

  // Step 3: Ensure singular: batteries -> battery
  normalizedName = normalizedName.replace(/\bbatteries\b/g, 'battery');

  // Step 4: Capitalize size tokens for display consistency
  result.name = normalizedName
    .replace(/\baa\b/g, 'AA')
    .replace(/\baaa\b/g, 'AAA')
    .replace(/\bc\b/g, 'C')
    .replace(/\bd\b/g, 'D')
    .replace(/\b9v\b/g, '9V')
    .replace(/\bcr2032\b/g, 'CR2032');

  // Infer category
  result.category = inferCategoryFromName(result.name);

  // Default type
  result.type = result.category === 'Filters' ? 'Consumable' : 'Inventory';

  // Validation logging: warn if part name is too generic or potentially hallucinated
  if (!result.name || result.name.trim().length === 0) {
    console.warn('[Parser] Empty part name detected from segment:', segment);
  } else if (result.name === 'battery' && !batteryTokens.some(t => segment.toLowerCase().includes(t.toLowerCase()))) {
    console.warn('[Parser] Generic "battery" without type specified:', segment);
  }

  // Log parsed part for debugging (QtyGuard diagnostic)
  console.debug('[QtyGuard] input=', segment, ' parsedQty=', result.quantity, ' name=', result.name);

  return result;
}

/**
 * Parse multiple parts from transcription
 */
function parseMultipleParts(transcription) {
  const detection = detectMultipleParts(transcription);

  console.log('[Parser] Multi-part detection:', {
    isMultiple: detection.isMultiple,
    segmentCount: detection.segments.length,
    segments: detection.segments
  });

  const parts = [];
  for (const segment of detection.segments) {
    const parsed = parsePartPhrase(segment);
    parts.push(parsed);
  }

  // Summary validation
  console.log('[Parser] ✓ Final parsed parts:', parts.map(p => ({
    qty: p.quantity,
    name: p.name,
    category: p.category
  })));

  // Validation: Check for potential hallucinations
  const partNames = parts.map(p => p.name.toLowerCase());
  const originalLower = transcription.toLowerCase();

  parts.forEach(part => {
    if (part.name && !originalLower.includes(part.name.toLowerCase().split(' ')[0])) {
      console.warn('[Parser] ⚠️ Potential hallucination - part not in original text:', {
        detected: part.name,
        original: transcription
      });
    }
  });

  return parts;
}

/**
 * Render detected parts list for transcript drawer
 */
function renderDetectedList(parts) {
  if (!parts || parts.length === 0) return '';

  let output = 'Detected parts:\n\n';
  parts.forEach((part, i) => {
    const qty = part.quantity || '?';
    const name = part.name || 'unknown';
    const cat = part.category || 'Other';
    output += `${i + 1}. ${qty} × ${name} (${cat})`;
    if (part.clarify) {
      output += ` [needs clarification]`;
    }
    output += '\n';
  });
  return output;
}

/**
 * Render short format for pill display
 */
function renderShort(part) {
  if (!part) return '';
  const qty = part.quantity || 1;
  const name = part.name || 'part';
  return `${qty} × ${name}`;
}

// ========== DB LOOKUP NORMALIZATION HELPERS ==========

/**
 * Normalize a part name for DB lookup (qty-free, lowercase, singularized)
 * @param {string} rawName - Raw part name (may include quantity tokens)
 * @returns {string} Normalized name for lookup
 */
function normalizeNameForLookup(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';

  let normalized = rawName.toLowerCase().trim();

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');

  // Remove leading quantity tokens (defensive - should already be removed)
  // Match patterns like: "4 ", "12 ", "pack of ", "6-pack ", etc.
  normalized = normalized.replace(/^\d+\s+/, ''); // "4 fuses" → "fuses"
  normalized = normalized.replace(/^\d+-pack\s+/, ''); // "12-pack batteries" → "batteries"
  normalized = normalized.replace(/^pack\s+of\s+\d+\s+/, ''); // "pack of 6 filters" → "filters"

  // Singularize common plurals
  const pluralMap = {
    'filters': 'filter',
    'fuses': 'fuse',
    'batteries': 'battery',
    'breakers': 'breaker',
    'capacitors': 'capacitor',
    'contactors': 'contactor',
    'thermostats': 'thermostat',
    'sensors': 'sensor',
    'valves': 'valve',
    'belts': 'belt',
    'bearings': 'bearing',
    'motors': 'motor',
    'compressors': 'compressor',
    'coils': 'coil',
    'fans': 'fan'
  };

  // Replace plural with singular if exact match
  Object.keys(pluralMap).forEach(plural => {
    const singular = pluralMap[plural];
    // Use word boundary to avoid partial replacements
    const regex = new RegExp(`\\b${plural}\\b`, 'gi');
    normalized = normalized.replace(regex, singular);
  });

  return normalized.trim();
}

/**
 * Create a DB lookup key from part info
 * @param {Object} partInfo - {name: string, partNumber?: string}
 * @returns {string} Lookup key for DB matching
 */
function makeDbLookupKey({ name, partNumber }) {
  const normalizedName = normalizeNameForLookup(name || '');
  if (partNumber && partNumber.trim()) {
    return `${normalizedName}|${partNumber.trim()}`;
  }
  return normalizedName;
}

/**
 * Convert a string part (possibly with quantity) into a chip object
 * @param {string} partString - Raw part string (e.g., "4 600V 30A fuses")
 * @returns {Object} Chip object {name, quantity, lookupKey, text}
 */
function stringToChip(partString) {
  if (!partString || typeof partString !== 'string') {
    return { name: '', quantity: 1, lookupKey: '', text: partString };
  }

  const text = partString.trim();

  // Parse using existing parsePartPhrase logic
  const parsed = parsePartPhrase(text);

  const chip = {
    name: parsed.name || text,
    quantity: parsed.quantity || 1,
    lookupKey: normalizeNameForLookup(parsed.name || text),
    text: text // Original utterance
  };

  // Guard: never let a dimension number override quantity
  const DIM_RX = /\b\d{1,3}\s*(x|×|\*)\s*\d{1,3}(\s*(x|×|\*)\s*\d{1,3})?\b/i;
  if (DIM_RX.test(chip.name)) {
    // Dimension detected in name - quantity stays whatever the parser set or default 1
    // (quantity should come from leading words like "four 24x24x2 filters", not from "24")
  }

  console.debug('[Chip]', chip);

  return chip;
}

// ========== QUEUE MANAGEMENT FUNCTIONS ==========

/**
 * Load current queued part into modal form
 */
function loadQueuedPartIntoModal() {
  if (pendingPartIndex >= pendingPartsQueue.length) {
    showCompactPill('✓ All parts processed', '', { showView: false });
    setTimeout(() => hideCompactPill(), 3000);
    pendingPartsQueue = [];
    pendingPartIndex = 0;
    return;
  }

  const part = pendingPartsQueue[pendingPartIndex];

  console.log(`[Queue] Loading part ${pendingPartIndex + 1}/${pendingPartsQueue.length}:`, part);

  // If this part needs clarification, show it and wait
  if (part.clarify) {
    const clarifyMsg = part.clarify;
    const buttons = [];

    // Add clarification choice buttons if it's a battery question
    if (clarifyMsg.includes('AA') || clarifyMsg.includes('AAA')) {
      showCompactPill('❓ Need clarification', clarifyMsg, {
        showView: true,
        clarificationChoices: ['AA', 'AAA', 'C', 'D', '9V', 'CR2032']
      });
    } else {
      showCompactPill('❓ Need clarification', clarifyMsg, { showView: true });
    }
    return;
  }

  // Fill form with part data
  document.getElementById('partName').value = part.name || '';
  document.getElementById('partQuantity').value = part.quantity || 1;
  document.getElementById('partCategory').value = part.category || '';
  document.getElementById('partType').value = part.type || 'Inventory';

  // Don't touch price, description, common uses - those are for follow-up recordings

  // Show progress in pill
  const remaining = pendingPartsQueue.length - pendingPartIndex - 1;
  if (remaining > 0) {
    showCompactPill(
      `Part ${pendingPartIndex + 1}/${pendingPartsQueue.length}`,
      `Loaded: ${renderShort(part)}`,
      { showView: true, showNext: true, showSkip: true }
    );
  } else {
    showCompactPill(
      `Part ${pendingPartIndex + 1}/${pendingPartsQueue.length} (last)`,
      `Loaded: ${renderShort(part)}`,
      { showView: true }
    );
  }
}

/**
 * Advance to next part in queue
 */
function handleNextPart() {
  console.log('[Queue] Next clicked');
  pendingPartIndex++;
  loadQueuedPartIntoModal();
}

/**
 * Skip current part
 */
function handleSkipPart() {
  console.log('[Queue] Skip clicked');
  pendingPartIndex++;
  loadQueuedPartIntoModal();
}

/**
 * Handle clarification choice (e.g., selecting "AA" for battery)
 */
function handleClarificationChoice(choice) {
  console.log('[Queue] Clarification choice:', choice);

  if (pendingPartIndex >= pendingPartsQueue.length) return;

  const part = pendingPartsQueue[pendingPartIndex];

  // Resolve the ambiguity
  if (part.clarify && part.clarify.includes('battery')) {
    part.name = `${choice} battery`;
    part.category = 'Electrical';
    part.type = 'Consumable';
    delete part.clarify;

    // Now load it
    loadQueuedPartIntoModal();
  }
}

/**
 * Main parser: Extract structured data from spoken transcription
 * @param {string} transcription - Raw voice transcription
 * @param {object} currentFields - Current form field values (for incremental merge)
 * @returns {object} Parsed data with quantity, name, category, type, price, etc.
 */
function parseSpokenPart(transcription, currentFields = {}) {
  // Initialize result with current field values (MERGE mode)
  const result = {
    quantity: currentFields.quantity || null,
    name: currentFields.name || null,
    category: currentFields.category || null,
    type: currentFields.type || null,
    price: currentFields.price || null,
    partNumber: currentFields.partNumber || null,
    description: currentFields.description || null,
    commonUses: currentFields.commonUses || null,
    errors: [],
    changedFields: [] // Track which fields were updated in this parse
  };

  let remainingText = transcription.trim();

  // Special command: "reset fields"
  if (/reset\s+fields?|clear\s+all|start\s+over/i.test(transcription)) {
    return {
      quantity: null,
      name: null,
      category: null,
      type: null,
      price: null,
      partNumber: null,
      description: null,
      commonUses: null,
      errors: [],
      changedFields: ['ALL'],
      resetCommand: true
    };
  }

  // 1. Extract leading quantity
  const qtyExtract = extractLeadingQuantity(remainingText);
  if (qtyExtract) {
    if (result.quantity !== qtyExtract.quantity) {
      result.quantity = qtyExtract.quantity;
      result.changedFields.push('quantity');
    }
    remainingText = qtyExtract.remaining;
  }

  // 2. Extract price
  const priceExtract = extractPrice(transcription);
  if (priceExtract !== null) {
    if (result.price !== priceExtract) {
      result.price = priceExtract;
      result.changedFields.push('price');
    }
  }

  // 3. Extract category
  const categoryMatch = fuzzyMatchCategory(transcription);
  if (categoryMatch.match) {
    if (result.category !== categoryMatch.match) {
      result.category = categoryMatch.match;
      result.changedFields.push('category');
    }
  } else if (categoryMatch.error) {
    result.errors.push(categoryMatch.error);
  }

  // 4. Extract type
  const typeMatch = fuzzyMatchType(transcription);
  if (typeMatch.match) {
    if (result.type !== typeMatch.match) {
      result.type = typeMatch.match;
      result.changedFields.push('type');
    }
  } else if (typeMatch.error) {
    result.errors.push(typeMatch.error);
  }

  // 5. Extract part number
  const partNumExtract = extractPartNumber(transcription);
  if (partNumExtract) {
    if (result.partNumber !== partNumExtract) {
      result.partNumber = partNumExtract;
      result.changedFields.push('partNumber');
    }
  }

  // 6. Name normalization and battery detection
  if (remainingText.length > 0) {
    // Clean up name: remove pack/quantity remnants
    let cleanedName = remainingText
      .replace(/^(pack|packs|of|pair|pairs|dozen|dozens)\s+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Battery token detection
    const batteryTokens = ['AA', 'AAA', 'C', 'D', '9V', 'CR2032'];
    const foundTokens = [];
    const lowerText = transcription.toLowerCase();

    for (const token of batteryTokens) {
      const tokenLower = token.toLowerCase();
      // Check for explicit mentions like "AA batteries" or "triple A"
      if (lowerText.includes(tokenLower) ||
          (token === 'AAA' && (lowerText.includes('triple a') || lowerText.includes('triple-a'))) ||
          (token === 'AA' && (lowerText.includes('double a') || lowerText.includes('double-a')))) {
        foundTokens.push(token);
      }
    }

    // Clarification check: multiple battery sizes or ambiguous
    if (foundTokens.length > 1) {
      result.clarify = `Did you mean "${foundTokens[0]} batteries" or "${foundTokens[1]} batteries"?`;
    } else if (foundTokens.length === 1) {
      // Single battery type found - normalize name
      if (!cleanedName.toLowerCase().includes('batter')) {
        cleanedName = `${foundTokens[0]} batteries`;
      } else if (!cleanedName.includes(foundTokens[0])) {
        cleanedName = cleanedName.replace(/batter(y|ies)/i, `${foundTokens[0]} batteries`);
      }
    } else if (/batter(y|ies)/i.test(cleanedName) && !foundTokens.length) {
      // Generic "batteries" without size
      result.clarify = 'Which battery size? (AA, AAA, C, D, 9V, CR2032)';
    }

    // Update name if changed and not asking for clarification about it
    if (cleanedName.length > 0 && (!result.name || cleanedName !== result.name) && !result.clarify) {
      result.name = cleanedName;
      result.changedFields.push('name');
    }
  }

  // 7. Description discipline - only set with explicit cue
  const descriptionCues = ['description', 'note', 'notes', 'details', 'detail'];
  for (const cue of descriptionCues) {
    const regex = new RegExp(`\\b${cue}[:\\s]+(.+)`, 'i');
    const match = transcription.match(regex);
    if (match) {
      const desc = match[1].trim();
      if (result.description !== desc) {
        result.description = desc;
        result.changedFields.push('description');
      }
      break;
    }
  }

  return result;
}

/**
 * Calculate confidence score for parsed data
 * Returns value between 0 and 1
 */
function calculateParseConfidence(parsedData) {
  let score = 0;
  let maxScore = 5;

  // Required fields
  if (parsedData.name) score += 1;
  if (parsedData.category) score += 1;
  if (parsedData.type) score += 1;

  // Optional but valuable fields
  if (parsedData.price !== null) score += 1;
  if (parsedData.partNumber) score += 0.5;

  // Penalties
  if (parsedData.errors.length > 0) {
    score -= parsedData.errors.length * 0.3;
  }

  const confidence = Math.max(0, Math.min(1, score / maxScore));
  return confidence;
}

// LocalStorage persistence functions
function saveRepairsToLocalStorage() {
  try {
    localStorage.setItem('jerryHVAC_repairs', JSON.stringify(currentRepairs));
    console.log('💾 Saved repairs to localStorage:', currentRepairs.length);
  } catch (error) {
    console.error('Failed to save repairs:', error);
  }
}

function loadRepairsFromLocalStorage() {
  try {
    const saved = localStorage.getItem('jerryHVAC_repairs');
    if (saved) {
      currentRepairs = JSON.parse(saved);
      console.log('📂 Loaded repairs from localStorage:', currentRepairs.length);
      if (currentRepairs.length > 0) {
        renderRepairs();
        resultsSection.classList.add('visible');
      }
    }
  } catch (error) {
    console.error('Failed to load repairs:', error);
    currentRepairs = [];
  }
}

const jobNotesTextarea = document.getElementById('jobNotes');
const submitBtn = document.getElementById('submitBtn');
const statusMessage = document.getElementById('statusMessage');
const resultsSection = document.getElementById('resultsSection');
const transcriptionSection = document.getElementById('transcriptionSection');
const transcriptionText = document.getElementById('transcriptionText');
const repairGrid = document.getElementById('repairGrid');

// Floating input elements
const floatingInputContainer = document.getElementById('floatingInputContainer');
const floatingMic = document.getElementById('floatingMic');
const recordingIndicator = document.getElementById('recordingIndicator');
const keyboardToggle = document.getElementById('keyboardToggle');
const floatingTextInput = document.getElementById('floatingTextInput');
const floatingTextarea = document.getElementById('floatingTextarea');
const floatingSubmit = document.getElementById('floatingSubmit');

// Parts search modal elements
const partsModal = document.getElementById('partsModal');
const closeModal = document.getElementById('closeModal');
const partsSearchInput = document.getElementById('partsSearchInput');
const partsResults = document.getElementById('partsResults');

// Keyboard mode state
let isKeyboardMode = false;

// Load repairs from localStorage and ensure modal is hidden on page load
window.addEventListener('DOMContentLoaded', () => {
  if (partsModal) {
    partsModal.classList.add('hidden');
  }

  // Load saved repairs
  loadRepairsFromLocalStorage();

  // Load lexicon from server
  fetchLexicon();

  // Periodic lexicon refresh (every 5 minutes for hot-reload)
  setInterval(fetchLexicon, 5 * 60 * 1000);
});

// Push-to-talk functionality - context-aware
floatingMic.addEventListener('mousedown', contextAwareStartRecording);
floatingMic.addEventListener('mouseup', contextAwareStopRecording);
floatingMic.addEventListener('mouseleave', (e) => {
  if (isRecording || isModalRecording) contextAwareStopRecording();
});

// Touch support for mobile
floatingMic.addEventListener('touchstart', (e) => {
  e.preventDefault();
  contextAwareStartRecording();
});
floatingMic.addEventListener('touchend', (e) => {
  e.preventDefault();
  contextAwareStopRecording();
});

submitBtn.addEventListener('click', handleSubmit);
closeModal.addEventListener('click', () => hidePartsModal());
partsModal.addEventListener('click', (e) => {
  if (e.target === partsModal) hidePartsModal();
});

// Add Part Modal event listeners
const addPartModal = document.getElementById('addPartModal');
const closeAddPartModalBtn = document.getElementById('closeAddPartModal');
const addPartForm = document.getElementById('addPartForm');
const cancelBtn = document.querySelector('#addPartForm .btn-cancel');

if (closeAddPartModalBtn) {
  closeAddPartModalBtn.addEventListener('click', closeAddPartModal);
}

if (addPartModal) {
  addPartModal.addEventListener('click', (e) => {
    if (e.target === addPartModal) closeAddPartModal();
  });
}

if (cancelBtn) {
  cancelBtn.addEventListener('click', closeAddPartModal);
}

if (addPartForm) {
  addPartForm.addEventListener('submit', handleAddPart);
}

// Toggle transcription viewer
// Compact pill view button - toggles transcript drawer
const pillViewBtn = document.getElementById('pillViewBtn');
if (pillViewBtn) {
  pillViewBtn.addEventListener('click', toggleTranscriptDrawer);
}

// Keyboard toggle functionality
keyboardToggle.addEventListener('click', toggleKeyboardMode);

// Floating submit button
floatingSubmit.addEventListener('click', handleFloatingSubmit);

// Allow Enter+Shift for new line, Enter alone to submit
floatingTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleFloatingSubmit();
  }
});

// Debounced search
let searchTimeout;
partsSearchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  if (query.length > 1) {
    searchTimeout = setTimeout(() => searchParts(query), 300);
  } else {
    partsResults.innerHTML = '';
  }
});

function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message status-${type}`;
  statusMessage.classList.remove('hidden');
}

function hideStatus() {
  statusMessage.classList.add('hidden');
}

function toggleKeyboardMode() {
  isKeyboardMode = !isKeyboardMode;

  if (isKeyboardMode) {
    // Activate keyboard mode
    floatingInputContainer.classList.add('keyboard-mode');
    keyboardToggle.classList.add('active');
    floatingTextInput.classList.remove('hidden');

    // Use setTimeout to ensure transition happens after display change
    setTimeout(() => {
      floatingTextInput.classList.add('visible');
      floatingTextarea.focus();
    }, 10);

    showStatus('Keyboard mode active - Type your notes', 'info');
  } else {
    // Deactivate keyboard mode
    floatingInputContainer.classList.remove('keyboard-mode');
    keyboardToggle.classList.remove('active');
    floatingTextInput.classList.remove('visible');

    setTimeout(() => {
      floatingTextInput.classList.add('hidden');
    }, 300); // Wait for transition to complete

    showStatus('Voice mode active - Hold mic to record', 'info');
  }
}

async function handleFloatingSubmit() {
  const text = floatingTextarea.value.trim();

  if (!text) {
    showStatus('Please enter some text before submitting.', 'error');
    return;
  }

  // Submit the text (same logic as main submit)
  await submitToBackend(null, text);

  // Clear the floating textarea after successful submit
  floatingTextarea.value = '';
}

// Context-aware recording wrappers
function contextAwareStartRecording() {
  // Check if Add Part modal is open
  const addPartModal = document.getElementById('addPartModal');
  const isModalOpen = addPartModal && !addPartModal.classList.contains('hidden');

  console.log('Context-aware start recording:', {
    modalOpen: isModalOpen,
    currentPartToAdd: currentPartToAdd
  });

  if (isModalOpen) {
    // Modal is open - record for part details
    console.log('Starting modal recording for part:', currentPartToAdd);
    startModalRecording();
  } else {
    // Normal repair notes recording
    console.log('Starting normal repair recording');
    startRecording();
  }
}

function contextAwareStopRecording() {
  console.log('Context-aware stop recording:', {
    isModalRecording: isModalRecording,
    isRecording: isRecording
  });

  // Check which type of recording is active
  if (isModalRecording) {
    console.log('Stopping modal recording');
    stopModalRecording();
  } else if (isRecording) {
    console.log('Stopping normal recording');
    stopRecording();
  }
}

async function startRecording() {
  if (isRecording) return; // Already recording

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showStatus('Voice recording is not supported in this browser. Please type your notes instead.', 'error');
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm'
    });

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      await convertAndProcess(audioBlob, true); // true = auto-submit

      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    isRecording = true;

    // Visual feedback
    floatingMic.classList.add('recording');
    recordingIndicator.classList.remove('hidden');

    // Start timer
    recordingStartTime = Date.now();
    recordingTimerInterval = setInterval(updateRecordingTimer, 100);

    showStatus('Recording... Release to send', 'info');

  } catch (error) {
    console.error('Error starting recording:', error);
    showStatus('Could not access microphone. Please check permissions.', 'error');
  }
}

function stopRecording() {
  if (!mediaRecorder || !isRecording) return;

  mediaRecorder.stop();
  isRecording = false;

  // Visual feedback
  floatingMic.classList.remove('recording');
  recordingIndicator.classList.add('hidden');

  // Stop timer
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }

  showStatus('Processing audio...', 'info');
}

function updateRecordingTimer() {
  if (!isRecording || !recordingStartTime) return;

  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const timerElement = recordingIndicator.querySelector('.recording-timer');
  if (timerElement) {
    timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

async function convertAndProcess(audioBlob, autoSubmit = false) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    if (autoSubmit) {
      // Auto-submit: transcribe and parse immediately
      await submitToBackend(base64Audio, null);
    } else {
      // Manual mode: just transcribe (not used anymore but keeping for compatibility)
      await submitToBackend(base64Audio, null);
    }

  } catch (error) {
    console.error('Error converting audio:', error);
    showStatus('Error processing audio. Please try typing your notes instead.', 'error');
  }
}

function audioBufferToWav(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;

  const data = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    data.push(audioBuffer.getChannelData(i));
  }

  const interleaved = interleave(data);
  const dataLength = interleaved.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  floatTo16BitPCM(view, 44, interleaved);

  return new Blob([view], { type: 'audio/wav' });
}

function interleave(channelData) {
  const length = channelData[0].length;
  const result = new Float32Array(length * channelData.length);

  let offset = 0;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < channelData.length; channel++) {
      result[offset++] = channelData[channel][i];
    }
  }

  return result;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handleSubmit() {
  const text = jobNotesTextarea.value.trim();

  if (!text) {
    showStatus('Please enter or record job notes before submitting.', 'error');
    return;
  }

  await submitToBackend(null, text);
}

async function submitToBackend(audio, text) {
  try {
    submitBtn.disabled = true;
    floatingMic.disabled = true;

    const loadingSpinner = document.createElement('span');
    loadingSpinner.className = 'loading-spinner';
    loadingSpinner.id = 'loadingSpinner';
    document.getElementById('submitText').textContent = 'Processing...';
    submitBtn.appendChild(loadingSpinner);

    // Check if we're in conversational command mode
    if (conversationState) {
      // Get the user's response (from text or transcribe audio first)
      let userResponse = text;

      if (audio && !text) {
        // Need to transcribe audio first
        showStatus('Transcribing your answer...', 'info');
        const transcribeResponse = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio })
        });

        if (transcribeResponse.ok) {
          const transcribeData = await transcribeResponse.json();
          userResponse = transcribeData.text;
        } else {
          throw new Error('Failed to transcribe audio');
        }
      }

      // Continue the conversation with the user's answer
      await continueConversationalCommand(userResponse);

      // Clear input
      jobNotesTextarea.value = '';

      submitBtn.disabled = false;
      floatingMic.disabled = false;
      const spinner = document.getElementById('loadingSpinner');
      if (spinner) spinner.remove();
      document.getElementById('submitText').textContent = 'Parse Notes';

      return; // Exit early, we're handling this differently
    }

    // Check if parts modal is open - if so, only transcribe for search
    const isPartsModalOpen = partsModal && !partsModal.classList.contains('hidden');

    if (isPartsModalOpen) {
      showStatus('Transcribing for parts search...', 'info');
    } else {
      showStatus('Processing your notes with AI...', 'info');
    }

    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ audio, text })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to process notes');
    }

    const result = await response.json();

    // If parts modal is open, populate search field instead of adding repairs
    if (isPartsModalOpen) {
      const searchTerm = result.transcription || text || '';
      partsSearchInput.value = searchTerm;
      partsSearchInput.dispatchEvent(new Event('input'));
      showStatus(`Searching for: "${searchTerm}"`, 'success');
    } else {
      displayResults(result);
    }

  } catch (error) {
    console.error('Error submitting:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    floatingMic.disabled = false;

    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.remove();
    document.getElementById('submitText').textContent = 'Parse Notes';
  }
}

function displayResults(result) {
  // Handle conversational messages (chat responses)
  if (result.message_type === 'conversational' && result.response) {
    // Show chat section
    const chatSection = document.getElementById('chatSection');
    const chatHistory = document.getElementById('chatHistory');
    chatSection.classList.add('visible');

    // Add user message
    const userMsg = createChatMessage('user', result.transcription || result.raw_transcription);
    chatHistory.appendChild(userMsg);

    // Add Jerry's response
    const assistantMsg = createChatMessage('assistant', result.response);
    chatHistory.appendChild(assistantMsg);

    // Scroll to bottom
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // Clear the input
    jobNotesTextarea.value = '';

    // Hide parts section if no repairs
    if (!result.repairs || result.repairs.length === 0) {
      resultsSection.classList.remove('visible');
    }

    // Update view toggle
    updateViewToggle();

    showStatus('💬 Response from Jerry', 'success');
    return; // Don't process as parts documentation
  }

  // Handle mixed messages (both chat and parts)
  if (result.message_type === 'mixed' && result.chat_response) {
    const chatSection = document.getElementById('chatSection');
    const chatHistory = document.getElementById('chatHistory');
    chatSection.classList.add('visible');

    // Add user message
    const userMsg = createChatMessage('user', result.transcription || result.raw_transcription);
    chatHistory.appendChild(userMsg);

    // Add Jerry's response
    const assistantMsg = createChatMessage('assistant', result.chat_response);
    chatHistory.appendChild(assistantMsg);

    // Scroll to bottom
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // Continue to show parts below
    // View toggle will be updated at the end when both sections are ready
  }

  // Handle voice commands (add part/term) differently
  if (result.command_type === 'add_part' || result.command_type === 'add_term') {
    const commandName = result.command_type === 'add_part' ? 'Part' : 'Term';

    // Check if we need more information (conversational mode)
    if (result.needs_more_info) {
      // Enter conversation mode
      conversationState = {
        type: result.command_type,
        data: result.partial_data || {},
        missingFields: result.missing_fields || [],
        rawCommand: result.raw_transcription
      };

      showConversationalPrompt();
      return; // Wait for user's next response
    }

    if (result.success) {
      showStatus(`✅ ${result.message}`, 'success');

      // Show confirmation in transcription area
      transcriptionText.textContent = `Voice Command: ${result.raw_transcription}`;
      transcriptionSection.classList.remove('hidden');

      // Show what was added as a "repair" card for visual feedback
      const successCard = document.createElement('div');
      successCard.className = 'repair-card';
      successCard.style.borderColor = '#10b981';
      successCard.innerHTML = `
        <div class="equipment-badge" style="background: #10b981;">✅ ${commandName} Added</div>
        <div class="problem" style="margin-top: 12px;">${result.message}</div>
        <div class="section">
          <div class="section-title">What You Said</div>
          <p style="color: #6b7280; font-style: italic;">"${result.raw_transcription}"</p>
        </div>
        ${result.part ? `
          <div class="section">
            <div class="section-title">Part Details</div>
            <p><strong>Part Number:</strong> ${result.part.part_number}</p>
            <p><strong>Category:</strong> ${result.part.category}</p>
            <p><strong>Price:</strong> $${parseFloat(result.part.price).toFixed(2)}</p>
          </div>
        ` : ''}
        ${result.term ? `
          <div class="section">
            <div class="section-title">Term Details</div>
            <p><strong>Standard Term:</strong> ${result.term.standard_term}</p>
            <p><strong>Category:</strong> ${result.term.category}</p>
            <p><strong>Variations:</strong> ${result.term.variations.length} variation(s)</p>
          </div>
        ` : ''}
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
          <button class="btn-primary" onclick="window.location.href='${result.command_type === 'add_part' ? '/manage-parts.html' : '/admin.html'}'" style="background: #10b981;">
            View in ${result.command_type === 'add_part' ? 'Parts' : 'Terms'} Manager
          </button>
        </div>
      `;

      repairGrid.innerHTML = '';
      repairGrid.appendChild(successCard);
      resultsSection.classList.add('visible');

      // Clear the input
      jobNotesTextarea.value = '';

    } else {
      showStatus(`❌ ${result.message}`, 'error');

      // Show error details
      transcriptionText.textContent = `Failed Command: ${result.raw_transcription}`;
      transcriptionSection.classList.remove('hidden');

      const errorCard = document.createElement('div');
      errorCard.className = 'repair-card';
      errorCard.style.borderColor = '#ef4444';
      errorCard.innerHTML = `
        <div class="equipment-badge" style="background: #ef4444;">❌ ${commandName} Failed</div>
        <div class="problem" style="margin-top: 12px; color: #ef4444;">${result.message}</div>
        <div class="section">
          <div class="section-title">What You Said</div>
          <p style="color: #6b7280; font-style: italic;">"${result.raw_transcription}"</p>
        </div>
        <div class="section">
          <div class="section-title">Tips for Voice Commands</div>
          <ul style="margin-left: 20px; color: #6b7280; font-size: 0.9rem;">
            ${result.command_type === 'add_part' ? `
              <li>Say "Add new part" followed by the part name</li>
              <li>Include the price: "costs $45" or "about thirty dollars"</li>
              <li>Optional: Mention category (electrical, refrigerant, etc.)</li>
              <li>Example: "Add new part, Honeywell damper actuator, $45, electrical"</li>
            ` : `
              <li>Say "Add new term" followed by the term name</li>
              <li>Include the category (refrigerant, equipment, etc.)</li>
              <li>Optional: List variations: "variations are R22, R 22"</li>
              <li>Example: "Add new term, R-22, refrigerant, also called twenty-two"</li>
            `}
          </ul>
        </div>
      `;

      repairGrid.innerHTML = '';
      repairGrid.appendChild(errorCard);
      resultsSection.classList.add('visible');
    }

    return; // Exit early, don't process as normal repair
  }

  // Store both raw and normalized transcription for context
  if (result.transcription && result.transcription !== jobNotesTextarea.value.trim()) {
    const hasRawText = result.raw_transcription && result.raw_transcription !== result.transcription;

    // Clear any existing raw text toggle
    const existingToggle = transcriptionSection.querySelector('.raw-text-toggle');
    if (existingToggle) existingToggle.remove();

    const existingRawText = transcriptionSection.querySelector('.raw-text-display');
    if (existingRawText) existingRawText.remove();

    // Show normalized text
    transcriptionText.textContent = result.transcription;
    transcriptionSection.classList.remove('hidden');

    // Add toggle button for raw text if they differ
    if (hasRawText) {
      const toggleButton = document.createElement('button');
      toggleButton.className = 'raw-text-toggle';
      toggleButton.textContent = '👁️ View Raw Text';
      toggleButton.style.cssText = `
        background: #6366f1;
        color: white;
        border: none;
        padding: 6px 14px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 600;
        margin-top: 8px;
        transition: all 0.2s;
      `;
      toggleButton.addEventListener('mouseover', () => {
        toggleButton.style.background = '#4f46e5';
      });
      toggleButton.addEventListener('mouseout', () => {
        toggleButton.style.background = '#6366f1';
      });

      // Create raw text display (hidden by default)
      const rawTextDisplay = document.createElement('div');
      rawTextDisplay.className = 'raw-text-display';
      rawTextDisplay.style.cssText = `
        display: none;
        background: #f3f4f6;
        border: 2px solid #9ca3af;
        border-radius: 8px;
        padding: 12px;
        margin-top: 8px;
        font-family: monospace;
        font-size: 0.9rem;
        color: #374151;
        white-space: pre-wrap;
        word-wrap: break-word;
      `;
      rawTextDisplay.innerHTML = `<strong style="color: #6366f1;">Raw Whisper Transcription:</strong><br>${result.raw_transcription}`;

      // Toggle functionality
      let isRawVisible = false;
      toggleButton.addEventListener('click', () => {
        isRawVisible = !isRawVisible;
        if (isRawVisible) {
          rawTextDisplay.style.display = 'block';
          toggleButton.textContent = '👁️ Hide Raw Text';
        } else {
          rawTextDisplay.style.display = 'none';
          toggleButton.textContent = '👁️ View Raw Text';
        }
      });

      transcriptionSection.appendChild(toggleButton);
      transcriptionSection.appendChild(rawTextDisplay);
    }
  } else {
    transcriptionSection.classList.add('hidden');
  }

  if (result.repairs && result.repairs.length > 0) {
    // Store raw transcription with each repair for context
    const repairsWithContext = result.repairs.map(repair => {
      // Convert string parts to chip objects
      let partsChips = repair.parts || [];
      if (Array.isArray(partsChips)) {
        partsChips = partsChips.map(part => {
          // If already an object, keep it; otherwise convert string to chip
          if (typeof part === 'string') {
            return stringToChip(part);
          }
          return part;
        });
      }

      return {
        ...repair,
        parts: partsChips,
        raw_transcription: result.raw_transcription,
        normalized_transcription: result.transcription
      };
    });

    // APPEND new repairs to existing ones instead of replacing
    currentRepairs.push(...repairsWithContext);
    saveRepairsToLocalStorage(); // Persist to localStorage
    renderRepairs();

    resultsSection.classList.add('visible');

    // Update view toggle (in case both chat and repairs exist)
    updateViewToggle();

    setTimeout(() => {
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    // Clear the input after successful parse
    jobNotesTextarea.value = '';

    showStatus(`Added ${result.repairs.length} new repair(s)! Total: ${currentRepairs.length}`, 'success');
  } else {
    showStatus('No repairs were identified in the notes.', 'error');
  }

  // Show terminology suggestions if any
  if (result.suggestions && result.suggestions.length > 0) {
    showTerminologySuggestions(result.suggestions);
  }

  // Show new term suggestions (add to glossary)
  if (result.newTerms && result.newTerms.length > 0) {
    showNewTermSuggestions(result.newTerms);
  }

  // Show new part suggestions (add to parts catalog)
  // DISABLED: User prefers to use blue indicators in repair cards instead
  // if (result.newParts && result.newParts.length > 0) {
  //   showNewPartSuggestions(result.newParts);
  // }
}

// Show conversational prompt for missing fields
function showConversationalPrompt() {
  if (!conversationState || conversationState.missingFields.length === 0) {
    conversationState = null;
    return;
  }

  const nextField = conversationState.missingFields[0];
  const commandName = conversationState.type === 'add_part' ? 'Part' : 'Term';

  // Create friendly prompts for each field
  const prompts = {
    add_part: {
      name: "What's the name of the part?",
      price: "What's the price? (e.g., '$45' or 'forty-five dollars')",
      category: "What category? (electrical, refrigerant, controls, filters, supplies, or other)",
      type: "Is it consumable or inventory?",
      brand: "What's the brand? (e.g., 'Honeywell', 'Carrier', 'Trane') - say 'skip' if not applicable",
      vendor: "What vendor do you buy it from? (e.g., 'Johnstone', 'Ferguson') - say 'skip' if not applicable",
      vendor_part_number: "What's the vendor part number? - say 'skip' if you don't know",
      manufacturer_part_number: "What's the manufacturer part number? - say 'skip' if you don't know"
    },
    add_term: {
      standard_term: "What's the standard term you want to add?",
      category: "What category? (refrigerant, equipment, voltage, measurement, part_type, action, brand, or other)",
      variations: "What are some variations? (optional - just say 'none' to skip)"
    }
  };

  const prompt = prompts[conversationState.type][nextField] || `What's the ${nextField}?`;

  // Show big, obvious prompt
  showStatus(`📣 ${prompt}`, 'info');

  // Also show in transcription area
  transcriptionText.innerHTML = `
    <div style="font-size: 1.1rem; font-weight: 600; color: #667eea; margin-bottom: 8px;">
      Adding ${commandName}: Step ${Object.keys(conversationState.data).length + 1}
    </div>
    <div style="font-size: 1.3rem; color: #1f2937;">
      ${prompt}
    </div>
    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 0.9rem;">
      💡 Tip: Just speak your answer, or type it and press "Parse Notes"
    </div>
  `;
  transcriptionSection.classList.remove('hidden');

  // Show what we've collected so far
  const dataCard = document.createElement('div');
  dataCard.className = 'repair-card';
  dataCard.style.borderColor = '#667eea';
  dataCard.innerHTML = `
    <div class="equipment-badge" style="background: #667eea;">Adding ${commandName}</div>
    <div class="section" style="margin-top: 12px;">
      <div class="section-title">Information Collected</div>
      ${Object.keys(conversationState.data).length > 0 ?
        Object.entries(conversationState.data)
          .map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`)
          .join('')
        : '<p style="color: #6b7280; font-style: italic;">No information yet</p>'
      }
    </div>
    <div class="section">
      <div class="section-title">Still Need</div>
      <ul style="margin-left: 20px; color: #6b7280;">
        ${conversationState.missingFields.map((field, idx) =>
          `<li style="${idx === 0 ? 'font-weight: 600; color: #667eea;' : ''}">${field}${idx === 0 ? ' ← answering now' : ''}</li>`
        ).join('')}
      </ul>
    </div>
  `;

  repairGrid.innerHTML = '';
  repairGrid.appendChild(dataCard);
  resultsSection.classList.add('visible');

  // Focus the input
  jobNotesTextarea.focus();
  jobNotesTextarea.placeholder = `Say or type your answer...`;
}

// Handle continuing a conversational command
async function continueConversationalCommand(userResponse) {
  if (!conversationState) return;

  const nextField = conversationState.missingFields[0];

  showStatus('Processing your answer...', 'info');

  try {
    const response = await fetch('/api/continue-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: conversationState.type,
        currentData: conversationState.data,
        fieldToFill: nextField,
        userResponse: userResponse
      })
    });

    if (!response.ok) {
      throw new Error('Failed to process your answer');
    }

    const result = await response.json();

    // Update conversation state with the new data
    if (result.needs_more_info) {
      conversationState.data = result.partial_data;
      conversationState.missingFields = result.missing_fields;
      showConversationalPrompt();
    } else if (result.success) {
      // Command complete!
      conversationState = null;
      jobNotesTextarea.placeholder = 'Type or record your repair notes here... e.g., "RTU-1 low on charge needs 4 pounds 410A, economizer damper actuator is broken"';
      displayResults(result);
    } else {
      // Error
      showStatus(`❌ ${result.message}`, 'error');
      conversationState = null;
    }

  } catch (error) {
    console.error('Error continuing command:', error);
    showStatus(`Error: ${error.message}`, 'error');
    conversationState = null;
  }
}

function showTerminologySuggestions(suggestions) {
  // Remove any existing suggestion UI
  const existingSuggestions = document.getElementById('terminologySuggestions');
  if (existingSuggestions) {
    existingSuggestions.remove();
  }

  const suggestionsContainer = document.createElement('div');
  suggestionsContainer.id = 'terminologySuggestions';
  suggestionsContainer.style.cssText = `
    background: #eff6ff;
    border: 2px solid #3b82f6;
    border-radius: 12px;
    padding: 16px;
    margin: 16px 0;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
  `;

  const title = document.createElement('h3');
  title.textContent = '🤔 Terminology Confirmation';
  title.style.cssText = `
    color: #1e40af;
    margin: 0 0 12px 0;
    font-size: 1.1rem;
  `;
  suggestionsContainer.appendChild(title);

  const description = document.createElement('p');
  description.textContent = 'I wasn\'t completely sure about these terms. Please confirm:';
  description.style.cssText = `
    color: #1e40af;
    margin: 0 0 12px 0;
    font-size: 0.9rem;
  `;
  suggestionsContainer.appendChild(description);

  // Track recording state for corrections
  const correctionRecorders = {};

  suggestions.forEach((suggestion, index) => {
    const suggestionItem = document.createElement('div');
    suggestionItem.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      border-left: 4px solid #3b82f6;
    `;

    const confidencePercent = Math.round(suggestion.confidence * 100);

    suggestionItem.innerHTML = `
      <div style="margin-bottom: 8px;">
        <strong style="color: #1f2937;">I heard:</strong> "<span style="color: #ef4444;">${suggestion.original}</span>"<br>
        <strong style="color: #1f2937;">Did you mean:</strong> "<span style="color: #10b981;">${suggestion.suggested}</span>"?
        <span style="background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px;">${confidencePercent}% match</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="btn-confirm-yes" data-index="${index}" style="background: #10b981; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem;">
          ✓ Yes, correct
        </button>
        <button class="btn-confirm-no" data-index="${index}" style="background: #6b7280; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem; transition: all 0.2s; user-select: none;">
          🎤 Hold to say correction
        </button>
        <div class="recording-status" data-index="${index}" style="display: none; color: #ef4444; font-weight: 600; font-size: 0.9rem;">
          🔴 Recording... <span class="timer">0:00</span>
        </div>
      </div>
    `;

    suggestionsContainer.appendChild(suggestionItem);
  });

  // Add event listeners
  suggestionsContainer.querySelectorAll('.btn-confirm-yes').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.target.dataset.index);
      const suggestion = suggestions[index];

      await confirmTerminology(suggestion.original, suggestion.suggested, suggestion.category);

      // Remove this suggestion from the UI
      e.target.closest('div[style*="background: white"]').remove();

      // If no more suggestions, remove the container
      if (suggestionsContainer.querySelectorAll('.btn-confirm-yes').length === 0) {
        suggestionsContainer.remove();
      }
    });
  });

  // Push-to-talk for corrections
  suggestionsContainer.querySelectorAll('.btn-confirm-no').forEach(btn => {
    const index = parseInt(btn.dataset.index);
    const suggestion = suggestions[index];
    const recordingStatus = suggestionsContainer.querySelector(`.recording-status[data-index="${index}"]`);
    const timerElement = recordingStatus.querySelector('.timer');

    let isRecordingCorrection = false;
    let recordingStartTime = null;
    let timerInterval = null;

    const startCorrectionRecording = async () => {
      if (isRecordingCorrection) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        correctionRecorders[index] = {
          mediaRecorder: new MediaRecorder(stream, { mimeType: 'audio/webm' }),
          audioChunks: [],
          stream
        };

        const recorder = correctionRecorders[index];

        recorder.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recorder.audioChunks.push(event.data);
          }
        };

        recorder.mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(recorder.audioChunks, { type: 'audio/webm' });
          await processCorrectionAudio(audioBlob, suggestion, index);

          stream.getTracks().forEach(track => track.stop());
          delete correctionRecorders[index];
        };

        recorder.mediaRecorder.start();
        isRecordingCorrection = true;

        // Visual feedback
        btn.style.background = '#ef4444';
        btn.textContent = '🔴 Recording...';
        recordingStatus.style.display = 'block';

        // Timer
        recordingStartTime = Date.now();
        timerInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 100);

        showStatus('Recording correction... Release button when done', 'info');

      } catch (error) {
        console.error('Error starting correction recording:', error);
        showStatus('Could not access microphone', 'error');
      }
    };

    const stopCorrectionRecording = () => {
      if (!isRecordingCorrection || !correctionRecorders[index]) return;

      correctionRecorders[index].mediaRecorder.stop();
      isRecordingCorrection = false;

      // Reset visual feedback
      btn.style.background = '#6b7280';
      btn.textContent = '🎤 Hold to say correction';
      recordingStatus.style.display = 'none';

      // Clear timer
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      showStatus('Processing correction...', 'info');
    };

    // Mouse events
    btn.addEventListener('mousedown', startCorrectionRecording);
    btn.addEventListener('mouseup', stopCorrectionRecording);
    btn.addEventListener('mouseleave', () => {
      if (isRecordingCorrection) stopCorrectionRecording();
    });

    // Touch events for mobile
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startCorrectionRecording();
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopCorrectionRecording();
    });
  });

  // Insert before results section
  const container = document.querySelector('.container');
  const resultsSection = document.getElementById('resultsSection');
  container.insertBefore(suggestionsContainer, resultsSection);

  // Scroll to suggestions
  setTimeout(() => {
    suggestionsContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

async function processCorrectionAudio(audioBlob, suggestion, index) {
  try {
    // Convert webm to wav and base64
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    // Transcribe the correction
    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64Audio, text: null })
    });

    if (!response.ok) {
      throw new Error('Failed to transcribe correction');
    }

    const result = await response.json();
    const corrected = result.transcription.trim();

    if (!corrected) {
      showStatus('No correction detected. Please try again.', 'error');
      return;
    }

    // Save the correction
    await confirmTerminology(suggestion.original, corrected, suggestion.category);

    // Remove this suggestion from the UI
    const suggestionElement = document.querySelector(`.btn-confirm-no[data-index="${index}"]`);
    if (suggestionElement) {
      suggestionElement.closest('div[style*="background: white"]').remove();
    }

    // If no more suggestions, remove the container
    const container = document.getElementById('terminologySuggestions');
    if (container && container.querySelectorAll('.btn-confirm-yes').length === 0) {
      container.remove();
    }

  } catch (error) {
    console.error('Error processing correction:', error);
    showStatus(`Error processing correction: ${error.message}`, 'error');
  }
}

async function confirmTerminology(original, corrected, category) {
  try {
    const response = await fetch('/api/terminology/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original, corrected, category })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to save terminology');
    }

    showStatus(`✓ Saved: "${original}" → "${corrected}"`, 'success');

  } catch (error) {
    console.error('Error confirming terminology:', error);
    showStatus(`Error saving terminology: ${error.message}`, 'error');
  }
}

function showNewTermSuggestions(newTerms) {
  // Remove any existing new term UI
  const existingNewTerms = document.getElementById('newTermSuggestions');
  if (existingNewTerms) {
    existingNewTerms.remove();
  }

  const container = document.createElement('div');
  container.id = 'newTermSuggestions';
  container.style.cssText = `
    background: #f0fdf4;
    border: 2px solid #10b981;
    border-radius: 12px;
    padding: 16px;
    margin: 16px 0;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
  `;

  const title = document.createElement('h3');
  title.textContent = '💡 Add to Glossary?';
  title.style.cssText = `
    color: #065f46;
    margin: 0 0 12px 0;
    font-size: 1.1rem;
  `;
  container.appendChild(title);

  const description = document.createElement('p');
  description.textContent = 'I noticed these technical terms that aren\'t in the glossary yet:';
  description.style.cssText = `
    color: #065f46;
    margin: 0 0 12px 0;
    font-size: 0.9rem;
  `;
  container.appendChild(description);

  const newTermRecorders = {};

  newTerms.forEach((termInfo, index) => {
    const termItem = document.createElement('div');
    termItem.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      border-left: 4px solid #10b981;
    `;

    termItem.innerHTML = `
      <div style="margin-bottom: 8px;">
        <strong style="color: #1f2937;">Detected:</strong> "<span style="color: #10b981; font-weight: 600;">${termInfo.phrase}</span>"
        ${termInfo.bestMatch ? `<br><small style="color: #6b7280;">Closest match: ${termInfo.bestMatch} (${Math.round(termInfo.similarity * 100)}%)</small>` : ''}
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="btn-add-term-yes" data-index="${index}" style="background: #10b981; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem; transition: all 0.2s; user-select: none;">
          🎤 Hold to confirm
        </button>
        <button class="btn-add-term-no" data-index="${index}" style="background: #6b7280; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem;">
          ✗ Skip
        </button>
        <div class="new-term-recording-status" data-index="${index}" style="display: none; color: #10b981; font-weight: 600; font-size: 0.9rem;">
          🔴 Recording... <span class="timer">0:00</span>
        </div>
      </div>
    `;

    container.appendChild(termItem);
  });

  // Add skip listeners
  container.querySelectorAll('.btn-add-term-no').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('div[style*="background: white"]').remove();
      if (container.querySelectorAll('.btn-add-term-yes').length === 0) {
        container.remove();
      }
    });
  });

  // Add voice recording listeners for confirm
  container.querySelectorAll('.btn-add-term-yes').forEach(btn => {
    const index = parseInt(btn.dataset.index);
    const termInfo = newTerms[index];
    const recordingStatus = container.querySelector(`.new-term-recording-status[data-index="${index}"]`);
    const timerElement = recordingStatus.querySelector('.timer');

    let isRecordingNewTerm = false;
    let recordingStartTime = null;
    let timerInterval = null;

    const startNewTermRecording = async () => {
      if (isRecordingNewTerm) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        newTermRecorders[index] = {
          mediaRecorder: new MediaRecorder(stream, { mimeType: 'audio/webm' }),
          audioChunks: [],
          stream
        };

        const recorder = newTermRecorders[index];

        recorder.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recorder.audioChunks.push(event.data);
          }
        };

        recorder.mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(recorder.audioChunks, { type: 'audio/webm' });
          await processNewTermAudio(audioBlob, termInfo, index);

          stream.getTracks().forEach(track => track.stop());
          delete newTermRecorders[index];
        };

        recorder.mediaRecorder.start();
        isRecordingNewTerm = true;

        btn.style.background = '#ef4444';
        btn.textContent = '🔴 Recording...';
        recordingStatus.style.display = 'block';

        recordingStartTime = Date.now();
        timerInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 100);

        showStatus('Recording new term... Release when done', 'info');

      } catch (error) {
        console.error('Error starting recording:', error);
        showStatus('Could not access microphone', 'error');
      }
    };

    const stopNewTermRecording = () => {
      if (!isRecordingNewTerm || !newTermRecorders[index]) return;

      newTermRecorders[index].mediaRecorder.stop();
      isRecordingNewTerm = false;

      btn.style.background = '#10b981';
      btn.textContent = '🎤 Hold to confirm';
      recordingStatus.style.display = 'none';

      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      showStatus('Processing new term...', 'info');
    };

    btn.addEventListener('mousedown', startNewTermRecording);
    btn.addEventListener('mouseup', stopNewTermRecording);
    btn.addEventListener('mouseleave', () => {
      if (isRecordingNewTerm) stopNewTermRecording();
    });

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startNewTermRecording();
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopNewTermRecording();
    });
  });

  const mainContainer = document.querySelector('.container');
  const resultsSection = document.getElementById('resultsSection');
  mainContainer.insertBefore(container, resultsSection);

  setTimeout(() => {
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

// Show new part suggestions (add to parts catalog)
function showNewPartSuggestions(newParts) {
  // Remove any existing new parts UI
  const existingNewParts = document.getElementById('newPartSuggestions');
  if (existingNewParts) {
    existingNewParts.remove();
  }

  const container = document.createElement('div');
  container.id = 'newPartSuggestions';
  container.style.cssText = `
    background: #eff6ff;
    border: 2px solid #3b82f6;
    border-radius: 12px;
    padding: 16px;
    margin: 16px 0;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
  `;

  const title = document.createElement('h3');
  title.textContent = '📦 Add to Parts Catalog?';
  title.style.cssText = `
    color: #1e40af;
    margin: 0 0 12px 0;
    font-size: 1.1rem;
  `;
  container.appendChild(title);

  const description = document.createElement('p');
  description.textContent = 'I noticed these parts that aren\'t in the catalog yet:';
  description.style.cssText = `
    color: #1e40af;
    margin: 0 0 12px 0;
    font-size: 0.9rem;
  `;
  container.appendChild(description);

  newParts.forEach((partInfo) => {
    const partItem = document.createElement('div');
    partItem.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      border-left: 4px solid #3b82f6;
    `;

    partItem.innerHTML = `
      <div style="margin-bottom: 8px;">
        <strong style="color: #1f2937;">Detected:</strong> "<span style="color: #3b82f6; font-weight: 600;">${partInfo.phrase}</span>"
        ${partInfo.bestMatch ? `<br><small style="color: #6b7280;">Closest match: ${partInfo.bestMatch} (${Math.round(partInfo.similarity * 100)}%)</small>` : ''}
        ${partInfo.quantity > 1 ? `<br><small style="color: #6b7280;">Quantity: ${partInfo.quantity}</small>` : ''}
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="btn-add-part-yes" style="background: #3b82f6; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem; transition: all 0.2s;">
          ✓ Add to Catalog
        </button>
        <button class="btn-add-part-no" style="background: #6b7280; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem;">
          ✗ Skip
        </button>
      </div>
    `;

    container.appendChild(partItem);

    // Add event listeners
    const yesBtn = partItem.querySelector('.btn-add-part-yes');
    const noBtn = partItem.querySelector('.btn-add-part-no');

    yesBtn.addEventListener('click', () => {
      // Start conversational prompt for this part
      conversationState = {
        type: 'add_part',
        data: {
          name: partInfo.phrase // Pre-fill the name
        },
        missingFields: ['price'], // Still need price at minimum
        rawCommand: `Add part from suggestion: ${partInfo.phrase}`
      };

      // Remove all suggestion UIs
      container.remove();

      // Show the conversational prompt
      showConversationalPrompt();
    });

    noBtn.addEventListener('click', () => {
      partItem.remove();
      if (container.querySelectorAll('.btn-add-part-yes').length === 0) {
        container.remove();
      }
    });
  });

  // Insert after any new term suggestions or at the end of results
  const existingTermSuggestions = document.getElementById('newTermSuggestions');
  if (existingTermSuggestions) {
    existingTermSuggestions.after(container);
  } else {
    resultsSection.appendChild(container);
  }
}

async function processNewTermAudio(audioBlob, termInfo, index) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64Audio, text: null })
    });

    if (!response.ok) {
      throw new Error('Failed to transcribe');
    }

    const result = await response.json();
    const confirmed = result.transcription.trim();

    if (!confirmed) {
      showStatus('No term detected. Please try again.', 'error');
      return;
    }

    // Add to glossary
    await fetch('/api/terminology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        standard_term: confirmed,
        category: 'part_type', // Default category
        variations: [termInfo.phrase],
        description: `Auto-detected from user input`
      })
    });

    showStatus(`✓ Added "${confirmed}" to glossary!`, 'success');

    const termElement = document.querySelector(`.btn-add-term-yes[data-index="${index}"]`);
    if (termElement) {
      termElement.closest('div[style*="background: white"]').remove();
    }

    const newTermContainer = document.getElementById('newTermSuggestions');
    if (newTermContainer && newTermContainer.querySelectorAll('.btn-add-term-yes').length === 0) {
      newTermContainer.remove();
    }

  } catch (error) {
    console.error('Error processing new term:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

async function renderRepairs() {
  repairGrid.innerHTML = '';

  // Check all parts against database
  await checkPartsInDatabase();

  currentRepairs.forEach((repair, index) => {
    const repairCard = createRepairCard(repair, index);
    repairGrid.appendChild(repairCard);
  });

  // Add "Add New Repair" button at the end
  const addButton = document.createElement('button');
  addButton.className = 'btn-primary';
  addButton.style.marginTop = '16px';
  addButton.innerHTML = '<span>+ Add New Repair</span>';
  addButton.addEventListener('click', () => addNewRepair());
  repairGrid.appendChild(addButton);

  // Add or update "Submit Final Repairs" button
  let submitFinalBtn = document.getElementById('submitFinalBtn');
  if (!submitFinalBtn) {
    submitFinalBtn = document.createElement('button');
    submitFinalBtn.id = 'submitFinalBtn';
    submitFinalBtn.className = 'btn-secondary';
    submitFinalBtn.style.marginTop = '16px';
    submitFinalBtn.style.width = '100%';
    submitFinalBtn.innerHTML = '<span>✓ Submit Final Repairs</span>';
    submitFinalBtn.addEventListener('click', submitFinalRepairs);
    repairGrid.appendChild(submitFinalBtn);
  }
}

async function checkPartsInDatabase() {
  // Collect all unique lookupKeys from all repairs
  const allLookupKeys = new Set();
  currentRepairs.forEach(repair => {
    if (repair.parts && repair.parts.length > 0) {
      repair.parts.forEach(part => {
        // Handle both old string format and new chip object format
        if (typeof part === 'string') {
          // Convert to chip first
          const chip = stringToChip(part);
          allLookupKeys.add(chip.lookupKey);
        } else if (part && part.lookupKey) {
          allLookupKeys.add(part.lookupKey);
        }
      });
    }
  });

  if (allLookupKeys.size === 0) return;

  try {
    const response = await fetch('/api/parts/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ parts: Array.from(allLookupKeys) })
    });

    if (response.ok) {
      const data = await response.json();
      partsStatus = {};
      data.results.forEach(result => {
        // Store by lookupKey (normalized) instead of raw string
        partsStatus[result.part] = result.exists;
      });
    }
  } catch (error) {
    console.error('Error checking parts:', error);
  }
}

function createRepairCard(repair, index) {
  const card = document.createElement('div');
  card.className = 'repair-card';
  card.dataset.index = index;

  const header = document.createElement('div');
  header.className = 'repair-header';

  const badge = document.createElement('div');
  badge.className = 'equipment-badge';
  badge.textContent = repair.equipment || `Item ${index + 1}`;

  const buttonGroup = document.createElement('div');
  buttonGroup.style.display = 'flex';
  buttonGroup.style.gap = '8px';

  const searchPartsBtn = document.createElement('button');
  searchPartsBtn.className = 'btn-primary';
  searchPartsBtn.style.fontSize = '0.85rem';
  searchPartsBtn.style.padding = '6px 12px';
  searchPartsBtn.style.minWidth = 'auto';
  searchPartsBtn.innerHTML = '🔍 Parts';
  searchPartsBtn.addEventListener('click', () => showPartsModal(index));

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-edit';
  editBtn.innerHTML = '✏️ Edit';
  editBtn.addEventListener('click', () => editRepair(index));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-delete';
  deleteBtn.innerHTML = '🗑️ Delete';
  deleteBtn.addEventListener('click', () => deleteRepair(index));

  buttonGroup.appendChild(searchPartsBtn);
  buttonGroup.appendChild(editBtn);
  buttonGroup.appendChild(deleteBtn);

  header.appendChild(badge);
  header.appendChild(buttonGroup);
  card.appendChild(header);

  const problem = document.createElement('div');
  problem.className = 'problem';
  problem.textContent = repair.problem || 'No problem description';
  card.appendChild(problem);

  if (repair.parts && repair.parts.length > 0) {
    const partsSection = document.createElement('div');
    partsSection.className = 'section';

    const partsTitle = document.createElement('div');
    partsTitle.className = 'section-title';
    partsTitle.textContent = 'Parts Needed';
    partsSection.appendChild(partsTitle);

    const partsList = document.createElement('div');
    partsList.className = 'list-items';
    repair.parts.forEach(part => {
      // Handle both old string format and new chip object format
      let chip;
      if (typeof part === 'string') {
        chip = stringToChip(part);
      } else {
        chip = part;
      }

      const partWrapper = document.createElement('div');
      partWrapper.className = 'part-item-wrapper';

      const partItem = document.createElement('span');
      partItem.className = 'list-item';

      // Check if part is in database using lookupKey
      const isInDatabase = partsStatus[chip.lookupKey];
      if (isInDatabase === false) {
        partItem.classList.add('part-not-in-database');
      }

      // Display with quantity (e.g., "4 × 600V 30A fuse")
      const displayText = chip.quantity > 1
        ? `${chip.quantity} × ${chip.name}`
        : chip.name;
      partItem.textContent = displayText;
      partWrapper.appendChild(partItem);

      // Add "Not in DB" badge and button if part is not in database
      if (isInDatabase === false) {
        const badge = document.createElement('span');
        badge.className = 'not-in-db-badge';
        badge.textContent = 'Not in DB';
        partWrapper.appendChild(badge);

        const addBtn = document.createElement('button');
        addBtn.className = 'add-part-btn';
        addBtn.textContent = '+ Add';
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openAddPartModal(chip);
        });
        partWrapper.appendChild(addBtn);
      }

      partsList.appendChild(partWrapper);
    });

    partsSection.appendChild(partsList);
    card.appendChild(partsSection);
  }

  if (repair.actions && repair.actions.length > 0) {
    const actionsSection = document.createElement('div');
    actionsSection.className = 'section';

    const actionsTitle = document.createElement('div');
    actionsTitle.className = 'section-title';
    actionsTitle.textContent = 'Actions';
    actionsSection.appendChild(actionsTitle);

    const actionsList = document.createElement('div');
    actionsList.className = 'list-items';
    repair.actions.forEach(action => {
      const actionItem = document.createElement('span');
      actionItem.className = 'list-item';
      actionItem.textContent = action;
      actionsList.appendChild(actionItem);
    });

    actionsSection.appendChild(actionsList);
    card.appendChild(actionsSection);
  }

  // Display selected parts from database
  if (repair.selectedParts && repair.selectedParts.length > 0) {
    const selectedPartsSection = document.createElement('div');
    selectedPartsSection.className = 'section';
    selectedPartsSection.style.marginTop = '16px';
    selectedPartsSection.style.padding = '12px';
    selectedPartsSection.style.background = '#f0fdf4';
    selectedPartsSection.style.borderRadius = '8px';
    selectedPartsSection.style.border = '2px solid #10b981';

    const hasAutoMatched = repair.selectedParts.some(p => p.auto_matched);
    const selectedPartsTitle = document.createElement('div');
    selectedPartsTitle.className = 'section-title';
    selectedPartsTitle.textContent = hasAutoMatched ? '🤖 AI Auto-Matched Parts' : '✓ Selected Parts from Catalog';
    selectedPartsTitle.style.color = '#10b981';
    selectedPartsSection.appendChild(selectedPartsTitle);

    repair.selectedParts.forEach(part => {
      const partCard = document.createElement('div');
      partCard.style.display = 'flex';
      partCard.style.justifyContent = 'space-between';
      partCard.style.alignItems = 'center';
      partCard.style.padding = '8px';
      partCard.style.background = 'white';
      partCard.style.borderRadius = '6px';
      partCard.style.marginTop = '8px';

      const partInfo = document.createElement('div');
      partInfo.style.flex = '1';

      const typeBadge = document.createElement('span');
      typeBadge.className = part.type === 'consumable' ? 'part-type-consumable' : 'part-type-inventory';
      typeBadge.textContent = part.type === 'consumable' ? 'Consumable' : 'Inventory';
      typeBadge.style.fontSize = '0.7rem';
      typeBadge.style.marginLeft = '8px';

      // Add auto-matched badge if applicable
      let autoMatchBadge = '';
      if (part.auto_matched) {
        const confidence = Math.round(part.match_confidence * 100);
        autoMatchBadge = `<span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 8px;" title="Auto-matched from: ${part.original_text}">🤖 ${confidence}%</span>`;
      }

      partInfo.innerHTML = `<strong>${part.name}</strong> ${typeBadge.outerHTML}${autoMatchBadge}<br>`;

      // Price display
      const priceSpan = document.createElement('span');
      priceSpan.style.fontSize = '0.85rem';
      priceSpan.style.color = '#10b981';
      priceSpan.style.marginRight = '8px';
      priceSpan.textContent = `$${parseFloat(part.price).toFixed(2)} ×`;
      partInfo.appendChild(priceSpan);

      // Quantity controls container
      const qtyControls = document.createElement('span');
      qtyControls.style.display = 'inline-flex';
      qtyControls.style.alignItems = 'center';
      qtyControls.style.gap = '4px';

      // Minus button
      const minusBtn = document.createElement('button');
      minusBtn.textContent = '−';
      minusBtn.style.background = '#ef4444';
      minusBtn.style.color = 'white';
      minusBtn.style.border = 'none';
      minusBtn.style.borderRadius = '4px';
      minusBtn.style.width = '24px';
      minusBtn.style.height = '24px';
      minusBtn.style.cursor = 'pointer';
      minusBtn.style.fontSize = '16px';
      minusBtn.style.lineHeight = '1';
      minusBtn.style.padding = '0';
      minusBtn.addEventListener('click', () => {
        if (part.quantity > 1) {
          const oldQty = part.quantity;
          part.quantity -= 1;

          // Log correction if this is an auto-matched part with voice context
          if (part.auto_matched && part._parsedQuantity !== undefined && part.quantity !== part._parsedQuantity) {
            logCorrection('quantity', part._parsedQuantity, part.quantity, part.original_text, part.original_text);
          }

          saveRepairsToLocalStorage(); // Persist quantity change
          renderRepairs();
        } else {
          if (confirm(`Remove ${part.name} from this repair?`)) {
            removePartFromRepair(index, part.part_number);
          }
        }
      });

      // Quantity input
      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '1';
      qtyInput.value = part.quantity;
      qtyInput.style.width = '50px';
      qtyInput.style.textAlign = 'center';
      qtyInput.style.border = '1px solid #d1d5db';
      qtyInput.style.borderRadius = '4px';
      qtyInput.style.padding = '4px';
      qtyInput.style.fontSize = '0.85rem';
      qtyInput.addEventListener('change', (e) => {
        const oldQty = part.quantity;
        const newQty = parseInt(e.target.value);

        if (!isNaN(newQty) && newQty > 0) {
          part.quantity = newQty;

          // Log correction if this is an auto-matched part with voice context
          if (part.auto_matched && part._parsedQuantity !== undefined && oldQty !== newQty) {
            logCorrection('quantity', part._parsedQuantity, newQty, part.original_text, part.original_text);
          }

          saveRepairsToLocalStorage(); // Persist quantity change
          renderRepairs();
        } else if (newQty === 0) {
          if (confirm(`Remove ${part.name} from this repair?`)) {
            removePartFromRepair(index, part.part_number);
          } else {
            e.target.value = part.quantity;
          }
        } else {
          e.target.value = part.quantity;
        }
      });

      // Plus button
      const plusBtn = document.createElement('button');
      plusBtn.textContent = '+';
      plusBtn.style.background = '#10b981';
      plusBtn.style.color = 'white';
      plusBtn.style.border = 'none';
      plusBtn.style.borderRadius = '4px';
      plusBtn.style.width = '24px';
      plusBtn.style.height = '24px';
      plusBtn.style.cursor = 'pointer';
      plusBtn.style.fontSize = '16px';
      plusBtn.style.lineHeight = '1';
      plusBtn.style.padding = '0';
      plusBtn.addEventListener('click', () => {
        const oldQty = part.quantity;
        part.quantity += 1;

        // Log correction if this is an auto-matched part with voice context
        if (part.auto_matched && part._parsedQuantity !== undefined && part.quantity !== part._parsedQuantity) {
          logCorrection('quantity', part._parsedQuantity, part.quantity, part.original_text, part.original_text);
        }

        saveRepairsToLocalStorage(); // Persist quantity change
        renderRepairs();
      });

      qtyControls.appendChild(minusBtn);
      qtyControls.appendChild(qtyInput);
      qtyControls.appendChild(plusBtn);
      partInfo.appendChild(qtyControls);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-delete';
      removeBtn.style.fontSize = '0.75rem';
      removeBtn.style.padding = '4px 8px';
      removeBtn.innerHTML = '×';
      removeBtn.addEventListener('click', () => removePartFromRepair(index, part.part_number));

      partCard.appendChild(partInfo);
      partCard.appendChild(removeBtn);
      selectedPartsSection.appendChild(partCard);
    });

    // Show total price
    const totalPrice = repair.selectedParts.reduce((sum, part) => sum + (parseFloat(part.price) * part.quantity), 0);
    const totalDiv = document.createElement('div');
    totalDiv.style.marginTop = '12px';
    totalDiv.style.fontWeight = '600';
    totalDiv.style.textAlign = 'right';
    totalDiv.style.color = '#10b981';
    totalDiv.textContent = `Parts Total: $${totalPrice.toFixed(2)}`;
    selectedPartsSection.appendChild(totalDiv);

    card.appendChild(selectedPartsSection);
  }

  if (repair.notes) {
    const notesDiv = document.createElement('div');
    notesDiv.className = 'notes';
    notesDiv.textContent = repair.notes;
    card.appendChild(notesDiv);
  }

  return card;
}

function editRepair(index) {
  const repair = currentRepairs[index];

  const equipment = prompt('Equipment:', repair.equipment || '');
  if (equipment === null) return; // User cancelled

  const problem = prompt('Problem:', repair.problem || '');
  if (problem === null) return;

  // Convert chips to display text for editing
  const partsDisplayText = (repair.parts || []).map(part => {
    if (typeof part === 'string') return part;
    // For chip objects, show "qty × name"
    return part.quantity > 1 ? `${part.quantity} × ${part.name}` : part.name;
  }).join(', ');

  const partsStr = prompt('Parts (comma-separated):', partsDisplayText);
  if (partsStr === null) return;

  const actionsStr = prompt('Actions (comma-separated):', (repair.actions || []).join(', '));
  if (actionsStr === null) return;

  const notes = prompt('Notes:', repair.notes || '');
  if (notes === null) return;

  // Update the repair - convert string parts to chips
  currentRepairs[index] = {
    equipment: equipment.trim(),
    problem: problem.trim(),
    parts: partsStr.split(',').map(p => p.trim()).filter(p => p).map(p => stringToChip(p)),
    actions: actionsStr.split(',').map(a => a.trim()).filter(a => a),
    notes: notes.trim()
  };

  saveRepairsToLocalStorage(); // Persist repair update
  renderRepairs();
  showStatus('Repair updated successfully!', 'success');
}

function deleteRepair(index) {
  if (confirm('Are you sure you want to delete this repair?')) {
    currentRepairs.splice(index, 1);
    saveRepairsToLocalStorage(); // Persist to localStorage
    renderRepairs();
    showStatus('Repair deleted.', 'info');

    if (currentRepairs.length === 0) {
      resultsSection.classList.remove('visible');
    }
  }
}

function addNewRepair() {
  const equipment = prompt('Equipment:', 'RTU-1');
  if (!equipment) return;

  const problem = prompt('Problem:', '');
  if (!problem) return;

  const partsStr = prompt('Parts (comma-separated):', '');
  const actionsStr = prompt('Actions (comma-separated):', '');
  const notes = prompt('Notes (optional):', '');

  const newRepair = {
    equipment: equipment.trim(),
    problem: problem.trim(),
    parts: partsStr.split(',').map(p => p.trim()).filter(p => p).map(p => stringToChip(p)),
    actions: actionsStr.split(',').map(a => a.trim()).filter(a => a),
    notes: notes.trim()
  };

  currentRepairs.push(newRepair);
  saveRepairsToLocalStorage(); // Persist to localStorage
  renderRepairs();
  showStatus('New repair added!', 'success');
}

async function submitFinalRepairs() {
  if (currentRepairs.length === 0) {
    showStatus('No repairs to submit.', 'error');
    return;
  }

  try {
    showStatus('Submitting final repairs...', 'info');

    const response = await fetch('/api/submit-repairs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ repairs: currentRepairs })
    });

    if (!response.ok) {
      throw new Error('Failed to submit repairs');
    }

    const result = await response.json();

    showStatus(`Successfully submitted ${currentRepairs.length} repair(s)!`, 'success');
    console.log('Submitted repairs:', result);

    // Optionally clear the form
    // currentRepairs = [];
    // renderRepairs();

  } catch (error) {
    console.error('Error submitting repairs:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// Parts Search Functions
function showPartsModal(repairIndex) {
  currentRepairIndex = repairIndex;
  partsModal.classList.remove('hidden');
  partsSearchInput.value = '';
  partsResults.innerHTML = '<div class="no-results">Start typing to search for parts...</div>';
  partsSearchInput.focus();
}

function hidePartsModal() {
  if (partsModal) {
    partsModal.classList.add('hidden');
  }
  currentRepairIndex = null;
  if (partsSearchInput) {
    partsSearchInput.value = '';
  }
  if (partsResults) {
    partsResults.innerHTML = '';
  }
}

async function searchParts(query) {
  try {
    partsResults.innerHTML = '<div class="no-results">Searching...</div>';

    const response = await fetch(`/api/parts/search?query=${encodeURIComponent(query)}&limit=10`);

    if (!response.ok) {
      throw new Error('Search failed');
    }

    const data = await response.json();
    displayPartsResults(data.parts);

  } catch (error) {
    console.error('Parts search error:', error);
    partsResults.innerHTML = '<div class="no-results">Error searching parts. Please try again.</div>';
  }
}

function displayPartsResults(parts) {
  if (parts.length === 0) {
    partsResults.innerHTML = '<div class="no-results">No parts found. Try a different search.</div>';
    return;
  }

  partsResults.innerHTML = '';

  parts.forEach(part => {
    const partItem = document.createElement('div');
    partItem.className = 'part-item';

    const typeBadgeClass = part.type === 'consumable' ? 'part-type-consumable' : 'part-type-inventory';
    const typeLabel = part.type === 'consumable' ? 'Consumable' : 'Inventory';

    partItem.innerHTML = `
      <img src="${part.thumbnail_url}" alt="${part.name}" class="part-thumbnail" />
      <div class="part-info">
        <div class="part-name">${part.name}</div>
        <div class="part-description">${part.description.substring(0, 120)}${part.description.length > 120 ? '...' : ''}</div>
        <div class="part-meta">
          <span class="part-price">$${parseFloat(part.price).toFixed(2)}</span>
          <span class="part-category">${part.category}</span>
          <span class="part-type-badge ${typeBadgeClass}">${typeLabel}</span>
          ${part.similarity ? `<span style="font-size: 0.75rem; color: #6b7280;">${(part.similarity * 100).toFixed(0)}% match</span>` : ''}
        </div>
      </div>
      <button class="btn-add-part">Add Part</button>
    `;

    partItem.querySelector('.btn-add-part').addEventListener('click', (e) => {
      e.stopPropagation();
      addPartToRepair(part);
    });

    partsResults.appendChild(partItem);
  });
}

function addPartToRepair(part) {
  if (currentRepairIndex === null) {
    showStatus('Please select a repair first by clicking "🔍 Parts" on a repair card.', 'error');
    return;
  }

  const repair = currentRepairs[currentRepairIndex];

  // Initialize selectedParts array if it doesn't exist
  if (!repair.selectedParts) {
    repair.selectedParts = [];
  }

  // Check if part already added
  const existingPart = repair.selectedParts.find(p => p.part_number === part.part_number);
  if (existingPart) {
    // Auto-increase quantity by 1
    existingPart.quantity += 1;
    renderRepairs();
    showStatus(`Increased ${part.name} quantity to ${existingPart.quantity}`, 'success');
    return;
  }

  // Add part with default quantity of 1
  repair.selectedParts.push({
    part_number: part.part_number,
    name: part.name,
    price: part.price,
    type: part.type,
    quantity: 1
  });

  saveRepairsToLocalStorage(); // Persist part addition
  renderRepairs();
  hidePartsModal();
  showStatus(`Added ${part.name} to repair!`, 'success');
}

function removePartFromRepair(repairIndex, partNumber) {
  const repair = currentRepairs[repairIndex];
  if (!repair.selectedParts) return;

  repair.selectedParts = repair.selectedParts.filter(p => p.part_number !== partNumber);
  saveRepairsToLocalStorage(); // Persist part removal
  renderRepairs();
  showStatus('Part removed from repair.', 'info');
}

// ========== ADD PART MODAL FUNCTIONS ==========

function openAddPartModal(partOrChip) {
  // Handle both old string format and new chip object format
  let chip;
  if (typeof partOrChip === 'string') {
    chip = stringToChip(partOrChip);
  } else {
    chip = partOrChip;
  }

  // Store the chip for reference
  currentPartToAdd = chip.name;

  // Prefill from chip fields (not reparse text)
  const partNameInput = document.getElementById('partName');
  if (partNameInput) {
    partNameInput.value = chip.name || '';
  }

  // Prefill quantity from chip
  document.getElementById('partQuantity').value = chip.quantity || 1;

  const addPartModal = document.getElementById('addPartModal');
  if (addPartModal) {
    addPartModal.classList.remove('hidden');
  }

  // Show context label on floating mic
  const floatingMicLabel = document.getElementById('floatingMicLabel');
  const floatingMicLabelText = document.getElementById('floatingMicLabelText');
  if (floatingMicLabel && floatingMicLabelText) {
    floatingMicLabelText.textContent = `🎙️ Recording Part Details for "${chip.name}"`;
    floatingMicLabel.classList.remove('hidden');
  }

  // Clear other fields
  document.getElementById('partNumber').value = '';
  document.getElementById('partCategory').value = '';
  document.getElementById('partType').value = '';
  document.getElementById('partPrice').value = '';
  document.getElementById('partDescription').value = '';
  document.getElementById('partCommonUses').value = '';

  // Clear field history for undo functionality
  modalFieldHistory = {};
}

function closeAddPartModal() {
  const addPartModal = document.getElementById('addPartModal');
  if (addPartModal) {
    addPartModal.classList.add('hidden');
  }
  currentPartToAdd = '';

  // Hide context label on floating mic
  const floatingMicLabel = document.getElementById('floatingMicLabel');
  if (floatingMicLabel) {
    floatingMicLabel.classList.add('hidden');
  }

  // Stop recording if active
  if (isModalRecording) {
    stopModalRecording();
  }

  // Hide all modal UI elements
  hideCompactPill();
  hideDropdownHints();
  hideTranscriptDrawer();
}

async function startModalRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showStatus('Voice recording is not supported in this browser.', 'error');
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    modalMediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm'
    });

    modalAudioChunks = [];

    modalMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        modalAudioChunks.push(event.data);
      }
    };

    modalMediaRecorder.onstop = async () => {
      const audioBlob = new Blob(modalAudioChunks, { type: 'audio/webm' });
      await processModalAudio(audioBlob);

      stream.getTracks().forEach(track => track.stop());
    };

    modalMediaRecorder.start();
    isModalRecording = true;

    // Update floating mic to show recording state
    const floatingMic = document.getElementById('floatingMic');
    if (floatingMic) {
      floatingMic.classList.add('recording');
    }

    // Show dropdown hints while recording
    showDropdownHints();

    // Show compact pill
    showCompactPill('🎤 Recording...', 'Speak now to describe the part');

  } catch (error) {
    console.error('Error starting modal recording:', error);
    showStatus('Could not access microphone. Please check permissions.', 'error');
    hideModalAiStatus();
  }
}

function stopModalRecording() {
  if (modalMediaRecorder && isModalRecording) {
    modalMediaRecorder.stop();
    isModalRecording = false;

    // Update floating mic to remove recording state
    const floatingMic = document.getElementById('floatingMic');
    if (floatingMic) {
      floatingMic.classList.remove('recording');
    }

    // Hide dropdown hints after a short delay
    hideDropdownHints(3000);

    // Show processing status
    showCompactPill('⏳ Processing audio...', 'Converting to text');
  }
}

async function processModalAudio(audioBlob) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    // Step 1: Get transcription from Whisper
    showCompactPill('⏳ Transcribing...', '');

    const transcribeResponse = await fetch('/api/parts/parse-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: base64Audio,
        partName: currentPartToAdd
      })
    });

    if (!transcribeResponse.ok) {
      throw new Error('Failed to transcribe audio');
    }

    const transcribeResult = await transcribeResponse.json();
    const rawTranscription = String(transcribeResult.transcription || '');

    console.log('[Transcription] Raw:', rawTranscription);

    // Step 1.5: Normalize transcription using lexicon
    const transcription = normalizeTranscript(rawTranscription);

    console.log('[Transcription] Normalized:', transcription);

    // Update pill with transcript snippet and View button
    showCompactPill('🤖 Parsing...', transcription, { showView: true });

    // Step 2: Detect and parse multiple parts
    const detectedParts = parseMultipleParts(transcription);

    console.log('[Multi-Part] Detected parts:', detectedParts);

    // Update transcript drawer with both raw and normalized transcription + detected parts
    const drawerContent = `Raw: ${rawTranscription}\nNormalized: ${transcription}\n\n${renderDetectedList(detectedParts)}`;
    showTranscriptDrawer(drawerContent);

    // If multiple parts detected or single part, queue them
    pendingPartsQueue = detectedParts;
    pendingPartIndex = 0;

    console.log('[Multi-Part] Queue initialized with', pendingPartsQueue.length, 'part(s)');

    // Load first part into modal
    loadQueuedPartIntoModal();
    return; // Skip old single-part flow

    // Check for reset command
    if (parsedData.resetCommand) {
      showCompactPill('🔄 Resetting fields...', '');
      document.getElementById('partName').value = currentPartToAdd;
      document.getElementById('partNumber').value = '';
      document.getElementById('partCategory').value = '';
      document.getElementById('partType').value = '';
      document.getElementById('partQuantity').value = '1';
      document.getElementById('partPrice').value = '';
      document.getElementById('partDescription').value = '';
      document.getElementById('partCommonUses').value = '';

      setTimeout(() => {
        showCompactPill('✓ Fields reset', '');
        setTimeout(() => hideCompactPill(), 2000);
      }, 500);
      return;
    }

    // Step 4: Calculate confidence
    const confidence = calculateParseConfidence(parsedData);
    console.log('Parse confidence:', confidence);

    // Step 5: Decide if we need GPT-4 validation
    const needsValidation = PARSER_CONFIG.useServerValidation &&
                           (confidence < PARSER_CONFIG.confidenceThreshold || parsedData.errors.length > 0);

    let finalData = parsedData;

    if (needsValidation) {
      console.log('Low confidence or errors - requesting GPT-4 validation');
      showCompactPill('🤖 AI validating...', transcription, { showView: true });

      // Send client-parsed data to server for GPT-4 enhancement
      const validateResponse = await fetch('/api/parts/parse-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: transcription,
          partName: currentPartToAdd,
          clientParsed: parsedData,
          currentFields: currentFields
        })
      });

      if (validateResponse.ok) {
        const validateResult = await validateResponse.json();
        if (validateResult.partDetails) {
          // Merge server validation with client parsing
          finalData = { ...parsedData, ...validateResult.partDetails };
          console.log('GPT-4 enhanced data:', finalData);
        }
      }
    }

    // Step 6: Show errors if any
    if (parsedData.errors.length > 0) {
      console.warn('Parse errors:', parsedData.errors);
      showCompactPill('⚠️ Warning', parsedData.errors[0], { showView: true });
      // Continue anyway - user can fix manually
    }

    // Step 7: Incremental field updates with animation and tracking
    showCompactPill('✨ Updating fields...', transcription, { showView: true });

    const fieldMappings = {
      'partName': { value: finalData.name, displayName: 'Name' },
      'partNumber': { value: finalData.partNumber, displayName: 'Part Number' },
      'partCategory': { value: finalData.category, displayName: 'Category' },
      'partType': { value: finalData.type, displayName: 'Type' },
      'partQuantity': { value: finalData.quantity, displayName: 'Quantity' },
      'partPrice': { value: finalData.price, displayName: 'Price' },
      'partDescription': { value: finalData.description, displayName: 'Description' },
      'partCommonUses': { value: finalData.commonUses, displayName: 'Common Uses' }
    };

    let firstChangedField = null;
    const updatedFields = [];

    // Update fields with delay for visual effect
    let delay = 100;
    for (const [fieldId, fieldData] of Object.entries(fieldMappings)) {
      if (fieldData.value !== null && fieldData.value !== undefined && fieldData.value !== '') {
        const currentValue = currentFields[fieldId.replace('part', '').toLowerCase()] ||
                            currentFields[fieldId.replace('part', '').replace(/([A-Z])/g, '$1').toLowerCase()];

        // Only update if value changed
        if (String(fieldData.value) !== String(currentValue)) {
          setTimeout(() => {
            const fieldElement = document.getElementById(fieldId);
            if (fieldElement) {
              // Save to history for undo
              if (!modalFieldHistory[fieldId]) {
                modalFieldHistory[fieldId] = [];
              }
              modalFieldHistory[fieldId].push({
                oldValue: fieldElement.value,
                newValue: String(fieldData.value),
                timestamp: Date.now()
              });

              fieldElement.value = fieldData.value;

              // Visual flash effect
              fieldElement.style.backgroundColor = '#dbeafe';
              setTimeout(() => {
                fieldElement.style.backgroundColor = '';
              }, 500);
            }
          }, delay);

          if (!firstChangedField) {
            firstChangedField = fieldId;
          }
          updatedFields.push(fieldData.displayName);
          delay += 100;
        }
      }
    }

    // Step 8: Show result and scroll to first changed field
    setTimeout(() => {
      if (updatedFields.length > 0) {
        const summary = updatedFields.join(', ');
        showCompactPill(`✓ Updated: ${summary}`, transcription, { showView: true });

        // Scroll to first changed field
        if (firstChangedField) {
          const fieldElement = document.getElementById(firstChangedField);
          if (fieldElement) {
            fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      } else {
        showCompactPill('ℹ️ No changes detected', transcription, { showView: true });
      }

      // Auto-hide pill after delay
      setTimeout(() => hideCompactPill(), 4000);
    }, delay + 200);

  } catch (error) {
    console.error('Error processing modal audio:', error);
    showCompactPill('❌ Error', 'Could not process audio. Please try again.', { showView: false });
    setTimeout(() => hideCompactPill(), 3000);
  }
}

async function handleAddPart(e) {
  e.preventDefault();

  const partData = {
    name: document.getElementById('partName').value.trim(),
    part_number: document.getElementById('partNumber').value.trim(),
    category: document.getElementById('partCategory').value,
    type: document.getElementById('partType').value,
    quantity: parseInt(document.getElementById('partQuantity').value) || 1,
    price: parseFloat(document.getElementById('partPrice').value) || 0,
    description: document.getElementById('partDescription').value.trim(),
    common_uses: document.getElementById('partCommonUses').value.trim()
  };

  if (!partData.name || !partData.category || !partData.type) {
    showStatus('Please fill in all required fields (Name, Category, Type).', 'error');
    return;
  }

  try {
    showStatus('Adding part to database...', 'info');

    const response = await fetch('/api/parts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(partData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add part');
    }

    const result = await response.json();

    showStatus(`Successfully added "${partData.name}" to parts database!`, 'success');

    // Update parts status cache
    partsStatus[currentPartToAdd] = true;

    // Close modal
    closeAddPartModal();

    // Re-render repairs to update UI
    await renderRepairs();

  } catch (error) {
    console.error('Error adding part:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// ========== COMPACT STATUS PILL FUNCTIONS ==========

/**
 * Show the compact status pill with optional transcript preview
 * @param {string} statusText - Main status message
 * @param {string} transcript - Optional transcript snippet to show
 * @param {object} options - Additional options { showView, showUndo, undoData }
 */
function showCompactPill(statusText, transcript = '', options = {}) {
  const pill = document.getElementById('compactStatusPill');
  const statusSpan = document.getElementById('pillStatus');
  const transcriptSpan = document.getElementById('pillTranscript');
  const viewBtn = document.getElementById('pillViewBtn');
  const undoBtn = document.getElementById('pillUndoBtn');

  if (!pill || !statusSpan) return;

  statusSpan.textContent = statusText;

  // Show transcript snippet (truncate if needed)
  if (transcriptSpan) {
    if (transcript && transcript.length > 0) {
      const truncated = transcript.length > 50 ? transcript.substring(0, 50) + '...' : transcript;
      transcriptSpan.textContent = `"${truncated}"`;
    } else {
      transcriptSpan.textContent = '';
    }
  }

  // Show/hide View button
  if (viewBtn) {
    if (options.showView && transcript) {
      viewBtn.classList.remove('hidden');
    } else {
      viewBtn.classList.add('hidden');
    }
  }

  // Show/hide Undo button
  if (undoBtn) {
    if (options.showUndo) {
      undoBtn.classList.remove('hidden');
      if (options.undoData) {
        undoBtn.onclick = () => handleUndoFieldChange(options.undoData);
      }
    } else {
      undoBtn.classList.add('hidden');
    }
  }

  // Dynamic buttons: Next, Skip, Clarification choices
  const pillContent = pill.querySelector('.pill-content');
  if (pillContent) {
    // Remove any existing dynamic buttons
    pillContent.querySelectorAll('.pill-dynamic-btn').forEach(btn => btn.remove());

    // Add Next button
    if (options.showNext) {
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'pill-view-btn pill-dynamic-btn';
      nextBtn.textContent = 'Next';
      nextBtn.onclick = () => handleNextPart();
      pillContent.appendChild(nextBtn);
    }

    // Add Skip button
    if (options.showSkip) {
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'pill-view-btn pill-dynamic-btn';
      skipBtn.textContent = 'Skip';
      skipBtn.onclick = () => handleSkipPart();
      pillContent.appendChild(skipBtn);
    }

    // Add clarification choice buttons
    if (options.clarificationChoices && Array.isArray(options.clarificationChoices)) {
      options.clarificationChoices.forEach(choice => {
        const choiceBtn = document.createElement('button');
        choiceBtn.type = 'button';
        choiceBtn.className = 'pill-view-btn pill-dynamic-btn';
        choiceBtn.textContent = choice;
        choiceBtn.onclick = () => handleClarificationChoice(choice);
        pillContent.appendChild(choiceBtn);
      });
    }
  }

  pill.classList.remove('hidden');
}

/**
 * Hide the compact status pill
 */
function hideCompactPill() {
  const pill = document.getElementById('compactStatusPill');
  if (pill) {
    pill.classList.add('hidden');
  }
}

/**
 * Show dropdown hints (categories and types)
 */
function showDropdownHints() {
  const hints = document.getElementById('dropdownHints');
  if (hints) {
    hints.classList.remove('hidden');
  }
}

/**
 * Hide dropdown hints
 * @param {number} delay - Delay in ms before hiding (default: 0)
 */
function hideDropdownHints(delay = 0) {
  const hints = document.getElementById('dropdownHints');
  if (hints) {
    if (delay > 0) {
      setTimeout(() => hints.classList.add('hidden'), delay);
    } else {
      hints.classList.add('hidden');
    }
  }
}

/**
 * Show/update the transcript drawer
 * @param {string} transcript - Full transcription text
 */
function showTranscriptDrawer(transcript) {
  const drawer = document.getElementById('transcriptDrawer');
  const content = document.getElementById('transcriptContent');

  if (drawer && content) {
    // Ensure transcript is always a string, never [object Object]
    content.textContent = String(transcript || '');
    drawer.classList.add('open');
  }
}

/**
 * Hide the transcript drawer
 */
function hideTranscriptDrawer() {
  const drawer = document.getElementById('transcriptDrawer');
  if (drawer) {
    drawer.classList.remove('open');
  }
}

/**
 * Toggle the transcript drawer
 */
function toggleTranscriptDrawer() {
  const drawer = document.getElementById('transcriptDrawer');
  if (drawer) {
    drawer.classList.toggle('open');
  }
}

/**
 * Handle undo of field change
 * @param {object} undoData - Contains { field, oldValue, newValue }
 */
function handleUndoFieldChange(undoData) {
  const fieldId = undoData.field;
  const oldValue = undoData.oldValue;

  const fieldElement = document.getElementById(fieldId);
  if (fieldElement) {
    fieldElement.value = oldValue;
    showCompactPill('✓ Change undone', '', { showView: false, showUndo: false });
    setTimeout(() => hideCompactPill(), 2000);
  }
}

// Backward compatibility wrappers for old function names
function showModalAiStatus(mainText, subtext, isComplete = false) {
  showCompactPill(mainText, subtext, { showView: false, showUndo: false });
}

function hideModalAiStatus() {
  hideCompactPill();
}

// ============================================================================
// PDF Upload Modal Functionality
// ============================================================================

/**
 * PDF Upload State Management
 * States: idle → uploading → processing → complete/canceled
 */
let pdfUploadState = {
  state: 'idle', // 'idle', 'uploading', 'processing', 'complete', 'canceled'
  selectedFile: null,
  manualId: null,
  pollInterval: null
};

/**
 * Initialize PDF upload modal
 */
function initPdfUploadModal() {
  const uploadBtn = document.getElementById('uploadPdfBtn');
  const modal = document.getElementById('pdfUploadModal');
  const closeBtn = document.getElementById('closePdfModal');
  const cancelBtn = document.getElementById('pdfCancelBtn');
  const dropZone = document.getElementById('pdfDropZone');
  const fileInput = document.getElementById('pdfFileInput');
  const uploadStartBtn = document.getElementById('pdfUploadStartBtn');
  const changeFileBtn = document.getElementById('pdfChangeFile');
  const cancelUploadBtn = document.getElementById('pdfCancelUploadBtn');
  const backToHomeBtn = document.getElementById('pdfBackToHomeBtn');
  const viewResultsBtn = document.getElementById('pdfViewResultsBtn');

  if (!uploadBtn || !modal) return;

  // Open modal
  uploadBtn.addEventListener('click', () => {
    pdfResetModal();
    modal.classList.remove('hidden');
  });

  // Close modal (X button)
  closeBtn?.addEventListener('click', () => {
    if (pdfUploadState.state === 'processing' || pdfUploadState.state === 'uploading') {
      // Don't allow closing while processing without confirmation
      return;
    }
    pdfCloseModal();
  });

  // Cancel button (before upload starts)
  cancelBtn?.addEventListener('click', () => {
    pdfCloseModal();
  });

  // Drop zone click
  dropZone?.addEventListener('click', () => {
    fileInput?.click();
  });

  // File selection
  fileInput?.addEventListener('change', (e) => {
    pdfHandleFileSelect(e.target.files[0]);
  });

  // Change file button
  changeFileBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  // Drag and drop
  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#764ba2';
    dropZone.style.background = '#f0f1f3';
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.style.borderColor = '#667eea';
    dropZone.style.background = '#f8f9fa';
  });

  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#667eea';
    dropZone.style.background = '#f8f9fa';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      pdfHandleFileSelect(files[0]);
    }
  });

  // Upload start button
  uploadStartBtn?.addEventListener('click', () => {
    pdfStartUpload();
  });

  // Cancel upload button (during processing)
  cancelUploadBtn?.addEventListener('click', () => {
    pdfCancelUpload();
  });

  // Back to home button
  backToHomeBtn?.addEventListener('click', () => {
    pdfCloseModal();
  });

  // View results button
  viewResultsBtn?.addEventListener('click', () => {
    window.location.href = '/pdf-admin.html';
  });
}

/**
 * Check if file type is supported
 */
function isValidManualFile(file) {
  if (!file) return false;

  const validTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/tiff',
    'image/bmp'
  ];

  const validExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

  return validTypes.includes(file.type) || hasValidExtension;
}

/**
 * Handle file selection
 */
function pdfHandleFileSelect(file) {
  if (!isValidManualFile(file)) {
    alert('Please select a valid file (PDF, JPG, PNG, TIFF, or BMP)');
    return;
  }

  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    alert('File size must be less than 50MB');
    return;
  }

  pdfUploadState.selectedFile = file;

  // Update UI
  const fileSelected = document.getElementById('pdfFileSelected');
  const fileName = document.getElementById('pdfFileName');
  const fileSize = document.getElementById('pdfFileSize');
  const uploadBtn = document.getElementById('pdfUploadStartBtn');

  if (fileName) fileName.textContent = file.name;
  if (fileSize) fileSize.textContent = (file.size / 1024 / 1024).toFixed(2);
  if (fileSelected) fileSelected.style.display = 'block';
  if (uploadBtn) uploadBtn.disabled = false;
}

/**
 * Start PDF upload
 */
async function pdfStartUpload() {
  if (!pdfUploadState.selectedFile) return;

  // Switch to processing state
  pdfSetState('uploading');
  pdfShowState('processing');
  pdfUpdateProgress(0, 'Uploading PDF...');

  try {
    const formData = new FormData();
    formData.append('pdf', pdfUploadState.selectedFile);

    // Check if schematics-only mode is enabled
    const schematicsOnly = document.getElementById('pdfSchematicsOnly')?.checked;
    const url = schematicsOnly
      ? '/api/manuals/upload?schematicsOnly=true'
      : '/api/manuals/upload';

    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.success) {
      pdfUploadState.manualId = result.manual.id;
      pdfSetState('processing');
      pdfUpdateProgress(25, 'Processing PDF...');

      // Start polling for status
      pdfStartStatusPolling();
    } else {
      throw new Error(result.error || 'Upload failed');
    }
  } catch (error) {
    console.error('Upload error:', error);
    alert('Upload failed: ' + error.message);
    pdfResetModal();
    pdfShowState('select');
  }
}

/**
 * Start polling for PDF processing status
 */
function pdfStartStatusPolling() {
  if (pdfUploadState.pollInterval) {
    clearInterval(pdfUploadState.pollInterval);
  }

  pdfUploadState.pollInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/manuals/${pdfUploadState.manualId}`);
      const result = await response.json();

      if (result.manual) {
        const manual = result.manual;

        // Update progress based on status
        if (manual.status === 'processing') {
          pdfUpdateProgress(50, 'Extracting text and analyzing...');
        } else if (manual.status === 'completed') {
          pdfUpdateProgress(100, 'Complete!');
          pdfSetState('complete');
          pdfStopStatusPolling();

          // Show completion state
          setTimeout(() => {
            pdfShowCompletionStats(manual);
          }, 500);
        } else if (manual.status === 'failed') {
          pdfStopStatusPolling();
          alert('Processing failed: ' + (manual.error_message || 'Unknown error'));
          pdfResetModal();
          pdfShowState('select');
        }
      }
    } catch (error) {
      console.error('Status polling error:', error);
    }
  }, 2000); // Poll every 2 seconds
}

/**
 * Stop status polling
 */
function pdfStopStatusPolling() {
  if (pdfUploadState.pollInterval) {
    clearInterval(pdfUploadState.pollInterval);
    pdfUploadState.pollInterval = null;
  }
}

/**
 * Cancel PDF upload/processing
 */
async function pdfCancelUpload() {
  const confirmed = confirm('Are you sure you want to cancel this upload? The PDF will be deleted.');

  if (!confirmed) return;

  pdfStopStatusPolling();

  // Delete the manual if it was created
  if (pdfUploadState.manualId) {
    try {
      await fetch(`/api/manuals/${pdfUploadState.manualId}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('Error deleting manual:', error);
    }
  }

  pdfSetState('canceled');
  pdfResetModal();
  pdfCloseModal();
}

/**
 * Update progress UI
 */
function pdfUpdateProgress(percent, message) {
  const progressBar = document.getElementById('pdfProgressBar');
  const statusText = document.getElementById('pdfStatusText');

  if (progressBar) progressBar.style.width = percent + '%';
  if (statusText) statusText.textContent = message;
}

/**
 * Show completion stats
 */
function pdfShowCompletionStats(manual) {
  pdfShowState('complete');

  const statsDiv = document.getElementById('pdfStats');
  if (statsDiv && manual) {
    statsDiv.innerHTML = `
      <div style="font-size: 14px;">
        <div style="margin-bottom: 8px;"><strong>📄 Filename:</strong> ${manual.filename || 'N/A'}</div>
        <div style="margin-bottom: 8px;"><strong>📊 Pages:</strong> ${manual.page_count || 'N/A'}</div>
        <div style="margin-bottom: 8px;"><strong>⏱️ Processed:</strong> ${new Date(manual.processed_at).toLocaleString()}</div>
        <div><strong>✅ Status:</strong> <span style="color: #10b981; font-weight: 600;">Completed</span></div>
      </div>
    `;
  }
}

/**
 * Set upload state
 */
function pdfSetState(state) {
  pdfUploadState.state = state;
}

/**
 * Show specific state UI
 */
function pdfShowState(state) {
  const selectState = document.getElementById('pdfSelectState');
  const processingState = document.getElementById('pdfProcessingState');
  const completeState = document.getElementById('pdfCompleteState');

  if (selectState) selectState.style.display = state === 'select' ? 'block' : 'none';
  if (processingState) processingState.style.display = state === 'processing' ? 'block' : 'none';
  if (completeState) completeState.style.display = state === 'complete' ? 'block' : 'none';
}

/**
 * Reset modal to initial state
 */
function pdfResetModal() {
  pdfStopStatusPolling();
  pdfUploadState = {
    state: 'idle',
    selectedFile: null,
    manualId: null,
    pollInterval: null
  };

  // Reset UI
  const fileSelected = document.getElementById('pdfFileSelected');
  const uploadBtn = document.getElementById('pdfUploadStartBtn');
  const fileInput = document.getElementById('pdfFileInput');
  const schematicsOnly = document.getElementById('pdfSchematicsOnly');

  if (fileSelected) fileSelected.style.display = 'none';
  if (uploadBtn) uploadBtn.disabled = true;
  if (fileInput) fileInput.value = '';
  if (schematicsOnly) schematicsOnly.checked = false;

  pdfShowState('select');
  pdfUpdateProgress(0, 'Initializing...');
}

/**
 * Close modal
 */
function pdfCloseModal() {
  const modal = document.getElementById('pdfUploadModal');
  if (modal) modal.classList.add('hidden');
  pdfResetModal();
}

// Initialize PDF upload modal when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPdfUploadModal);
} else {
  initPdfUploadModal();
}

// ========== CHAT FUNCTIONS ==========

/**
 * Create a chat message element
 */
function createChatMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = role === 'user' ? '👤' : 'J';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  // Convert markdown-style formatting to HTML
  let htmlContent = content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
    .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
    .replace(/\n/g, '<br>'); // Line breaks

  bubble.innerHTML = htmlContent;

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(bubble);

  return messageDiv;
}

/**
 * Clear chat history
 */
function clearChatHistory() {
  const chatHistory = document.getElementById('chatHistory');
  const chatSection = document.getElementById('chatSection');

  if (confirm('Are you sure you want to clear the conversation history?')) {
    chatHistory.innerHTML = '';
    chatSection.classList.remove('visible');
    showStatus('Chat history cleared', 'info');
  }
}

// Initialize chat functionality
document.addEventListener('DOMContentLoaded', () => {
  const clearChatBtn = document.getElementById('clearChatBtn');
  if (clearChatBtn) {
    clearChatBtn.addEventListener('click', clearChatHistory);
  }
});

/**
 * Toggle between chat and repairs view
 */
function toggleView(view) {
  const chatSection = document.getElementById('chatSection');
  const resultsSection = document.getElementById('resultsSection');
  const showChatBtn = document.getElementById('showChatBtn');
  const showRepairsBtn = document.getElementById('showRepairsBtn');

  if (view === 'chat') {
    chatSection.classList.add('visible');
    resultsSection.classList.remove('visible');
    showChatBtn.classList.add('active');
    showRepairsBtn.classList.remove('active');
  } else {
    chatSection.classList.remove('visible');
    resultsSection.classList.add('visible');
    showChatBtn.classList.remove('active');
    showRepairsBtn.classList.add('active');
  }
}

/**
 * Show or hide the view toggle based on what content exists
 */
function updateViewToggle() {
  const chatSection = document.getElementById('chatSection');
  const resultsSection = document.getElementById('resultsSection');
  const viewToggle = document.getElementById('viewToggle');
  const chatHistory = document.getElementById('chatHistory');
  const repairGrid = document.getElementById('repairGrid');

  const hasChat = chatHistory && chatHistory.children.length > 0;
  const hasRepairs = repairGrid && repairGrid.children.length > 0;

  // Show toggle only if both exist
  if (hasChat && hasRepairs) {
    viewToggle.classList.remove('hidden');
  } else {
    viewToggle.classList.add('hidden');
  }

  // Ensure at least one section is visible if content exists
  if (hasChat && !hasRepairs) {
    chatSection.classList.add('visible');
    resultsSection.classList.remove('visible');
  } else if (!hasChat && hasRepairs) {
    chatSection.classList.remove('visible');
    resultsSection.classList.add('visible');
  }
}

// Initialize toggle buttons
document.addEventListener('DOMContentLoaded', () => {
  const showChatBtn = document.getElementById('showChatBtn');
  const showRepairsBtn = document.getElementById('showRepairsBtn');

  if (showChatBtn) {
    showChatBtn.addEventListener('click', () => toggleView('chat'));
  }

  if (showRepairsBtn) {
    showRepairsBtn.addEventListener('click', () => toggleView('repairs'));
  }
});

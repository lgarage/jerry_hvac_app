// PDF Processing Worker - Extracts terminology and parts from HVAC manuals
require('dotenv').config();

// Polyfill canvas for pdf-parse (fixes DOMMatrix error)
try {
  const { DOMMatrix, DOMPoint } = require('@napi-rs/canvas');
  global.DOMMatrix = DOMMatrix;
  global.DOMPoint = DOMPoint;
} catch (e) {
  // Fallback if @napi-rs/canvas is not available
  console.warn('Canvas polyfill not available, PDF parsing may fail');
}

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');
const { sql } = require('./db');
const Tesseract = require('tesseract.js');
const { fromPath } = require('pdf2pic');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Run OCR on a PDF file (for scanned/image-based PDFs)
 */
async function extractTextWithOCR(pdfPath, numPages) {
  console.log(`🔍 Running OCR on ${numPages} pages (this may take several minutes)...`);

  const outputDir = path.join(__dirname, 'temp_ocr');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Configure pdf2pic to convert PDF pages to images
    const converter = fromPath(pdfPath, {
      density: 300,        // 300 DPI for good OCR quality
      saveFilename: path.basename(pdfPath, '.pdf'),
      savePath: outputDir,
      format: 'png',
      width: 2480,         // A4 at 300 DPI
      height: 3508
    });

    let allText = '';

    // Process each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      console.log(`   OCR processing page ${pageNum}/${numPages}...`);

      try {
        // Convert page to image
        const pageImage = await converter(pageNum, { responseType: 'image' });

        // Run Tesseract OCR
        const result = await Tesseract.recognize(
          pageImage.path,
          'eng',
          {
            logger: () => {} // Suppress verbose logs
          }
        );

        allText += `\n--- Page ${pageNum} ---\n`;
        allText += result.data.text;

        // Clean up image file
        fs.unlinkSync(pageImage.path);
      } catch (pageError) {
        console.error(`   Error on page ${pageNum}:`, pageError.message);
        allText += `\n--- Page ${pageNum} (OCR failed) ---\n`;
      }
    }

    // Clean up temp directory
    try {
      fs.rmdirSync(outputDir);
    } catch (e) {
      // Ignore cleanup errors
    }

    return allText;
  } catch (error) {
    console.error('OCR extraction failed:', error);
    throw error;
  }
}

/**
 * Detect if PDF is image-based (scanned) based on text density
 */
function isImageBasedPDF(text, numPages) {
  const avgCharsPerPage = text.length / numPages;
  const threshold = 100; // Less than 100 chars per page suggests scanned images

  return avgCharsPerPage < threshold;
}

/**
 * Extract text from PDF file (with OCR fallback for scanned PDFs)
 */
async function extractTextFromPDF(pdfPath) {
  console.log(`📄 Extracting text from: ${path.basename(pdfPath)}`);

  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);

    let finalText = data.text;
    const numPages = data.numpages;

    // Check if PDF appears to be image-based (scanned)
    if (isImageBasedPDF(data.text, numPages)) {
      console.log('⚠️  PDF appears to be scanned/image-based (low text density)');
      console.log('🔄 Falling back to OCR extraction...');

      try {
        finalText = await extractTextWithOCR(pdfPath, numPages);
        console.log(`✓ OCR completed: ${finalText.length} characters extracted`);
      } catch (ocrError) {
        console.error('⚠️  OCR failed, using original text extraction:', ocrError.message);
        // Continue with original text even if OCR fails
      }
    } else {
      console.log(`✓ Text-based PDF: ${finalText.length} characters extracted`);
    }

    return {
      text: finalText,
      numPages: numPages,
      info: data.info
    };
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw error;
  }
}

/**
 * Extract HVAC terminology from text using GPT-4
 */
async function extractTerminology(text, chunkSize = 3000) {
  console.log('🤖 Extracting HVAC terminology with GPT-4...');

  // Split text into chunks to avoid token limits
  const chunks = splitIntoChunks(text, chunkSize);
  const allTerms = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`   Processing chunk ${i + 1}/${chunks.length}...`);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an HVAC terminology expert. Extract ALL technical HVAC terms from the text.

For each term, provide:
1. The standard term (e.g., "R-410A")
2. Common variations (e.g., ["R410A", "R4-10", "410A", "four ten"])
3. Category (refrigerant, equipment, voltage, part_type, measurement, action, brand)
4. Brief description

Return as JSON array:
[
  {
    "standard_term": "R-410A",
    "variations": ["R410A", "R4-10", "410A", "four ten", "puron"],
    "category": "refrigerant",
    "description": "Common residential refrigerant"
  },
  ...
]

Only extract HVAC-specific technical terms. Skip general words.`
          },
          {
            role: 'user',
            content: chunks[i]
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(response.choices[0].message.content);
      if (result.terms && Array.isArray(result.terms)) {
        allTerms.push(...result.terms);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`Error processing chunk ${i + 1}:`, error.message);
    }
  }

  // Deduplicate terms
  const uniqueTerms = deduplicateTerms(allTerms);
  console.log(`✓ Extracted ${uniqueTerms.length} unique terms`);

  return uniqueTerms;
}

/**
 * Extract parts information from text using GPT-4
 */
async function extractParts(text, chunkSize = 3000) {
  console.log('🔧 Extracting HVAC parts with GPT-4...');

  const chunks = splitIntoChunks(text, chunkSize);
  const allParts = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`   Processing chunk ${i + 1}/${chunks.length}...`);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an HVAC parts expert. Extract ALL part names and numbers from the text.

For each part, provide:
1. Part name (e.g., "Contactor 30A 24V")
2. Part number if available (e.g., "CONT-30A-24V")
3. Category (Electrical, Refrigerant, Filters, Controls, Mechanical, Other)
4. Description
5. Price if mentioned (null if not)

Return as JSON array:
[
  {
    "name": "Contactor 30A 24V",
    "part_number": "CONT-30A-24V",
    "category": "Electrical",
    "description": "24V single-pole contactor rated for 30 amps",
    "price": 45.99
  },
  ...
]

Only extract actual HVAC parts with specific names/models.`
          },
          {
            role: 'user',
            content: chunks[i]
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(response.choices[0].message.content);
      if (result.parts && Array.isArray(result.parts)) {
        allParts.push(...result.parts);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`Error processing chunk ${i + 1}:`, error.message);
    }
  }

  const uniqueParts = deduplicateParts(allParts);
  console.log(`✓ Extracted ${uniqueParts.length} unique parts`);

  return uniqueParts;
}

/**
 * Generate embeddings for terms
 */
async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error.message);
    return null;
  }
}

/**
 * Store terminology in database with embeddings
 */
async function storeTerminology(terms, manualId) {
  console.log('💾 Storing terminology in database...');

  let stored = 0;
  let skipped = 0;

  for (const term of terms) {
    try {
      // Check if term already exists
      const existing = await sql`
        SELECT id FROM hvac_terminology
        WHERE standard_term = ${term.standard_term}
      `;

      if (existing.length > 0) {
        console.log(`   Skipping existing term: ${term.standard_term}`);

        // Still record provenance
        await sql`
          INSERT INTO hvac_term_provenance (terminology_id, manual_id, extraction_method, confidence_score)
          VALUES (${existing[0].id}, ${manualId}, 'gpt-4', 0.9)
          ON CONFLICT (terminology_id, manual_id, page_number) DO NOTHING
        `;

        skipped++;
        continue;
      }

      // Generate embedding
      const embeddingText = `${term.standard_term} ${term.variations.join(' ')} ${term.description}`;
      const embedding = await generateEmbedding(embeddingText);

      if (!embedding) {
        console.log(`   Failed to generate embedding for: ${term.standard_term}`);
        continue;
      }

      // Insert new term
      const result = await sql`
        INSERT INTO hvac_terminology (
          standard_term,
          category,
          variations,
          description,
          embedding
        ) VALUES (
          ${term.standard_term},
          ${term.category},
          ${sql.array(term.variations)},
          ${term.description},
          ${JSON.stringify(embedding)}
        )
        RETURNING id
      `;

      // Record provenance
      await sql`
        INSERT INTO hvac_term_provenance (
          terminology_id,
          manual_id,
          extraction_method,
          confidence_score
        ) VALUES (
          ${result[0].id},
          ${manualId},
          'gpt-4',
          0.9
        )
      `;

      stored++;
      console.log(`   ✓ Stored: ${term.standard_term}`);

      // Rate limiting for embeddings API
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`   Error storing term "${term.standard_term}":`, error.message);
    }
  }

  console.log(`✓ Stored ${stored} new terms, skipped ${skipped} existing`);
  return { stored, skipped };
}

/**
 * Store parts in database with embeddings
 */
async function storeParts(parts, manualId) {
  console.log('💾 Storing parts in database...');

  let stored = 0;
  let skipped = 0;

  for (const part of parts) {
    try {
      // Check if part already exists
      const existing = await sql`
        SELECT id FROM parts
        WHERE part_number = ${part.part_number || ''}
        OR (name = ${part.name} AND part_number IS NULL)
      `;

      if (existing.length > 0) {
        console.log(`   Skipping existing part: ${part.name}`);
        skipped++;
        continue;
      }

      // Generate embedding
      const embeddingText = `${part.name} ${part.description} ${part.category}`;
      const embedding = await generateEmbedding(embeddingText);

      if (!embedding) {
        console.log(`   Failed to generate embedding for: ${part.name}`);
        continue;
      }

      // Insert new part
      await sql`
        INSERT INTO parts (
          part_number,
          name,
          description,
          category,
          type,
          price,
          embedding
        ) VALUES (
          ${part.part_number || `AUTO-${Date.now()}`},
          ${part.name},
          ${part.description},
          ${part.category},
          'inventory',
          ${part.price || 0},
          ${JSON.stringify(embedding)}
        )
      `;

      stored++;
      console.log(`   ✓ Stored: ${part.name}`);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`   Error storing part "${part.name}":`, error.message);
    }
  }

  console.log(`✓ Stored ${stored} new parts, skipped ${skipped} existing`);
  return { stored, skipped };
}

/**
 * Process a PDF file end-to-end
 * @param {string} pdfPath - Path to PDF file
 * @param {number} manualId - Manual ID in database
 * @param {object} options - Processing options
 * @param {boolean} options.extractTerms - Extract terms and parts (default: true)
 * @param {boolean} options.extractSchematics - Extract schematics (default: true)
 */
async function processPDF(pdfPath, manualId, options = {}) {
  const { extractTerms = true, extractSchematics = true } = options;

  console.log('\n🚀 Starting PDF processing...\n');
  if (!extractTerms) {
    console.log('⚡ Fast mode: Skipping term/part extraction\n');
  }

  try {
    // Update manual status
    await sql`
      UPDATE manuals
      SET status = 'processing', processed_at = NOW()
      WHERE id = ${manualId}
    `;

    let termStats = { stored: 0, skipped: 0 };
    let partStats = { stored: 0, skipped: 0 };
    let numPages = 0;

    if (extractTerms) {
      // Extract text
      const { text, numPages: pages } = await extractTextFromPDF(pdfPath);
      numPages = pages;

      // Update page count
      await sql`
        UPDATE manuals
        SET page_count = ${numPages}
        WHERE id = ${manualId}
      `;

      console.log(`✓ Extracted ${text.length} characters from ${numPages} pages\n`);

      // Extract terminology
      const terms = await extractTerminology(text);

      // Extract parts
      const parts = await extractParts(text);

      // Store terminology and parts in database
      termStats = await storeTerminology(terms, manualId);
      partStats = await storeParts(parts, manualId);
    }

    // Schematic analysis using Fireworks Llama4 Maverick
    let schematicStats = { schematicsFound: 0, totalPages: 0 };
    if (extractSchematics) {
      console.log(''); // blank line for readability
      const { analyzePDFSchematics } = require('./schematic-analyzer');
      schematicStats = await analyzePDFSchematics(pdfPath, manualId);
    }

    // Update manual status
    await sql`
      UPDATE manuals
      SET
        status = 'completed',
        processed_at = NOW()
      WHERE id = ${manualId}
    `;

    console.log('\n✅ PDF processing complete!');
    if (extractTerms) {
      console.log(`   Terms: ${termStats.stored} new, ${termStats.skipped} existing`);
      console.log(`   Parts: ${partStats.stored} new, ${partStats.skipped} existing`);
    }
    if (extractSchematics) {
      console.log(`   Schematics: ${schematicStats.schematicsFound} found in ${schematicStats.totalPages || 0} pages`);
    }

    return {
      success: true,
      terms: termStats,
      parts: partStats,
      schematics: schematicStats
    };

  } catch (error) {
    console.error('\n❌ PDF processing failed:', error);

    // Update manual status
    await sql`
      UPDATE manuals
      SET
        status = 'failed',
        error_message = ${error.message}
      WHERE id = ${manualId}
    `;

    throw error;
  }
}

// Helper functions
function splitIntoChunks(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}

function deduplicateTerms(terms) {
  const seen = new Set();
  return terms.filter(term => {
    const key = term.standard_term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateParts(parts) {
  const seen = new Set();
  return parts.filter(part => {
    const key = (part.part_number || part.name).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  processPDF,
  extractTextFromPDF,
  extractTerminology,
  extractParts,
  generateEmbedding,
  storeTerminology,
  storeParts
};

// CLI usage
if (require.main === module) {
  const pdfPath = process.argv[2];
  const manualId = process.argv[3];

  if (!pdfPath || !manualId) {
    console.log('Usage: node pdf-processor.js <pdf-path> <manual-id>');
    process.exit(1);
  }

  processPDF(pdfPath, parseInt(manualId))
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

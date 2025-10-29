# PDF Ingestion System - Setup Guide

This guide will help you set up the PDF ingestion system for automated HVAC terminology and parts extraction.

## Prerequisites

- Node.js and npm installed
- PostgreSQL database with pgvector extension (Supabase provides this)
- OpenAI API key (for text extraction and embeddings)
- **Fireworks AI API key** (NEW - for schematic analysis)
- Database connection string in `.env` file

## Quick Setup (3 Steps)

### Step 1: Install Dependencies

The required packages are already in `package.json`. If you haven't installed them yet:

```bash
npm install
```

**Dependencies for PDF ingestion:**
- `pdf-parse` - PDF text extraction (for text-based PDFs)
- `tesseract.js` - OCR for scanned/image-based PDFs
- `pdf2pic` - Convert PDF pages to images
- `@fireworks-ai/fireworks-ai` - **NEW:** Schematic analysis with Llama4 Maverick
- `sharp` - **NEW:** Image processing
- `multer` - File upload handling
- `@supabase/storage-js` - Supabase storage integration

### Step 2: Run Database Migration

**IMPORTANT:** This creates the required database tables.

```bash
node run-migration.js
```

This will:
- ✓ Create `manuals` table (tracks uploaded PDFs)
- ✓ Create `hvac_term_provenance` table (links terms to source manuals)
- ✓ Create `manual_parts_extracted` table (tracks extracted parts)
- ✓ Create `manual_processing_jobs` table (job tracking)
- ✓ Create `manual_stats` view (statistics)
- ✓ Verify all tables were created successfully

**Expected output:**
```
🚀 PDF Ingestion Database Migration Runner
═══════════════════════════════════════════════════

📡 Testing database connection...
✓ Connected to database successfully

📄 Running migration: 003_create_pdf_ingestion_tables.sql
────────────────────────────────────────────────────────
📊 Found 23 SQL statements to execute

✓ [1/23] CREATE TABLE IF NOT EXISTS manuals (...
✓ [2/23] CREATE INDEX IF NOT EXISTS manuals_status_idx...
...
✅ Migration completed: 23/23 statements executed

🔍 Verifying tables...

✓ Table 'manuals' exists
✓ Table 'hvac_term_provenance' exists
✓ Table 'manual_parts_extracted' exists
✓ Table 'manual_processing_jobs' exists
✓ View 'manual_stats' exists
```

### Step 3: Configure API Keys

Edit `.env` and add your API keys:

```bash
# OpenAI (for text extraction and embeddings)
OPENAI_API_KEY=sk-your-actual-key-here

# Fireworks AI (for schematic analysis) - NEW
FIREWORKS_API_KEY=your-fireworks-api-key-here
VISION_MODEL=accounts/fireworks/models/llama4-maverick-instruct-basic
```

**Get Fireworks API Key:** Sign up at [fireworks.ai](https://fireworks.ai)

The PDF processor uses:
- **GPT-4o-mini** (OpenAI) - Terminology and parts extraction ($0.040/manual)
- **text-embedding-3-small** (OpenAI) - Semantic embeddings ($0.001/manual)
- **Llama4 Maverick** (Fireworks) - Schematic analysis ($0.007/manual) **NEW**

## Verify Setup

### Start the Server

```bash
node server.js
```

You should see:
```
✓ Database connected successfully
Server running on http://localhost:3000
PDF ingestion endpoints available:
  POST /api/manuals/upload
  GET  /api/manuals
  GET  /api/manuals/:id
  GET  /api/manuals/:id/status
```

### Open the Admin UI

Navigate to:
```
http://localhost:3000/pdf-admin.html
```

You should see the PDF upload interface with:
- Drag-and-drop upload area
- File size validation (50MB max)
- Real-time processing status
- List of uploaded manuals

## Test with a Sample PDF

1. **Find a small HVAC manual** (5-10 pages recommended for first test)
2. **Drag and drop** into the upload area or click to browse
3. **Click "Upload PDF"**
4. **Watch the status** change from "pending" → "processing" → "completed"

**Processing time:** ~1-2 minutes for a 10-page text-based manual

## OCR Support for Scanned PDFs

The system **automatically detects** scanned/image-based PDFs and uses OCR when needed.

### How It Works:

1. **Text extraction** first attempts normal PDF text extraction
2. **Detection** checks if text density is too low (< 100 chars/page)
3. **OCR fallback** if scanned, converts pages to images and runs Tesseract OCR
4. **Seamless** - no user intervention needed

### OCR Processing Time:

- **Text-based PDF:** 1-2 mins per 10 pages
- **Scanned PDF with OCR:** 5-10 mins per 10 pages (significantly longer)
- **140-page scanned manual:** 70-140 minutes (~1-2 hours)

### OCR Quality:

- Works best with **clear, high-resolution scans** (300 DPI+)
- May struggle with:
  - Handwritten notes
  - Low-quality photocopies
  - Skewed/rotated pages
  - Multi-column layouts

**Tip:** Check the first few pages of extraction to verify OCR quality before processing very large scanned manuals.

## What Gets Extracted

### HVAC Terminology
- Standard term (e.g., "R-410A")
- Common variations (e.g., ["R410A", "410A", "four ten"])
- Category (refrigerant, equipment, voltage, etc.)
- Description
- 1536-dimensional semantic embedding

### Parts Information
- Part name
- Part number (if available)
- Category
- Description
- Price (if mentioned)
- Semantic embedding

All extracted data includes **provenance tracking** - you can trace which manual contributed which terms.

## Database Schema

### `manuals` Table
```sql
id              SERIAL PRIMARY KEY
filename        VARCHAR(255)      -- stored filename
original_filename VARCHAR(255)    -- user's filename
storage_path    TEXT              -- path to PDF file
file_size       BIGINT            -- bytes
status          VARCHAR(50)       -- pending, processing, completed, failed
page_count      INTEGER           -- number of pages
error_message   TEXT              -- if failed
uploaded_at     TIMESTAMP
processed_at    TIMESTAMP
metadata        JSONB             -- manufacturer, model, etc.
```

### `hvac_term_provenance` Table
```sql
id              SERIAL PRIMARY KEY
terminology_id  INTEGER → hvac_terminology.id
manual_id       INTEGER → manuals.id
page_number     INTEGER
context_snippet TEXT              -- surrounding text
confidence_score FLOAT            -- AI confidence (0-1)
extraction_method VARCHAR(50)     -- 'gpt-4', 'manual', etc.
```

### `manual_parts_extracted` Table
```sql
id              SERIAL PRIMARY KEY
manual_id       INTEGER → manuals.id
part_id         INTEGER → parts.id (null if not matched)
extracted_name  VARCHAR(255)
extracted_number VARCHAR(100)
page_number     INTEGER
context_snippet TEXT
confidence_score FLOAT
status          VARCHAR(50)       -- pending, matched, rejected
```

### `manual_stats` View
Pre-joined view showing:
- Manual ID, filename, status
- Count of extracted terms
- Count of extracted parts
- Upload and processing timestamps

## API Endpoints

### Upload PDF
```bash
curl -X POST http://localhost:3000/api/manuals/upload \
  -F "pdf=@/path/to/manual.pdf"
```

**Response:**
```json
{
  "success": true,
  "manual": {
    "id": 1,
    "filename": "1730123456-carrier-manual.pdf",
    "original_filename": "carrier-manual.pdf",
    "status": "pending"
  },
  "message": "PDF uploaded successfully. Processing started in background."
}
```

### List All Manuals
```bash
curl http://localhost:3000/api/manuals
```

### Get Manual Details
```bash
curl http://localhost:3000/api/manuals/1
```

Shows:
- Manual metadata
- All extracted terms with confidence scores
- All extracted parts

### Check Processing Status
```bash
curl http://localhost:3000/api/manuals/1/status
```

## Troubleshooting

### "Database connection failed"
**Fix:** Verify your `DATABASE_URL` in `.env` is correct and Supabase database is accessible.

```bash
node -e "require('./db.js').testConnection()"
```

### "OpenAI API error"
**Fix:** Check your `OPENAI_API_KEY` in `.env` is valid.

### "No terms extracted"
**Possible causes:**
1. PDF is corrupted or encrypted
2. PDF contains no technical HVAC content
3. OCR failed on scanned PDF (check quality)
4. PDF is non-English (Tesseract configured for English only)

**Debug:**
```bash
# Test PDF text extraction
node pdf-processor.js /path/to/manual.pdf 1
```

### "OCR taking too long"
**For large scanned PDFs (100+ pages):**
- OCR can take 1-2 hours for a 140-page manual
- This is normal - OCR is CPU-intensive
- Check server logs to see progress (page X/Y)
- Consider processing smaller sections first

**Speed up OCR:**
- Ensure good PDF quality (300 DPI scans)
- Use text-based PDFs when possible (10x faster)

### "Rate limit exceeded"
**Fix:** OpenAI has rate limits. The processor already includes delays:
- 1 second between GPT-4 requests
- 100ms between embedding requests

For large PDFs, processing may take longer to avoid hitting limits.

### Processing stuck on "pending"
**Check:**
1. Server is running
2. Check server logs for errors
3. Manually trigger: `node pdf-processor.js uploads/filename.pdf <manual-id>`

## File Structure

```
jerry_hvac_app/
├── migrations/
│   └── 003_create_pdf_ingestion_tables.sql  ← Database schema
├── public/
│   └── pdf-admin.html                       ← Upload UI
├── uploads/                                  ← PDF storage (created automatically)
├── pdf-processor.js                          ← Core processor
├── server.js                                 ← API endpoints
├── run-migration.js                          ← Migration runner (this guide)
├── PDF_INGESTION_GUIDE.md                    ← Detailed documentation
└── SETUP_PDF_INGESTION.md                    ← This file
```

## Next Steps

1. ✅ Run `node run-migration.js`
2. ✅ Configure OpenAI API key in `.env`
3. ✅ Start server with `node server.js`
4. ✅ Open `http://localhost:3000/pdf-admin.html`
5. ✅ Upload your first HVAC manual PDF
6. ✅ Check extracted terms at `/api/manuals/1`

## Security Notes

- PDF files are stored locally in `./uploads/` directory
- No automatic cleanup (consider implementing retention policy)
- Maximum file size: 50MB (configurable in server.js)
- Only PDF MIME type accepted
- Database credentials in `.env` should be kept secure

## Performance

**Typical processing time:**
- 10-page manual: 1-2 minutes
- 50-page manual: 5-10 minutes
- 100-page manual: 10-20 minutes

**Factors affecting speed:**
- PDF size and page count
- Text density
- API rate limits
- Number of terms/parts to extract

## Cost Estimates (OpenAI API)

**Per 10-page manual (~5,000 words):**
- Text extraction: Free (pdf-parse library)
- GPT-4o-mini analysis: ~$0.01-0.02
- Embeddings (50 terms): ~$0.001
- **Total: ~$0.01-0.02 per manual**

## Support

For detailed information, see:
- `PDF_INGESTION_GUIDE.md` - Comprehensive guide with examples
- `migrations/003_create_pdf_ingestion_tables.sql` - Database schema
- `pdf-processor.js` - Implementation details

**Need help?** Check the server logs:
```bash
# If running with logs to file
tail -f server.log

# Or just run in foreground to see console output
node server.js
```

# 📚 PDF Ingestion System Guide

## Overview

The PDF Ingestion System automatically extracts HVAC terminology and parts from technical manuals, generates semantic embeddings, and stores them in your database for intelligent search.

---

## 🏗️ System Architecture

```
PDF Upload → Text Extraction → AI Analysis → Embeddings → Database
     ↓              ↓              ↓            ↓           ↓
  Local          pdf-parse       GPT-4      OpenAI API   PostgreSQL
  Storage                      (extract)   (embeddings)  (pgvector)
```

---

## 🚀 Quick Start

### Step 1: Run the Migration

**On your machine**, run the SQL migration to create the required tables:

```bash
# Option A: Via Supabase Dashboard
1. Go to Supabase SQL Editor
2. Copy contents of migrations/003_create_pdf_ingestion_tables.sql
3. Run the SQL

# Option B: Via psql (if you have it installed)
psql your_database_url -f migrations/003_create_pdf_ingestion_tables.sql
```

### Step 2: Start the Server

```bash
node server.js
```

### Step 3: Open the Admin UI

Navigate to: **http://localhost:3000/pdf-admin.html**

### Step 4: Upload a PDF

1. Drag and drop a PDF or click to select
2. Click "Upload PDF"
3. Watch as it processes in the background!

---

## 📊 What Gets Extracted

### HVAC Terminology

**Examples:**
- Refrigerants: R-410A, R-22, R-134A (with variations like "410A", "four ten")
- Equipment: RTU, AHU, FCU, VRF
- Voltages: 24V, 120V, 240V, 480V
- Parts: contactor, capacitor, compressor, TXV
- Measurements: CFM, tons, PSI, superheat, subcooling

**What's stored:**
- Standard term
- Common variations
- Category
- Description
- Semantic embedding (1536 dimensions)
- Provenance (which manual, page number, confidence)

### Parts Information

**Examples:**
- 24V Contactor 30A (CONT-24V-30A)
- R-410A Refrigerant per lb
- 20x25x1 Air Filter MERV 8
- Economizer Damper Actuator

**What's stored:**
- Part name
- Part number
- Category
- Description
- Price (if mentioned)
- Semantic embedding
- Extraction source

---

## 🗄️ Database Tables

### `manuals`
Tracks uploaded PDFs:
- filename, original_filename
- storage_path, file_size
- status (pending → processing → completed/failed)
- page_count, error_message
- uploaded_at, processed_at

### `hvac_term_provenance`
Links terms to source manuals:
- terminology_id → hvac_terminology.id
- manual_id → manuals.id
- page_number, context_snippet
- confidence_score, extraction_method

### `manual_parts_extracted`
Tracks parts found in manuals:
- manual_id, part_id
- extracted_name, extracted_number
- page_number, context_snippet
- confidence_score, status

### `manual_processing_jobs`
Tracks background processing jobs:
- job_type (terminology, parts, full)
- status (pending → running → completed/failed)
- progress (0-100%)
- results (extracted counts, etc.)

---

## 🔌 API Endpoints

### POST /api/manuals/upload
Upload a PDF manual for processing.

**Request:**
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
    "filename": "1698765432-carrier-manual.pdf",
    "original_filename": "carrier-manual.pdf",
    "status": "pending"
  },
  "message": "PDF uploaded successfully. Processing started in background."
}
```

### GET /api/manuals
List all uploaded manuals.

**Response:**
```json
{
  "manuals": [
    {
      "id": 1,
      "original_filename": "carrier-manual.pdf",
      "file_size": 5242880,
      "uploaded_at": "2025-10-28T...",
      "status": "completed",
      "page_count": 47
    }
  ]
}
```

### GET /api/manuals/:id
Get detailed information about a specific manual.

**Response:**
```json
{
  "manual": {
    "id": 1,
    "filename": "carrier-manual.pdf",
    "status": "completed",
    "terms_extracted": 23,
    "parts_extracted": 15,
    "page_count": 47
  },
  "terms": [
    {
      "standard_term": "R-410A",
      "category": "refrigerant",
      "confidence_score": 0.95,
      "created_at": "..."
    }
  ],
  "parts": [
    {
      "extracted_name": "24V Contactor 30A",
      "extracted_number": "CONT-24V-30A",
      "status": "matched",
      "confidence_score": 0.92
    }
  ]
}
```

### GET /api/manuals/:id/status
Check processing status.

**Response:**
```json
{
  "status": "processing",
  "processed_at": null,
  "error_message": null,
  "page_count": null
}
```

---

## 🤖 How the AI Works

### Text Extraction
- Uses `pdf-parse` library to extract text from PDFs
- Handles multi-page documents
- Preserves text structure

### Terminology Extraction
**GPT-4o-mini prompt:**
```
Extract ALL technical HVAC terms from the text.
For each term provide:
1. Standard term (e.g., "R-410A")
2. Common variations (e.g., ["R410A", "R4-10", "410A"])
3. Category (refrigerant, equipment, voltage, etc.)
4. Brief description
```

**Processing:**
- Text split into 3000-character chunks (to avoid token limits)
- Each chunk processed separately
- Results deduplicated by standard term
- Rate limited to 1 request/second

### Parts Extraction
**GPT-4o-mini prompt:**
```
Extract ALL part names and numbers from the text.
For each part provide:
1. Part name
2. Part number (if available)
3. Category
4. Description
5. Price (if mentioned)
```

**Processing:**
- Same chunking strategy as terminology
- Deduplication by part number or name
- Automatic categorization

### Embedding Generation
- Uses OpenAI `text-embedding-3-small`
- 1536-dimensional vectors
- Enables semantic search
- Rate limited to 10 requests/second

---

## 📈 Processing Status

### Status Flow:
```
pending → processing → completed
                    ↘ failed
```

### Typical Processing Time:
- 10-page manual: ~1-2 minutes
- 50-page manual: ~5-10 minutes
- 100-page manual: ~10-20 minutes

**Factors affecting speed:**
- PDF size and page count
- Text density
- API rate limits
- Number of terms/parts extracted

---

## 🧪 Testing

### Manual Test
```bash
# 1. Upload a small HVAC manual (5-10 pages)
# 2. Monitor server logs
# 3. Check status in admin UI
# 4. Query extracted terms:
curl http://localhost:3000/api/manuals/1
```

### Command Line Test
```bash
# Process a PDF directly
node pdf-processor.js /path/to/manual.pdf 1

# Watch the output:
# 📄 Extracting text...
# 🤖 Extracting HVAC terminology...
# 🔧 Extracting HVAC parts...
# 💾 Storing terminology...
# ✅ PDF processing complete!
```

### Verify in Database
```sql
-- Check extracted terms
SELECT standard_term, category, array_length(variations, 1) as variation_count
FROM hvac_terminology
ORDER BY created_at DESC
LIMIT 10;

-- Check provenance
SELECT m.original_filename, COUNT(*) as terms_extracted
FROM manuals m
JOIN hvac_term_provenance htp ON htp.manual_id = m.id
GROUP BY m.id, m.original_filename;

-- Check semantic search works
SELECT name, 1 - (embedding <=> '[...]'::vector) as similarity
FROM parts
ORDER BY embedding <=> '[...]'::vector
LIMIT 5;
```

---

## 🔧 Configuration

### Environment Variables (.env)
```bash
# Required
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://...

# Optional
PORT=3000
MAX_PDF_SIZE=52428800  # 50MB default
UPLOAD_DIR=./uploads
```

### File Storage
- PDFs stored in `./uploads/` directory
- Automatically created on first upload
- Filenames: `timestamp-random-originalname.pdf`
- No cleanup (manual deletion required)

### Rate Limiting
```javascript
// Built into pdf-processor.js
- GPT-4 requests: 1 per second
- Embedding requests: 100ms delay between
- Configurable in code
```

---

## 🐛 Troubleshooting

### PDF Upload Fails
**Error: "Only PDF files are allowed"**
- Check file type is actually PDF
- Verify MIME type: `file --mime-type manual.pdf`

**Error: "File too large"**
- Default limit: 50MB
- Edit multer config in server.js to increase

### Processing Stuck on "pending"
**Possible causes:**
1. Server not running
2. OpenAI API key invalid
3. Database connection issue

**Fix:**
```bash
# Check server logs
tail -f server.log

# Manually trigger processing
node pdf-processor.js uploads/filename.pdf <manual-id>
```

### No Terms Extracted
**Possible causes:**
1. PDF is scanned image (OCR needed)
2. PDF is corrupted
3. Text extraction failed

**Debug:**
```bash
# Test text extraction only
node -e "
const PDFParser = require('pdf-parse');
const fs = require('fs');
PDFParser(fs.readFileSync('manual.pdf')).then(data => {
  console.log('Pages:', data.numpages);
  console.log('Text length:', data.text.length);
  console.log('Sample:', data.text.substring(0, 500));
});
"
```

### Embeddings API Rate Limit
**Error: "Rate limit exceeded"**
- OpenAI has rate limits on embeddings API
- Free tier: ~3,000 requests/minute
- Paid tier: Higher limits

**Fix:**
- Increase delays in pdf-processor.js
- Process smaller PDFs first
- Upgrade OpenAI plan

---

## 💡 Best Practices

### PDF Quality
✅ **Good:**
- Text-based PDFs (not scanned)
- Clear formatting
- Technical specifications
- Parts lists

❌ **Avoid:**
- Scanned images (unless OCR added)
- Password-protected PDFs
- Corrupted files
- Non-technical content

### Batch Processing
```bash
# Process multiple PDFs
for pdf in manuals/*.pdf; do
  curl -X POST http://localhost:3000/api/manuals/upload \
    -F "pdf=@$pdf"
  sleep 10  # Wait between uploads
done
```

### Review Extracted Data
1. Check admin UI after processing
2. Verify terminology makes sense
3. Review parts for accuracy
4. Test semantic search with extracted terms

### Cleanup
```bash
# Remove old uploads (manual)
find uploads/ -type f -mtime +30 -delete

# Archive processed PDFs
mv uploads/*.pdf archive/
```

---

## 🚀 Future Enhancements

### Planned Features:
- [ ] OCR support for scanned PDFs (Tesseract.js)
- [ ] Bulk upload interface
- [ ] Manual review/approval workflow
- [ ] Automatic parts database matching
- [ ] Export extracted data to CSV
- [ ] Scheduled reprocessing
- [ ] Version tracking for manuals

### Integration Ideas:
- Supabase Storage for cloud PDF storage
- Webhook notifications on completion
- Email alerts for failed processing
- Dashboard analytics (terms/parts over time)

---

## 📚 Example Use Cases

### Case 1: New Manufacturer Catalog
```
1. Upload Carrier 2024 catalog (200 pages)
2. System extracts:
   - 150 parts with prices
   - 45 technical terms
   - All with embeddings
3. Now voice search works:
   "I need a three-ton carrier compressor"
   → Finds exact match from catalog
```

### Case 2: Technical Manual
```
1. Upload installation guide (50 pages)
2. System learns:
   - Voltage specifications
   - Wire sizing requirements
   - Clearance specifications
3. Voice normalization improves:
   "208 volt" → "208V" (learned from manual)
```

### Case 3: Parts Cross-Reference
```
1. Upload multiple OEM manuals
2. Build comprehensive parts database
3. Enable cross-manufacturer search
4. Track provenance (which manual mentions what)
```

---

## 🆘 Support

**Getting stuck?**
1. Check server logs: `tail -f server.log`
2. Test with small PDF first (5 pages)
3. Verify OpenAI API key: `echo $OPENAI_API_KEY`
4. Check database connection: `node test-db.js`

**Still need help?**
- Review the code in `pdf-processor.js`
- Check API responses in browser dev tools
- Test endpoints with curl/Postman

---

## ✅ Checklist

Before going live:
- [ ] Run migration (003_create_pdf_ingestion_tables.sql)
- [ ] Test with small PDF
- [ ] Verify terminology extracted correctly
- [ ] Check parts matched properly
- [ ] Test semantic search with new terms
- [ ] Set up monitoring/logging
- [ ] Plan PDF storage strategy
- [ ] Document internal processes

---

**Ready to process your first HVAC manual!** 🎉

Open **http://localhost:3000/pdf-admin.html** and upload a PDF to get started.

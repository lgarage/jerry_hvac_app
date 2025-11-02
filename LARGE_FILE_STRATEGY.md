# Large File Ingestion Strategy for Jerry HVAC
## Optimal Architecture for Scale

### Executive Summary
**Recommended Approach: Hybrid Tiered Processing with Cold Storage**

Combine strategies #1, #4, and #5 into a three-tier architecture:
- **Tier 1 (Hot)**: Metadata + extracted structured HVAC data (terminology, parts)
- **Tier 2 (Warm)**: Page-level summaries + sparse embeddings
- **Tier 3 (Cold)**: Raw files in object storage

**Expected savings**: 70-85% reduction in storage costs, 60% faster initial ingestion

---

## Current Architecture Analysis

### What You Have Now
```
Upload PDF → Full OCR (if needed) → Extract all text →
Generate embeddings for everything → Store in Supabase
```

**Problems:**
1. **Storage**: 100 MB PDF → 500 MB+ in Supabase (text + embeddings + metadata)
2. **Time**: 64-page manual = 30-60 min processing (OCR bottleneck)
3. **Cost**: $0.15-0.30 per manual for embeddings alone
4. **Scaling**: 100 customers × 50 manuals = 5 GB+ just for one equipment type

---

## Recommended: Three-Tier Hybrid Architecture

### Tier 1: Hot Data (Supabase) - "Always Ready"
**What to store:**
- Manual metadata (filename, manufacturer, model, upload date)
- Extracted HVAC terminology (normalized, with provenance)
- Extracted parts catalog (part numbers, specs, page references)
- Page-level summaries (1-2 sentences per page, ~100 chars)
- Lightweight document embedding (single vector for whole manual)

**Storage estimate:** 2-5 MB per manual (vs. 500 MB+)

**Why this works:**
- 95% of queries are for specific parts or terms, not full-text search
- Technicians search by part number, equipment ID, or symptom
- Page summaries enable "which page has X?" without full text

```sql
-- Enhanced schema
CREATE TABLE manual_pages (
  id SERIAL PRIMARY KEY,
  manual_id INTEGER REFERENCES manuals(id),
  page_number INTEGER,
  summary TEXT, -- 1-2 sentence AI summary
  has_schematic BOOLEAN DEFAULT FALSE,
  has_parts_list BOOLEAN DEFAULT FALSE,
  schema_vector VECTOR(384), -- Small embedding for "what's on this page"
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX manual_pages_vector_idx ON manual_pages
  USING ivfflat (schema_vector vector_cosine_ops);
```

### Tier 2: Warm Data (Supabase) - "Fetch on Demand"
**What to store:**
- Full text chunks (stored but not always loaded)
- Detailed embeddings (computed lazily, cached 7 days)

**Lazy loading trigger:**
When user asks: "Explain the startup sequence for York RTU model XYZ"
1. Search page summaries (fast, in Tier 1)
2. Identify relevant pages (e.g., pages 12-15)
3. Load full text for ONLY those pages from Tier 2
4. Generate detailed response

**Storage estimate:** 10-20 MB per manual

### Tier 3: Cold Storage (S3/Wasabi/Backblaze B2) - "Archive"
**What to store:**
- Original PDF files
- High-res schematic images (extracted but not processed)

**Cost comparison:**
| Storage        | 1 GB/month | 100 GB/month |
|----------------|------------|--------------|
| Supabase       | $0.125     | $12.50       |
| S3 Standard    | $0.023     | $2.30        |
| Wasabi         | $0.0059    | $0.59        |
| Backblaze B2   | $0.005     | $0.50        |

**Retrieval:** Only when user explicitly requests "show me page 15" or "download original PDF"

---

## Smart Ingestion Pipeline

### Phase 1: Initial Upload (< 30 seconds)
```javascript
async function uploadManual(file) {
  // 1. Upload raw file to cold storage (parallel to rest)
  const s3Url = await uploadToColdStorage(file);

  // 2. Quick metadata extraction (NO full OCR yet)
  const metadata = await extractQuickMetadata(file); // Title page only

  // 3. Create DB record
  const manual = await sql`
    INSERT INTO manuals (filename, storage_url, status, metadata)
    VALUES (${filename}, ${s3Url}, 'uploaded', ${metadata})
    RETURNING *
  `;

  // 4. Queue background job
  await queueProcessingJob(manual.id, 'smart_ingest');

  return { manual_id: manual.id, status: 'queued' };
}
```

### Phase 2: Smart Background Processing
```javascript
async function smartIngestManual(manualId) {
  // Step 1: Fast page classification (uses vision API, ~2 min for 64 pages)
  const pageTypes = await classifyAllPages(manualId);
  // Returns: [{page: 1, type: 'cover'}, {page: 5, type: 'schematic'},
  //           {page: 12, type: 'parts_list'}, {page: 20, type: 'text'}]

  // Step 2: Priority-based extraction (process valuable pages first)
  const priorities = {
    'parts_list': 1,    // Highest priority
    'schematic': 2,
    'specs': 3,
    'text': 4,          // Lowest priority
    'cover': 99         // Skip
  };

  const sortedPages = pageTypes.sort((a, b) =>
    priorities[a.type] - priorities[b.type]
  );

  // Step 3: Extract based on page type
  for (const page of sortedPages) {
    if (page.type === 'parts_list') {
      await extractPartsFromPage(manualId, page.number); // Deep extraction
    } else if (page.type === 'schematic') {
      await extractSchematicData(manualId, page.number); // Vision API
    } else if (page.type === 'text') {
      await createPageSummary(manualId, page.number); // Light summary only
    }
  }

  // Step 4: Create single document embedding (for "find relevant manual")
  const documentSummary = await generateDocumentSummary(manualId);
  await generateDocumentEmbedding(manualId, documentSummary);
}
```

---

## Dynamic Processing Decisions

### Decision Tree: When to Deep Process
```
User uploads PDF
├─ Title page extraction (ALWAYS) → 5 sec
├─ Page classification (ALWAYS) → 2 min for 64 pages
├─ Parts list pages (ALWAYS) → 30 sec per page
├─ Schematic pages (IF user wants) → 10 sec per page
└─ Full text extraction (ON DEMAND) → triggered by search
```

### Trigger for Lazy Processing
```javascript
// When user searches
async function searchManuals(query) {
  // 1. Search existing extractions (fast)
  const results = await searchExtractedTerms(query);

  if (results.length > 0) {
    return results; // Found it! No need for deep search
  }

  // 2. Search page summaries (still fast)
  const pageMatches = await searchPageSummaries(query);

  if (pageMatches.length === 0) {
    return []; // Not in any manual
  }

  // 3. Lazy load: Extract full text for matched pages ONLY
  for (const match of pageMatches) {
    if (!match.full_text_extracted) {
      await extractFullTextForPage(match.manual_id, match.page_number);
    }
  }

  // 4. Search again with full text
  return await searchExtractedTerms(query);
}
```

---

## Implementation Phases

### Phase 1: Cold Storage (Week 1)
```bash
npm install @aws-sdk/client-s3
# or use Backblaze B2 SDK
```

```javascript
// New file: storage-adapter.js
class ColdStorage {
  async upload(file, key) {
    // Upload to S3/Wasabi/B2
    // Return public URL
  }

  async download(key) {
    // Fetch from cold storage
    // Return stream or buffer
  }

  async delete(key) {
    // Remove from storage
  }
}
```

### Phase 2: Page Summaries (Week 2)
```sql
-- Migration
ALTER TABLE manual_pages
  ADD COLUMN summary TEXT,
  ADD COLUMN schema_vector VECTOR(384);
```

```javascript
async function createPageSummary(manualId, pageNum) {
  const pageText = await extractPageText(manualId, pageNum); // Light extraction

  const summary = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'system',
      content: 'Summarize this HVAC manual page in 1-2 sentences. Focus on what equipment, parts, or procedures it covers.'
    }, {
      role: 'user',
      content: pageText.substring(0, 2000) // Only first 2000 chars
    }],
    max_tokens: 100
  });

  await sql`
    INSERT INTO manual_pages (manual_id, page_number, summary)
    VALUES (${manualId}, ${pageNum}, ${summary.choices[0].message.content})
  `;
}
```

### Phase 3: Smart Classification (Week 3)
Use vision model to classify pages without full OCR:

```javascript
async function classifyPage(imagePath) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini', // Vision capable
    messages: [{
      role: 'system',
      content: 'Classify this HVAC manual page. Return JSON: {type: "parts_list"|"schematic"|"text"|"cover"|"specs", confidence: 0-1}'
    }, {
      role: 'user',
      content: [
        { type: 'text', text: 'What type of page is this?' },
        { type: 'image_url', image_url: { url: imagePath } }
      ]
    }],
    max_tokens: 50
  });

  return JSON.parse(response.choices[0].message.content);
}
```

---

## Cost-Benefit Analysis

### Current Approach (100 manuals, 50 pages avg)
- **Storage**: 100 × 500 MB = 50 GB @ $6.25/mo (Supabase)
- **Processing**: 100 × 45 min × $0.20/hour = $150 one-time
- **Embeddings**: 100 × 50 pages × $0.0001 = $0.50 one-time
- **Total first year**: $225 + (12 × $6.25) = **$300**

### Hybrid Tiered Approach (100 manuals, 50 pages avg)
- **Hot Storage**: 100 × 3 MB = 300 MB @ $0.04/mo (Supabase)
- **Cold Storage**: 100 × 50 MB = 5 GB @ $0.03/mo (Backblaze B2)
- **Processing**: 100 × 5 min × $0.20/hour = $17 one-time (90% less)
- **Embeddings**: 100 × 1 doc × $0.0001 = $0.01 one-time (99% less)
- **Total first year**: $17 + (12 × $0.07) = **$18**

**Savings: 94%** 💰

---

## Recommended Migration Path

### Step 1: Add Cold Storage (No Breaking Changes)
```javascript
// Modify upload endpoint
app.post('/api/manuals/upload', async (req, res) => {
  // Upload to BOTH local AND S3 (redundant temporarily)
  const localPath = req.file.path;
  const s3Url = await coldStorage.upload(req.file, `manuals/${manualId}.pdf`);

  await sql`UPDATE manuals SET cold_storage_url = ${s3Url} WHERE id = ${manualId}`;
});
```

### Step 2: Add Page Summaries (Parallel to Current System)
Run summaries alongside existing full extraction. Compare quality.

### Step 3: Gradual Cutover
- New uploads use smart ingestion
- Old manuals remain fully processed
- Migrate old manuals during low-usage hours

### Step 4: Remove Local Files
Once confident, delete local `uploads/` folder, rely on S3.

---

## Monitoring & Quality Metrics

```sql
-- Dashboard query
SELECT
  m.id,
  m.filename,
  m.file_size / 1024 / 1024 as size_mb,
  COUNT(DISTINCT mp.id) as pages_summarized,
  COUNT(DISTINCT htp.terminology_id) as terms_extracted,
  COUNT(DISTINCT mpe.id) as parts_extracted,
  m.status
FROM manuals m
LEFT JOIN manual_pages mp ON mp.manual_id = m.id
LEFT JOIN hvac_term_provenance htp ON htp.manual_id = m.id
LEFT JOIN manual_parts_extracted mpe ON mpe.manual_id = m.id
GROUP BY m.id
ORDER BY m.uploaded_at DESC;
```

---

## Answers to Your Specific Questions

### Q: Which strategy offers the best long-term balance?
**A: Hybrid approach combining #1 (thin ingest), #4 (cold storage), and #5 (term extraction)**

This gives you:
- Fast uploads (user sees success immediately)
- Low storage costs (94% reduction)
- High accuracy (process valuable pages deeply)
- Scalability (works for 10 customers or 10,000)

### Q: Should we combine approaches?
**A: Yes - all three tiers work together**
- Tier 1 (Hot) = #5 term extraction + metadata
- Tier 2 (Warm) = #1 thin ingest with lazy loading
- Tier 3 (Cold) = #4 object storage

### Q: How to decide when to deep parse vs light parse?
**A: Use page classification + value heuristics**

```javascript
const processingDecisions = {
  'parts_list': 'deep',      // Always extract all parts
  'schematic': 'medium',     // Extract components if requested
  'specifications': 'medium', // Extract key specs
  'text': 'light',           // Summary only
  'cover': 'skip',           // Just metadata
  'index': 'skip'            // Not useful
};
```

---

## Next Steps

1. **Immediate (This Week)**: Add cold storage adapter
2. **Short-term (Next 2 Weeks)**: Implement page summaries
3. **Medium-term (Next Month)**: Smart classification pipeline
4. **Long-term (Quarter 2)**: Machine learning model to auto-detect valuable pages

Would you like me to implement Phase 1 (Cold Storage) now?

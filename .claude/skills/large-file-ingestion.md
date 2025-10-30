# Large File Ingestion Builder

You are helping implement the three-tier hybrid ingestion architecture for Jerry HVAC app.

## Context
The app needs to handle large HVAC manuals (10-100 MB PDFs) efficiently. The strategy documents are in:
- `LARGE_FILE_STRATEGY.md` - Full technical specification
- `INGESTION_FLOW.md` - Visual diagrams and examples

## Architecture Overview

**Three-Tier System:**
- **Tier 1 (Hot)**: Supabase - Structured data (parts, terms, summaries) - 2-5 MB per manual
- **Tier 2 (Warm)**: Supabase - Full text, lazy-loaded - 10-20 MB per manual
- **Tier 3 (Cold)**: S3/Wasabi/B2 - Original PDFs - 50-100 MB per manual

## Implementation Phases

### Phase 1: Cold Storage Adapter (Week 1)
**Goal**: Upload files to S3/Wasabi/B2 instead of local storage

**Tasks:**
1. Install storage SDK: `npm install @aws-sdk/client-s3` or Backblaze B2
2. Create `storage-adapter.js` with upload/download/delete methods
3. Add environment variables for storage credentials
4. Modify `/api/manuals/upload` endpoint to use cold storage
5. Keep local storage temporarily (parallel systems)
6. Test upload and retrieval

**Files to modify:**
- `server.js` - Upload endpoint
- `.env` - Storage credentials
- Create: `storage-adapter.js`

**Success criteria:**
- New uploads go to cold storage
- Can retrieve files from cold storage
- Existing functionality unchanged

### Phase 2: Page Classification (Week 2-3)
**Goal**: Classify pages by type without full OCR

**Tasks:**
1. Add `manual_pages` table migration
2. Create page classification function using vision API
3. Extract pages as images for classification
4. Store page types in database
5. Create priority queue based on page type

**Schema:**
```sql
CREATE TABLE manual_pages (
  id SERIAL PRIMARY KEY,
  manual_id INTEGER REFERENCES manuals(id),
  page_number INTEGER,
  page_type VARCHAR(50), -- parts_list, schematic, text, specs, cover
  summary TEXT,
  has_schematic BOOLEAN DEFAULT FALSE,
  has_parts_list BOOLEAN DEFAULT FALSE,
  confidence_score FLOAT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Files to modify:**
- Create: `migrations/004_add_manual_pages.sql`
- `pdf-processor.js` - Add classification step
- `server.js` - Add page classification endpoint

### Phase 3: Smart Processing (Week 3-4)
**Goal**: Process pages based on priority and type

**Tasks:**
1. Implement priority-based processing queue
2. Deep extraction for parts_list pages
3. Vision extraction for schematics
4. Summary-only for text pages
5. Skip cover/index pages

**Priority levels:**
```javascript
const PROCESSING_PRIORITY = {
  'parts_list': 1,    // Deep OCR + parsing
  'schematic': 2,     // Vision API extraction
  'specifications': 3, // Light OCR for key values
  'text': 4,          // Summary only
  'cover': 99,        // Skip
  'index': 99         // Skip
};
```

**Files to modify:**
- `pdf-processor.js` - Add smart processing logic
- Create: `page-processors/parts-list-processor.js`
- Create: `page-processors/schematic-processor.js`
- Create: `page-processors/summary-processor.js`

### Phase 4: Lazy Loading (Week 5-6)
**Goal**: Load full text only when needed

**Tasks:**
1. Modify search to check Tier 1 first
2. Add on-demand full-text extraction endpoint
3. Cache extracted text for 7 days
4. Monitor cache hit rates
5. Update UI to show loading states

**API endpoints:**
```javascript
GET /api/manuals/:id/page/:num/summary    // Fast (Tier 1)
GET /api/manuals/:id/page/:num/full-text  // Lazy load (Tier 2)
GET /api/manuals/:id/download              // Cold storage (Tier 3)
```

**Files to modify:**
- `server.js` - Add lazy load endpoints
- `public/app.js` - Update search logic
- Create: `cache-manager.js`

### Phase 5: Migration (Month 3)
**Goal**: Move old manuals to new architecture

**Tasks:**
1. Create migration script for existing manuals
2. Reprocess old manuals in background
3. Move old files to cold storage
4. Delete local `uploads/` folder
5. Update documentation

## Guidelines for Implementation

### When Implementing Cold Storage
```javascript
// storage-adapter.js template
class StorageAdapter {
  constructor(provider) {
    // Initialize S3, Wasabi, or B2 client
  }

  async upload(file, key) {
    // Upload file, return URL
  }

  async download(key) {
    // Download file, return buffer/stream
  }

  async delete(key) {
    // Remove file from storage
  }

  async exists(key) {
    // Check if file exists
  }
}
```

### When Adding Page Classification
- Use GPT-4o-mini vision (fast and cheap)
- Classify in batches of 10 pages
- Store confidence scores
- Fall back to text-based classification if vision fails

### When Implementing Smart Processing
- Always process parts_list pages deeply
- Skip cover/index pages completely
- Use page summaries as fallback for search
- Monitor processing time per page type

### When Adding Lazy Loading
- Check Tier 1 data first (fast)
- Only load Tier 2 if needed
- Cache aggressively (7-day TTL)
- Show loading indicators to user

## Common Issues and Solutions

### Issue: Cold storage upload slow
**Solution**: Upload asynchronously, return success immediately

### Issue: Page classification inaccurate
**Solution**: Add confidence threshold, fall back to keyword detection

### Issue: OCR too expensive for all pages
**Solution**: Only OCR pages classified as valuable (parts_list, specs)

### Issue: Search quality degraded
**Solution**: Ensure page summaries are detailed enough, add keywords

### Issue: Mobile performance poor
**Solution**: Implement progressive loading, cache Tier 1 data

## Testing Strategy

### Unit Tests
- Cold storage: upload, download, delete
- Page classification: accuracy on sample pages
- Smart processing: correct priority ordering
- Lazy loading: cache hit/miss rates

### Integration Tests
- Full pipeline: upload → classify → extract → search
- Parallel systems: old and new work side-by-side
- Migration: old manuals converted correctly

### Performance Tests
- Upload time < 30 seconds
- Search latency < 1 second
- Page load time < 2 seconds on 4G
- Storage cost reduction > 90%

## Monitoring Metrics

Track these during implementation:

```sql
-- Cost metrics
SELECT
  COUNT(*) as total_manuals,
  SUM(file_size) / 1024 / 1024 / 1024 as local_gb,
  COUNT(*) * 3 / 1024 as tier1_gb,
  COUNT(*) * 15 / 1024 as tier2_gb,
  SUM(file_size) / 1024 / 1024 / 1024 as tier3_gb
FROM manuals;

-- Processing metrics
SELECT
  page_type,
  COUNT(*) as pages_count,
  AVG(processing_time_ms) as avg_time_ms,
  AVG(confidence_score) as avg_confidence
FROM manual_pages
GROUP BY page_type;

-- Search metrics
SELECT
  tier,
  COUNT(*) as queries,
  AVG(response_time_ms) as avg_time
FROM search_logs
GROUP BY tier;
```

## When User Asks to Implement

1. **Read strategy documents first**: `LARGE_FILE_STRATEGY.md` and `INGESTION_FLOW.md`
2. **Ask which phase** they want to start with
3. **Check dependencies**: Earlier phases needed for later phases
4. **Create todos** for the phase tasks
5. **Implement incrementally**: Test each component
6. **Add monitoring**: Track metrics as you go
7. **Document changes**: Update README with new architecture

## Key Principles

- **Non-breaking changes**: Keep old system working during migration
- **Parallel systems**: Run old and new side-by-side initially
- **Progressive enhancement**: Each phase adds value independently
- **Cost-conscious**: Always choose cheaper option when possible
- **Mobile-first**: Design for slow connections and limited storage
- **Measure everything**: Track costs, performance, quality

## Example Commands

Start Phase 1:
```
Implement Phase 1 of the large file ingestion strategy
```

Check progress:
```
Show me the status of ingestion implementation
```

Troubleshoot:
```
Cold storage uploads are failing, help debug
```

Migrate old files:
```
Create a script to migrate existing manuals to cold storage
```

## Success Indicators

- ✅ New uploads complete in < 30 seconds
- ✅ Storage costs reduced by > 90%
- ✅ Search latency < 1 second
- ✅ Mobile app works offline for common tasks
- ✅ No degradation in search quality
- ✅ Can scale to 20,000+ manuals

---

Remember: This is a multi-week project. Break it into small, testable increments. Keep old system working until new system is proven. Measure everything!

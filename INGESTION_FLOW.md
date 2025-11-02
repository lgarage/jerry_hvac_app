# Jerry HVAC - Smart Ingestion Flow Diagram

## Upload & Initial Processing (< 30 seconds)

```
┌─────────────────┐
│  Technician     │
│  Uploads PDF    │
│  (64 pages)     │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  IMMEDIATE RESPONSE (User sees "Upload successful!")    │
└─────────────────────────────────────────────────────────┘
         │
         ├─────────────────┬──────────────────┬────────────────────┐
         ▼                 ▼                  ▼                    ▼
    ┌────────┐      ┌──────────┐      ┌───────────┐      ┌─────────────┐
    │ Metadata│      │ Upload to│      │ Extract   │      │ Create job  │
    │ Extract │      │ S3/B2    │      │ Title Page│      │ queue entry │
    │ (5 sec) │      │ (async)  │      │ (10 sec)  │      │ (instant)   │
    └────────┘      └──────────┘      └───────────┘      └─────────────┘
```

## Background Processing (Smart & Selective)

```
┌─────────────────────────────────────────────────────────┐
│  BACKGROUND JOB (runs asynchronously)                   │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Step 1: Page Classification (2-3 min)   │  ← Vision API
│ • No OCR needed!                         │  ← Fast!
│ • Classify all 64 pages: parts_list,    │
│   schematic, text, specs, cover         │
└─────────────────┬───────────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │  Page Types    │
         │  Identified    │
         └────────┬───────┘
                  │
      ┌───────────┼───────────────┬──────────────┐
      ▼           ▼               ▼              ▼
┌──────────┐ ┌─────────┐  ┌─────────────┐  ┌─────────┐
│Parts List│ │Schematic│  │Specs/Tables │  │Text Page│
│Pages     │ │Pages    │  │Pages        │  │Pages    │
│(Priority 1)│(Priority 2)│(Priority 3) │  │(Priority 4)
└─────┬────┘ └────┬────┘  └──────┬──────┘  └────┬────┘
      │           │              │              │
      ▼           ▼              ▼              ▼
 ┌─────────┐ ┌──────────┐  ┌──────────┐  ┌──────────┐
 │Deep OCR │ │Vision API│  │Light OCR │  │Summary   │
 │+ Parse  │ │Extract   │  │+ Extract │  │Only      │
 │All Parts│ │Components│  │Key Values│  │(100 chars)
 └─────────┘ └──────────┘  └──────────┘  └──────────┘
      │           │              │              │
      └───────────┴──────────────┴──────────────┘
                  │
                  ▼
         ┌────────────────┐
         │  Store in DB:  │
         │ • Parts catalog │
         │ • Terminology  │
         │ • Page summaries│
         │ • Page types   │
         └────────────────┘
```

## Search & Retrieval (Fast!)

```
┌──────────────────────────────────────────┐
│ Technician searches: "24V transformer"   │
└─────────────────┬────────────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │ Query Vector   │
         │ Search Engine  │
         └────────┬───────┘
                  │
      ┌───────────┼──────────────┐
      ▼           ▼              ▼
┌──────────┐ ┌─────────┐  ┌────────────┐
│Parts DB  │ │Term DB  │  │Page Summary│
│(indexed) │ │(indexed)│  │Embeddings  │
└─────┬────┘ └────┬────┘  └──────┬─────┘
      │           │              │
      └───────────┴──────────────┘
                  │
                  ▼
         ┌────────────────┐
         │ Found Results: │
         │ • Part match   │
         │ • Manual ref   │
         │ • Page #12     │
         └────────┬───────┘
                  │
                  ▼
    ┌─────────────────────────┐
    │ Need full context?      │
    └───┬─────────────────┬───┘
        │ NO              │ YES
        ▼                 ▼
    ┌────────┐      ┌─────────────┐
    │Return  │      │Lazy Load    │
    │Summary │      │Page 12 Text │
    └────────┘      │from Tier 2  │
                    └─────────────┘
```

## Storage Tiers (Data at Rest)

```
┌────────────────────────────────────────────────────────┐
│  TIER 1: HOT (Supabase - Always Fast)                  │
│  ────────────────────────────────────────────────────  │
│  • Manual metadata (filename, manufacturer, model)     │
│  • Parts catalog (normalized, indexed)                 │
│  • HVAC terminology (with provenance)                  │
│  • Page summaries (1-2 sentences each)                 │
│  • Document embedding (1 vector per manual)            │
│  ────────────────────────────────────────────────────  │
│  Size: 2-5 MB per manual                               │
│  Access: Sub-second                                    │
│  Cost: $0.125/GB/month                                 │
└────────────────────────────────────────────────────────┘
                        ↕ (Rarely accessed)
┌────────────────────────────────────────────────────────┐
│  TIER 2: WARM (Supabase - On Demand)                   │
│  ────────────────────────────────────────────────────  │
│  • Full text chunks (per page)                         │
│  • Detailed embeddings (cached 7 days)                 │
│  • Extracted images (low-res previews)                 │
│  ────────────────────────────────────────────────────  │
│  Size: 10-20 MB per manual                             │
│  Access: 1-2 seconds (lazy load)                       │
│  Cost: $0.125/GB/month                                 │
└────────────────────────────────────────────────────────┘
                        ↕ (Very rarely accessed)
┌────────────────────────────────────────────────────────┐
│  TIER 3: COLD (S3/Wasabi/B2 - Archive)                 │
│  ────────────────────────────────────────────────────  │
│  • Original PDF files                                  │
│  • High-res schematic images                           │
│  • Raw OCR output (if needed again)                    │
│  ────────────────────────────────────────────────────  │
│  Size: 50-100 MB per manual                            │
│  Access: 5-10 seconds (download + process)             │
│  Cost: $0.005/GB/month (99% cheaper!)                  │
└────────────────────────────────────────────────────────┘
```

## Real-World Example: York RTU Manual (84 pages, 45 MB)

### Old Way (Current)
```
Upload → Wait 45 minutes → Done
         ↓
         • OCR all 84 pages (slow!)
         • Generate 84 × 1536-dim embeddings
         • Store 500 MB in Supabase
         • Cost: $0.30 processing + $0.06/month storage
```

### New Way (Proposed)
```
Upload → 20 seconds → Available for search!
         ↓
         • Upload to B2: 45 MB @ $0.0002/month
         • Classify 84 pages (vision): 2 min
         • Extract 12 parts-list pages (deep): 6 min
         • Extract 8 schematic pages (medium): 2 min
         • Summarize 64 other pages (light): 3 min
         • Store 4 MB in Supabase
         • Cost: $0.08 processing + $0.005/month storage

Total savings: 73% cost, 10x faster to "ready"
```

## Scaling to Planet Fitness (Example)

### Scenario
- 2,000 locations
- Each location has 10 different HVAC units
- Each unit has 1 manual (avg 50 pages, 30 MB)
- Total: 20,000 manuals

### Old Architecture
```
Storage: 20,000 × 500 MB = 10 TB
Cost:    10,000 GB × $0.125 = $1,250/month
Time:    20,000 × 45 min = 625 days of processing!
```

### New Architecture
```
Tier 1 (Hot):  20,000 × 3 MB = 60 GB @ $7.50/month
Tier 2 (Warm): 20,000 × 15 MB = 300 GB @ $37.50/month
Tier 3 (Cold): 20,000 × 30 MB = 600 GB @ $3.00/month (B2)

Total: $48/month (96% savings!)
Processing: 20,000 × 10 min = 139 days → Parallelized to 1 week
```

## Mobile/PWA Performance

### Challenge: Field technicians on slow 4G connections

### Solution: Progressive Data Loading
```
1. Technician opens manual on phone
   └─ Load: Metadata + parts list (200 KB) ← Fast!

2. Technician searches "capacitor"
   └─ Return: Structured part data (10 KB) ← Instant!

3. Technician taps "View Page 23"
   └─ Load: Page summary (1 KB) ← Immediate
   └─ Background load: Full text (50 KB) ← 1-2 sec on 4G

4. Technician requests "Download PDF"
   └─ Only THEN fetch from cold storage ← User expects delay
```

### Offline Support
```javascript
// Service worker caches hot data
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('jerry-v1').then((cache) => {
      return cache.addAll([
        '/api/parts',           // ← Tier 1 (small, cacheable)
        '/api/terminology',     // ← Tier 1 (small, cacheable)
        '/api/manuals/metadata' // ← Tier 1 (small, cacheable)
      ]);
    })
  );
});

// Don't cache Tier 2 or Tier 3 (too large)
```

## Decision Matrix: When to Process Deeply

| Page Type      | Initial Extract | Deep Process Trigger | Typical Content |
|----------------|-----------------|----------------------|-----------------|
| Parts List     | ✅ ALWAYS       | On upload            | Part #s, prices |
| Schematic      | Summary only    | User views page      | Wiring diagrams |
| Specifications | Key values      | User searches spec   | Voltage, BTU    |
| Procedures     | Summary only    | User opens section   | Step-by-step    |
| Index          | ❌ SKIP         | Never                | Page references |
| Cover/Legal    | ❌ SKIP         | Never                | Copyright info  |

---

## Implementation Priority

### Phase 1: Quick Wins (Week 1)
✅ Add cold storage (S3/B2) for new uploads
✅ Keep existing processing for now (parallel systems)

### Phase 2: Smart Classification (Week 2-3)
✅ Add page classification using vision API
✅ Store page types in database
✅ Use for new uploads only

### Phase 3: Tiered Extraction (Week 4-5)
✅ Implement priority-based processing
✅ Create page summaries instead of full embeddings
✅ Monitor quality metrics

### Phase 4: Lazy Loading (Week 6-8)
✅ Modify search to check hot data first
✅ Add on-demand full-text extraction
✅ Test with real technician workflows

### Phase 5: Migration (Month 3)
✅ Move old manuals to new architecture
✅ Delete local files, rely on cold storage
✅ Celebrate 90%+ cost savings! 🎉

---

**Ready to start implementation?** Let me know which phase to begin with!

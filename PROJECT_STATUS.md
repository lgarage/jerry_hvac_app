# Jerry HVAC - Project Status & Roadmap
**Last Updated:** October 31, 2025
**Status:** Paused - Phase 1 MVP In Progress (33% Complete)
**Next Pickup:** Q1 2026 (estimated)

---

## 🎯 Executive Summary

**Vision:** Voice-first field service documentation for HVAC technicians that learns from corrections and automates paperwork.

**Market Opportunity:**
- HVAC techs spend 30-45 min/day on paperwork
- Voice-to-structured-data saves 20+ min/day per tech
- $50-100/month per tech SaaS model = $600-1200/year
- 10 techs = $6K-12K ARR potential for small companies
- Learning system gets smarter with use (competitive moat)

**Current State:** Core AI parsing works. Job tracking foundation complete. Need to finish Phase 1 MVP (photo capture, OCR, labor hours) before customer trials.

---

## ✅ What's COMPLETE (Working Now)

### Voice-to-Parts Pipeline ✅
**Status:** PRODUCTION READY

The core value prop works:
1. Tech speaks: "RTU-1 needs 4 pounds of 410A and two 24x24x2 pleated filters"
2. System transcribes (Whisper)
3. Normalizes HVAC terms (embeddings: "4-10" → "R-410A")
4. Parses equipment, problems, parts (GPT-4)
5. Auto-matches parts from catalog (semantic search)
6. Shows tech for confirmation
7. Logs corrections for ML learning

**Key Safety:** Never fuzzy-matches refrigerants (R-410A ≠ R-22)

**Files:**
- `server.js` lines 1-2000: Transcription, normalization, parsing
- `public/app.js`: Voice recording, UI display
- `migrations/001_create_tables.sql`: Parts table with vectors
- `migrations/002_create_hvac_terminology.sql`: Terms database

### Parts & Terminology Databases ✅
**Status:** PRODUCTION READY

- 40+ HVAC terms with variations (R-410A, RTU, damper actuator, etc.)
- Semantic search with embeddings (1536-dim vectors)
- Parts catalog with auto-matching
- Corrections logging system (teaches the AI)
- Lexicon cache for fast lookups

**Files:**
- `data/lexicon.json`: Fast synonym cache
- `data/lexicon_corrections.json`: ML training data
- `seed-terminology.js`: Initial term seeding

### Conversational Chat (Jerry) ✅
**Status:** PRODUCTION READY

- Message type detection (conversational vs repair docs)
- Concise answers (2-3 sentences)
- Session-based chat history
- Toggle between chat and repairs view

**Files:**
- `server.js` lines 95-280: Chat session management
- `public/index.html`: Chat UI with bubbles

### Job Tracking Foundation ✅
**Status:** DATABASE READY, UI INCOMPLETE

Implemented (October 31, 2025):
- Customer/Equipment/Jobs database schema
- Auto job numbers: **0001NRP** format (sequential + location + type)
  - 0001NRP = First job, Neenah, Repair
  - 0002NQR = Quoted Repair
  - 0003NSC = Service Call
  - 0004NPM = Preventive Maintenance
- Atomic counter (never resets, race-condition safe)
- CSV bulk import for equipment data
- Equipment admin dashboard

**Files:**
- `migrations/004_create_mvp_foundation.sql`: Customers, equipment, jobs
- `migrations/005_update_job_number_format.sql`: Sequential job numbers
- `public/equipment-admin.html`: Admin dashboard
- `server.js` lines 3022-3571: Job API endpoints

**What Works:**
- Create customers via API
- Create equipment via CSV import or API
- Create jobs with auto job numbers
- Equipment tracks: model, serial, manufacturer, tonnage, refrigerant

**What's Missing:**
- No photo capture yet
- OCR not wired to job workflow
- No labor hours entry UI
- No tech signature capture
- Parts parsing not connected to jobs table

---

## ⚠️ What's INCOMPLETE (Phase 1 MVP)

### 1. OCR Nameplate Integration ❌
**Status:** Code exists, not integrated

**Current:** OCR can extract text from uploaded PDFs/images
**Needed:** Wire OCR into job workflow
- Tech takes photo of equipment nameplate
- OCR extracts manufacturer, model, serial number
- Auto-populates equipment record
- Saves to `equipment` table

**Impact:** Saves 2-3 min per service call (no manual data entry)

**Estimated Work:** 4-6 hours
- Add camera button to job creation UI
- Call existing OCR endpoint
- Parse manufacturer/model/serial from OCR result
- Auto-fill equipment form fields

**Files to Modify:**
- `public/index.html`: Add camera button
- `public/app.js`: Add photo capture function
- `server.js`: Wire `/api/parse` OCR to equipment creation

---

### 2. Photo Capture & Storage ❌
**Status:** Schema ready, UI not built

**Current:** Jobs table has `photos` and `nameplate_photos` JSONB fields
**Needed:** Camera access, upload, display
- Mobile camera access (Web API)
- Photo upload to storage (start with local, migrate to S3 later)
- Display photos in job view
- Attach to jobs.photos JSONB array

**Impact:** Critical for field documentation, parts ordering accuracy

**Estimated Work:** 8-10 hours
- Camera access UI (mobile-first)
- File upload endpoint
- Storage solution (uploads/ folder initially)
- Display photos in job cards
- Swipe/gallery view

**Files to Create/Modify:**
- `public/index.html`: Camera capture UI
- `public/app.js`: Photo capture logic
- `server.js`: Photo upload endpoint (use multer)
- Create `uploads/photos/` directory

---

### 3. Labor Hours & Tech Signature ❌
**Status:** Schema ready, UI not built

**Current:** Jobs table has `labor_hours` and `tech_signature` fields
**Needed:** Form to log hours and sign off
- Input field for labor hours (decimal: 2.5 hours)
- Signature capture (canvas or typed name)
- Lock job after signature (prevent edits)
- Display in job summary

**Impact:** Required for billing, payroll, customer invoicing

**Estimated Work:** 4-6 hours
- Labor hours input field
- Signature capture (HTML5 canvas or simple text input)
- Update job status to "completed" on sign-off
- Display signature and hours in job view

**Files to Modify:**
- `public/index.html`: Add labor/signature form
- `public/app.js`: Submit labor hours
- `server.js`: PATCH /api/jobs/:id (already supports these fields)

---

### 4. Wire Parts Parsing to Jobs ❌
**Status:** Parsing works, not saved to jobs

**Current:** Parts parsing extracts parts from voice/text
**Needed:** Save parsed parts to `jobs.parts_used` JSONB field
- When tech submits repair, save parts to job record
- Link repair submission to job creation
- Display parts used in job summary

**Impact:** Enables parts inventory tracking, billing, reporting

**Estimated Work:** 2-4 hours
- Modify `/api/submit-repairs` to create job record
- Save `parts_used` array to jobs.parts_used
- Display parts in job view

**Files to Modify:**
- `server.js`: Update `/api/submit-repairs` endpoint
- `public/app.js`: Link repair submission to job creation

---

## 📊 Phase 1 MVP Completion Checklist

According to `.claude/skills/jerry-hvac-roadmap.md`:

- [x] **1. Auto job numbers** ✅ COMPLETE (0001NRP format)
- [x] **2. Model/serial storage** ✅ COMPLETE (equipment table + CSV import)
- [ ] **3. OCR nameplate extraction** ⏳ Code exists, needs UI integration (4-6 hours)
- [ ] **4. Photo documentation** ⏳ Schema ready, needs camera UI (8-10 hours)
- [ ] **5. Parse parts from repairs** ⏳ Parsing works, needs job linking (2-4 hours)
- [ ] **6. Labor hours + signature** ⏳ Schema ready, needs form UI (4-6 hours)

**Total Remaining:** ~18-26 hours to complete Phase 1 MVP

**Current Progress:** 2/6 items = **33% complete**

---

## 💰 Business Potential & Revenue Path

### Target Market
- **Primary:** Small HVAC companies (5-20 techs)
- **Secondary:** Solo techs, medium companies (20-50 techs)
- **Geography:** Start Neenah/Wisconsin, expand nationally

### Pricing Model (Estimated)
- **Per Tech:** $50-100/month
- **10 techs:** $500-1000/month = $6K-12K/year
- **50 techs:** $2.5K-5K/month = $30K-60K/year

### Value Proposition
**Time Savings:**
- 20-30 min/day saved on paperwork
- = 8-12 hours/month per tech
- = $200-400/month value (at $25/hr labor cost)
- → $50-100/month software cost = 75-80% cost savings

**Accuracy Improvements:**
- Fewer incorrect parts ordered (refrigerant safety)
- Better documentation for callbacks/warranty
- Faster quote generation

**Learning System:**
- Gets smarter with each correction
- Company-specific terminology (equipment names)
- Competitive moat (unique training data)

### Why This Can Work
1. **Clear ROI:** 20 min/day × 250 days = 83 hours/year saved
2. **Field-first design:** Voice input, gloves-friendly
3. **Learning moat:** Gets smarter with use (hard to replicate)
4. **Low switching cost initially:** No hardware, just software
5. **Expansion path:** Parts inventory → billing → scheduling → CRM

---

## 🚀 Path to First Revenue

### Minimum Viable Product (MVP) - Phase 1
**Timeline:** 18-26 hours remaining work
**Goal:** Get ONE paying customer (beta pricing)

**Must Have:**
- Voice-to-parts works ✅ (done)
- Job tracking works ✅ (done)
- Photo capture works ❌ (critical for credibility)
- OCR works ❌ (time saver, competitive advantage)
- Labor hours works ❌ (required for billing)

**Beta Customer Profile:**
- Small company (5-10 techs)
- Tech-friendly owner
- Willing to give feedback
- In Neenah/Wisconsin area (easier support)
- $25-50/tech/month (50% discount for beta)

### Beta Launch Checklist (Phase 1 Complete)
1. ✅ Voice transcription works
2. ✅ Parts parsing works
3. ✅ Job numbers auto-generate
4. ❌ Camera/photos work
5. ❌ OCR extracts nameplate data
6. ❌ Labor hours entry works
7. ❌ Tech signature capture works
8. ❌ 1 week of dogfooding (use it yourself on test jobs)
9. ❌ Set up simple onboarding doc
10. ❌ Create demo video (2-3 min)

---

## 🛠️ Technical Setup (For Returning to Project)

### Prerequisites
```bash
# 1. Check Node.js version
node --version  # Should be v18+ or v20+

# 2. Check npm
npm --version

# 3. Verify .env file exists
cat .env  # Should have OPENAI_API_KEY and DATABASE_URL
```

### Getting Started Again
```bash
# 1. Pull latest code
git checkout claude/debug-message-length-011CUcRemNu67K1XMJA12xLW
git pull origin claude/debug-message-length-011CUcRemNu67K1XMJA12xLW

# 2. Install dependencies (in case packages updated)
npm install

# 3. Check database migrations
# If you haven't run migration 005 yet:
node run-migration.js migrations/005_update_job_number_format.sql

# 4. Verify database connection
node test-db.js

# 5. Start server
npm start

# 6. Open in browser
# Main app: http://localhost:3000
# Equipment admin: http://localhost:3000/equipment-admin.html
```

### Environment Variables Needed
```env
# .env file
OPENAI_API_KEY=sk-...  # Your OpenAI API key
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
PORT=3000
```

### Database Schema (Current State)
```
customers (36 records - Planet Fitness locations)
  ├── equipment (N records - HVAC units)
  └── jobs (0 records - none created yet)

parts (seeded with sample parts)
hvac_terminology (40+ terms with variations)
manuals (0 records - PDF ingestion not used yet)

job_counter (1 record - current value: 0, next: 0001)
location_codes (1 record - N = Neenah)
```

---

## 🐛 Known Issues & Technical Debt

### High Priority (Blocking MVP)
1. **Photos not implemented** - Critical for field use
2. **OCR not wired to jobs** - Time-saving feature, competitive advantage
3. **No labor hours UI** - Required for billing/payroll
4. **Parts not saved to jobs** - Parsing works but doesn't persist

### Medium Priority (Post-MVP)
1. **Customer structure** - 36 customers (should be 1 customer, 36 locations)
   - Current: Each location = separate customer
   - Better: One "Planet Fitness" with 36 locations
   - Fix: Add `customer_locations` table, refactor equipment links
2. **No offline mode** - PWA infrastructure exists but not fully implemented
3. **No mobile app** - Browser works but native would be better
4. **PDF ingestion unused** - Built but not integrated into workflow
5. **No job search** - Can't search by equipment, date, customer easily

### Low Priority (Future)
1. **No analytics dashboard** - Can't see metrics (jobs/day, parts used, etc.)
2. **No invoicing** - Can't generate customer invoices from jobs
3. **No scheduling** - Can't assign jobs to techs or schedule appointments
4. **No route optimization** - Techs plan their own routes
5. **No parts inventory** - Can't track parts on truck/warehouse

---

## 📋 Recommended Next Steps (When You Return)

### Week 1: Refresh & Quick Win (4-6 hours)
**Goal:** Get familiar with codebase again, ship one small feature

1. **Refresh your memory** (1-2 hours)
   - Read this document
   - Read `PHASE1_SETUP.md`
   - Read `.claude/skills/jerry-hvac-roadmap.md`
   - Browse `server.js` and `public/app.js` briefly

2. **Verify everything works** (1 hour)
   - Pull latest code
   - Run migrations
   - Start server
   - Test voice recording → parts parsing
   - Test CSV equipment import
   - Create test job via API

3. **Quick win: Wire parts to jobs** (2-4 hours)
   - Modify `/api/submit-repairs` to create job record
   - Save `parts_used` to jobs table
   - Test: Voice record repair → creates job with parts
   - **Result:** Parts parsing now saves to database ✅

### Week 2: Photo Capture (8-10 hours)
**Goal:** Ship photo capture feature

1. **Camera UI** (3-4 hours)
   - Add camera button to job workflow
   - Mobile camera access (navigator.mediaDevices.getUserMedia)
   - Take photo, display preview

2. **Photo upload** (2-3 hours)
   - Add `/api/photos/upload` endpoint (multer)
   - Save to `uploads/photos/` directory
   - Return photo URL

3. **Display photos** (2-3 hours)
   - Attach photos to jobs.photos array
   - Display in job view
   - Simple gallery/swipe view

**Result:** Techs can take photos of equipment ✅

### Week 3: OCR + Labor Hours (8-10 hours)
**Goal:** Complete Phase 1 MVP

1. **OCR integration** (4-6 hours)
   - Wire camera to OCR endpoint
   - Extract manufacturer/model/serial
   - Auto-fill equipment fields
   - Test on real nameplate photos

2. **Labor hours UI** (4 hours)
   - Add labor hours input field
   - Add signature capture (simple text input initially)
   - Update job on submit
   - Display in job view

**Result:** Phase 1 MVP complete! ✅

### Week 4: Testing & Beta Prep (4-8 hours)
**Goal:** Prepare for first customer

1. **Dogfooding** (2-4 hours)
   - Use the app yourself on 5-10 test jobs
   - Find and fix usability issues
   - Polish UI rough edges

2. **Documentation** (1-2 hours)
   - Create simple onboarding guide
   - Write 1-page "how to use" doc
   - Record 2-3 min demo video

3. **Beta outreach** (1-2 hours)
   - Identify 3-5 potential beta customers
   - Draft pitch email
   - Set up call with most interested

**Result:** Ready for first beta customer! 🎉

---

## 💡 Quick Wins (If Short on Time)

If you only have a few hours when you return:

**2-Hour Sprint: Parts to Jobs**
- Wire `/api/submit-repairs` to create job records
- Instant value: Parts parsing now saves to database

**4-Hour Sprint: Basic Photo Capture**
- Add camera button
- Save photos to uploads/ folder
- Display in job view
- No fancy gallery, just show images

**1-Hour Sprint: Fix Customer Structure**
- Consolidate 36 Planet Fitness locations into 1 customer
- Add `location` field to equipment display
- Cleaner admin view

---

## 📚 Key Documentation Files

When you return, read these files in order:

1. **This file** (`PROJECT_STATUS.md`) - Overall status
2. `.claude/skills/jerry-hvac-roadmap.md` - Phase definitions, what to build
3. `PHASE1_SETUP.md` - Setup guide, API reference
4. `CLAUDE.md` - Voice-to-part parsing rules
5. `LARGE_FILE_STRATEGY.md` - PDF ingestion strategy (Phase 2)

---

## 🎯 Success Criteria (Know You're Ready for Beta)

**Technical:**
- ✅ Voice → parts works reliably
- ✅ Job numbers auto-generate
- ✅ Equipment database populated
- ❌ Photos capture and display
- ❌ OCR extracts nameplate data
- ❌ Labor hours can be logged
- ❌ 10 test jobs completed successfully

**Business:**
- ❌ 1 interested beta customer identified
- ❌ Demo video created
- ❌ Onboarding doc written
- ❌ Pricing model finalized ($25-50/tech/month beta)

**When all ✅:** Ready to onboard first beta customer!

---

## 🔮 Future Vision (Post-MVP)

### Phase 2: Learning Systems (Q2 2026)
- PDF ingestion for manuals
- Filter size inventory upload
- Asset repair history queries
- Corrections-based AI improvements

### Phase 3: Asset Tracking (Q3 2026)
- Equipment maintenance schedules
- Warranty tracking
- Parts inventory management
- Predictive maintenance (ML-based)

### Phase 4: Workflow Polish (Q4 2026)
- Service tag formatting (AI → manager approval → customer)
- Mobile app (React Native)
- Offline mode (full PWA)
- Multi-location support

### Phase 5+: Scale (2027+)
- Route optimization
- CRM integration
- Automated invoicing
- Analytics dashboards
- API for third-party integrations

---

## 💭 Final Thoughts

**Why This Project Matters:**
- HVAC techs lose 30-45 min/day to paperwork
- Voice-first solves a real problem for field workers
- Learning system creates competitive moat
- Clear path to revenue ($6K-12K ARR per 10-tech company)

**What Makes This Different:**
- Actually works (voice → parts parsing is solid)
- Safety-first (refrigerant matching protection)
- Gets smarter with use (corrections logging)
- Built for gloves-on field work, not office use

**When You Return:**
- ~20 hours to complete Phase 1 MVP
- 1-2 weeks to test and polish
- 1-2 weeks to find beta customer
- **First revenue possible within 1-2 months of resuming work**

**You've built something valuable.** The core tech works. The hardest AI problems are solved. What's left is UI polish and feature completion. When you're ready to return, you're close to having something customers will pay for.

---

## 📞 Contact Info (For Future You)

**When you return, you'll ask:**
- "Where was I?"
  → Read this doc, then `PHASE1_SETUP.md`

- "What should I build next?"
  → Week 1: Wire parts to jobs (2-4 hours)
  → Week 2: Photo capture (8-10 hours)
  → Week 3: OCR + labor hours (8-10 hours)

- "How do I get started?"
  → `git pull`, `npm install`, `npm start`
  → Test voice recording at http://localhost:3000

- "Am I close to revenue?"
  → Yes! ~20 hours of work to MVP, then beta customer ready

**Good luck. This project has real potential. See you in Q1 2026! 🚀**

---

**Last Commit:** `6297e7e` - Sequential job numbers (0001NRP)
**Last Session:** October 31, 2025
**Claude Agent:** claude-sonnet-4-5-20250929
**Branch:** `claude/debug-message-length-011CUcRemNu67K1XMJA12xLW`

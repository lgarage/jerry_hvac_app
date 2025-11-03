# Jerry HVAC - Session Progress Tracker

**Last Updated:** November 3, 2025
**Current Phase:** Phase 1 - MVP Foundation
**Phase Progress:** 50% complete (3/6 verified, 1 awaiting test) 🧪
**Session Focus:** Labor hours + signature code complete, needs user testing

---

## 📋 Phase Definitions

### Phase 1 - MVP Foundation (Current)
**Goal:** Core field documentation features needed for beta customer
**Timeline:** 15-20 hours remaining
**Deliverable:** Functional app ready for real HVAC tech testing

### Phase 2 - Intelligence & Learning
**Goal:** AI-powered assistance and equipment learning features
**Timeline:** TBD after Phase 1 ships
**Deliverable:** Smart prompts, part suggestions, equipment history

### Phase 3 - Mobile & Offline
**Goal:** PWA, offline mode, mobile optimization
**Timeline:** TBD after Phase 2 ships
**Deliverable:** Works offline in field, native-like mobile experience

### Phase 4 - Business Features
**Goal:** Invoicing, customer portal, reporting
**Timeline:** TBD after Phase 3 ships
**Deliverable:** Revenue-generating business features

---

## 🎯 Where We Are Right Now

### Just Completed (This Session - Nov 3)
- 🧪 **PHASE 1 ITEM #6: Labor Hours + Signature** - Code complete, **AWAITING USER TEST**
  - **Frontend (public/index.html:1104-1178):**
    * Tech dropdown with 8 hardcoded names (Steve Chew, Mike Johnson, etc.)
    * Date field defaulting to today
    * Hours input with 0.25 increments (min 0.25, max 24)
    * HTML5 signature canvas (600x150px, touch + mouse support)
    * Clear signature button
  - **Signature Canvas (public/app.js:4578-4670):**
    * Touch event support for mobile
    * Mouse event support for desktop
    * Stores base64 PNG in hidden field
    * Clear functionality
  - **Validation (public/app.js:3319-3398):**
    * Requires tech selection
    * Requires date
    * Requires hours > 0
    * Requires signature (canvas not empty)
    * Focus on first invalid field
  - **Voice Commands (public/app.js:1788-1874):**
    * "I worked 4 hours" → auto-fills 4.0
    * "worked 2 and a half hours" → auto-fills 2.5
    * "4 and a quarter hours" → auto-fills 4.25
    * "4 point 5 hours" → auto-fills 4.5
    * "Sign timecard" → scrolls to and highlights signature canvas
    * Green highlight effect on successful fill
  - **Backend (server.js:1895-1985):**
    * Accepts tech_name, work_date, labor_hours, signature_base64
    * Stores signature as base64 PNG in tech_signature column
    * Stores timecard metadata in JSONB (tech_name, work_date, signature_timestamp)
    * Validation for complete timecard data
  - **USER: Please test before marking complete!**
- ✅ **Phase management system** - Scalable phase checking in CLAUDE.md, auto-defer to backlogs
- ✅ **Filter inventory seed** - 36 filters imported into parts table
- ✅ **Database connection fixed** - Supabase connection working with pooler
- ✅ **Equipment metadata integration** - parseRepairs() now queries and uses equipment metadata (server.js:1645-1657)
- ✅ **Clarification endpoint** - POST /api/jobs/:jobNumber/clarification stores learned specs (server.js:2234-2321)
- ✅ **Equipment learning tests** - Comprehensive test suite with 6 scenarios passing (test-equipment-learning.js)

### Earlier This Session (Phase 2 work - moved to backlog)
- ✅ **Transcript tracking database schema** - Migration 006 adds transcripts JSONB + session_context
- ✅ **Transcript API endpoints** - 6 new endpoints for transcript CRUD operations
- ✅ **Incomplete part detection** - detectIncompleteParts.js detects missing specs (24/24 tests passing)
- ✅ **Filter inventory system** - 36 filter sizes with pricing, validation
- ✅ **Equipment-specific learning** - System learns each unit's specs, no generic suggestions

### Previous Session (Nov 2)
- ✅ **Wired parts to jobs** - `/api/submit-repairs` now creates job records with `parts_used` JSONB
- ✅ **Job number format** - Changed to 0001NRP (sequential + location + type)
- ✅ **CSV import fixes** - Fixed PostgreSQL type inference errors, added drag-and-drop
- ✅ **Progress tracking** - Added auto-update instructions to CLAUDE.md (lines 203-259)
- ✅ **Documentation cleanup** - Deleted PROJECT_STATUS.md to avoid duplication

### In Progress (Transcript Feature)
- ⏳ **Frontend integration** - Wire transcript API to voice recording flow
- ⏳ **UnitCard component** - Group repairs by equipment in single card
- ⏳ **TranscriptDrawer component** - Show full transcript history with timestamps
- ⏳ **Session context tracking** - Track "lastMentionedUnit" for follow-up commands
- ⏳ **Clarification UI** - Frontend flow for incomplete parts (prompt → response → store)

### 🧪 Ready for User Testing (CRITICAL - Phase 1 Item #6)

**Item #6: Labor Hours + Signature**
**Status:** Code complete, needs user verification before marking ✅

**Test Steps:**
1. Start server: `npm start` (on your local machine)
2. Go to: `http://localhost:3000`
3. Enter some job notes (type or voice record)
4. Click "Parse Notes" to see repairs
5. Scroll to **"⏱️ Time Card Entry"** section at bottom
6. **NEW FIELDS TEST:**
   - Select a technician from dropdown (e.g., "Steve Chew")
   - Date should auto-fill with today's date
   - Enter labor hours (e.g., "2.5" or "4.25")
   - Sign in the signature canvas (draw with mouse or touch)
7. **VOICE COMMAND TEST (Optional):**
   - Record voice: "I worked 4 hours"
   - Should auto-fill hours field with 4.0 and show green highlight
   - Try: "worked 2 and a half hours" → should fill 2.5
   - Try: "Sign timecard" → should scroll to and highlight canvas
8. Click "Submit Job & Time Card"
9. **Verify:** Success message shows with hours and tech name
10. **Database Check (Optional):**
    ```sql
    SELECT job_number, labor_hours, tech_signature, metadata
    FROM jobs ORDER BY created_at DESC LIMIT 1;
    ```
    - `labor_hours` should show your entered value (e.g., 2.5)
    - `tech_signature` should show base64 PNG string starting with "data:image/png;base64,"
    - `metadata` should show timecard info with tech_name and work_date

**Expected Result:**
- ✅ Form validates all required fields before submit
- ✅ Voice commands auto-fill hours field
- ✅ Signature canvas works on both mouse and touch
- ✅ Success message shows hours and tech name
- ✅ Database stores all timecard fields correctly

**If successful:** Comment "Item #6 tested and working" and I'll mark it ✅ complete

**If issues:** Report what broke and I'll fix it immediately

---

### Other Testing (Phase 2 features - defer until Phase 1 ships)
- [x] Incomplete detection unit tests (24/24 passing ✅)
- [x] Equipment learning unit tests (6/6 scenarios passing ✅)
- [ ] Run migration 006 (needs .env with DATABASE_URL)
- [ ] Voice record incomplete: "RTU-6 needs filters and batteries" → should prompt for size/type
- [ ] Voice record complete: "RTU-6 needs 24x24x2 filters and AA batteries" → should NOT prompt
- [ ] Clarification flow: "filters" → "What size?" → "24x24x2" → complete
- [ ] Equipment learning flow: first time → learns, second time → suggests
- [ ] Test multi-unit: "RTU-6 and RTU-2 both need filters"
- [ ] Test follow-up: "oh and add batteries to that" (should apply to last unit)

---

## 📊 Phase 1 Checklist (3/6 Verified, 1 Awaiting Test)

- [x] **1. Auto job numbers** ✅ (Tested & verified by user)
- [x] **2. Model/serial storage** ✅ (Tested & verified by user)
- [x] **3. Parts parsing to jobs** ✅ (Tested & verified by user)
- [ ] **4. OCR nameplate extraction** ⏳ (Code exists, needs UI integration)
- [ ] **5. Photo documentation** ⏳ (Schema ready, needs camera UI)
- [ ] **6. Labor hours + signature** 🧪 **AWAITING USER TEST** (Code complete)

**Progress:** 50% verified (3/6) + 1 pending test
**Next:** User tests #6, then tackle #4 (OCR) or #5 (Photos)

---

## 🚀 Immediate Next Actions

**Option A: Clarification UI (2-4 hours)** ⭐ **RECOMMENDED**
- Build frontend flow for incomplete parts
- Display equipment-specific prompts from backend
- Capture technician's response (voice or text)
- Call POST /api/jobs/:jobNumber/clarification endpoint
- Show confirmation: "Learned that RTU-6 uses 24x24x2 filters"
- Complete the equipment learning loop (backend already done)
- High value: enables the entire learning system

**Option B: Labor Hours UI (4-6 hours)**
- Add hours input field
- Add signature capture (text input)
- Quick to build, required for billing

**Option C: OCR Integration (4-6 hours)**
- Wire camera to OCR endpoint
- Extract manufacturer/model/serial
- Auto-populate equipment fields
- High value, competitive advantage

**Option D: Run Migration 006 & Test (30 min)**
- Set up .env with DATABASE_URL
- Run migrations/006_add_transcript_tracking.sql
- Test transcript endpoints with curl
- Verify equipment learning with test data

**Recommended:** Option A (clarification UI) - completes the learning system we just built

---

## ✅ What's Working

**Voice-to-Parts Pipeline:**
- Whisper transcription ✅
- HVAC term normalization ✅
- Repair parsing (GPT-4) ✅
- Parts auto-matching ✅
- Corrections logging ✅

**Database & Jobs:**
- Job auto-generation ✅ (0001NRP format)
- Customer/equipment tables ✅
- CSV bulk import ✅
- Parts saved to jobs.parts_used ✅

**Frontend:**
- Voice recording ✅
- Chat with Jerry ✅
- Equipment admin dashboard ✅

---

## ⚠️ What's Blocked/Missing

**High Priority:**
- Photo capture UI (8-10 hrs) - Critical for field use
- OCR integration (4-6 hrs) - Needs UI wiring
- Labor hours form (4-6 hrs) - Required for billing

**Medium Priority:**
- Equipment selector in frontend (currently hardcoded customer_id=1)
- Link repairs to specific equipment_id (currently null)
- Job search/filter functionality

**Low Priority:**
- Customer/location structure (36 locations showing as 36 customers)
- No offline mode yet
- No mobile app

---

## 🐛 Known Issues

1. **Customer structure** - Each Planet Fitness location = separate customer
   - Should be: 1 customer with 36 locations
   - Works for now, can refactor later

2. **Equipment not linked to jobs** - equipment_id is null
   - Need equipment selector in UI
   - For now, problem_description mentions equipment name

3. **No test jobs created yet** - Need to verify parts-to-jobs flow works

---

## 📝 Last Session Notes (Nov 3 - Voice Transcript Feature)

**Completed (Phase 1 - Backend Foundation):**

1. **Database Migration (migrations/006_add_transcript_tracking.sql)**
   - Added `transcripts` JSONB column to jobs table
   - Added `session_context` JSONB for tracking lastMentionedUnit
   - Created 5 PostgreSQL functions:
     * `add_transcript_to_job()` - stores transcript with ISO8601 timestamp
     * `get_job_transcripts()` - retrieves all transcripts chronologically
     * `get_unit_transcripts()` - filters transcripts by unit (RTU-6, etc)
     * `get_job_units()` - returns all units mentioned with statistics
     * `update_session_context()` - tracks lastMentionedUnit for follow-ups
   - Added GIN indexes for fast JSONB queries

2. **API Endpoints (server.js:1811-2051)**
   - `POST /api/jobs/:jobNumber/transcripts` - Add transcript to job
   - `GET /api/jobs/:jobNumber/transcripts` - Get all transcripts (sortable ASC/DESC)
   - `GET /api/jobs/:jobNumber/transcripts/unit/:unitName` - Filter by unit
   - `GET /api/jobs/:jobNumber/units` - Get units with mention counts
   - `GET /api/jobs/:jobNumber/session-context` - Get current session state
   - `PUT /api/jobs/:jobNumber/session-context` - Update lastMentionedUnit

3. **Utility Functions (src/utils/)**
   - **formatTimestamp.js** - Timestamp display utilities
     * `formatTimestamp()` - "2 hours ago" or "Oct 15, 2025 at 2:30 PM"
     * `formatTimestampShort()` - "2m", "3h", "2d" for compact displays
     * `groupByDate()` - group transcripts by date
     * `getDateGroupLabel()` - "Today", "Yesterday", weekday names
   - **extractUnits.js** - Unit identifier extraction
     * `extractUnits()` - parse "RTU-6", "AHU-2" from text
     * `groupRepairsByUnit()` - consolidate repairs by equipment
     * `normalizeUnitId()` - convert "rtu6" → "RTU-6"

4. **Incomplete Part Detection (utils/detectIncompleteParts.js)**
   - Detects parts missing required specifications:
     * Filters → MUST have size (24x24x2, "20 by 25 by 1")
     * Batteries → MUST have type (AA, AAA, 9V)
     * Contactors → MUST have poles + voltage (2 pole 24V)
     * Capacitors → MUST have MFD + voltage (45/5 MFD 440V)
     * Refrigerant → MUST have type + quantity (4 lbs R-410A)
     * Belts, Motors, Thermostats → specific requirements
   - Returns structured data with missing details and prompts
   - Test suite: 24/24 tests passing ✅
   - Integrated into parseRepairs() (server.js:1508-1544)

5. **Filter Inventory System (data/filter-sizes.json + utils/filterSizeLookup.js)**
   - Database of 36 common filter sizes with complete specifications
   - 3 pricing tiers based on quantity (12, 36, 60+ qty)
   - 9 popular sizes flagged for smart suggestions
   - Functions:
     * `getPopularFilterSizes()` - suggests most common sizes
     * `validateFilterSize()` - checks if size exists in inventory
     * `getFilterPricing()` - calculates price with tier discounts
     * `normalizeFilterSize()` - converts spoken "20 by 25 by 1" to "20x25x1"
   - Integrated with incomplete detection:
     * "filters" → suggests "14x20x1, 16x20x1, 16x25x1"
     * "24x24x2 filters" → validates, shows $9.35/ea pricing
     * "30x30x1 filters" → warns "not in standard inventory"
   - Test suite: All validations passing ✅

6. **Equipment-Specific Learning System (CRITICAL ARCHITECTURAL CHANGE)**
   - **Business Context Discovered:**
     * PM done 2-4x/year - filters/belts changed during PM
     * Filters RARELY needed outside PM for existing accounts
     * Each unit has SPECIFIC sizes (RTU-6 → 24x24x2, not random)
     * Technicians DON'T need pricing (only for quote generation)
   - **Old Approach (WRONG):**
     * "filters" → suggests generic "14x20x1, 16x20x1, 16x25x1"
     * Shows pricing to technician ($9.35/ea)
     * Useless - RTU-6 doesn't use those generic sizes
   - **New Approach (CORRECT):**
     * Checks equipment.metadata.filter_size for this specific unit
     * If known: "RTU-6 uses 24x24x2 filters. Same size?"
     * If unknown: "What size filters does RTU-6 need?" (learns and stores)
     * Pricing hidden from tech → _backendOnly field for quotes
   - **Implementation:**
     * detectIncompletePart() now accepts equipment context
     * Queries equipment metadata for learned specifications
     * Stores tech's answers in equipment.metadata for next time
     * Each unit builds its own specification profile over time
   - **Documentation:** docs/EQUIPMENT_LEARNING_SYSTEM.md

7. **Equipment Metadata Integration (server.js:1437-1568, 2234-2321)**
   - **Equipment Query Functions:**
     * `getEquipmentMetadata(equipmentName)` - query single unit's metadata
     * `storeEquipmentSpec(equipmentName, specKey, specValue, jobNumber)` - store learned spec
     * `batchGetEquipmentMetadata(repairs)` - efficiently query multiple units at once
   - **Integration into parseRepairs():**
     * Line 1645: Batch query equipment metadata before processing repairs
     * Line 1657: Populate context with actual metadata from database
     * Replaced TODO with functional implementation
   - **Clarification Endpoint (POST /api/jobs/:jobNumber/clarification):**
     * Receives technician's answer to incomplete part prompt
     * Validates required fields (equipmentName, specKey, specValue)
     * Stores learned specification using storeEquipmentSpec()
     * Re-detects part with updated context to confirm completion
     * Returns confirmation with updated metadata
   - **Complete Learning Loop:**
     1. Tech says "filters" for RTU-6 → "What size filters does RTU-6 need?"
     2. Tech says "24x24x2" → POST /clarification stores filter_size
     3. Next visit: "filters" → "RTU-6 uses 24x24x2 filters. Same size?"
     4. System remembers forever, no manual entry needed
   - **Test Coverage (test-equipment-learning.js):**
     * ✅ New equipment (no history) prompts correctly
     * ✅ Known equipment (has history) suggests learned specs
     * ✅ Complete specifications validate against inventory
     * ✅ Size changes trigger learning updates
     * ✅ Non-standard sizes accepted with warnings
     * ✅ Batch detection with equipment context works
     * All 6 scenarios passing

**Next Steps (Phase 2 - Frontend Integration):**
1. Wire transcript API to voice recording flow
2. Store transcript on mic release (before parsing)
3. Build UnitCard component (group repairs by equipment)
4. Build TranscriptDrawer component (full history with timestamps)
5. Add session context tracking for follow-up commands

**Previous Session (Nov 2):**
- Modified `/api/submit-repairs` endpoint to create job records
- Parts formatted and saved to `jobs.parts_used` JSONB field
- Job number format: 0001NRP (sequential + location + type)
- Added progress tracking to CLAUDE.md

**Testing TODO:**
1. Restart server: `npm start`
2. Open: http://localhost:3000
3. Voice record a repair
4. Submit
5. Query database: `SELECT job_number, parts_used FROM jobs ORDER BY created_at DESC LIMIT 1;`

---

## 🎯 Next Session Goals

**If continuing today:**
1. Test parts-to-jobs flow (30 min)
2. Build labor hours UI (4-6 hrs)
3. Test end-to-end job cycle

**If starting fresh later:**
1. Read this file (PROGRESS.md) ← YOU ARE HERE
2. Read jerry-hvac-roadmap skill for context
3. Pick next Phase 1 item based on time available
4. Update this file when done

---

## 💡 Quick Context for Future Sessions

**The App:**
Voice-first HVAC field service documentation. Techs speak repairs, AI extracts parts, creates job records.

**Current State:**
- Core AI parsing works perfectly ✅
- Job tracking foundation complete ✅
- Need to finish Phase 1 UI polish (photos, OCR, labor hours)
- ~15-20 hours from MVP completion

**Business Potential:**
- $50-100/tech/month pricing
- 10 techs = $6K-12K/year revenue
- Strong value prop (saves 20-30 min/day)
- Learning system = competitive moat

**When Complete:**
- Ready for beta customer
- 1-2 months to first revenue
- Real HVAC problem solved

---

## 🗂️ File Structure Reference

**Planning Guides:**
- `.claude/skills/jerry-hvac-roadmap.md` ← Static roadmap (what to build)
- `PROGRESS.md` ← This file (where you are now) - single source of truth
- `CLAUDE.md` ← Auto-loaded parsing rules + progress tracking instructions
- `PHASE1_SETUP.md` ← Setup & API reference

**Code Files:**
- `server.js` ← Backend API (3500+ lines)
- `public/app.js` ← Frontend logic (146KB)
- `public/index.html` ← Main UI
- `public/equipment-admin.html` ← Admin dashboard

**Database:**
- `migrations/` ← Schema migrations (001-005)
- `db.js` ← Connection setup

---

## 🔄 How to Use This File

**Starting a session:**
1. Read "Where We Are Right Now"
2. Check "Immediate Next Actions"
3. Review "Known Issues" if blocked
4. Start coding!

**Ending a session:**
1. Update "Just Completed"
2. Update "Ready to Test" or "Blocked/Missing"
3. Update "Last Session Notes" with what you did
4. Commit this file with your code changes

**Getting stuck:**
1. Check "What's Blocked/Missing"
2. Read "Last Session Notes" for context
3. Invoke jerry-hvac-roadmap skill for guidance
4. Ask: "What should I work on next?"

---

## 📦 Future Phase Backlogs

> **Auto-managed by Claude:** When ideas come up that don't fit the current phase, they're automatically added here and triaged to the appropriate phase.

### Phase 2 Backlog - Intelligence & Learning
**Status:** Not started (ships after Phase 1)

**Features to build:**
- ✨ **Transcript tracking & unit grouping** (Backend complete, needs frontend)
  - Wire transcript API to voice recording flow
  - Build UnitCard component (group repairs by equipment)
  - Build TranscriptDrawer component (full history with timestamps)
  - Session context tracking for follow-up commands
- ✨ **Equipment learning system** (Backend complete, needs clarification UI)
  - Frontend clarification flow for incomplete parts
  - Display equipment-specific prompts ("RTU-6 uses 24x24x2 filters. Same size?")
  - Store learned specifications via POST /api/jobs/:jobNumber/clarification
  - Equipment-specific part suggestions based on history
- ✨ **Smart part detection** (Already implemented, needs testing)
  - Incomplete part detection (24/24 tests passing)
  - Equipment metadata integration
  - Filter inventory validation

**Priority:** High - These features differentiate from competitors

---

### Phase 3 Backlog - Mobile & Offline
**Status:** Not started (ships after Phase 2)

**Features to build:**
- _(None yet - add ideas here as they come up)_

**Priority:** Medium - Needed for field reliability

---

### Phase 4 Backlog - Business Features
**Status:** Not started (ships after Phase 3)

**Features to build:**
- _(None yet - add ideas here as they come up)_

**Priority:** Lower - Revenue features after product-market fit

---

**Remember:** This is your quick-reference sheet. CLAUDE.md auto-loads every session with parsing rules and progress reminders. For planning, invoke the roadmap skill. 🚀

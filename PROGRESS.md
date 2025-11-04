# Jerry HVAC - Session Progress Tracker

**Last Updated:** November 4, 2025
**Current Phase:** Phase 1 - MVP Foundation
**Phase Progress:** 50% complete (3/6 verified, 1 awaiting test) 🧪
**Session Focus:** Complete timecard system with repair checklist (BREAKING CHANGE - replaced old implementation)

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

### Just Completed (This Session - Nov 4) 🚨 BREAKING CHANGE

- 🧪 **PHASE 1 ITEM #6: Complete Timecard System** - Code complete, **AWAITING USER TEST**

  **⚠️ BREAKING CHANGE:** Replaced old time tracking with proper workflow matching real HVAC operations

  **What Was Wrong:**
  - ❌ Voice "I worked 4 hours" didn't ask for tech name
  - ❌ No visual confirmation that timecard was saved
  - ❌ Hours duplicated across every equipment repair (wrong!)
  - ❌ No way to track which repairs completed vs incomplete
  - ❌ Didn't match real workflow (one timecard per job visit)

  **What's Fixed:**
  - ✅ **One timecard per job** (not per equipment)
  - ✅ **Repair checklist** shows completion progress with checkboxes
  - ✅ **Status auto-detected** from checklist (all checked = complete)
  - ✅ **Voice command opens modal** and prompts for tech name
  - ✅ **Visual confirmation** displays all timecard details
  - ✅ **Hours tied to specific job number**

  **1. Database Schema (migrations/007_create_timecards_table.sql):**
  - Created `timecards` table with:
    * job_number (FK to jobs.job_number)
    * tech_name, work_date, hours_worked, status, signature_base64
    * repairs_completed JSONB (tracks checkbox states per equipment/part)
    * notes (optional)
  - PostgreSQL functions:
    * get_job_timecard_summary() - total hours/visits per job
    * get_tech_hours() - tech hours for date range
    * update_timecard_timestamp() - auto-update trigger
  - Indexes for fast job/tech/status queries

  **2. Repair Checklist UI (public/index.html:1104-1134):**
  - Auto-generates from documented repairs
  - Checkboxes for each part/repair item
  - Completion badges (per-equipment and overall)
  - "Mark All Complete" bulk action
  - "Ready to Log Time" opens timecard modal

  **3. Timecard Modal (public/index.html:1415-1532):**
  - Job info display (job#, location)
  - Tech dropdown (8 hardcoded names)
  - Date field (defaults to today)
  - Hours input (0.25 increments, 0.25-24 range)
  - Status radio buttons (auto-detected from checklist):
    * Complete (all boxes checked)
    * Incomplete (some unchecked)
  - Signature canvas (520x150px, touch + mouse support)
  - Optional notes field
  - Full validation before submit

  **4. Repair Checklist Logic (public/app.js:2966-3149):**
  - generateRepairChecklist() - builds from currentRepairs array
  - Groups parts by equipment
  - Tracks checkbox state in repairChecklistState object
  - updateChecklistCompletionBadges() - live progress tracking
  - markAllChecksComplete() - bulk check action
  - Per-equipment completion counters

  **5. Timecard Modal Logic (public/app.js:3151-3421):**
  - openTimecardModal() - auto-detects status from checklist
  - initTimecardSignatureCanvas() - proper canvas event setup
  - submitTimecard() - validates, builds repairs_completed JSONB, calls API
  - showTimecardConfirmation() - displays success with all details
  - Auto-hides confirmation after 10 seconds

  **6. Voice Command Integration (public/app.js:1787-1871):**
  - "I worked 4 hours" → opens modal, pre-fills hours field
  - "worked 2 and a half hours" → converts to 2.5
  - "4 and a quarter hours" → 4.25
  - "4 point 5 hours" → 4.5
  - Checks if repairs exist first (prevents empty timecards)
  - Focuses tech name field if not selected
  - Shows helpful prompts: "Hours set to 4. Please select technician."

  **7. Backend API (server.js:2017-2200):**
  - POST /api/submit-repairs-with-timecard
  - Creates job records (one per repair)
  - Creates ONE timecard linked to first job number
  - Stores repairs_completed JSONB with checkbox states
  - Validates: tech_name, work_date, hours_worked, status, signature
  - Returns jobs + timecard data for confirmation display
  - Comprehensive logging for debugging

  **8. Migration Runner (run-migration-007.js):**
  - Ready to execute: `node run-migration-007.js`
  - Verifies table creation
  - Lists created columns and functions
  - Safe error handling

  **The Correct Workflow:**
  1. Tech documents repairs → Repairs parsed and displayed
  2. System generates repair checklist with checkboxes
  3. Tech checks boxes as repairs are completed
  4. Tech says "I worked 4 hours" (voice command)
  5. System opens timecard modal with pre-filled hours
  6. System auto-detects status based on checked boxes
  7. System prompts for tech name (if not selected)
  8. Tech signs canvas → Submits
  9. System creates ONE timecard for the job
  10. Visual confirmation shows: Job#, tech, hours, date, status, repairs completed

  **USER: MUST run migration first, then test!**
  ```bash
  node run-migration-007.js  # Creates timecards table
  npm start                   # Start server
  # Then test the complete workflow
  ```
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

**Item #6: Complete Timecard System with Repair Checklist**
**Status:** Code complete, needs user verification before marking ✅

**⚠️ BREAKING CHANGE:** Old time tracking replaced. New workflow matches real HVAC operations.

**Pre-Test Setup (REQUIRED):**
```bash
# 1. Run database migration to create timecards table
node run-migration-007.js

# Expected output:
# ✓ Migration 007 completed successfully
# Timecards table columns: id, job_number, tech_name, work_date, hours_worked, status, signature_base64, notes, repairs_completed, created_at, updated_at
# Created functions: get_job_timecard_summary(), get_tech_hours(), update_timecard_timestamp()

# 2. Start server
npm start
```

**Test Scenario 1: Complete Job (All Repairs Done)**
1. Go to: `http://localhost:3000`
2. Document repairs (voice or text):
   - Example: "RTU-6 needs 20x25x1 filters and a contactor. RTU-1 needs a capacitor."
3. Click "Parse Notes"
4. **NEW: Repair Checklist appears** ✨
   - Should show equipment groups (RTU-6, RTU-1)
   - Each part has a checkbox
   - Completion badges show "0/3 completed"
5. **Check all boxes** (mark all repairs complete)
   - Manually check each box OR
   - Click "Mark All Complete" button
   - Completion badge should turn green: "3/3 completed"
6. **Voice command:** Say "I worked 4 hours"
   - Timecard modal should open
   - Hours field pre-filled with "4.00" (green highlight)
   - Status auto-selected: "Complete" (all boxes checked)
   - Hint says: "All repairs checked (3/3)"
7. **Fill timecard:**
   - Select tech: "Steve Chew"
   - Date: Today (auto-filled)
   - Sign canvas (draw signature)
   - Optionally add notes
8. Click "Submit Timecard"
9. **Visual confirmation should appear:** ✨
   - Job number (e.g., "0042NRP")
   - Location: Planet Fitness
   - Tech: Steve Chew
   - Hours: 4.0
   - Date: Nov 4, 2025
   - Status: ✓ Complete
   - Repairs: 3/3 completed
   - Signed: ✓
10. **Verify in database:**
    ```sql
    SELECT * FROM timecards ORDER BY created_at DESC LIMIT 1;
    -- Should show: job_number, tech_name='Steve Chew', hours_worked=4.0, status='complete', signature_base64 (long string), repairs_completed JSONB

    SELECT * FROM jobs ORDER BY created_at DESC LIMIT 3;
    -- Should show 3 jobs (one per repair), all with status='complete'
    ```

**Test Scenario 2: Incomplete Job (Some Repairs Not Done)**
1. Document new repairs: "RTU-6 needs filters and belts. AHU-2 needs batteries."
2. Parse notes → Checklist shows 3 items
3. **Check only 2 boxes** (leave one unchecked)
   - Completion: "2/3 completed"
4. Voice: "I worked 2 and a half hours"
5. Modal opens:
   - Hours: 2.50
   - Status auto-selected: **"Incomplete"** (some unchecked) ✨
   - Hint says: "2/3 repairs checked"
6. Fill tech, sign, submit
7. **Verify:**
   - Database: `status='incomplete'`
   - Jobs table: `status='incomplete'`
   - repairs_completed JSONB shows which boxes checked/unchecked

**Test Scenario 3: Voice Command Edge Cases**
- "I worked 4 hours" → Opens modal, hours = 4.00
- "worked 2 and a quarter hours" → hours = 2.25
- "I worked 3 point 5 hours" → hours = 3.50
- Say "I worked 4 hours" WITHOUT documenting repairs first:
  - Should show error: "Please document repairs first before logging hours"

**Test Scenario 4: Validation**
Try to submit timecard without:
- Tech name → Error: "Please select a technician"
- Hours → Error: "Please enter hours worked (must be greater than 0)"
- Signature → Error: "Please sign to certify your hours"

**Expected Results:**
- ✅ Repair checklist auto-generates from documented repairs
- ✅ Checkboxes track completion progress
- ✅ Completion badges update in real-time
- ✅ Voice "I worked X hours" opens modal with pre-filled hours
- ✅ Status auto-detected based on checkboxes (complete vs incomplete)
- ✅ Modal prompts for tech name if not selected
- ✅ Signature canvas works (touch + mouse)
- ✅ Visual confirmation displays all timecard details
- ✅ ONE timecard created per job (not duplicated per equipment)
- ✅ Database stores: job_number, tech, hours, status, signature, repairs_completed JSONB

**If successful:** Comment "Item #6 tested and working" and I'll mark it ✅ complete (67% Phase 1 done!)

**If issues:** Report:
1. What step failed
2. Error messages (console or screen)
3. Expected vs actual behavior
And I'll fix immediately!

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

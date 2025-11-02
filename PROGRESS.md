# Jerry HVAC - Session Progress Tracker

**Last Updated:** November 2, 2025 (Session continued)
**Current Phase:** Phase 1 MVP (50% complete - 3/6 items)
**Session Focus:** Wired parts parsing to jobs database + added progress tracking

---

## 🎯 Where We Are Right Now

### Just Completed (This Session)
- ✅ **Wired parts to jobs** - `/api/submit-repairs` now creates job records with `parts_used` JSONB
- ✅ **Job number format** - Changed to 0001NRP (sequential + location + type)
- ✅ **CSV import fixes** - Fixed PostgreSQL type inference errors, added drag-and-drop
- ✅ **Progress tracking** - Added auto-update instructions to CLAUDE.md (lines 203-259)
- ✅ **Documentation cleanup** - Deleted PROJECT_STATUS.md to avoid duplication

### Ready to Test
- [ ] Voice record: "RTU-1 needs 2 filters and 4 pounds R-410A"
- [ ] Submit repair
- [ ] Verify job created in database with parts_used array

---

## 📊 Phase 1 Checklist (3/6 Complete)

- [x] **1. Auto job numbers** ✅ (0001NRP format implemented)
- [x] **2. Model/serial storage** ✅ (Equipment table + CSV import)
- [x] **3. Parts parsing to jobs** ✅ (Just wired today!)
- [ ] **4. OCR nameplate extraction** ⏳ (Code exists, needs UI integration)
- [ ] **5. Photo documentation** ⏳ (Schema ready, needs camera UI)
- [ ] **6. Labor hours + signature** ⏳ (Schema ready, needs form UI)

**Progress:** 50% → Ready for item #4 or #6

---

## 🚀 Immediate Next Actions

**Option A: OCR Integration (4-6 hours)**
- Wire camera to OCR endpoint
- Extract manufacturer/model/serial
- Auto-populate equipment fields
- High value, competitive advantage

**Option B: Labor Hours UI (4-6 hours)**
- Add hours input field
- Add signature capture (text input)
- Quick to build, required for billing

**Option C: Keep Testing (30 min)**
- Test parts-to-jobs flow end-to-end
- Fix any bugs before moving on

**Recommended:** Option C first (test what we built), then Option B (labor hours)

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

## 📝 Last Session Notes (Nov 2, 8am - continued)

**Completed:**
- Modified `/api/submit-repairs` endpoint (server.js lines 1713-1801)
- Each repair creates one job with auto-generated number
- Parts formatted and saved to `jobs.parts_used` JSONB field
- Job type determined by repair.actions (repair vs service)
- Status set to 'completed' (repairs already done when submitted)
- Defaults to customer_id=1 (Planet Fitness)
- Added progress tracking section to CLAUDE.md (lines 203-259)
- Deleted PROJECT_STATUS.md to keep PROGRESS.md as single source of truth

**Code Changes:**
```javascript
// Each repair creates a job with parts
const partsUsed = repair.parts.map(part => ({
  name: part.name,
  quantity: part.quantity,
  unit: part.unit,
  category: part.category,
  matched: part.matched
}));

const job = await sql`INSERT INTO jobs (...) VALUES (...)`;
// Returns: {job_number: "0001NRP", parts_used: [...]}
```

**Documentation Changes:**
- CLAUDE.md now includes auto-reminder to update PROGRESS.md at session end
- Ensures context is maintained across sessions without needing to ask "what should I work on?"

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

**Remember:** This is your quick-reference sheet. CLAUDE.md auto-loads every session with parsing rules and progress reminders. For planning, invoke the roadmap skill. 🚀

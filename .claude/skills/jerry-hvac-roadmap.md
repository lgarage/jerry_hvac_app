# Jerry HVAC App Development Roadmap

## Purpose
Keep development focused on MVP. Prevent scope creep into advanced features before foundation is solid.

## Goal
Get to a working MVP that techs can use for basic job tracking, parts identification, and hour logging.

## Current Status
Building basic repair workflow and asset tracking system.

---

## PHASE 1: MVP FOUNDATION (Active Development)
**Priority: Minimum viable product for tech use**

### Core Job Management
1. **Auto job number generation**
   - Unique ID per service call
   - Sequential or formatted (e.g., JOB-2025-001)
   - Never duplicates

2. **Model/serial number storage**
   - Input fields for equipment M/S
   - Store per asset/unit
   - Required for future asset tracking

3. **OCR nameplate extraction**
   - Tech takes photo of unit nameplate
   - OCR extracts: model, serial, tonnage, refrigerant, etc.
   - Auto-populates fields (tech can verify/edit)
   - Eliminates manual transcription errors
   - Already wired in - make it part of job workflow

4. **Photo documentation**
   - Take pictures during service
   - Critical for parts ordering accuracy
   - Required photos: nameplates (motor, economizer, etc.)
   - Attach to job record
   - Why critical: Motor sizes vary, economizer models differ (especially Carrier), need exact part matches

5. **Parse parts from repairs**
   - AI extracts parts list from tech notes
   - Identifies part numbers, quantities
   - Formats cleanly for ordering

6. **Labor hours tracking**
   - Manual entry by tech at job completion
   - Tech signature to lock hours
   - Simple and accurate - no AI suggestions yet

### What MVP Looks Like
**Tech arrives on site:**
- Opens app
- Sees job details (customer, location, equipment)

**During service:**
- **Takes photo of unit nameplate (OCR extracts model/serial)**
- Takes notes (voice or text)
- **Takes photos of nameplates and key components**
- AI helps identify parts needed
- Documents repairs/PM work

**Before leaving:**
- Reviews AI-parsed parts list
- **Confirms all critical photos captured**
- Enters labor hours
- Signs to confirm
- Submits job

**Back office:**
- Job number tracks everything
- **Photos available for accurate parts matching**
- Parts list ready for ordering
- Hours logged for billing

**When user deviates:** Remind them Phase 1 MVP must work end-to-end before adding features.

---

## PHASE 2: LEARNING SYSTEMS
**Start after Phase 1 MVP is functional**

5. **Upload filter sizes**
   - Teach AI your filter inventory
   - Sizes, types, part numbers
   - AI suggests correct filters for units

6. **Parts understanding improvement**
   - AI learns from filter data
   - Better part identification
   - Reduced errors in parts parsing

7. **Move PDF/terminology to admin only**
   - Remove "Load PDF" button from main UI (or admin-only)
   - Remove "Learn Terminology" button from main UI (or admin-only)
   - Clean up interface once AI is trained
   - Keep learning tools available for updates

### Why Phase 2 Matters
PDF and image ingestion is only for teaching AI HVAC terminology. Once trained, techs don't need these buttons cluttering the UI. Admin access lets you update AI knowledge without confusing field techs.

---

## PHASE 3: ASSET TRACKING
**Requires Phase 1 & 2 complete**

8. **Asset repairs per unit/customer**
   - Link all repairs to specific equipment
   - Track by model/serial number
   - View complete repair history per unit
   - Filter by customer name or location

9. **Chat about past jobs**
   - Query: "What repairs did we do on RTU-3?"
   - Query: "Show me all work at ABC Company"
   - Query: "When did we last replace filters here?"
   - AI searches historical data and responds

### Why This Needs Foundation
Can't track asset history without job numbers (Phase 1) and model/serial storage (Phase 1). Chat needs structured data to search through.

---

## PHASE 4: WORKFLOW POLISH
**After core tracking works**

10. **Tech notes enhancement**
    - Show raw text tech entered
    - Offer AI enhancement option
    - Tech approves final version before submit
    - Never auto-replace tech's words

11. **Service tag formatting**
    - Auto-format service tags for consistency
    - Management review before customer delivery
    - Eventually: AI validation then auto-send

### Service Tag Workflow
- Tech completes work → Raw notes captured
- AI formats into professional service tag
- Management checks and approves
- Tag sent to customer
- *Future: AI checks quality → auto-send if perfect*

---

## DEFERRED FEATURES (Post-MVP/Revenue)
**Do NOT build these until MVP is working and making money:**

### Workflow Enhancements (Later)
- GPS check-in/check-out tracking
- Auto check-out if tech leaves site
- Customer signature on device
- QR code scanning for equipment
- QR code generation for assets
- Checkout screen with signature area
- Force check-in via QR scan at customer desk

### Intelligence Features (Later)
- AI suggested labor hours
- AI service tag validation
- AI auto-dispatch techs
- Route optimization
- Local AI on phone for faster parsing

### Integration Features (Later)
- Parts distributor integration (Johnstone, Bluon)
- Parts lookup by model/serial
- Auto parts pricing and availability
- Direct parts ordering from quotes

### Customer Features (Later)
- Online portal for service requests
- Customer view of past service calls
- Customer view of upcoming repairs
- Text/email notifications for scheduling
- AI chat for customer service questions

### Asset Management (Later)
- Full equipment history by unit
- Multiple QR codes per unit (all linked)
- GPS-aware queries ("history on RTU 2" knows location)
- Asset repair tracking per customer/location

**Why deferred:** These require infrastructure, revenue, partnerships, and a working MVP foundation.

---

## BUILDOPS-STYLE WORKFLOW (Future Vision)
**This is what success looks like - but build foundation first**

1. Tech arrives on site → Check-in button
2. GPS ping captures location
3. View job details (customer, equipment, work order)
4. Perform work (repair, PM, diagnostic)
5. Fill out service details
6. Customer signs on screen
7. Tech checks out
8. Next job appears in queue

**For MVP:** Focus on steps 3-5 only. GPS, signatures, and auto-dispatch come later.

---

## KEY RULES FOR CLAUDE CODE

### When User Asks About Future Features:
1. Acknowledge it's a good idea
2. Confirm it's in the roadmap (cite specific phase/section)
3. Redirect to current phase work
4. Ask: "What's blocking you on [current phase item]?"

### When User Jumps Ahead:
**Response template:**
"That's Phase [X] / Deferred Features. Right now you're in Phase 1 (MVP Foundation). Complete these items first:
- [ ] Auto job numbers
- [ ] OCR nameplate extraction
- [ ] Photo documentation
- [ ] Model/serial storage
- [ ] Parse parts from repairs
- [ ] Labor hours + signature

Which Phase 1 item are you working on?"

### When User Gets Stuck:
1. Identify which phase item they're on
2. Break it into smaller steps
3. Focus on the immediate next action
4. Don't discuss future phases unless they block current work

### When to Allow Deviation:
Only break phase order if:
- Client demo requires specific feature
- Safety/compliance issue
- Blocking bug that requires future feature to fix
- User explicitly says "I know this is out of order but..."

---

## COMPLETION CRITERIA

**Phase 1 MVP Complete When:**
- Jobs auto-generate unique numbers
- Model/serial stored per asset
- OCR extracts data from unit nameplate photos
- Photo capture works (attach to jobs)
- Parts parser extracts components correctly from tech notes
- Labor hours entry works with tech signature
- Tech can complete full job cycle: view details → scan nameplate → document work → take photos → log hours → sign → submit

**Phase 2 Complete When:**
- Filter sizes uploaded and searchable
- AI suggests correct parts from terminology
- Admin-only access controls work for learning tools
- PDF/terminology buttons removed from tech UI

**Phase 3 Complete When:**
- Can view all repairs for a specific unit
- Can query repair history by customer/location
- Past job data accessible via chat
- Asset tracking shows complete equipment history

**Phase 4 Complete When:**
- Tech notes show raw + enhanced version
- Service tags format consistently
- Management approval workflow functions

---

## CURRENT PROGRESS ASSESSMENT

When user starts a session, assess where they are:

**Questions to ask:**
1. "Do you have job numbers working?"
2. "Is OCR integrated into the job workflow?"
3. "Can techs take and attach photos?"
4. "Is model/serial data being stored?"
5. "Is parts parsing working correctly?"
6. "Can techs enter and sign labor hours?"

**Based on answers, guide to next Phase 1 item.**

---

## LOGICAL NEXT STEPS

### If Starting Fresh:
1. Get job numbers working → Everything depends on this
2. Add OCR nameplate scanning → Auto-captures unit data
3. Add model/serial storage → Store extracted data
4. Add photo capture → Critical for accurate parts ordering
5. Fix parts parsing → Core AI functionality
6. Add labor + signature → Complete the job cycle

### If You Have Job Numbers Working:
- Next: OCR nameplate scanning
- Why: Eliminates manual data entry errors

### If You Have OCR Working:
- Next: Model/serial storage
- Why: Need place to store extracted data

### If You Have Model/Serial Working:
- Next: Photo capture
- Why: Critical for accurate parts matching

### If You Have Photos Working:
- Next: Parts parsing improvement
- Why: Core value proposition for techs

### If You Have Parts Working:
- Next: Labor hours + signature
- Why: Completes MVP job cycle

### If Phase 1 MVP Works End-to-End:
- Next: Start Phase 2 (filter uploads, learning systems)
- Why: Makes AI smarter at identifying parts

---

## RESPONSE TEMPLATES

### User Asks: "Can we add GPS tracking?"
"That's in **Deferred Features (Workflow Enhancements)**. GPS check-in/out requires:
- Working job numbers (Phase 1)
- Customer/location tracking (Phase 3)
- Infrastructure you don't have yet

Right now you're in **Phase 1**. Which of these are you working on:
- [ ] Auto job numbers
- [ ] OCR nameplate extraction
- [ ] Photo documentation
- [ ] Model/serial storage
- [ ] Parts parsing
- [ ] Labor hours + signature"

### User Asks: "What about customer signatures?"
"Customer signatures are in **Deferred Features (Workflow Enhancements)**. For MVP, only **tech signatures on labor hours** (Phase 1, item #6).

Customer features come after:
- Phase 1 MVP works end-to-end
- You have revenue
- You've validated the workflow with real techs

Which Phase 1 item are you currently stuck on?"

### User Asks: "Can AI suggest labor hours?"
"AI-suggested labor hours are in **Deferred Features (Intelligence Features)**.

For MVP, techs enter hours manually because:
- No baseline data to train on yet
- Need to collect real hours first
- Simpler = less bugs = faster to revenue

Focus on **Phase 1, item #6**: Manual labor hour entry with tech signature.

Need help implementing that?"

### User Asks: "When do we add parts distributor integration?"
"Parts distributor integration (Johnstone, Bluon) is in **Deferred Features (Integration Features)**.

This needs:
- Working MVP to demonstrate to distributors
- Partnership agreements (API access)
- Revenue to justify integration costs

Right now: **Phase 1, item #5** - Get basic parts parsing working first.

What's blocking your parts parsing?"

### User Asks: "Should we build the customer portal now?"
"Customer portal is in **Deferred Features (Customer Features)**.

It requires:
- Working job tracking (Phase 1)
- Asset history (Phase 3)
- Service tag workflow (Phase 4)
- Authentication system
- Revenue to support infrastructure

You need the foundation first. Which Phase 1 item should we build next?"

---

## EMERGENCY CONTEXT SWITCHING

If user says something like:
- "I know this is out of order, but..."
- "Just humor me for a second..."
- "I need to demo [future feature] tomorrow..."

**Then:** Help them, but remind them to come back to Phase 1.

**Response template:**
"Got it - helping with [future feature] for [reason]. After this, let's get back to Phase 1. You still need:
- [ ] Item 1
- [ ] Item 2
..."

---

## SUCCESS METRICS

**MVP is successful when:**
- 1 tech can complete 1 full job workflow without bugs
- Job data is accurate and trackable
- Parts lists are correctly parsed
- Hours are logged and signed
- Back office can process the job for billing

**Then and only then:** Move to Phase 2.

---

## ANTI-PATTERNS TO WATCH FOR

### "But what if we just added..."
🚫 **Stop:** That's scope creep. What Phase 1 item are you on?

### "This would be so cool..."
🚫 **Stop:** Cool ≠ MVP. What Phase 1 item are you on?

### "My friend's app has..."
🚫 **Stop:** Their app is 3 years ahead of you. What Phase 1 item are you on?

### "Can we make it also do..."
🚫 **Stop:** No "also" until Phase 1 works. What Phase 1 item are you on?

---

## WHEN USER IS ON TRACK

**Celebrate progress:** "Great! That's Phase 1, item X complete. Next: item Y."

**Encourage focus:** "You're making solid progress on the foundation. This is how MVPs get to revenue."

**Preview next phase:** "Once Phase 1 works end-to-end, Phase 2 will make the AI much smarter at parts identification."

---

Remember: **Foundation first. Revenue second. Cool features third.**

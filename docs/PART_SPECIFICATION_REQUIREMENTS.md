# Part Specification Requirements

## Problem

When tech says: **"RTU-6 needs filters and batteries"**

❌ **WRONG:** System assumes 24x24x2 filters and AA batteries
✅ **CORRECT:** System prompts for specifics

---

## Required Behavior

### 1. Incomplete Part Detection

When parsing identifies parts WITHOUT sufficient specifications, system must:
1. Flag part as **incomplete**
2. Store initial vague request in transcript
3. Prompt user for missing details
4. Store clarified details in NEW transcript

### 2. What Counts as "Incomplete"

**Filters:**
- ❌ "filters" (missing size)
- ❌ "air filters" (missing size)
- ✅ "24x24x2 filters" (has size)
- ✅ "16x25x1 MERV 8 pleated filters" (complete)

**Batteries:**
- ❌ "batteries" (missing type)
- ✅ "AA batteries" (has type)
- ✅ "4 AA batteries" (has quantity + type)

**Contactors:**
- ❌ "contactor" (missing specs)
- ❌ "2 pole contactor" (missing voltage)
- ✅ "2 pole 24V contactor" (complete)

**Capacitors:**
- ❌ "capacitor" (missing specs)
- ❌ "run capacitor" (missing ratings)
- ✅ "45/5 MFD 440V dual run capacitor" (complete)

**Refrigerant:**
- ❌ "refrigerant" (missing type + quantity)
- ❌ "R-410A" (missing quantity)
- ✅ "4 lbs R-410A" (complete)

---

## Implementation

### Phase 1: Parser Updates

Update `parseRepairs()` in server.js to flag incomplete parts:

```javascript
{
  "equipment": "RTU-6",
  "problem": "Needs filters and batteries",
  "parts": [
    {
      "name": "filters",
      "incomplete": true,
      "missingDetails": ["size", "type"],
      "prompt": "What size filters does RTU-6 need?"
    },
    {
      "name": "batteries",
      "incomplete": true,
      "missingDetails": ["type"],
      "prompt": "What type of batteries?"
    }
  ],
  "actions": [],
  "needsClarification": true
}
```

### Phase 2: Conversational Flow

When `needsClarification: true`, system enters **clarification mode**:

**Transcript 1 (Initial Request):**
```
Tech: "RTU-6 needs filters and batteries"
Time: Nov 3, 2025 at 9:15 AM
Status: Incomplete - needs clarification
```

**System Response:**
```
Jerry: "I've noted RTU-6 needs filters and batteries.
       What size filters? (e.g., 20x25x1, 16x20x2)"
```

**Transcript 2 (Clarification 1):**
```
Tech: "24 by 24 by 2 pleated"
Time: Nov 3, 2025 at 9:16 AM
Context: Clarifying filters for RTU-6
Linked to: Transcript 1
```

**System Response:**
```
Jerry: "Got it - 24x24x2 pleated filters for RTU-6.
       What type of batteries?"
```

**Transcript 3 (Clarification 2):**
```
Tech: "Four AA"
Time: Nov 3, 2025 at 9:16 AM
Context: Clarifying batteries for RTU-6
Linked to: Transcript 1
```

**Final Result:**
```
✓ RTU-6 Repairs Complete:
  - 24x24x2 pleated filters (qty: 1)
  - AA batteries (qty: 4)

[View 3 Transcripts]
```

---

## Transcript Linking

All clarification transcripts link back to the original:

```json
{
  "id": "transcript-001",
  "timestamp": "2025-11-03T09:15:00.000Z",
  "text": "RTU-6 needs filters and batteries",
  "unitsMentioned": ["RTU-6"],
  "status": "incomplete",
  "clarificationTranscripts": ["transcript-002", "transcript-003"]
}

{
  "id": "transcript-002",
  "timestamp": "2025-11-03T09:16:00.000Z",
  "text": "24 by 24 by 2 pleated",
  "unitsMentioned": ["RTU-6"],
  "parentTranscript": "transcript-001",
  "clarifies": "filters"
}

{
  "id": "transcript-003",
  "timestamp": "2025-11-03T09:16:30.000Z",
  "text": "Four AA",
  "unitsMentioned": ["RTU-6"],
  "parentTranscript": "transcript-001",
  "clarifies": "batteries"
}
```

---

## UI Changes Required

### 1. Incomplete Part Indicator

```
┌─ RTU-6 ──────────────────────────────────────┐
│ ⚠️  Needs filters (SPECIFY SIZE)             │
│    What size filters? (e.g., 20x25x1)        │
│    [Tap mic to specify] [Type manually]      │
│                                               │
│ ⚠️  Needs batteries (SPECIFY TYPE)           │
│    What type of batteries?                   │
│    [Tap mic to specify] [Type manually]      │
└───────────────────────────────────────────────┘
```

### 2. After Clarification

```
┌─ RTU-6 ──────────────────────────────────────┐
│ ✓ Filters (9:15 AM)                          │
│   PARTS: 1 × 24x24x2 pleated filter          │
│   ACTIONS: Replace filters                   │
│                                               │
│ ✓ Batteries (9:16 AM)                        │
│   PARTS: 4 × AA battery                      │
│   ACTIONS: Replace batteries                 │
│                                               │
│ [View 3 Transcripts]                         │
└───────────────────────────────────────────────┘
```

---

## Part Specification Rules

### Minimum Required Details

| Part Category | Required Fields | Example |
|---------------|----------------|---------|
| **Filters** | Size (WxHxD) | 24x24x2 |
| **Batteries** | Type (AA, AAA, 9V, etc) | AA |
| **Contactors** | Poles + Voltage | 2 pole 24V |
| **Capacitors** | MFD + Voltage | 45/5 MFD 440V |
| **Refrigerant** | Type + Quantity | 4 lbs R-410A |
| **Belts** | Size/Part number | 5/8 × 54" or A54 |
| **Motors** | HP + Voltage + Speed | 1/2 HP 208-230V 1075 RPM |
| **Thermostats** | Type + Stages | Programmable 2H/1C |

### Default Quantities

- Filters: 1 (unless specified)
- Batteries: Ask quantity if not mentioned
- Contactors: 1
- Capacitors: 1
- Refrigerant: MUST specify quantity (no default)

---

## System Prompts

### Generic Part Prompts

```javascript
const clarificationPrompts = {
  "filter": "What size filter does {unit} need? (e.g., 20x25x1, 16x20x2)",
  "battery": "What type of battery? (e.g., AA, AAA, 9V)",
  "contactor": "What are the contactor specs? (e.g., 2 pole 24V)",
  "capacitor": "What are the capacitor ratings? (e.g., 45/5 MFD 440V)",
  "refrigerant": "How many pounds and what type? (e.g., 4 lbs R-410A)",
  "belt": "What belt size? (e.g., 5/8 × 54 inches)",
  "motor": "What are the motor specs? (HP, voltage, speed)"
}
```

### Smart Follow-ups

If tech says "filters", system can:
1. Check equipment database for {unit} specs
2. If RTU-6 has known filter size in equipment.metadata → suggest it
3. Otherwise → prompt for size

```
Jerry: "What size filters for RTU-6?
       (Last time you used 24x24x2 - same size?)"

Tech: "yes" → uses 24x24x2
```

---

## Acceptance Criteria

✅ System detects incomplete part specifications
✅ System prompts for missing details conversationally
✅ All transcripts (vague + clarifications) are stored with timestamps
✅ Transcripts are linked (parent → clarifications)
✅ UI shows "⚠️ Needs clarification" for incomplete parts
✅ Final repair card shows complete specifications only
✅ System remembers previous specs for same equipment

❌ System NEVER assumes filter sizes
❌ System NEVER assumes battery types
❌ System NEVER assumes part specifications without explicit confirmation

---

## Future Enhancement: Learning System

Track part usage patterns:
- RTU-6 filter size history → suggest most common
- Tech's preferred brands → offer as default
- Seasonal patterns → "Usually 2x filters this time of year?"

But always require **explicit confirmation** before finalizing.

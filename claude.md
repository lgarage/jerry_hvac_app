# CLAUDE.md

## Project

**Jerry HVAC App – Voice-Driven Part Entry**

This repo powers the “Add Part to Database” modal in the HVAC documentation assistant.  
Treat this as an **active-modal voice UI**: all AI-driven fills or UI updates MUST occur **only** inside the currently open modal.

---

## Core Intent

When the user holds the **purple microphone** button, interpret the utterance as structured data for the active modal titled **“Add Part to Database.”**  
Extract values (name, quantity, category, type, price, part number, description, etc.), choose valid dropdown items, fill the fields, and update UI feedback components — **without** touching anything behind the modal.

---

## Modal Layout

| Field Label | Field Key     | Input Type | Notes                                                                                      |
| ----------- | ------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Part Name   | `name`        | text       | **Required**                                                                               |
| Part Number | `partNumber`  | text       | Optional; placeholder `e.g., M847D`                                                        |
| Category    | `category`    | select     | **Required**; options: **Electrical, Mechanical, Refrigeration, Controls, Filters, Other** |
| Type        | `type`        | select     | **Required**; options: **Consumable, Inventory**                                           |
| Price ($)   | `price`       | number     | Default `0.00`                                                                             |
| Quantity    | `quantity`    | number     | Default `1`                                                                                |
| Description | `description` | textarea   | Optional                                                                                   |
| Common Uses | `commonUses`  | textarea   | Optional                                                                                   |

Buttons at bottom: **Cancel** | **Add Part to Database**  
Floating controls: **Purple microphone** + **Green keyboard** centered at bottom.

---

## Voice Parsing Rules

1. **Leading number = Quantity**

- “**2 AA batteries**” → `quantity = 2`, `name = "AA batteries"`
- “**three and a half gallons glycol**” → `quantity = 3.5`, `name = "gallons glycol"`
- Preserve embedded numerics in names: “**3/4 ball valve**” → `name = "3/4 ball valve"` (do **not** set qty to 3).

2. **Single-shot entry** (fill multiple fields from one utterance)  
   Example: “**Two AA batteries, Electrical, Consumable, price one twenty-five each**.”  
   Result: `quantity=2`, `name="AA batteries"`, `category="Electrical"`, `type="Consumable"`, `price=1.25`.

3. **Fuzzy dropdown matching**

- Case-insensitive, partial, or near spelling (Levenshtein/startsWith).
- Snap to the closest valid **Category**/**Type** above a sensible threshold.
- If unknown, show inline error (no submit):  
  `Unknown category "X". Try one of: Electrical, Mechanical, Refrigeration, Controls, Filters, Other`.

4. **Price normalization**

- “one twenty-five” → `1.25`
- “ninety-nine cents” → `0.99`
- Default currency: USD; treat spoken “price / price each / at / for” as **unit price**.

5. **Quantity synonyms**

- “qty”, “quantity”, “make it”, “set to”, “count” → map to `quantity`.

6. **If multiple values spoken, fill in this priority:**  
   `quantity → name → category → type → price → partNumber → description`.

---

## Parser Function Spec

```ts
export type Parsed = {
  name?: string
  partNumber?: string
  quantity?: number
  category?: "Electrical"|"Mechanical"|"Refrigeration"|"Controls"|"Filters"|"Other"
  type?: "Consumable"|"Inventory"
  price?: number
  description?: string
  errors?: string[]
}

export function parseSpokenPart(input: string): Parsed
Tests (Jest/Vitest) should cover:

"3/4 ball valve" → name only; no quantity extraction

"two-pack AA batteries" → quantity=2, name="AA batteries"

"qty five price 1.25 each" → quantity=5, price=1.25

Unknown category/type produces errors[]

UI / UX Requirements
Quantity Field
Add Quantity numeric input next to Price ($) on desktop (same row); stack on mobile.

Compact Status Pill
Replace large top banner with a small sticky pill above the mic that cycles:
Recording… → Parsing… → Filling fields… → Done
Show the latest transcript snippet (truncate with ellipsis). Include a small “View” link to toggle a collapsible transcript drawer inside the modal (no page scroll).

Dropdown Visibility While Recording
While the mic is active, the pill displays:
Categories: Electrical • Mechanical • Refrigeration • Controls • Filters • Other
Types: Consumable • Inventory
(Compact; horizontal scroll allowed if needed.)

Bottom Toolbar Placement
Move the purple mic + green keyboard into a sticky bottom toolbar inside the modal, ensuring Cancel and Add Part to Database are never covered.
Add bottom padding/safe-area insets; ensure z-index allows clicks.

Scroll Behavior

Do not auto-scroll to the top on status updates.

After filling fields, smoothly scroll the first changed field into view.

Accessibility

ARIA labels for mic, status pill, transcript drawer.

Focus order: inputs → mic → keyboard → Cancel → Add Part.

File References (expected)
Component	Path	Purpose
AddPartModal	src/components/AddPartModal.jsx	Modal layout
MicControl	src/components/MicControl.tsx	Mic press & streaming
VoiceStatus	src/components/VoiceStatus.jsx	Pill & transcript
parseSpokenPart	src/utils/parseSpokenPart.ts	Speech → structured fields

Implementation Plan (for Claude)
Read the components above to confirm boundaries.

Plan updates: props/state additions, layout changes, parser rules & tests.

Implement with incremental commits:

feat(voice): add parser + dropdown mapping

feat(ui): quantity field + sticky toolbar

feat(ui): compact status pill + transcript drawer

fix(ux): prevent overlap; improve accessibility

Verify:

Example utterances populate correctly.

Buttons remain clickable on mobile.

No DOM writes outside active modal.

Acceptance Criteria
Spoken Example	Expected Outcome
“Two AA batteries, Electrical, Consumable, price one twenty-five each.”	Qty=2; Name=AA batteries; Category=Electrical; Type=Consumable; Price=1.25
“Part number M847D, Refrigeration, Inventory, price 129.”	PartNumber=M847D; Category=Refrigeration; Type=Inventory; Price=129
“Three filters, Filters, Consumable, price 8.50 each.”	Qty=3; Category=Filters; Type=Consumable; Price=8.50
“3/4 ball valve, Mechanical, Inventory, price 22.”	Name=3/4 ball valve (no qty); Category=Mechanical; Type=Inventory; Price=22

Behavior Safeguards
Never update fields in background pages or other modals.

Confirm destructive overwrites only when the new value differs drastically.

If multiple modals exist, always target ui.active_surface.

Use inline validation instead of blocking alerts.

Developer Notes
ES Modules (import/export).

Styling: Tailwind utilities + existing modal theme.

Run npm run typecheck before committing.

(Optional) Log voice debug info to src/debug/voice.log.

Quick Reference
Categories: Electrical, Mechanical, Refrigeration, Controls, Filters, Other

Types: Consumable, Inventory

Voice input: purple mic only

Status pill: above mic; shows live transcript + state

Buttons: never covered; always visible

Scope: active modal only
```

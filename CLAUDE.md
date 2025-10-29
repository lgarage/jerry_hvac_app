# Voice-to-Part Parser Directives

## Objective

When interpreting transcribed speech that describes parts or materials, the system must correctly separate **quantity**, **part name**, **specifications**, and **categories/types** — even when multiple parts are mentioned in one sentence.

Always prioritize structured parsing accuracy over literal transcription.

---

## Parsing Rules

### 1. Quantity Extraction

- **Always** detect and extract leading or embedded quantities when they refer to distinct parts.
- Valid quantity forms:
  - Digits (“2 filters”, “4 600V 30A fuses”)
  - Words (“four”, “two and a half”, “half”, “dozen”, “pair”)
  - “pack of 6”, “6-pack”, “case of 12”, etc.
- Quantities **apply only** to the immediate noun phrase following them (stop at “and”, commas, or another quantity).
- Example:
  > “unit needs four 600V 30A fuses and two 24x24x2 pleated filters”  
  > ✅ `[
      { quantity: 4, name: "600V 30A fuse", category: "Electrical" },
      { quantity: 2, name: "24x24x2 pleated filter", category: "Filters" }
  ]`

### 2. Part Name Extraction

- After removing quantity tokens, extract the **remaining noun phrase** as the part name.
- Include relevant technical descriptors (e.g., voltage, amperage, dimensions, size).
- Examples:
  - “4 600V 30A fuses” → `name: "600V 30A fuse"`
  - “2 24x24x2 pleated filters” → `name: "24x24x2 pleated filter"`

### 3. Category Inference

- Infer category from keywords when possible:
  - `"fuse"`, `"breaker"` → Electrical
  - `"filter"`, `"belt"` → Filters/Mechanical
  - `"thermostat"`, `"sensor"` → Controls
  - Default fallback: Other
- Always assign a category if one can be inferred confidently.

### 4. Multiple Parts in One Sentence

- Split on **“and”**, commas, or semicolons when they clearly separate parts.
- Each segment is parsed independently following rules 1–3.
- Example:
  > “need two AA batteries and one 9V battery”
  > → `[ {qty:2, name:"AA battery"}, {qty:1, name:"9V battery"} ]`

### 5. Quantity + Name Normalization

- Never include the quantity inside the `name` field.
- Normalize plural nouns:
  - “filters” → “filter”
  - “batteries” → “battery”
- Ensure dimensional specs (like `24x24x2`) remain intact.

### 6. Unclear / Ambiguous Terms

If a part type or spec cannot be confidently parsed:

- Ask a brief clarifying question rather than guessing.
  - Example: `"Did you mean 600V fuses or 30A breakers?"`
  - Example: `"Confirm filter type: pleated or washable?"`

### 7. Output Format

Always return a normalized array of part objects like:

```json
[
  {
    "quantity": 4,
    "name": "600V 30A fuse",
    "category": "Electrical",
    "type": "Inventory"
  },
  {
    "quantity": 2,
    "name": "24x24x2 pleated filter",
    "category": "Filters",
    "type": "Consumable"
  }
]
If confidence in parsing is below 0.8, include a clarify field with a short question.

Examples to Train Against
Input (spoken)	Expected Parsed Output
“two AA batteries”	[{"qty":2,"name":"AA battery","category":"Electrical"}]
“six pleated filters twenty by twenty by two”	[{"qty":6,"name":"20x20x2 pleated filter","category":"Filters"}]
“four 600V 30A fuses and two 24x24x2 pleated filters”	[{"qty":4,"name":"600V 30A fuse","category":"Electrical"},{"qty":2,"name":"24x24x2 pleated filter","category":"Filters"}]
“one 9V battery and one thermostat sensor”	[{"qty":1,"name":"9V battery","category":"Electrical"},{"qty":1,"name":"thermostat sensor","category":"Controls"}]

Implementation Reminders
The parser runs before GPT-4 validation.

Confidence threshold: 0.75 → escalate for confirmation.

Use client-side parsing for first pass, server-side for clarification logic.

Never concatenate multiple parts into one string.
```

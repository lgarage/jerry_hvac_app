# Equipment-Specific Filter Learning System

## Business Context

**Preventive Maintenance Model:**
- PM performed 2-4 times per year for regular accounts
- Filters changed during PM (every 3-6 months)
- Belts changed every 6 months during PM
- **Filters rarely needed outside PM for existing accounts**
- Filters more common for new customers/locations (not on PM schedule)

**Key Insight:** Each unit has SPECIFIC filter sizes. Generic suggestions are useless.
- RTU-6 always needs 24x24x2 (not 20x25x1)
- RTU-2 always needs 16x20x1 (not 24x24x2)
- etc.

---

## Current Problem with Generic Suggestions

❌ **WRONG APPROACH:**
```
Tech: "RTU-6 needs filters"
System: "What size? (e.g., 14x20x1, 16x20x1, 16x25x1)"
```
This is useless - RTU-6 has a specific size. Suggesting random popular sizes wastes time.

✅ **CORRECT APPROACH:**
```
Tech: "RTU-6 needs filters"
System checks equipment.metadata for RTU-6
  If found: "RTU-6 uses 24x24x2 filters (last changed 3 months ago). Same size?"
  If not found: "What size filters does RTU-6 need?"
Tech: "24x24x2"
System stores in equipment.metadata → future calls auto-suggest
```

---

## Implementation Strategy

### 1. Equipment Metadata Structure

Each equipment record stores its specifications:

```sql
UPDATE equipment
SET metadata = jsonb_build_object(
  'filter_size', '24x24x2',
  'filter_last_changed', '2025-08-15',
  'belt_size', '5/8 x 54',
  'belt_last_changed', '2025-08-15',
  'refrigerant_type', 'R-410A',
  'battery_type', 'AA',
  'learned_from_job', '0045NRP'
)
WHERE equipment_name = 'RTU-6';
```

### 2. Smart Prompting Logic

**On first mention (no history):**
```
Tech: "RTU-6 needs filters"
System: Equipment RTU-6 has no filter size on record.
        "What size filters does RTU-6 need?"
Tech: "24 by 24 by 2"
System: Stores 24x24x2 in equipment.metadata
```

**On subsequent mentions:**
```
Tech: "RTU-6 needs filters"
System: Found RTU-6 filter_size = "24x24x2" (last changed 3 months ago)
        "RTU-6 uses 24x24x2 filters. Same size?"
Tech: "yes"
System: Uses 24x24x2, no re-prompt needed
```

**Edge case - size changed:**
```
Tech: "RTU-6 needs filters"
System: "RTU-6 uses 24x24x2 filters. Same size?"
Tech: "no, 20x20x2"
System: Updates equipment.metadata with new size
        Logs size change in job notes
```

### 3. Pricing Visibility

**Tech-facing UI:**
- ❌ NO pricing shown
- ❌ NO "Tap for 14x20x1" buttons
- ✅ Show only: "24x24x2 filter (qty: 2)"

**Quote/Admin UI:**
- ✅ Show pricing for quote generation
- ✅ Show inventory availability
- ✅ Show tier discounts
- ✅ Calculate total material cost

### 4. PM Schedule Context

Track when filters were last changed:
```javascript
{
  equipment_name: "RTU-6",
  metadata: {
    filter_size: "24x24x2",
    filter_last_changed: "2025-08-15",  // 3 months ago
    filter_change_interval_months: 3,    // Learned from history
    next_pm_due: "2025-11-15"
  }
}
```

**PM reminder logic:**
```
If (months_since_last_filter_change >= 3) {
  Flag: "RTU-6 filters may be due for PM"
  Show in PM schedule: "RTU-6 - Filter change recommended"
}
```

### 5. New Customer Workflow

**First service call at new location:**
```
Tech: "RTU-2 needs filters"
System: Equipment RTU-2 not found. Is this a new unit?
        [Create Equipment] [Skip]
Tech: Creates RTU-2
System: "What size filters does RTU-2 need?"
Tech: "16x20x1"
System: Creates equipment record with filter_size = "16x20x1"
```

**All future calls:**
```
Tech: "RTU-2 needs filters"
System: "RTU-2 uses 16x20x1 filters. Same size?" ✅
```

---

## Database Schema Updates

### Equipment Table Enhancement

```sql
-- Add learned specifications to equipment.metadata
ALTER TABLE equipment
ALTER COLUMN metadata SET DEFAULT '{
  "filter_size": null,
  "filter_last_changed": null,
  "filter_qty": null,
  "belt_size": null,
  "belt_last_changed": null,
  "battery_type": null,
  "refrigerant_type": null,
  "refrigerant_capacity_lbs": null,
  "learned_specifications": {
    "complete": false,
    "learning_job_ids": []
  }
}'::jsonb;
```

### Functions for Equipment Learning

```sql
-- Function to get equipment specifications
CREATE OR REPLACE FUNCTION get_equipment_spec(
  p_equipment_name VARCHAR,
  p_spec_key VARCHAR
)
RETURNS TEXT AS $$
DECLARE
  spec_value TEXT;
BEGIN
  SELECT metadata->>p_spec_key INTO spec_value
  FROM equipment
  WHERE equipment_name = p_equipment_name;

  RETURN spec_value;
END;
$$ LANGUAGE plpgsql;

-- Function to store learned specification
CREATE OR REPLACE FUNCTION store_equipment_spec(
  p_equipment_name VARCHAR,
  p_spec_key VARCHAR,
  p_spec_value TEXT,
  p_job_number VARCHAR DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE equipment
  SET metadata = jsonb_set(
    metadata,
    ARRAY[p_spec_key],
    to_jsonb(p_spec_value)
  ),
  updated_at = NOW()
  WHERE equipment_name = p_equipment_name;

  -- Log the learning event
  IF p_job_number IS NOT NULL THEN
    UPDATE equipment
    SET metadata = jsonb_set(
      metadata,
      ARRAY['learned_specifications', 'learning_job_ids'],
      (metadata->'learned_specifications'->'learning_job_ids') || to_jsonb(p_job_number)
    )
    WHERE equipment_name = p_equipment_name;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## Updated Detection Logic

### Before (Generic Suggestions)
```javascript
// ❌ WRONG
return {
  prompt: 'What size filter? (e.g., 14x20x1, 16x20x1, 16x25x1)',
  suggestions: ['14x20x1', '16x20x1', '16x25x1']  // Generic, useless
};
```

### After (Equipment-Specific)
```javascript
// ✅ CORRECT
async function detectFilter(normalized, original, context) {
  const { equipmentName } = context;

  if (!hasFilterSize(original)) {
    // Check equipment history
    const knownSize = await getEquipmentSpec(equipmentName, 'filter_size');

    if (knownSize) {
      return {
        prompt: `${equipmentName} uses ${knownSize} filters. Same size?`,
        suggestedSize: knownSize,
        allowConfirmation: true  // "yes" = use suggested, "no" = prompt for new size
      };
    } else {
      return {
        prompt: `What size filters does ${equipmentName} need?`,
        suggestedSize: null,
        learnAndStore: true  // Store answer in equipment.metadata
      };
    }
  }
}
```

---

## Acceptance Criteria

✅ System NEVER shows generic filter sizes to tech
✅ System checks equipment.metadata for unit-specific specs
✅ First mention: asks and stores spec for future use
✅ Subsequent mentions: suggests known spec, allows confirmation
✅ Pricing hidden from tech UI (only in quote/admin view)
✅ Equipment learns specifications over time
✅ PM schedule aware (tracks last filter change date)
✅ New customer workflow: create equipment → learn specs → store

❌ System does NOT show pricing to technicians
❌ System does NOT show generic "popular sizes" buttons
❌ System does NOT assume specs without equipment context

---

## Migration Path

1. Query existing jobs for filter/belt/battery mentions
2. Extract sizes from historical transcripts
3. Pre-populate equipment.metadata with learned specs
4. Mark confidence level based on consistency

**Example:**
```sql
-- Find all filter mentions for RTU-6
SELECT
  equipment_name,
  parts_used,
  COUNT(*) as times_used
FROM jobs
WHERE equipment_name = 'RTU-6'
  AND parts_used::text LIKE '%filter%'
GROUP BY equipment_name, parts_used
ORDER BY times_used DESC;

-- Result: RTU-6 has used "24x24x2 filter" 12 times
-- Action: Pre-populate equipment.metadata.filter_size = "24x24x2"
```

This way, the system already "knows" specs for existing equipment from historical data!

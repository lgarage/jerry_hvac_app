# Corrections Logging Testing Guide

## Overview
The corrections logging system automatically tracks when users edit auto-matched parts, helping the system learn from corrections over time.

## What Was Implemented

### Server-Side (server.js)
1. **Corrections Cache & File Operations**
   - `loadCorrections()` - Loads corrections from `data/lexicon_corrections.json`
   - `saveCorrections()` - Saves corrections to JSON file (pretty-formatted)
   - Auto-creates file if it doesn't exist

2. **API Endpoints**
   - `POST /api/lexicon/corrections` - Log a user correction
   - `GET /api/lexicon/corrections` - Retrieve corrections (with filtering)
   - `GET /api/lexicon/suggestions` - Get auto-suggested synonyms from recurring patterns

3. **Auto-Matched Parts Enhancement**
   - Parts now include `_parsedQuantity` and `_parsedName` fields for tracking original values

### Client-Side (public/app.js)
1. **Global Variables**
   - `lastRawTranscript` - Stores last raw voice input
   - `lastNormalizedTranscript` - Stores last normalized text

2. **Helper Function**
   - `logCorrection(field, oldValue, newValue, raw, normalized)` - Fire-and-forget logging

3. **Correction Tracking Hooks**
   - Quantity input change event (line ~3087)
   - Minus button click (line ~3064)
   - Plus button click (line ~3132)
   - Only logs for auto-matched parts (has voice context)

## Testing Instructions

### 1. Server Endpoint Tests (Already Passed ✓)

```bash
# Test POST correction
curl -X POST http://localhost:3000/api/lexicon/corrections \
  -H "Content-Type: application/json" \
  -d '{"field":"quantity","oldValue":"2","newValue":"4","raw":"2 AA batteries","normalized":"2 AA battery","timestamp":1730000000000}'

# Test GET corrections
curl http://localhost:3000/api/lexicon/corrections | jq .

# Test GET with limit
curl 'http://localhost:3000/api/lexicon/corrections?limit=2' | jq .

# Test GET with field filter
curl 'http://localhost:3000/api/lexicon/corrections?field=name' | jq .

# Test GET suggestions
curl http://localhost:3000/api/lexicon/suggestions | jq .

# Test error handling
curl -X POST http://localhost:3000/api/lexicon/corrections \
  -H "Content-Type: application/json" \
  -d '{"field":"invalid"}' # Should return error

# Test no-op
curl -X POST http://localhost:3000/api/lexicon/corrections \
  -H "Content-Type: application/json" \
  -d '{"field":"name","oldValue":"test","newValue":"test"}' # Should skip
```

### 2. Manual Browser Tests (Recommended)

#### Test Scenario 1: Quantity Correction
1. Start server: `node server.js`
2. Open browser to `http://localhost:3000`
3. Create a repair for an RTU
4. Use voice input: **"RTU-1 needs 2 AA batteries"**
5. Verify auto-matched part appears with qty=2
6. Change quantity to 4 using the inline input
7. Check browser console for log: `📝 Logging correction: quantity "2" → "4"`
8. Verify correction logged: `curl http://localhost:3000/api/lexicon/corrections | jq .`

Expected output:
```json
{
  "field": "quantity",
  "oldValue": "2",
  "newValue": "4",
  "raw": "2 AA batteries",
  "normalized": "2 AA batteries"
}
```

#### Test Scenario 2: Multiple Corrections
1. Say: **"RTU-2 needs 4 24x24x2 pleated filters"**
2. Change quantity from 4 to 6
3. Check console logs
4. Say: **"RTU-3 needs 1 9V battery"**
5. Change quantity from 1 to 2
6. Run: `curl http://localhost:3000/api/lexicon/corrections | jq .`
7. Should see both corrections

#### Test Scenario 3: Plus/Minus Buttons
1. Say: **"RTU-4 needs 3 capacitors"**
2. Click "+" button twice (should go 3 → 4 → 5)
3. Check console - should log when it differs from original (5 ≠ 3)
4. Click "−" button once (should go 5 → 4)
5. Check console - should log again (4 ≠ 3)

### 3. Suggestions Test

After accumulating several corrections:

```bash
# Add multiple "plated" → "pleated" corrections
curl -X POST http://localhost:3000/api/lexicon/corrections \
  -H "Content-Type: application/json" \
  -d '{"field":"name","oldValue":"plated filter","newValue":"pleated filter","raw":"24x24x2 plated filter","timestamp":1730000001000}'

curl -X POST http://localhost:3000/api/lexicon/corrections \
  -H "Content-Type: application/json" \
  -d '{"field":"name","oldValue":"plated filter","newValue":"pleated filter","raw":"20x25 plated filter","timestamp":1730000002000}'

# Get suggestions (requires 2+ occurrences by default)
curl http://localhost:3000/api/lexicon/suggestions | jq .
```

Expected output:
```json
{
  "suggestions": [
    {
      "trigger": "plated filter",
      "replacement": "pleated filter",
      "kind": "synonym",
      "score": 1,
      "notes": "Auto-suggested from 2 user corrections",
      "occurrences": 2
    }
  ]
}
```

### 4. Using the Test Page

1. Start server: `node server.js`
2. Open `http://localhost:3000/test_corrections.html`
3. Open browser console (F12)
4. Click "Run Tests"
5. Watch console output
6. Click link to view logged corrections

## What Gets Logged

### Logged Fields
- `field`: "name", "category", "type", "price", or "quantity"
- `oldValue`: Original parsed value (from voice)
- `newValue`: User's corrected value
- `raw`: Original voice transcript (e.g., "2 AA batteries")
- `normalized`: Normalized transcript (e.g., "2 AA battery")
- `timestamp`: Unix timestamp
- `created_at`: ISO timestamp

### When Corrections Are Logged
✅ **Logged:**
- User edits quantity on auto-matched part
- User clicks +/− buttons on auto-matched part
- New value differs from original parsed value

❌ **Not Logged:**
- No change (oldValue === newValue)
- Manually added parts (no voice context)
- Parts added from catalog search
- Invalid field names

## Data Files

### lexicon_corrections.json
Location: `/home/user/jerry_hvac_app/data/lexicon_corrections.json`

Format:
```json
[
  {
    "field": "quantity",
    "raw": "2 AA batteries",
    "normalized": "2 AA battery",
    "oldValue": "2",
    "newValue": "4",
    "timestamp": 1730000000000,
    "created_at": "2025-10-28T01:15:14.644Z"
  }
]
```

## Future Use Cases

1. **Auto-Suggestions**: Review `/api/lexicon/suggestions` periodically to find recurring patterns
2. **Teaching UI**: Build interface to promote suggestions to lexicon.json
3. **Analytics**: Analyze which parts are most often corrected
4. **Quality Metrics**: Track parser accuracy over time

## Troubleshooting

### Corrections not logging?
- Check browser console for errors
- Verify part has `auto_matched: true` flag
- Ensure part has `_parsedQuantity` field
- Check server logs: `tail -f` on server output

### File not created?
- Check permissions on `data/` directory
- Verify server started successfully
- Look for "✓ Created lexicon_corrections.json" in server output

### CORS errors?
- Server has CORS enabled by default
- Check network tab in browser dev tools

## Performance Notes

- Corrections logging is **fire-and-forget** (won't block UI)
- File writes use `setImmediate()` to avoid blocking
- Failed logs are silently ignored with console warnings
- No authentication required (consider adding for production)

## Next Steps

After testing and confirming corrections are logging properly:
1. Use suggestions endpoint to identify patterns
2. Manually promote useful suggestions to lexicon.json
3. Consider building admin UI for reviewing/approving suggestions
4. Monitor correction frequency to find parser weak points

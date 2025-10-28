# Check Corrections

Review logged user corrections and see auto-suggestions.

## Steps
1. Fetch recent corrections: `curl http://localhost:3000/api/lexicon/corrections?limit=10`
2. Parse and format nicely
3. Fetch suggestions: `curl http://localhost:3000/api/lexicon/suggestions`
4. Show suggestions with occurrence counts
5. Recommend which suggestions to add to lexicon

## Expected Output
- Recent corrections (formatted table)
- Auto-suggestions (formatted table)
- Recommendations: "Consider adding: plated→pleated (2 occurrences)"

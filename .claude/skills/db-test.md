# Database Connection Test

Test the PostgreSQL database connection and show basic statistics.

## Steps
1. Use the postgres MCP server to run: `SELECT COUNT(*) FROM parts;`
2. Show the result
3. Also check: `SELECT COUNT(*) FROM lexicon;` if the table exists
4. Report whether database is healthy

## Expected Output
- Part count
- Lexicon entry count (if exists)
- Connection status: ✅ or ❌

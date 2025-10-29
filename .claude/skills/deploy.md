# Deploy Server

Restart the Node.js server safely.

## Steps
1. Check if server is already running: `ps aux | grep "node server.js"`
2. If running, kill it: `pkill -f "node server.js"`
3. Start fresh: `node server.js` in background
4. Wait 2 seconds
5. Verify it started: `curl -s http://localhost:3000/api/lexicon | head -n 5`
6. Report status

## Expected Output
- ✅ Server running on http://localhost:3000
- OR ❌ Failed to start (with error message)

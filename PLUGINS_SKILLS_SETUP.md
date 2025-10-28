# 🚀 Plugins & Skills Setup Guide

This guide will supercharge your development workflow. Follow these exact steps.

---

## ✅ What I Just Set Up For You

I've created:
1. **MCP Server Configuration** (`.claude/mcp.json`)
2. **4 Custom Skills** (in `.claude/skills/`)

---

## 🔧 Part 1: MCP Servers (Super Powers!)

### What Are MCP Servers?
Think of them as "plugins" that give Claude Code special abilities:
- **postgres**: Direct database access (no code needed!)
- **filesystem**: Better file operations

### Installation (ONE TIME ONLY)

**Option A: Automatic (Recommended)**

Just restart Claude Code:
```bash
# Exit Claude Code (Ctrl+C or close terminal)
# Then start it again:
claude-code
```

When Claude Code restarts, it will automatically detect `.claude/mcp.json` and install the MCP servers.

**Option B: Manual (If needed)**

If automatic doesn't work, install globally:
```bash
npm install -g @modelcontextprotocol/server-postgres
npm install -g @modelcontextprotocol/server-filesystem
```

### How to Use MCP Servers

**Before (without MCP):**
```
You: "Show me all parts in the database"
Me: "Let me write a query and run it via psql..."
[5 steps, lots of code]
```

**After (with MCP):**
```
You: "Show me all parts in the database"
Me: [Instantly queries database using postgres MCP]
     "Here are 47 parts: ..."
```

**Example Commands You Can Use:**
- "Show me all parts with category Electrical"
- "How many repairs are in the database?"
- "Show me the 5 most expensive parts"
- "What's in the lexicon table?"
- "Count corrections by field type"

---

## 🎯 Part 2: Custom Skills (Time Savers!)

I created 4 skills for common tasks. Here's how to use them:

### Skill 1: `db-test` - Test Database Connection

**What it does:** Checks if database is working and shows stats

**How to use:**
```
You: "db-test"
```

**What I'll do:**
- Connect to PostgreSQL
- Count parts, lexicon entries
- Report health status

**When to use:**
- After database changes
- When debugging connection issues
- Quick sanity check

---

### Skill 2: `deploy` - Restart Server

**What it does:** Safely restarts Node.js server

**How to use:**
```
You: "deploy"
```

**What I'll do:**
- Stop current server (if running)
- Start fresh server
- Verify it's working
- Report status

**When to use:**
- After code changes to server.js
- After npm install
- When server seems stuck

---

### Skill 3: `quick-commit` - Fast Git Commits

**What it does:** Commit all changes and push in one command

**How to use:**
```
You: "quick-commit: fixed battery parsing bug"
```

OR:
```
You: "quick-commit"
Me: "What's the commit message?"
You: "fixed battery parsing bug"
```

**What I'll do:**
- Stage all changes
- Commit with your message
- Push to current branch
- Show summary

**When to use:**
- Small fixes
- Quick iterations
- No need for fancy commit messages

---

### Skill 4: `check-corrections` - Review User Corrections

**What it does:** Shows what users have been correcting + suggestions

**How to use:**
```
You: "check-corrections"
```

**What I'll do:**
- Fetch recent corrections from `/api/lexicon/corrections`
- Fetch auto-suggestions from `/api/lexicon/suggestions`
- Format as nice tables
- Recommend which to add to lexicon

**When to use:**
- Weekly review of corrections
- Before updating lexicon.json
- To see what users are struggling with

---

## 📋 Your New Workflow

### Scenario 1: Making a Quick Fix

**Old way (5 steps):**
```
You: "Fix the parser bug"
Me: [fixes code]
You: "Now commit it"
Me: [stages, commits]
You: "Now push it"
Me: [pushes]
You: "Now restart server"
Me: [restarts]
```

**New way (1 step):**
```
You: "Fix the parser bug, quick-commit, and deploy"
Me: [does everything in one go]
```

---

### Scenario 2: Checking Database

**Old way (complex):**
```
You: "What parts do we have?"
Me: "Let me connect via psql..."
[Writes code, runs commands, formats output]
```

**New way (instant):**
```
You: "Show all parts"
Me: [Uses postgres MCP, instant results]
```

---

### Scenario 3: Weekly Review

**Old way:**
```
You: "Check corrections"
Me: [Writes curl commands, parses JSON, formats]
```

**New way:**
```
You: "check-corrections"
Me: [Skill runs, shows formatted tables + recommendations]
```

---

## 🧪 Test Your Setup (Do This Now!)

### Test 1: Skills Work?

```
You: "list available skills"
```

**Expected output:** Should list db-test, deploy, quick-commit, check-corrections

---

### Test 2: Postgres MCP Works?

```
You: "Use postgres MCP to count all parts"
```

**Expected output:** "There are X parts in the database"

If you get an error, the MCP server needs to be installed. See "Option B: Manual" above.

---

### Test 3: Try a Skill

```
You: "db-test"
```

**Expected output:** Database health report with counts

---

## 🆘 Troubleshooting

### "MCP server not found"

**Problem:** MCP servers not installed

**Fix:**
```bash
npm install -g @modelcontextprotocol/server-postgres
npm install -g @modelcontextprotocol/server-filesystem
```

Then restart Claude Code.

---

### "Skill not found"

**Problem:** Skills directory not loaded

**Fix:**
```bash
# Check skills exist:
ls .claude/skills/

# Should show: db-test.md, deploy.md, quick-commit.md, check-corrections.md
```

If files are there, just try the command again. Skills are auto-loaded.

---

### "Database connection failed"

**Problem:** PostgreSQL not running or wrong credentials

**Fix:**
```bash
# Check if PostgreSQL is running:
pg_isready

# If not running:
sudo service postgresql start

# Check connection string in .env:
cat .env | grep DATABASE_URL
```

---

## 📚 Learning More

### Want to create your own skills?

1. Create a new file in `.claude/skills/`
2. Name it descriptively: `my-skill.md`
3. Write the steps in Markdown
4. Use it by saying the filename (without .md)

**Example:**
```markdown
# My Skill Name

Description of what it does.

## Steps
1. First step
2. Second step
3. Third step

## Expected Output
What should happen
```

Then use it: "my-skill"

---

### Want to add more MCP servers?

Check the registry: https://github.com/modelcontextprotocol/servers

Popular ones:
- `@modelcontextprotocol/server-fetch` - Better web scraping
- `@modelcontextprotocol/server-github` - GitHub integration
- `@modelcontextprotocol/server-slack` - Slack notifications

Add to `.claude/mcp.json`:
```json
{
  "mcpServers": {
    "postgres": { ... },
    "filesystem": { ... },
    "your-new-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"],
      "description": "What it does"
    }
  }
}
```

---

## 🎯 Quick Command Reference

| What You Want | What To Say |
|---------------|-------------|
| Test database | `db-test` |
| Restart server | `deploy` |
| Quick commit & push | `quick-commit: your message` |
| Review corrections | `check-corrections` |
| Query database | `Show me all [parts/repairs/etc]` |
| Count records | `How many [parts/repairs] are there?` |
| List skills | `list available skills` |

---

## ✅ Next Steps (Do These Now!)

1. **Restart Claude Code** (so it loads MCP servers)
   ```bash
   # Exit current session
   # Start fresh:
   claude-code
   ```

2. **Test it:**
   ```
   You: "list available skills"
   You: "db-test"
   You: "Show me 5 parts from the database"
   ```

3. **Start using shortcuts:**
   ```
   You: "quick-commit: updated readme"
   You: "check-corrections"
   You: "deploy"
   ```

---

## 💡 Pro Tips

1. **Chain commands:**
   ```
   "Fix the bug, quick-commit, and deploy"
   ```

2. **Natural language with MCP:**
   ```
   "Show me all electrical parts under $10"
   "How many AA batteries are in stock?"
   ```

3. **Use skills for routine tasks:**
   ```
   "check-corrections" (weekly)
   "db-test" (after changes)
   "deploy" (after updates)
   ```

---

## 🎉 You're Done!

You now have:
- ✅ Direct database access (postgres MCP)
- ✅ Better file operations (filesystem MCP)
- ✅ 4 time-saving skills
- ✅ Faster development workflow

**Next time you work on the app, just use these tools naturally!**

---

## Questions?

Just ask me:
- "Show me how to use [skill name]"
- "Create a skill for [task]"
- "What MCP servers can I use?"
- "How do I query the database?"

**Let's build this app faster! 🚀**

# 🗄️ Database Setup Guide - Supabase + pgvector

## What You Have

Your repo includes:
- ✅ PostgreSQL migrations with **pgvector** extension
- ✅ Semantic search using OpenAI embeddings (1536 dimensions)
- ✅ Parts table with vector similarity search
- ✅ HVAC terminology table for normalization

## Why Supabase is Perfect

Supabase provides:
- ✅ PostgreSQL with **pgvector extension pre-installed**
- ✅ Free tier (500MB database, 2GB bandwidth)
- ✅ No local PostgreSQL installation needed
- ✅ Built-in pgvector support

---

## 🚀 Step-by-Step Setup

### Step 1: Get Your Supabase Connection String

**If you already have a Supabase project:**

1. Go to https://supabase.com/dashboard
2. Open your project
3. Click **Settings** (gear icon, bottom left)
4. Click **Database**
5. Scroll to **Connection string**
6. Select **URI** tab (NOT Session mode or Transaction mode)
7. Copy the connection string
8. **IMPORTANT:** Click "Reset database password" if you forgot it

The connection string looks like:
```
postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

**If you DON'T have a Supabase project yet:**

1. Go to https://supabase.com
2. Click "Start your project"
3. Sign in with GitHub
4. Click "New Project"
5. Choose:
   - **Organization:** Your name
   - **Name:** jerry-hvac-app
   - **Database Password:** (Generate strong password - SAVE THIS!)
   - **Region:** Closest to you
6. Click "Create new project"
7. Wait 2 minutes for it to provision
8. Then follow "Get Your Supabase Connection String" above

---

### Step 2: Update Your .env File

**DON'T JUST COPY-PASTE!** Replace the placeholders with your actual values:

```bash
# OpenAI API Configuration
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx  # Your actual OpenAI key

# Database Configuration (Supabase)
DATABASE_URL=postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Server Configuration
PORT=3000
```

**To update .env:**
```bash
# Open in editor:
nano .env

# Or tell me your connection string and I'll update it for you
```

---

### Step 3: Run the Migrations

Once your .env is updated with the correct Supabase URL:

**Option A: Via Supabase Dashboard (Easiest)**

1. Go to your Supabase project
2. Click **SQL Editor** (left sidebar)
3. Click **New query**
4. Copy the contents of `migrations/001_create_tables.sql`
5. Paste into SQL Editor
6. Click **Run**
7. Repeat for `migrations/002_create_hvac_terminology.sql`

**Option B: Via Command Line (Faster)**

Tell me when your .env is updated, then I'll run:
```bash
# I'll use the postgres MCP server to run your migrations automatically
```

---

### Step 4: Verify the Database

Once migrations are run, test it:

```bash
node test-db.js
```

**Expected output:**
```
✅ Connection: SUCCESS
   Current time: 2025-10-28 01:30:00

📦 Parts in database: 0
📊 Parts by category:
   (empty - no parts yet)

✅ Database Status: HEALTHY
```

Or just say: **"db-test"** (once Claude Code is restarted with MCP servers)

---

## 🔍 Troubleshooting

### Error: "extension vector does not exist"

**Problem:** pgvector not enabled

**Fix:**
1. Go to Supabase Dashboard
2. Click **Database** → **Extensions**
3. Search for "vector"
4. Click **Enable** on "vector"
5. Try migration again

---

### Error: "password authentication failed"

**Problem:** Wrong password in DATABASE_URL

**Fix:**
1. Go to Supabase → Settings → Database
2. Click **Reset database password**
3. Copy the new password
4. Update .env with new password

---

### Error: "SSL connection required"

**Problem:** Connection string needs SSL

**Fix:** Make sure your DATABASE_URL ends with:
```
?sslmode=require
```

Full example:
```
DATABASE_URL=postgresql://postgres.[ref]:[password]@host.supabase.com:6543/postgres?sslmode=require
```

---

## ✅ What's Next After Database Setup

Once your database is connected:

### 1. Seed Initial Parts Data

You'll want to add some parts. I can help you:
```
"Create a script to seed some common HVAC parts"
```

### 2. Generate Embeddings

For semantic search to work, parts need embeddings:
```
"Generate embeddings for all parts in the database"
```

### 3. Test Semantic Search

Try searching:
```
"Test semantic search with 'air filter'"
```

### 4. Use MCP Powers

With postgres MCP server (after restart):
```
"Show me all electrical parts"
"How many parts are in the database?"
"Find parts similar to 'capacitor'"
```

---

## 📝 Quick Reference

**Check current .env:**
```bash
cat .env | grep DATABASE_URL
```

**Test connection:**
```bash
node test-db.js
```

**Run migrations via SQL Editor:**
1. Supabase Dashboard → SQL Editor
2. Copy/paste migration files
3. Click Run

**Verify pgvector enabled:**
```bash
# I'll query: SELECT * FROM pg_extension WHERE extname = 'vector';
```

---

## 🎯 Next Steps

1. **Get your Supabase connection string** (Step 1 above)
2. **Tell me:** "Update my .env with this connection string: [paste it here]"
3. **I'll run the migrations** for you
4. **We'll test** with `db-test`
5. **Start building!** 🚀

---

**Ready? Just say:**
- "Here's my Supabase connection string: [paste]"
- "I updated .env, run the migrations"
- "Help me create a Supabase project"

Let's get your database connected! 💪

# Phase 1 MVP Setup Guide

## Overview

You've just completed the foundation for Phase 1 MVP of Jerry HVAC app! This setup includes:

✅ **Database Schema** - Customers, Equipment, and Jobs tables
✅ **Auto Job Numbers** - Automatic JOB-2025-001 format generation
✅ **CSV Import** - Bulk import equipment from spreadsheets
✅ **Admin Dashboard** - View and manage equipment data
✅ **REST API** - Backend endpoints for all operations

---

## 🚀 Quick Start

### 1. Set Up Your Environment

First, create a `.env` file in the project root with your database credentials:

```bash
cp .env.example .env
```

Then edit `.env` and add your Supabase connection string:

```env
# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Database Configuration (Supabase)
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Server Configuration
PORT=3000
```

### 2. Run the Database Migration

Apply the Phase 1 MVP database schema:

```bash
node run-migration.js migrations/004_create_mvp_foundation.sql
```

Expected output:
```
✓ Connected to database successfully
📄 Running migration: 004_create_mvp_foundation.sql
✓ Migration completed successfully

Created tables:
  • customers
  • equipment
  • jobs

Created views:
  • equipment_with_customer
  • job_summary
  • equipment_repair_history
```

### 3. Start the Server

```bash
npm start
```

### 4. Access the Admin Dashboard

Open your browser to:
- **Main App**: http://localhost:3000/
- **Equipment Admin**: http://localhost:3000/equipment-admin.html

---

## 📥 Importing Planet Fitness Equipment

### Prepare Your CSV File

Create a CSV file with your Planet Fitness equipment data. Required format:

```csv
customer_name,location,equipment_name,manufacturer,model,serial_number,tonnage,refrigerant,voltage
Planet Fitness,Downtown Location,RTU-1,York,YCAV0036EC300AAAA,12345678,3.0,R-410A,208/230V
Planet Fitness,Mall Location,RTU-2,Carrier,50TCQ06A3A6A0A0A0,87654321,5.0,R-410A,460V
Planet Fitness,Westside Location,Split System,Trane,4TWR4036A1000AA,11223344,3.0,R-410A,208/230V
```

### Supported Columns

| Column | Required | Description |
|--------|----------|-------------|
| `customer_name` | ✅ | Business name (e.g., "Planet Fitness") |
| `location` | ✅ | Location identifier (e.g., "Downtown", "Mall") |
| `equipment_name` | | Unit name (e.g., "RTU-1", "Rooftop Unit #3") |
| `equipment_type` | | Type (e.g., "RTU", "Split System") |
| `manufacturer` | | Brand (e.g., "York", "Carrier", "Trane") |
| `model` | ✅ | Model number |
| `serial_number` | | Serial number |
| `tonnage` | | Cooling capacity (e.g., 3.0, 5.0, 10.0) |
| `refrigerant` | | Type (e.g., "R-410A", "R-22") |
| `voltage` | | Voltage (e.g., "208/230V", "460V") |

### Import Steps

1. **Go to Admin Dashboard**
   - Open http://localhost:3000/equipment-admin.html

2. **Click the "📥 Import Equipment" tab**

3. **Paste your CSV data** into the text box

4. **Click "📥 Import CSV"**

5. **Verify the results**
   - Check the success message
   - Review the stats: X customers created, Y equipment created
   - View imported data in the "Equipment" tab

---

## 🔧 API Endpoints

### Customers

```bash
# Get all customers
GET /api/customers

# Create a new customer
POST /api/customers
{
  "name": "Planet Fitness",
  "location": "Downtown",
  "address": "123 Main St",
  "city": "Springfield",
  "state": "IL",
  "contact_name": "John Doe",
  "contact_phone": "555-1234"
}
```

### Equipment

```bash
# Get all equipment
GET /api/equipment

# Get equipment for a specific customer
GET /api/equipment?customer_id=1

# Create new equipment
POST /api/equipment
{
  "customer_id": 1,
  "equipment_name": "RTU-1",
  "manufacturer": "York",
  "model": "YCAV0036EC300AAAA",
  "serial_number": "12345678",
  "tonnage": 3.0,
  "refrigerant": "R-410A"
}
```

### Jobs

```bash
# Get all jobs (last 100)
GET /api/jobs

# Get jobs by status
GET /api/jobs?status=scheduled

# Get jobs for a customer
GET /api/jobs?customer_id=1

# Create a new job (auto-generates job number)
POST /api/jobs
{
  "customer_id": 1,
  "equipment_id": 5,
  "job_type": "service",
  "priority": "normal",
  "problem_description": "Unit not cooling properly",
  "scheduled_date": "2025-11-01"
}

# Update a job
PATCH /api/jobs/1
{
  "status": "in_progress",
  "tech_notes": "Found bad capacitor",
  "parts_used": [
    {"name": "35/5 MFD capacitor", "quantity": 1}
  ]
}
```

### CSV Import

```bash
# Import equipment from CSV
POST /api/equipment/import-csv
{
  "csvData": "customer_name,location,manufacturer,model,serial_number\nPlanet Fitness,Downtown,York,YCAV0036,12345678"
}
```

---

## ✅ What Works Now (Phase 1 Progress)

Based on the Jerry HVAC Roadmap skill, here's your progress:

### Phase 1 MVP Foundation

- [x] **Auto job number generation** - ✅ COMPLETE
  - Format: JOB-2025-001, JOB-2025-002, etc.
  - Auto-increments per year
  - Trigger-based, no manual input needed

- [x] **Model/serial number storage** - ✅ COMPLETE
  - Equipment table stores all model/serial data
  - CSV import populates this automatically

- [ ] **OCR nameplate extraction** - ❌ NOT INTEGRATED YET
  - OCR exists in your app
  - Needs to be wired into job workflow
  - Should auto-populate equipment fields

- [ ] **Photo documentation** - ❌ NOT BUILT YET
  - Jobs table has `photos` and `nameplate_photos` fields (JSONB)
  - Need to add photo capture UI
  - Need to add photo upload endpoint

- [ ] **Parse parts from repairs** - ⚠️ EXISTS BUT SEPARATE
  - Parts parsing works in main app
  - Needs to integrate with jobs table
  - Should populate `parts_used` field

- [ ] **Labor hours tracking** - ⚠️ SCHEMA READY
  - Jobs table has `labor_hours` and `tech_signature` fields
  - Need to add UI for tech to enter hours
  - Need to add signature capture

### What to Build Next

According to the roadmap, your next steps are:

1. **Integrate OCR into job workflow** (Phase 1, item #3)
   - Add nameplate scan button when creating/updating jobs
   - Auto-populate manufacturer, model, serial from scan
   - Store extracted data in equipment table

2. **Add photo capture** (Phase 1, item #4)
   - Camera access for mobile techs
   - Upload photos to storage (S3/B2)
   - Attach to jobs via `photos` JSONB field

3. **Wire up parts parsing to jobs** (Phase 1, item #5)
   - Parse parts from tech notes
   - Store in `parts_used` JSONB field
   - Show in job view

---

## 🗄️ Database Schema Reference

### customers

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| name | VARCHAR | Business name |
| location | VARCHAR | Location identifier |
| address | TEXT | Street address |
| city | VARCHAR | City |
| state | VARCHAR | State |
| contact_name | VARCHAR | Primary contact |
| contact_phone | VARCHAR | Phone number |
| created_at | TIMESTAMP | Record created |

### equipment

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| customer_id | INTEGER | Foreign key to customers |
| equipment_name | VARCHAR | Unit identifier |
| manufacturer | VARCHAR | Brand (York, Carrier, etc.) |
| model | VARCHAR | Model number |
| serial_number | VARCHAR | Serial number |
| tonnage | DECIMAL | Cooling capacity |
| refrigerant | VARCHAR | Type (R-410A, etc.) |
| last_service_date | DATE | Auto-updated from jobs |

### jobs

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| job_number | VARCHAR | Auto-generated (JOB-2025-001) |
| customer_id | INTEGER | Foreign key to customers |
| equipment_id | INTEGER | Foreign key to equipment |
| status | VARCHAR | scheduled, in_progress, completed |
| tech_notes | TEXT | Raw tech notes |
| parts_used | JSONB | Array of parts |
| labor_hours | DECIMAL | Hours worked |
| tech_signature | TEXT | Digital signature |
| photos | JSONB | Array of photo URLs |
| created_at | TIMESTAMP | Record created |

---

## 🎯 Next Development Steps

### Immediate (This Week)

1. **Test CSV Import**
   - Import your Planet Fitness equipment data
   - Verify all data imported correctly
   - Check for any errors or missing fields

2. **Create Sample Jobs**
   - Use API or create UI to create test jobs
   - Verify job numbers auto-generate correctly
   - Test job status updates

### Short-term (Next 2 Weeks)

3. **Integrate OCR into Job Workflow**
   - Add button: "Scan Nameplate" in job creation
   - Connect to existing OCR endpoint
   - Auto-populate equipment fields

4. **Add Photo Capture**
   - Camera access for techs
   - Upload to storage
   - Display in job view

5. **Connect Parts Parsing to Jobs**
   - Parse tech notes for parts
   - Store in `parts_used` field
   - Show in job summary

### Medium-term (Month 2)

6. **Add Labor Hours Entry**
   - Form for tech to enter hours
   - Signature capture (canvas or typed)
   - Lock job after signature

7. **Build Tech Mobile View**
   - Simplified UI for field techs
   - Focus on current job only
   - Big buttons, easy to use with gloves

---

## 🐛 Troubleshooting

### Database Connection Failed

```bash
✗ Database connection failed: connection to server failed
```

**Solution:**
1. Check your `.env` file has `DATABASE_URL` set
2. Verify Supabase connection string is correct
3. Test connection: `node -e "require('./db').testConnection()"`

### Migration Already Applied

```bash
⊙ Some objects already exist (this is usually okay)
```

**Solution:**
- This is normal if running migration twice
- Tables use `CREATE TABLE IF NOT EXISTS`
- Safe to ignore

### CSV Import Errors

If import shows errors, check:
1. CSV has header row
2. `customer_name` and `model` are present (required)
3. No special characters in data (use quotes if needed)
4. Columns match expected names (see import section)

### API Returns 500 Error

Check server logs:
```bash
npm start
```

Look for error messages. Common issues:
- Database connection lost
- Missing required fields
- Invalid data types (e.g., text in numeric field)

---

## 📊 Sample Data for Testing

### Sample CSV for Testing

```csv
customer_name,location,equipment_name,manufacturer,model,serial_number,tonnage,refrigerant,voltage
Planet Fitness,Downtown,RTU-1,York,YCAV0036EC300AAAA,PF-DT-001,3.0,R-410A,208/230V
Planet Fitness,Downtown,RTU-2,Carrier,50TCQ06A3A6A0A0A0,PF-DT-002,5.0,R-410A,460V
Planet Fitness,Mall Location,RTU-1,Trane,4TWR4036A1000AA,PF-ML-001,3.0,R-410A,208/230V
Planet Fitness,Westside,Split-1,York,YCJF36S41S1AAAF,PF-WS-001,3.0,R-410A,208/230V
```

### Sample API Test (Create Job)

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": 1,
    "equipment_id": 1,
    "job_type": "service",
    "priority": "high",
    "problem_description": "Unit not cooling, compressor not running",
    "scheduled_date": "2025-11-01"
  }'
```

Expected response:
```json
{
  "success": true,
  "job": {
    "id": 1,
    "job_number": "JOB-2025-001",
    "customer_id": 1,
    "equipment_id": 1,
    "status": "scheduled",
    "created_at": "2025-10-30T..."
  }
}
```

---

## 🎉 Success Criteria

Phase 1 MVP is complete when:

- ✅ Jobs auto-generate unique numbers
- ✅ Model/serial stored per asset
- ❌ OCR extracts data from nameplate photos (not integrated yet)
- ❌ Photo capture works (not built yet)
- ❌ Parts parser extracts components from tech notes (not integrated yet)
- ❌ Labor hours entry works with tech signature (not built yet)
- ✅ Tech can complete job cycle: schedule → document → submit

**Current Status: 2/6 complete (33%)**

---

## 📚 Additional Resources

- **Jerry HVAC Roadmap**: `.claude/skills/jerry-hvac-roadmap.md`
- **Large File Ingestion Strategy**: `LARGE_FILE_STRATEGY.md` (for future PDF work)
- **Migration Files**: `migrations/004_create_mvp_foundation.sql`
- **Admin Dashboard**: `public/equipment-admin.html`

---

## Need Help?

If you get stuck or have questions:

1. Check the troubleshooting section above
2. Review server logs: `npm start`
3. Consult the Jerry HVAC Roadmap skill
4. Ask Claude Code for help with specific issues

Remember: **Foundation first. Revenue second. Cool features third.** 🚀

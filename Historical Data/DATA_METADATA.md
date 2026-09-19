# OneRecon Hackathon — Data Metadata & Ingestion Guide

## Overview

You are provided with **3 months** of financial transaction data across **3 systems** (GL, MA, FA). Each month is in its own folder. Your task is to **reconcile** the three systems and identify all breaks (mismatches).

---

## Folder Structure

```
Dataset1/
├── june/
│   ├── gl_report_202606.xml      ← GL data (XML format)
│   ├── fa_report_202606.csv      ← FA data (CSV format)
│   ├── join_map.txt              ← Key mapping (TXT format)
│   └── ma_api_server_202606.py   ← MA data (REST API — run this)
├── july/
│   ├── gl_report_202607.xml      ← GL data (XML format)
│   ├── fa_report_202607.csv      ← FA data (CSV format)
│   ├── join_map.txt              ← Key mapping (TXT format)
│   └── ma_api_server_202607.py   ← MA data (REST API — run this)
├── august/
│   ├── gl_report_202608.xml      ← GL data (XML format)
│   ├── fa_report_202608.csv      ← FA data (CSV format)
│   ├── join_map.txt              ← Key mapping (TXT format)
│   └── ma_api_server_202608.py   ← MA data (REST API — run this)
└── business_rules.txt            ← Validation rules
```

> **Important:** MA data is **NOT** provided as a file. Each month folder has its own `ma_api_server_YYYYMM.py`. Run it and consume data via HTTP requests.

---

## Data Sources & Formats

### 1. General Ledger (GL) — XML File

| Property | Value |
|----------|-------|
| **File** | `gl_report_YYYYMM.xml` |
| **Format** | XML |
| **Encoding** | UTF-8 |
| **Record count** | ~16,800 – 22,100 per month |

**XML Structure:**
```xml
<?xml version='1.0' encoding='UTF-8'?>
<GLReport source="General Ledger" period="202606">
  <Transaction>
    <TransactionID>AE5034E6B5CE8A39</TransactionID>
    <gl_account_id>ACC3038</gl_account_id>
    <TransactionDate>2026-06-04</TransactionDate>
    <Amount>73092.01</Amount>
    <Currency>JPY</Currency>
    <Country>DE</Country>
    <Description>Processing charge</Description>
  </Transaction>
  <!-- ... more <Transaction> elements ... -->
</GLReport>
```

**Fields:**

| Field | Type | Format | Example |
|-------|------|--------|---------|
| `TransactionID` | String (16 chars) | Uppercase hex | `AE5034E6B5CE8A39` |
| `gl_account_id` | String | `ACC` + 4 digits | `ACC3038` |
| `TransactionDate` | String (ISO-8601) | `YYYY-MM-DD` | `2026-06-04` |
| `Amount` | Decimal | 2 decimal places | `73092.01` |
| `Currency` | String (3 chars) | ISO 4217 | `USD`, `EUR`, `INR` |
| `Country` | String (2 chars) | ISO 3166-1 alpha-2 | `US`, `DE`, `IN` |
| `Description` | String | Free text | `Processing charge` |

---

### 2. Management Accounting (MA) — REST API (Per-Month Server)

| Property | Value |
|----------|-------|
| **Server** | `ma_api_server_YYYYMM.py` (inside each month folder) |
| **Format** | JSON (via HTTP) |
| **Base URL** | `http://localhost:5000` |
| **Record count** | ~16,800 – 22,000 per month |
| **Pagination** | Required (default 500/page, max 5000/page) |
| **Scope** | Each server serves **only its own month** |

**Setup (per month):**
```bash
pip install flask
cd june
python ma_api_server_202606.py
# Server now serves ONLY June 2026 data
```

> **Note:** Each month folder has its own `ma_api_server_YYYYMM.py`. You must run the correct one for the month you're reconciling. Only one server can run at a time (port 5000).

**API Endpoints:**

#### Health Check
```
GET /api/ma/health
```
**Response:**
```json
{"status": "ok", "service": "MA Report API", "period": "202606"}
```

#### Summary
```
GET /api/ma/summary
```
**Response:**
```json
{
  "period": "202606",
  "total_records": 16824,
  "total_amount": 645231847.23,
  "avg_amount": 38352.46
}
```

#### Paginated Transactions
```
GET /api/ma/transactions?page=1&per_page=500
```
**Response:**
```json
{
  "data": [
    {
      "TransactionID": "AE5034E6B5CE8A39",
      "TransactionDate": "2026-06-04",
      "Amount": "73092.01",
      "Currency": "JPY",
      "Country": "DE",
      "Description": "Processing charge",
      "ma_customer_key": "CUS-003038"
    }
  ],
  "period": "202606",
  "total": 16824,
  "page": 1,
  "per_page": 500,
  "total_pages": 34
}
```

#### Single Transaction Lookup
```
GET /api/ma/transactions/AE5034E6B5CE8A39
```
**Response:**
```json
{"data": {"TransactionID": "AE5034E6B5CE8A39", "ma_customer_key": "CUS-003038", ...}}
```

**MA Fields:**

| Field | Type | Format | Example |
|-------|------|--------|---------|
| `TransactionID` | String (16 chars) | Uppercase hex | `AE5034E6B5CE8A39` |
| `TransactionDate` | String (ISO-8601) | `YYYY-MM-DD` | `2026-06-04` |
| `Amount` | String (decimal) | 2 decimal places | `73092.01` |
| `Currency` | String (3 chars) | ISO 4217 | `USD`, `EUR`, `INR` |
| `Country` | String (2 chars) | ISO 3166-1 alpha-2 | `US`, `DE`, `IN` |
| `Description` | String | Free text | `Processing charge` |
| `ma_customer_key` | String | `CUS-` + 6 digits | `CUS-003038` |

> **Note:** `Amount` is returned as a **string** in the API response. Cast to float for calculations.

---

### 3. Financial Accounting (FA) — CSV File

| Property | Value |
|----------|-------|
| **File** | `fa_report_YYYYMM.csv` |
| **Format** | CSV (comma-separated) |
| **Encoding** | UTF-8 |
| **Record count** | ~16,800 – 22,000 per month |

**CSV Structure:**
```csv
TransactionID,TransactionDate,Amount,Currency,Country,Description,fa_key
AE5034E6B5CE8A39,2026-06-04,73092.01,JPY,DE,Processing charge,FA-003038
```

**Fields:**

| Field | Type | Format | Example |
|-------|------|--------|---------|
| `TransactionID` | String (16 chars) | Uppercase hex | `AE5034E6B5CE8A39` |
| `TransactionDate` | String (ISO-8601) | `YYYY-MM-DD` | `2026-06-04` |
| `Amount` | Decimal | 2 decimal places | `73092.01` |
| `Currency` | String (3 chars) | ISO 4217 | `USD`, `EUR`, `INR` |
| `Country` | String (2 chars) | ISO 3166-1 alpha-2 | `US`, `DE`, `IN` |
| `Description` | String | Free text | `Processing charge` |
| `fa_key` | String | `FA-` + 6 digits | `FA-003038` |

---

### 4. Join Map — TXT File

| Property | Value |
|----------|-------|
| **File** | `join_map.txt` (one per month folder) |
| **Format** | TXT (CSV-compatible, comma-separated) |
| **Record count** | ~3,200 – 7,000 per month |

**Structure:**
```
gl_account_id,ma_customer_key,fa_key,entity,effective_from,effective_to
ACC0001,CUS-000001,FA-000001,Global,2022-01-01,2099-12-31
ACC0002,CUS-000002,FA-000002,Global,2022-01-01,2099-12-31
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `gl_account_id` | String | GL key (`ACC` + 4 digits) |
| `ma_customer_key` | String | MA key (`CUS-` + 6 digits) |
| `fa_key` | String | FA key (`FA-` + 6 digits) |
| `entity` | String | Always `Global` |
| `effective_from` | Date | Mapping start date |
| `effective_to` | Date | Mapping end date |

> **Important:** Each month has its **own** join map with a **different** number of keys. Do NOT reuse a join map across months.

---

## Business Rules (Validation)

Refer to [`business_rules.txt`](business_rules.txt) for the full list. Key rules:

| Rule | Description |
|------|-------------|
| R01 | `TransactionID` must be 16-char uppercase hex |
| R02 | `gl_account_id` must match `ACC\d{4}` |
| R03 | `TransactionDate` must be valid ISO-8601 (`YYYY-MM-DD`) |
| R04 | `Amount` must be in range 0 – 100,000 |
| R05 | `Currency` must be a valid ISO 4217 code |
| R06 | `Country` must be a valid ISO 3166-1 alpha-2 code |
| R07 | `Description` must be 1–100 characters |
| R09 | Join keys: `GL:gl_account_id`, `MA:ma_customer_key`, `FA:fa_key` |
| R10 | Aggregate: `SUM` grouped by `gl_account_id` |

---

## Month Details

| Month | Folder | GL Records | MA Records | FA Records | Join Map Keys |
|-------|--------|-----------|-----------|-----------|---------------|
| June 2026 | `june/` | 16,824 | 16,824 | 16,824 | 3,204 |
| July 2026 | `july/` | 21,908 | 21,844 | 21,862 | 7,062 |
| August 2026 | `august/` | 22,105 | 22,039 | 22,019 | 6,815 |

> **Note:** Record counts differ between systems within the same month. This is expected — some records may be missing from one or more systems.

---

## What You Need to Build

1. **Data Ingestion Layer**
   - Ingest data from all 3 systems (GL, MA, FA) in their respective formats
   - Handle the join map for cross-system key resolution

2. **Reconciliation Engine**
   - Figure out how to match records across the 3 systems
   - Identify and flag all mismatches (breaks) between systems

3. **AI-Enabled Data Validation**
   - Go beyond simple field comparison
   - Detect anomalies, outliers, and patterns that rule-based checks miss

4. **Break Reporting**
   - List all detected breaks with details
   - Categorize by type
   - Provide root-cause analysis (AI-assisted)

5. **Maker-Checker Workflow** (optional, bonus)
   - Investigator submits break resolution
   - Approver authorizes

---

## Tech Stack (Suggested)

| Component | Options |
|-----------|---------|
| Language | Python, Java, Node.js |
| Data Processing | Pandas, plain Python, or equivalent |
| XML Parsing | `xml.etree`, `lxml`, or equivalent |
| HTTP Client | `requests`, `axios`, or equivalent |
| AI/ML | Scikit-learn, LLM API, or rule-based heuristics |
| Frontend | HTML/JS, React, Angular, or any |
| Storage | In-memory, SQLite, PostgreSQL |

---

## Getting Started

```bash
# 1. Install dependencies
pip install flask pandas requests

# 2. Start the MA API server for the month you want to reconcile
cd june
python ma_api_server_202606.py
# (Stop it, then cd july && python ma_api_server_202607.py for July, etc.)

# 3. Verify it's running (in another terminal)
curl http://localhost:5000/api/ma/health

# 4. Fetch a sample of MA data
curl "http://localhost:5000/api/ma/transactions?page=1&per_page=5"

# 5. Start building your reconciliation engine
```

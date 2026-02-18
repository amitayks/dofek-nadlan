## Context

The pulse-property-insight site needs Israeli real estate and price index data from three government sources:

1. **CBS (Central Bureau of Statistics)** — publishes housing price indices, average apartment prices, and CPI data. Built on SharePoint 2019, content rendered client-side. Has both a SharePoint REST API and a public XML API.
2. **gov.il Ministry of Finance** — publishes periodic economic reviews with real estate focus. Built on AngularJS dynamic collector with backing API.

These sources publish periodically (monthly on the 15th for CBS, weekly/periodic for gov.il) with semi-predictable but inconsistent file naming. Files come in XLSX, DOCX, DOC, PDF, and ZIP formats.

**Current state:** No infrastructure exists. The project is greenfield with only an OpenSpec planning framework in place.

**Constraints:**
- Budget: $0 operational cost target (free tiers)
- The main frontend site will be rebuilt, so the data layer should be API-agnostic
- Government servers should be treated respectfully (rate limiting)
- Hebrew content (RTL) in all source data

## Goals / Non-Goals

**Goals:**
- Automated daily discovery and download of all new government publications
- Structured data extraction from XLSX, DOCX, and XML sources in-process
- Async PDF extraction via separate service for heavy processing
- Permanent archive of all raw files for human fallback
- Reliable, crash-resilient pipeline that self-heals on next run
- Zero operational cost

**Non-Goals:**
- Real-time data (daily is sufficient)
- Historical backfill (current year forward only, historical can be added later)
- Frontend API design (out of scope — frontend will be rebuilt)
- Scraping of property listing sites (yad2, madlan, etc. — separate future change)
- User-facing dashboard for pipeline monitoring (admin-only for now)

## Decisions

### Decision 1: Cloudflare Worker (TS) + GitHub Action (Python) split

**Chosen:** Two-service architecture where the Cloudflare Worker handles everything except PDF processing, and a GitHub Action handles PDF-to-image-to-AI extraction.

**Alternatives considered:**
- *All Cloudflare*: Workers have 30s CPU (free) / 30min (paid) limits and 128MB memory. PDF image conversion + AI calls would exceed these limits.
- *All GitHub Actions*: Would work but loses the elegance of Cloudflare's integrated D1/R2/KV. Also cold-starts are slower and scheduling is less precise.
- *External server (Railway/Fly.io)*: Unnecessary cost and complexity for what amounts to ~5 min/day of processing.

**Rationale:** The Worker handles the 95% case (API calls, XLSX parsing, coordination) within its resource limits. The 5% case (PDF processing) runs where compute is abundant and free (GitHub Actions: 6hr limit, 7GB RAM). R2 serves as the communication bridge.

### Decision 2: R2 as the communication bus between Worker and Action

**Chosen:** Extraction requests and results are exchanged via JSON files in R2, with an optional webhook for immediate notification.

**Alternatives considered:**
- *Direct webhook with payload*: Would need to handle large payloads, auth, retry logic, and the data would be lost if the webhook fails.
- *GitHub Action commits to repo*: Fragile, pollutes git history.
- *Cloudflare Queue*: Would add another service to manage, and the GitHub Action can't natively consume CF Queues.

**Rationale:** R2 is durable, inspectable, shared between both services, and crash-resilient. Even if the webhook fails, the next cron run picks up results. You can browse R2 in the dashboard to debug.

### Decision 3: TypeScript for Worker, Python for PDF Action

**Chosen:** TypeScript (Cloudflare Workers native language) for the main pipeline, Python for the GitHub Action.

**Alternatives considered:**
- *TypeScript everywhere*: Node.js PDF libraries are weaker than Python's (pdf2image, PyMuPDF, tabula-py).
- *Python everywhere*: Can't run natively on Cloudflare Workers without Pyodide (experimental, limited).

**Rationale:** Each language where it's strongest. TypeScript for API calls, JSON manipulation, and Cloudflare bindings. Python for data science, PDF processing, and AI SDK integration.

### Decision 4: SheetJS (xlsx) for XLSX parsing in Worker

**Chosen:** SheetJS/xlsx library for parsing Excel files within the Cloudflare Worker.

**Alternatives considered:**
- *exceljs*: Heavier, more features than needed, larger bundle for Worker.
- *Parse in GitHub Action with pandas*: Would add unnecessary latency; XLSX parsing is fast enough for the Worker.

**Rationale:** SheetJS is lightweight, works in edge runtimes, and handles both XLSX and XLS formats. CBS files have simple table structures that don't need pandas-level analysis.

### Decision 5: D1 for structured data, KV for fast state lookups

**Chosen:** D1 (SQLite) for all relational data, KV for single-value state lookups.

**Alternatives considered:**
- *D1 only*: Would work but querying "latest_folder" on every cron run is slower than a KV get.
- *KV only*: Can't do relational queries needed for the data (e.g., "all prices for Jerusalem 2025").
- *External database (Supabase, PlanetScale)*: Unnecessary when D1 is integrated and free.

**Rationale:** KV gives O(1) reads for "what did we last see?" state. D1 gives SQL queries for structured data. Both are free on Cloudflare.

### Decision 6: CBS SharePoint REST API as primary discovery mechanism

**Chosen:** Hit the SharePoint REST API directly to discover publications and enumerate files.

**Alternatives considered:**
- *Browser automation (Puppeteer/Playwright)*: SharePoint pages are JS-rendered, so this would work but is slow, expensive, and fragile.
- *RSS/Atom feeds*: CBS doesn't appear to have public feeds for publication updates.
- *Scrape the HTML*: The pages render client-side so raw HTML contains no content.

**Rationale:** The SharePoint REST API returns structured JSON with all file metadata (filename, size, order, titles in Hebrew and English). It's faster, more reliable, and provides richer data than any scraping approach.

**Key API patterns discovered:**
```
# List publication pages
GET /he/publications/Madad/_api/Web/Lists(guid'71b30cd4-0261-4757-9482-a52c5a6da90a')/Items
  ?$filter=CbsPublishingFolderLevel1 eq '2026'
  &$orderby=Created desc
  &$select=Title,CbsEnglishTitle,CbsPublishingFolderLevel1,CbsPublishingFolderLevel2,Created

# Enumerate files in a publication folder
GET /he/publications/Madad/_api/web/GetFolderByServerRelativeUrl(
  '/he/publications/Madad/DocLib/2026/price01aa'
)/Files?$expand=ListItemAllFields
```

### Decision 7: gov.il backing API accessed directly

**Chosen:** Hit the AngularJS dynamic collector's backing API directly rather than rendering the page.

**Alternatives considered:**
- *Render with Puppeteer*: Slow and brittle.
- *Parse the Angular HTML*: Only contains template bindings, no actual data.

**Rationale:** The collection GUID `3ed26e5e-41c1-4dbb-ac3f-b9b0f7b2c7b2` and filter configuration are embedded in the page source. The API returns JSON with item slugs and filenames needed to construct download URLs.

**URL construction for gov.il PDFs:**
```
https://www.gov.il/BlobFolder/dynamiccollectorresultitem/{UrlName}/he/{FileName}
```

### Decision 8: PDF extraction uses AI vision models

**Chosen:** Convert PDF pages to images, send to an AI vision model (Claude/GPT-4) with schema-guided prompts.

**Alternatives considered:**
- *Tabula-py*: Works for simple tables but fails on complex layouts, merged cells, and Hebrew text.
- *Tesseract OCR + regex*: Unreliable for structured table extraction from government PDFs.
- *AWS Textract / Google Document AI*: Cost per page, vendor lock-in.

**Rationale:** AI vision models handle Hebrew text, complex table layouts, and narrative reports well. The schema-guided prompt approach means we define what we want and the AI adapts to formatting changes. Cost is minimal for ~10-20 pages/day.

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|---|---|---|
| CBS SharePoint REST API requires authentication or gets blocked | Discovery fails | Fallback: browser automation discovery. Monitor response codes. The API is currently public (no auth required for read-only access to published content). |
| CBS changes file naming convention | XLSX parser fails to match templates | Extraction router logs unrecognized files. Human reviews R2 archive. Parser templates are configurable. |
| gov.il changes dynamic collector API | gov.il discovery fails | Collection GUID and API structure are embedded in page source. If it changes, re-scrape the page source for new config. |
| AI extraction produces incorrect data | Wrong values stored in D1 | Confidence scores on each extraction. Validation layer checks ranges and formats. Human review for low-confidence results. |
| Cloudflare Worker hits CPU time limit | Pipeline doesn't complete | Phase-based execution: each phase can be short. If needed, split into multiple Worker invocations chained via D1 state. |
| GitHub Actions minutes exhausted | PDF extraction stops | Track usage. The pipeline still functions for XLSX/API data. PDF results queue in R2 until minutes replenish. |
| R2/D1 free tier storage limits hit | Writes fail | R2: 10GB free. Estimated yearly: ~500MB raw files. D1: 5GB free. Estimated yearly: ~50MB structured data. Well within limits. |
| Government servers rate-limit or block | Downloads fail | 500ms delay between requests. Respectful User-Agent header. Retry with backoff. |

## Source Site Reference

### CBS File Naming Conventions

**Publications (DocLib):**
```
/he/publications/Madad/DocLib/{year}/{folder}/{filename}

Folder codes:
  price{NN}a   — CPI Section A (consumer price index tables)
  price{NN}aa  — Section AA (housing/dwelling index tables)
  price{NN}g   — Section G (detailed price statistics)
  price{NN}b/ba/bb/c/ca/d/e/f/fa — Other sections

Filename pattern:
  {section_prefix}{chapter}_{table}_{lang}.{ext}
  Examples:
    aa2_1_h.xlsx  — Section AA, Table 2.1, Hebrew, Excel
    a4_9_h.pdf    — Section A, Table 4.9, Hebrew, PDF
    g1_1_h.xls    — Section G, Table 1.1, Hebrew, Excel (old format)
```

**Media Releases (DocLib):**
```
/he/mediarelease/Madad/DocLib/{year}/{release_num}/{filename}

Filename pattern:
  10_{YY}_{NNN}{suffix}.{ext}
  Suffixes: b (body), e (English), y (appendix), t1-t4 (tables), te1-te3 (English tables)
  Examples:
    10_26_017b.pdf    — Year 26, Release 017, body text, PDF
    10_24_051t2.xls   — Year 24, Release 051, Table 2, Excel
```

**Press Release Page URLs:**
```
Hebrew: /he/mediarelease/Madad/Pages/{year}/{Hebrew-slug}.aspx
  Housing: שינוי-במחירי-שוק-הדירות-{month}-{year}.aspx
  CPI:     מדדי-המחירים-לצרכן-{month}-{year}.aspx

English: /en/mediarelease/madad/Pages/{year}/{English-slug}.aspx
  Housing: Price-Changes-in-the-Dwellings-Market-{Month}-{Year}.aspx
  CPI:     Consumer-Price-Index-{Month}-{Year}.aspx
```

### CBS Table Types (Housing)

| Table | Filename | Content | Key Fields |
|---|---|---|---|
| 2.1 | aa2_1_h.xlsx | Housing Price Index (national) | period, index_value, base_year, pct_change |
| 2.2 | aa2_2_h.xlsx | Average Apartment Prices by district/city/rooms | period, district, city, rooms, avg_price_nis |
| 2.3 | aa2_3_h.xlsx | Housing Price Index by District | period, district, index_value, pct_change |
| 2.4 | aa2_4_h.xlsx | New Housing Price Index | period, index_value, pct_change |
| 1.1 | aa1_1_h.doc | Methodology document (text) | N/A (reference only) |

### CBS XML API

**Endpoint:** `https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false&lang=he`
**Schema:** `https://api.cbs.gov.il/xsd/price/indices_base_eng.xsd`

Key index codes:
- `120010` — CPI General
- `120020` — CPI excluding vegetables/fruit
- `110040` — CPI excluding housing
- `170010-170050` — Manufacturing price indices
- `200010, 800010, 240010` — Construction input indices

**Publication schedule:** Monthly on the 15th at 18:30. Friday/holiday eve at 14:00.

### gov.il Dynamic Collector

**Collection GUID:** `3ed26e5e-41c1-4dbb-ac3f-b9b0f7b2c7b2`
**Subject filter key:** `01` (Real Estate / נדל"ן)
**Pagination:** `skip` parameter, 10 items per page
**Sort:** `publish_date` descending

**Item URL slugs:**
- Real estate reviews: `periodic-review-real-estate-{MMYYYY}`
- Quarterly: `periodic-review-real-estate-{YYYY}-q{N}`
- General periodic: `periodic-review-{DDMMYYYY}`

**File URL construction:**
```
https://www.gov.il/BlobFolder/dynamiccollectorresultitem/{UrlName}/he/{FileName}
```

**Subject categories available (25 total):** Real Estate (01), Forecasts (02), Overview/Summaries (03), Taxation (04), Labor Market (05), Education (06), International (07), Poverty (08), Investments (09), Doing Business (10), Public Sector (11), Foreign Trade (12), International Comparisons (13), Cost of Living (14), National Accounts (16), Balance of Payments (17), Business Sector (18), Credit (19), Capital Market (20), Regulation (21), Vehicles (23), Quality of Life (24), Health (25), Private Sector (26), Inflation (27).

## Architecture Diagram

```
                       ┌──────────────────────────────┐
                       │     CLOUDFLARE WORKER (TS)    │
                       │     Cron: 0 0 * * *           │
                       │                               │
                       │  ┌─────────────────────────┐ │
                       │  │ Phase 0: PICKUP         │ │
                       │  │ Check R2/extracted/      │ │
                       │  │ for unprocessed results  │ │
                       │  │ → Process into D1        │ │
                       │  └────────────┬────────────┘ │
                       │               ▼               │
                       │  ┌─────────────────────────┐ │
                       │  │ Phase 1: DISCOVER        │ │
  CBS SharePoint ◀─────┤  │ Hit all source APIs     │ │
  CBS XML API    ◀─────┤  │ Compare with KV state   │ │
  gov.il API     ◀─────┤  │ → Produce manifest[]    │ │
                       │  └────────────┬────────────┘ │
                       │               ▼               │
                       │  ┌─────────────────────────┐ │
                       │  │ Phase 2: DOWNLOAD        │ │
                       │  │ GET files from URLs      │──────▶ R2 (raw-files/)
                       │  │ Rate limited (500ms)     │ │
                       │  │ All formats, all files   │ │
                       │  └────────────┬────────────┘ │
                       │               ▼               │
                       │  ┌─────────────────────────┐ │
                       │  │ Phase 3: EXTRACT         │ │
                       │  │ XLSX → SheetJS → JSON    │ │
                       │  │ DOCX → mammoth → JSON    │──────▶ D1 (tables)
                       │  │ XML API → parse → JSON   │ │
                       │  │ PDF → write request      │──────▶ R2 (extraction-requests/)
                       │  └────────────┬────────────┘ │
                       │               ▼               │
                       │  ┌─────────────────────────┐ │
                       │  │ Phase 4: TRIGGER         │ │
                       │  │ POST to GitHub API       │────────┐
                       │  │ workflow_dispatch         │ │      │
                       │  └────────────┬────────────┘ │      │
                       │               ▼               │      │
                       │  ┌─────────────────────────┐ │      │
                       │  │ Phase 5: FINALIZE        │ │      │
                       │  │ Update pipeline_runs     │ │      │
                       │  │ Update KV state          │ │      │
                       │  └─────────────────────────┘ │      │
                       │                               │      │
                       │  HTTP Routes:                 │      │
                       │  POST /api/ingest  ◀──────────┤──┐   │
                       │  GET  /api/status             │  │   │
                       │  POST /api/trigger            │  │   │
                       │  GET  /api/health             │  │   │
                       └──────────────────────────────┘  │   │
                                                          │   │
                       ┌──────────────────────────────┐  │   │
                       │   GITHUB ACTION (Python)      │  │   │
                       │                               │  │   │
                       │   Trigger: workflow_dispatch ◀─┤──┘───┘
                       │   Input: run_id               │  │
                       │                               │  │
                       │   Job 1: discover-work        │  │
                       │   ├── Read R2/extraction-req/ │  │
                       │   └── Output: matrix IDs      │  │
                       │                               │  │
                       │   Job 2: extract [matrix]     │  │
                       │   ├── Pull PDF from R2        │  │
                       │   ├── PDF → Images (300 DPI)  │  │
                       │   ├── Images → AI (Claude)    │  │
                       │   ├── Validate JSON output    │  │
                       │   └── Write result → R2       │  │
                       │                               │  │
                       │   Job 3: notify               │  │
                       │   └── POST webhook ───────────┤──┘
                       └──────────────────────────────┘

Storage:
  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │     D1     │  │     R2     │  │     KV     │
  │  (SQLite)  │  │  (Objects) │  │ (Key-Val)  │
  │            │  │            │  │            │
  │ sources    │  │ raw-files/ │  │ discovery: │
  │ publicat.. │  │ pipeline/  │  │   state    │
  │ files      │  │   extract..│  │ pipeline:  │
  │ housing_.. │  │   -requests│  │   state    │
  │ avg_apt_.. │  │   extracted│  │            │
  │ cpi        │  │            │  │            │
  │ review_..  │  │            │  │            │
  │ pipeline_. │  │            │  │            │
  └────────────┘  └────────────┘  └────────────┘
```

## Project Structure

```
gov-data-pipeline/
├── worker/                          # Cloudflare Worker (TypeScript)
│   ├── wrangler.toml               # Worker config, bindings, cron
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                # Entry: fetch handler + scheduled handler
│   │   ├── types.ts                # Shared types (Manifest, Env, etc.)
│   │   ├── pipeline/
│   │   │   ├── orchestrator.ts     # Main pipeline sequence
│   │   │   ├── pickup.ts           # Phase 0: process pending results
│   │   │   ├── discover.ts         # Phase 1: discovery coordinator
│   │   │   └── trigger.ts          # Phase 4: GitHub Action trigger
│   │   ├── discovery/
│   │   │   ├── cbs-publications.ts # CBS SharePoint REST discovery
│   │   │   ├── cbs-media.ts        # CBS media releases discovery
│   │   │   ├── cbs-xml-api.ts      # CBS XML API discovery
│   │   │   └── gov-il-reviews.ts   # gov.il dynamic collector
│   │   ├── download/
│   │   │   ├── downloader.ts       # File download with retry + rate limit
│   │   │   └── archive.ts          # R2 upload with metadata
│   │   ├── extraction/
│   │   │   ├── router.ts           # Route files to correct parser
│   │   │   ├── xlsx-parser.ts      # SheetJS-based XLSX extraction
│   │   │   ├── docx-parser.ts      # DOCX extraction
│   │   │   ├── xml-api-parser.ts   # CBS XML API response parser
│   │   │   └── pdf-request.ts      # Creates extraction request JSONs
│   │   ├── storage/
│   │   │   ├── d1.ts               # D1 operations (insert, query, upsert)
│   │   │   ├── kv.ts               # KV state read/write helpers
│   │   │   └── r2.ts               # R2 read/write helpers
│   │   ├── routes/
│   │   │   ├── ingest.ts           # POST /api/ingest handler
│   │   │   ├── status.ts           # GET /api/status handler
│   │   │   ├── trigger.ts          # POST /api/trigger handler
│   │   │   └── health.ts           # GET /api/health handler
│   │   └── utils/
│   │       ├── http.ts             # Fetch wrapper with retry/timeout
│   │       └── validation.ts       # Data validation helpers
│   ├── migrations/
│   │   └── 0001_initial.sql        # D1 schema creation
│   └── test/
│       ├── discovery.test.ts
│       ├── extraction.test.ts
│       └── pipeline.test.ts
│
├── action/                          # GitHub Action (Python)
│   ├── .github/
│   │   └── workflows/
│   │       └── extract-pdfs.yml    # Workflow definition
│   ├── requirements.txt            # pdf2image, PyMuPDF, boto3, anthropic
│   ├── extract/
│   │   ├── __init__.py
│   │   ├── main.py                 # Entry point: read requests, dispatch
│   │   ├── pdf_to_images.py        # PDF → PNG conversion
│   │   ├── ai_extract.py           # Send images to AI, get JSON
│   │   ├── validate.py             # Validate extracted data
│   │   ├── r2_client.py            # R2 read/write via boto3
│   │   └── webhook.py              # POST results to Worker
│   └── tests/
│       └── test_extraction.py
│
└── shared/                          # Shared contracts (for reference)
    ├── extraction-request.schema.json
    └── extraction-result.schema.json
```

## Open Questions

1. **gov.il backing API**: The AngularJS page uses a backing API but the exact endpoint URL for the dynamic collector needs to be confirmed by rendering the page and inspecting network requests. The collection GUID is known (`3ed26e5e-41c1-4dbb-ac3f-b9b0f7b2c7b2`) but the API base URL may be `https://www.gov.il/he/api/DynamicCollector/` or similar.

2. **CBS SharePoint auth**: Initial research shows the SharePoint REST API is publicly accessible for read-only operations on published content. This needs to be verified at implementation time — if auth is required, we may need to use browser cookies or a different approach.

3. **AI model choice for PDF extraction**: Claude (via Anthropic API) or GPT-4 Vision? Both handle Hebrew well. Decision can be deferred to implementation.

4. **Monorepo vs separate repos**: The design shows a single repo structure. If the Worker and Action are in the same repo, the Action workflow file lives alongside the Worker code. If separate repos, the Worker needs the other repo's workflow ID. Recommend single repo for simplicity.

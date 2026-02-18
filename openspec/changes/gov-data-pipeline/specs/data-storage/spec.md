## ADDED Requirements

### Requirement: D1 Database Schema
The system SHALL use Cloudflare D1 (SQLite) with the following tables:

**`sources`** — Configuration for each data source
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `type` TEXT NOT NULL (cbs-publications, cbs-media, cbs-xml-api, gov-il-reviews)
- `base_url` TEXT
- `check_config` TEXT (JSON: API endpoints, filters, pagination config)
- `is_active` INTEGER DEFAULT 1

**`publications`** — Each discovered publication/release
- `id` TEXT PRIMARY KEY
- `source_id` TEXT REFERENCES sources(id)
- `title` TEXT
- `title_en` TEXT
- `publish_date` TEXT (ISO 8601)
- `period_start` TEXT
- `period_end` TEXT
- `discovery_url` TEXT
- `raw_metadata` TEXT (JSON: source-specific metadata)
- `status` TEXT DEFAULT 'discovered' (discovered, downloading, downloaded, extracting, extracted, failed)
- `created_at` TEXT DEFAULT CURRENT_TIMESTAMP
- `updated_at` TEXT

**`files`** — Each file associated with a publication
- `id` TEXT PRIMARY KEY
- `publication_id` TEXT REFERENCES publications(id)
- `filename` TEXT NOT NULL
- `format` TEXT NOT NULL (xlsx, xls, docx, doc, pdf, zip, xml)
- `download_url` TEXT
- `r2_key` TEXT (path in R2)
- `file_size_bytes` INTEGER
- `checksum_sha256` TEXT
- `is_preferred_format` INTEGER DEFAULT 0
- `extraction_status` TEXT DEFAULT 'pending' (pending, extracted, failed, not_needed)
- `extraction_request_id` TEXT (for PDF extraction tracking)
- `created_at` TEXT DEFAULT CURRENT_TIMESTAMP

**`housing_price_index`** — Extracted housing price index values
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `publication_id` TEXT REFERENCES publications(id)
- `file_id` TEXT REFERENCES files(id)
- `period` TEXT NOT NULL (e.g., "2025-11/2025-12")
- `district` TEXT (NULL for national)
- `index_value` REAL NOT NULL
- `base_year` INTEGER NOT NULL
- `pct_change_monthly` REAL
- `pct_change_annual` REAL
- `is_new_dwellings` INTEGER DEFAULT 0
- `created_at` TEXT DEFAULT CURRENT_TIMESTAMP

**`avg_apartment_prices`** — Average apartment prices by location
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `publication_id` TEXT REFERENCES publications(id)
- `file_id` TEXT REFERENCES files(id)
- `period` TEXT NOT NULL
- `district` TEXT NOT NULL
- `city` TEXT
- `rooms` TEXT (e.g., "3", "4", "5+")
- `avg_price_nis_thousands` REAL NOT NULL
- `sample_size` INTEGER
- `created_at` TEXT DEFAULT CURRENT_TIMESTAMP

**`consumer_price_index`** — CPI data from XML API and files
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `publication_id` TEXT REFERENCES publications(id)
- `file_id` TEXT REFERENCES files(id)
- `period` TEXT NOT NULL
- `index_code` TEXT NOT NULL (e.g., "120010")
- `index_name_he` TEXT
- `index_name_en` TEXT
- `index_value` REAL NOT NULL
- `base_year` INTEGER NOT NULL
- `pct_change_monthly` REAL
- `pct_change_annual` REAL
- `created_at` TEXT DEFAULT CURRENT_TIMESTAMP

**`review_insights`** — Extracted data from gov.il review PDFs
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `publication_id` TEXT REFERENCES publications(id)
- `file_id` TEXT REFERENCES files(id)
- `topic` TEXT
- `key_figures` TEXT (JSON array of {label, value, unit})
- `summary` TEXT
- `extracted_text` TEXT
- `confidence` REAL
- `created_at` TEXT DEFAULT CURRENT_TIMESTAMP

**`pipeline_runs`** — Tracking each pipeline execution
- `id` TEXT PRIMARY KEY (date-based: "2026-02-17")
- `started_at` TEXT NOT NULL
- `finished_at` TEXT
- `status` TEXT DEFAULT 'running' (running, completed, partial, failed)
- `sources_checked` INTEGER DEFAULT 0
- `files_discovered` INTEGER DEFAULT 0
- `files_downloaded` INTEGER DEFAULT 0
- `files_extracted` INTEGER DEFAULT 0
- `pdf_requests_created` INTEGER DEFAULT 0
- `pdf_results_processed` INTEGER DEFAULT 0
- `errors` TEXT (JSON array of error objects)
- `created_at` TEXT DEFAULT CURRENT_TIMESTAMP

#### Scenario: First pipeline run creates records
- **WHEN** the pipeline discovers 25 new files from a CBS publication
- **THEN** it SHALL create 1 `publications` record, 25 `files` records, and 1 `pipeline_runs` record, all within a single D1 batch transaction

#### Scenario: Extracted data inserted with foreign keys
- **WHEN** XLSX parsing extracts 50 housing price index rows
- **THEN** 50 `housing_price_index` records SHALL be inserted, each referencing the correct `publication_id` and `file_id`

### Requirement: KV State Management
The system SHALL use Cloudflare KV for fast-access state that doesn't need relational queries:

| Key Pattern | Value | Purpose |
|---|---|---|
| `discovery:cbs-publications:last_check` | ISO timestamp | When CBS publications were last checked |
| `discovery:cbs-publications:latest_folder` | `{year}/{folder}` | Latest publication folder seen |
| `discovery:cbs-xml-api:latest_period` | Period string | Latest data period from XML API |
| `discovery:cbs-media:latest_release` | `{year}/{number}` | Latest media release seen |
| `discovery:gov-il:latest_publish_date` | ISO timestamp | Latest gov.il review date |
| `pipeline:last_run` | ISO timestamp | When pipeline last ran |
| `pipeline:last_successful_run` | ISO timestamp | When pipeline last fully succeeded |

#### Scenario: KV read during discovery
- **WHEN** the CBS publications discovery runs
- **THEN** it SHALL read `discovery:cbs-publications:latest_folder` from KV to determine what's new, avoiding a D1 query

#### Scenario: KV updated after successful processing
- **WHEN** a source is fully processed (discovery through extraction)
- **THEN** the corresponding KV keys SHALL be updated atomically

### Requirement: Idempotent Inserts
The system SHALL handle duplicate data gracefully. If a pipeline run is re-executed for the same date, it SHALL NOT create duplicate records. The `publication_id` and `file_id` SHALL be deterministic (derived from source + URL or source + publication metadata) so that `INSERT OR IGNORE` prevents duplicates.

#### Scenario: Re-run same day
- **WHEN** the pipeline runs twice for 2026-02-17 (e.g., manual retry after partial failure)
- **THEN** the second run SHALL skip already-downloaded files (checking R2 existence) and already-extracted data (checking D1 existence), only processing items that failed or were missed

### Requirement: Ingest Webhook Endpoint
The Worker SHALL expose `POST /api/ingest` that:
1. Validates the `Authorization: Bearer {token}` header against a stored secret
2. Accepts the extraction completion payload
3. For each result ID in the payload, reads the result JSON from R2 `pipeline/extracted/req-{id}-result.json`
4. Validates and transforms the extracted data
5. Inserts into the appropriate D1 tables
6. Updates the `files` table extraction_status
7. Updates the `pipeline_runs` stats
8. Cleans up processed request/result files from R2

#### Scenario: Webhook receives extraction results
- **WHEN** the GitHub Action POSTs to `/api/ingest` with 7 successful and 1 failed result
- **THEN** the Worker SHALL process all 7 successful results into D1, update 7 files as `extracted`, update 1 file as `extraction_failed`, and update the pipeline run stats

#### Scenario: Unauthorized webhook call
- **WHEN** a request to `/api/ingest` has an invalid or missing Authorization header
- **THEN** the Worker SHALL return HTTP 401 and not process any data

### Requirement: Pickup Unprocessed Results on Cron
The daily cron Worker SHALL check for any unprocessed extraction results in R2 (`pipeline/extracted/`) that weren't processed via webhook (e.g., webhook failed). This ensures no results are lost.

#### Scenario: Webhook failed but results exist in R2
- **WHEN** the cron runs and finds `req-{id}-result.json` files in R2 that have no corresponding processed record in D1
- **THEN** the Worker SHALL process them the same way as the webhook would

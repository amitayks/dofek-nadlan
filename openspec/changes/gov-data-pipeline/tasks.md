## 1. Project Scaffolding

- [x] 1.1 Initialize the monorepo structure with `worker/` and `action/` directories
- [x] 1.2 Initialize the Cloudflare Worker project with `npm create cloudflare` or `wrangler init` inside `worker/`, configure TypeScript
- [x] 1.3 Create `wrangler.toml` with D1 database binding (`DB`), R2 bucket binding (`STORAGE`), KV namespace binding (`STATE`), secrets (`GITHUB_TOKEN`, `INGEST_AUTH_TOKEN`), and cron trigger `0 0 * * *`
- [x] 1.4 Create the D1 migration file `worker/migrations/0001_initial.sql` with all table schemas: `sources`, `publications`, `files`, `housing_price_index`, `avg_apartment_prices`, `consumer_price_index`, `review_insights`, `pipeline_runs`
- [x] 1.5 Run `wrangler d1 migrations apply` to create the D1 database and apply the schema
- [x] 1.6 Create the R2 bucket via `wrangler r2 bucket create gov-data-pipeline`
- [x] 1.7 Create the KV namespace via `wrangler kv namespace create STATE`
- [x] 1.8 Initialize the Python Action project inside `action/` with `requirements.txt` (pdf2image, PyMuPDF, boto3, anthropic, requests) and the `.github/workflows/extract-pdfs.yml` workflow file
- [x] 1.9 Create `worker/src/types.ts` with shared TypeScript types: `ManifestEntry`, `ExtractionRequest`, `ExtractionResult`, `PipelineRun`, `Env` (with D1, R2, KV bindings)
- [x] 1.10 Create `shared/extraction-request.schema.json` and `shared/extraction-result.schema.json` with the JSON contract between Worker and Action

## 2. Storage Helpers

- [x] 2.1 Implement `worker/src/storage/d1.ts` — D1 helper functions: `insertPublication()`, `insertFile()`, `insertHousingPriceIndex()`, `insertAvgApartmentPrices()`, `insertConsumerPriceIndex()`, `insertReviewInsights()`, `createPipelineRun()`, `updatePipelineRun()`, `getFileByUrl()` (for idempotency checks)
- [x] 2.2 Implement `worker/src/storage/kv.ts` — KV helper functions: `getDiscoveryState(source)`, `setDiscoveryState(source, state)`, `getLastRun()`, `setLastRun()`
- [x] 2.3 Implement `worker/src/storage/r2.ts` — R2 helper functions: `uploadFile(key, data, metadata)`, `downloadFile(key)`, `listFiles(prefix)`, `fileExists(key)`, `writeJson(key, data)`, `readJson(key)`
- [x] 2.4 Implement `worker/src/utils/http.ts` — Fetch wrapper with retry (3 attempts, exponential backoff), timeout (30s default), and rate limiting (500ms per domain)

## 3. Source Discovery

- [x] 3.1 Implement `worker/src/discovery/cbs-publications.ts` — Query CBS SharePoint REST API at `/he/publications/Madad/_api/Web/Lists/Items` filtered by current year, ordered by Created desc. For each new publication, enumerate files via `GetFolderByServerRelativeUrl(...)/Files?$expand=ListItemAllFields`. Compare against KV state to identify new items. Output: `ManifestEntry[]`
- [x] 3.2 Implement `worker/src/discovery/cbs-media.ts` — Query CBS media releases at `/he/mediarelease/Madad/_api/Web/Lists/Items` filtered by Created > last_check_date. For each release, enumerate DocLib files. Map filename suffix pattern `10_{YY}_{NNN}{suffix}.{ext}` to content types. Output: `ManifestEntry[]`
- [x] 3.3 Implement `worker/src/discovery/cbs-xml-api.ts` — Fetch `https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false&lang=he`. Parse XML response. Compare latest period against KV state. If new, produce manifest entry with source `cbs-xml-api` and type `structured-data`. Output: `ManifestEntry[]`
- [x] 3.4 Implement `worker/src/discovery/gov-il-reviews.ts` — Hit the gov.il dynamic collector backing API with collection GUID `3ed26e5e-41c1-4dbb-ac3f-b9b0f7b2c7b2` and subject filter `01` (Real Estate). Paginate via `skip` parameter. Construct PDF download URLs from `UrlName` and `FileName` fields. Compare against KV state. Output: `ManifestEntry[]`
- [x] 3.5 Implement `worker/src/pipeline/discover.ts` — Discovery coordinator that runs all 4 discovery sources in parallel, collects manifests, merges them, and returns the combined manifest. Handles individual source failures gracefully (log error, continue).

## 4. File Download & Archive

- [x] 4.1 Implement `worker/src/download/downloader.ts` — Takes `ManifestEntry[]`, downloads each file using the HTTP helper with retry and rate limiting. Validates non-zero size and correct content-type. Returns downloaded file buffer + metadata per entry. Tags each with `is_preferred_format` based on format priority (xlsx > xls > docx > pdf).
- [x] 4.2 Implement `worker/src/download/archive.ts` — Uploads downloaded files to R2 following the path convention: `raw-files/{source}/{year}/{folder}/{filename}`. Sets custom metadata on each R2 object: source, publication_id, original_url, download_date, checksum_sha256. Creates `files` records in D1.
- [x] 4.3 Add ZIP file handling in the downloader — detect ZIP files (e.g., `housing.zip`), extract contents, and treat each contained file as an individual download with its own archive path and D1 record.

## 5. Data Extraction (Inline — Worker)

- [x] 5.1 Implement `worker/src/extraction/router.ts` — Routes files to extraction strategy based on format and `is_preferred_format`. XLSX/XLS → xlsx-parser, DOCX → docx-parser, source=cbs-xml-api → xml-api-parser, PDF with is_preferred_format → pdf-request creator. Returns extracted data or extraction request.
- [x] 5.2 Implement `worker/src/extraction/xlsx-parser.ts` — Uses SheetJS (`xlsx` npm package) to parse CBS XLSX files. Contains template parsers for each known table type:
  - `parseTable2_1(buffer)` → housing_price_index records (national)
  - `parseTable2_2(buffer)` → avg_apartment_prices records (by district/city/rooms)
  - `parseTable2_3(buffer)` → housing_price_index records (by district)
  - `parseTable2_4(buffer)` → housing_price_index records (new dwellings)
  - `parseCpiTable(buffer)` → consumer_price_index records
  - Template matching via filename pattern recognition
- [x] 5.3 Implement `worker/src/extraction/docx-parser.ts` — Uses mammoth or similar library to extract tables and text from DOCX files. Converts embedded tables to the same output schemas as XLSX parser. Extracts narrative text for press release summaries.
- [x] 5.4 Implement `worker/src/extraction/xml-api-parser.ts` — Parses CBS XML API response. Extracts index entries with code, name (he/en), period, values across base years, and percent changes. Outputs `consumer_price_index` records.
- [x] 5.5 Implement `worker/src/extraction/pdf-request.ts` — For PDF files that need extraction, creates extraction request JSON and writes to R2 at `pipeline/extraction-requests/req-{id}.json`. Sets `extraction_status=pending_extraction` on the file's D1 record.
- [x] 5.6 Implement `worker/src/utils/validation.ts` — Validates extracted data records against expected schemas: required fields present, numeric fields valid, period format correct, known district/city names matched. Rejects invalid records with logged warnings.

## 6. Pipeline Orchestrator

- [x] 6.1 Implement `worker/src/pipeline/pickup.ts` — Phase 0: Scans R2 `pipeline/extracted/` for result JSONs that haven't been processed into D1 yet (by cross-referencing with `files` table extraction_status). Processes each result: validates data, inserts into D1 tables, updates file status, cleans up R2 request/result files.
- [x] 6.2 Implement `worker/src/pipeline/orchestrator.ts` — Main pipeline sequence: Phase 0 (pickup) → Phase 1 (discover) → Phase 2 (download + archive) → Phase 3 (extract inline) → Phase 4 (trigger GH Action) → Phase 5 (finalize). Creates pipeline_run at start, updates stats at each phase, handles partial failures.
- [x] 6.3 Implement `worker/src/pipeline/trigger.ts` — Triggers GitHub Action via `POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/extract-pdfs.yml/dispatches` with run_id input. Handles 204 success, 429 rate limit, and auth errors.
- [x] 6.4 Implement `worker/src/index.ts` — Worker entry point with `scheduled` handler (cron → orchestrator), `fetch` handler (HTTP routes), and environment type exports.

## 7. HTTP Routes

- [x] 7.1 Implement `worker/src/routes/ingest.ts` — `POST /api/ingest`: Validates Bearer token auth. Accepts extraction completion payload. For each result ID: reads result JSON from R2, validates data, inserts into D1, updates file status, updates pipeline_run stats. Cleans up processed R2 files. Returns 200 with processing summary.
- [x] 7.2 Implement `worker/src/routes/status.ts` — `GET /api/status`: Returns latest pipeline run details from D1 including stats and errors.
- [x] 7.3 Implement `worker/src/routes/trigger.ts` — `POST /api/trigger`: Validates Bearer token auth. Executes the same pipeline as the cron handler. Returns run_id.
- [x] 7.4 Implement `worker/src/routes/health.ts` — `GET /api/health`: No auth. Returns `{"status": "ok", "last_run": "..."}` from KV.

## 8. PDF Extraction GitHub Action

- [x] 8.1 Create `.github/workflows/extract-pdfs.yml` — Workflow with `workflow_dispatch` trigger, `run_id` input. Three jobs: `discover-work` (list pending requests from R2, output matrix), `extract` (matrix job, one per PDF), `notify` (runs after matrix, sends webhook).
- [x] 8.2 Implement `action/extract/r2_client.py` — R2 access via boto3 with S3-compatible endpoint. Functions: `list_extraction_requests(run_id)`, `download_pdf(r2_key)`, `read_request(request_id)`, `write_result(request_id, result)`. Uses GitHub secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.
- [x] 8.3 Implement `action/extract/pdf_to_images.py` — Converts PDF to PNG images at 300 DPI using pdf2image (with poppler) or PyMuPDF. Returns list of image file paths.
- [x] 8.4 Implement `action/extract/ai_extract.py` — Sends page images to AI vision model (Anthropic Claude API) with extraction schema and expected content type from the request. Prompts the AI to return JSON array of records matching the schema. Includes retry on invalid JSON. Returns parsed data + confidence score.
- [x] 8.5 Implement `action/extract/validate.py` — Validates AI extraction output against the request's extraction_schema. Checks required fields, types, value ranges. Returns validated data or error details.
- [x] 8.6 Implement `action/extract/webhook.py` — Sends POST to Worker's `/api/ingest` endpoint with extraction completion payload. Uses `INGEST_WEBHOOK_URL` and `INGEST_AUTH_TOKEN` from GitHub secrets. Retries 3 times on failure.
- [x] 8.7 Implement `action/extract/main.py` — Entry point for each matrix job: reads request from R2, downloads PDF, converts to images, sends to AI, validates output, writes result to R2. Exit code 0 on success, 1 on failure (doesn't break other matrix jobs).

## 9. Testing & Validation

- [x] 9.1 Write unit tests for XLSX parser with sample CBS XLSX files — verify correct extraction of each table type (2.1, 2.2, 2.3, 2.4)
- [x] 9.2 Write unit tests for XML API parser with sample CBS XML response
- [x] 9.3 Write unit tests for discovery modules with mocked API responses
- [x] 9.4 Write integration test for the full pipeline with mocked external APIs — verify end-to-end: discovery → download → extract → store
- [x] 9.5 Write Python tests for PDF extraction with a sample PDF — verify image conversion and AI prompt construction
- [x] 9.6 Download sample files from CBS (one XLSX per table type, one PDF, the XML API response) and store as test fixtures

## 10. Deployment & Configuration

- [x] 10.1 Set Cloudflare Worker secrets: `GITHUB_TOKEN`, `INGEST_AUTH_TOKEN`, `AI_API_KEY`
- [ ] 10.2 Set GitHub repository secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `INGEST_WEBHOOK_URL`, `INGEST_AUTH_TOKEN`, `ANTHRIPIC_API_KEY`
- [x] 10.3 Seed the `sources` table in D1 with the 4 source configurations (cbs-publications, cbs-media, cbs-xml-api, gov-il-reviews) including their base_url and check_config JSON
- [x] 10.4 Deploy the Worker with `wrangler deploy` and verify cron trigger is registered
- [x] 10.5 Test the full pipeline end-to-end: trigger via `/api/trigger`, verify discovery, download, extraction, and D1 data
- [ ] 10.6 Test the PDF extraction flow: manually create an extraction request in R2, trigger the GitHub Action, verify result in R2 and D1 after webhook

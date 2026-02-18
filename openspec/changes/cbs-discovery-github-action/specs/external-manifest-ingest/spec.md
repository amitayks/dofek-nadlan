## ADDED Requirements

### Requirement: Worker accepts external manifest entries via HTTP
The Worker SHALL expose a `POST /api/manifest` endpoint that accepts an array of `ManifestEntry` objects and runs the download, archive, extract, and store pipeline on them.

#### Scenario: Successful manifest processing
- **WHEN** an authenticated POST request is sent to `/api/manifest` with a JSON body containing `{ "entries": [...] }` where entries is a valid array of ManifestEntry objects
- **THEN** the Worker SHALL download each file, archive to R2, extract data (XLSX/DOCX inline, PDF via extraction request), store results in D1, and return a JSON response with `{ "processed": <count>, "errors": <count>, "pdf_requests": <count> }`

#### Scenario: Authentication required
- **WHEN** a POST request is sent to `/api/manifest` without a valid `Authorization: Bearer <INGEST_AUTH_TOKEN>` header
- **THEN** the Worker SHALL return HTTP 401 Unauthorized

#### Scenario: Empty manifest
- **WHEN** an authenticated POST request is sent with `{ "entries": [] }`
- **THEN** the Worker SHALL return HTTP 200 with `{ "processed": 0, "errors": 0, "pdf_requests": 0 }`

#### Scenario: Partial failure
- **WHEN** some manifest entries fail to download or extract but others succeed
- **THEN** the Worker SHALL process all entries, return HTTP 200 with the count of successes and errors, and not abort on individual file failures

#### Scenario: Duplicate file detection
- **WHEN** a manifest entry has a URL that already exists in the D1 `files` table
- **THEN** the Worker SHALL skip that entry and not re-download or re-process it

### Requirement: Manifest endpoint triggers GitHub Action for PDFs
The Worker SHALL trigger the `extract-pdfs.yml` GitHub Action if any of the processed manifest entries produce PDF extraction requests.

#### Scenario: PDF files in manifest
- **WHEN** the manifest contains PDF files that require AI extraction
- **THEN** the Worker SHALL create extraction requests in R2 and trigger the GitHub Action with the current run ID

#### Scenario: No PDF files
- **WHEN** the manifest contains only XLSX/DOCX files (no PDFs needing extraction)
- **THEN** the Worker SHALL NOT trigger the GitHub Action

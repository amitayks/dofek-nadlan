## ADDED Requirements

### Requirement: GitHub Action Workflow Trigger
The PDF extraction service SHALL be a GitHub Action triggered via `workflow_dispatch` by the Cloudflare Worker. The trigger SHALL include the `run_id` (date string) as input so the Action knows which extraction requests to process.

#### Scenario: Worker triggers extraction
- **WHEN** the Worker has written one or more extraction request JSONs to R2 and calls `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` with `{"ref": "main", "inputs": {"run_id": "2026-02-17"}}`
- **THEN** the GitHub Action SHALL start and process all pending requests for that run

#### Scenario: No extraction requests exist
- **WHEN** the Action starts but finds no `req-*.json` files in `pipeline/extraction-requests/`
- **THEN** the Action SHALL exit successfully with a log message "No extraction requests found"

### Requirement: PDF to Image Conversion
The Action SHALL convert each PDF page to an image using a Python library (e.g., pdf2image with poppler, or PyMuPDF/fitz). Images SHALL be generated at 300 DPI for reliable text/table recognition.

#### Scenario: Multi-page PDF converted
- **WHEN** a PDF has 5 pages
- **THEN** the Action SHALL produce 5 PNG images, one per page, stored temporarily in the Action's workspace

### Requirement: AI-Powered Data Extraction
The Action SHALL send PDF page images to an AI model (Claude or GPT-4 Vision) with a structured prompt that includes:
1. The `extraction_schema` from the request (what fields to extract)
2. The `expected_content` description (what kind of table/data to look for)
3. Instructions to output valid JSON matching the schema

The prompt SHALL request the AI to return a JSON array of records.

#### Scenario: Table extraction from housing price PDF
- **WHEN** a PDF contains a table of average apartment prices by district
- **THEN** the AI SHALL extract each row as a JSON record with fields matching the `extraction_schema`, and the Action SHALL validate the output is parseable JSON

#### Scenario: Narrative report extraction from gov.il review
- **WHEN** a gov.il periodic review PDF contains narrative text with embedded statistics
- **THEN** the AI SHALL extract key findings as structured JSON with fields: `topic`, `key_figures` (array of {label, value, unit}), `summary` (text), and `period`

#### Scenario: AI extraction fails or returns invalid JSON
- **WHEN** the AI response is not valid JSON or doesn't match the schema
- **THEN** the Action SHALL retry once with a more explicit prompt, and if it fails again, write a result with `status: "extraction_failed"` and include the raw AI response for debugging

### Requirement: Parallel Processing via Matrix Strategy
The Action SHALL support processing multiple PDFs in parallel using GitHub Actions matrix strategy. A discovery job SHALL list all pending extraction requests, then a matrix job SHALL process each independently.

#### Scenario: 8 PDFs to process
- **WHEN** there are 8 pending extraction requests
- **THEN** the Action SHALL create a matrix of 8 parallel jobs, each processing one PDF independently, with a maximum concurrency matching GitHub's free tier (20 jobs)

### Requirement: R2 Result Writing
After successful extraction, the Action SHALL write the result JSON to R2 at path `pipeline/extracted/req-{request_id}-result.json`. The result format:
```json
{
  "request_id": "req-2026-02-17-001",
  "status": "success|extraction_failed|partial",
  "data": [...],
  "confidence": 0.0-1.0,
  "extraction_method": "pdf2image+{model_name}",
  "pages_processed": 5,
  "processed_at": "{ISO 8601}"
}
```

The Action SHALL access R2 using S3-compatible API with credentials stored as GitHub repository secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`).

#### Scenario: Successful extraction written to R2
- **WHEN** extraction succeeds for request `req-2026-02-17-001`
- **THEN** the result SHALL be written to `pipeline/extracted/req-2026-02-17-001-result.json` in R2

### Requirement: Webhook Notification on Completion
After all matrix jobs complete, a final job in the Action SHALL call the Worker's webhook endpoint at `https://{worker-domain}/api/ingest` with a POST request containing:
```json
{
  "event": "extraction_complete",
  "run_id": "2026-02-17",
  "results": ["req-2026-02-17-001", "req-2026-02-17-002", ...],
  "stats": {"total": 8, "success": 7, "failed": 1}
}
```
The webhook auth SHALL use a shared secret in the `Authorization: Bearer {token}` header.

#### Scenario: All extractions complete, webhook sent
- **WHEN** all 8 matrix jobs finish (7 success, 1 failed)
- **THEN** the final job SHALL send the webhook with accurate stats, and the Worker SHALL receive and process it

#### Scenario: Webhook unreachable
- **WHEN** the Worker webhook returns non-200 or times out
- **THEN** the Action SHALL retry 3 times with 10s delay, and if all fail, log the error. The Worker's next cron run SHALL pick up unprocessed results from R2 anyway.

### Requirement: R2 Access from GitHub Action
The Action SHALL use the boto3 (AWS S3 SDK for Python) library configured for Cloudflare R2's S3-compatible endpoint to read extraction requests and write results.

#### Scenario: Action reads extraction request from R2
- **WHEN** the Action job starts for request `req-2026-02-17-001`
- **THEN** it SHALL read the request JSON from `pipeline/extraction-requests/req-2026-02-17-001.json` and download the PDF from the `r2_key` path specified in the request

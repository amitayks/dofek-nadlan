## ADDED Requirements

### Requirement: Daily Cron Trigger
The Cloudflare Worker SHALL be configured with a cron trigger at `0 0 * * *` (midnight UTC daily). The cron handler SHALL execute the full pipeline sequence.

#### Scenario: Cron fires at midnight
- **WHEN** the cron trigger fires at 2026-02-17T00:00:00Z
- **THEN** the Worker SHALL create a pipeline run with id `2026-02-17`, set status to `running`, and begin the discovery phase

#### Scenario: Previous run still has pending PDF extractions
- **WHEN** the cron fires and there are unprocessed extraction results from the previous run in R2
- **THEN** the Worker SHALL first process those results (ingest into D1), then proceed with the new discovery

### Requirement: Pipeline Execution Sequence
The orchestrator SHALL execute phases in this order:
1. **Pickup**: Check R2 for any unprocessed extraction results from previous runs. Process them into D1.
2. **Discover**: Run discovery for all active sources. Produce manifest.
3. **Download**: Download all new files from manifest to R2.
4. **Extract (inline)**: Process XLSX, DOCX, and XML API data immediately. Store results in D1.
5. **Request PDF extraction**: Write extraction requests to R2 for any PDFs that need processing.
6. **Trigger GitHub Action**: If extraction requests were created, trigger the Action via workflow_dispatch.
7. **Finalize**: Update pipeline run stats and KV state.

Each phase SHALL proceed even if the previous phase had partial failures. The pipeline SHALL NOT abort entirely due to a single source or file failing.

#### Scenario: One source fails, others succeed
- **WHEN** the CBS publications API is unreachable but CBS XML API and gov.il respond normally
- **THEN** the pipeline SHALL skip CBS publications, process the other sources, log the error in the pipeline run, and set status to `partial`

#### Scenario: Full success
- **WHEN** all sources respond, all files download, and all inline extractions succeed
- **THEN** the pipeline run status SHALL be `completed` and all stats SHALL reflect the work done

### Requirement: Worker HTTP Routes
The Worker SHALL handle these HTTP routes in addition to the cron handler:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/ingest` | Bearer token | Receive extraction results from GitHub Action |
| GET | `/api/status` | Bearer token | Return latest pipeline run status |
| POST | `/api/trigger` | Bearer token | Manually trigger a pipeline run |
| GET | `/api/health` | None | Health check (returns 200) |

#### Scenario: Manual pipeline trigger
- **WHEN** an authenticated POST request is made to `/api/trigger`
- **THEN** the Worker SHALL execute the same pipeline sequence as the cron handler and return the run ID

#### Scenario: Health check
- **WHEN** a GET request is made to `/api/health`
- **THEN** the Worker SHALL return `{"status": "ok", "last_run": "2026-02-17T00:05:00Z"}` with data from KV

### Requirement: Error Handling and Logging
The orchestrator SHALL log structured events for each phase:
- `{phase, status, source, count, duration_ms, errors[]}`

Errors SHALL be accumulated in the pipeline run's `errors` JSON array with: `{phase, source, file, error_message, timestamp}`.

#### Scenario: Download timeout for specific file
- **WHEN** file `aa2_1_h.xlsx` times out during download
- **THEN** the error SHALL be logged with `{phase: "download", source: "cbs-publications", file: "aa2_1_h.xlsx", error_message: "Timeout after 30s"}`, the file SHALL be marked `download_failed` in D1, and the pipeline SHALL continue with the next file

### Requirement: GitHub Action Trigger
The Worker SHALL trigger the GitHub Action by calling the GitHub API:
```
POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
Authorization: Bearer {github_token}
{
  "ref": "main",
  "inputs": {
    "run_id": "2026-02-17"
  }
}
```
The `github_token` SHALL be stored as a Cloudflare Worker secret. The `workflow_id` can be the workflow filename (e.g., `extract-pdfs.yml`).

#### Scenario: GitHub Action triggered successfully
- **WHEN** the Worker has created 3 extraction requests in R2
- **THEN** it SHALL POST to the GitHub API, receive HTTP 204, and log "Triggered PDF extraction for run 2026-02-17 with 3 requests"

#### Scenario: GitHub API rate limited
- **WHEN** the GitHub API returns HTTP 429 or 403 (rate limit)
- **THEN** the Worker SHALL log the error and set the pipeline run's `pdf_extraction_triggered` to false. The next day's cron will pick up the pending requests.

### Requirement: Cloudflare Worker Configuration
The Worker SHALL be configured with these bindings:

| Binding | Type | Name |
|---|---|---|
| D1 | Database | `DB` |
| R2 | Bucket | `STORAGE` |
| KV | Namespace | `STATE` |
| Secret | Text | `GITHUB_TOKEN` |
| Secret | Text | `INGEST_AUTH_TOKEN` |
| Secret | Text | `AI_API_KEY` (for future inline AI use) |

#### Scenario: Worker deployed with all bindings
- **WHEN** the Worker is deployed via `wrangler deploy`
- **THEN** all bindings SHALL be available via the `env` parameter in the Worker's fetch and scheduled handlers

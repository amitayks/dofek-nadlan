## Why

The current `discover-cbs.yml` GitHub Action is a fragile bash script that discovers ALL files for the entire year (798 entries on first run), sends them in batches of 10 to the Worker, and has no awareness of what's already been processed. This wastes time, bandwidth, and Worker CPU. The PDF extraction workflow (`extract-pdfs.yml`) runs as a separate workflow triggered by the Worker. Having two separate workflows for related tasks adds complexity and friction.

We need a smarter, unified Python-based Action that:
1. Queries the Worker for already-known file URLs to skip duplicates before POSTing
2. Only discovers files from the current month onward (not the entire year)
3. Combines CBS discovery + PDF extraction into one workflow
4. Uses Python instead of bash for reliability and testability

## What Changes

- Add `GET /api/known-urls?source=cbs-media&source=cbs-publications` endpoint to the Worker that returns known `download_url` values from D1's `files` table
- Create `action/discover/` Python module for CBS SharePoint discovery (publications + media releases)
- Create `.github/workflows/pipeline.yml` — unified workflow replacing both `discover-cbs.yml` and `extract-pdfs.yml`
- Delete `.github/workflows/discover-cbs.yml`
- Update Worker's `triggerGitHubAction` to reference the new unified workflow file

## Capabilities

### New Capabilities
- `known-urls-endpoint`: Worker endpoint returning known file URLs per source, allowing the Action to skip already-processed files locally
- `python-cbs-discovery`: Python module that queries CBS SharePoint REST APIs, filters by current month, and builds manifest entries
- `unified-pipeline-action`: Single workflow that runs discovery → post manifest → wait → extract PDFs in sequence

### Modified Capabilities
- `github-action-trigger`: Worker's `triggerGitHubAction` updated to target `pipeline.yml` instead of `extract-pdfs.yml`

## Impact

- **Worker routes**: New `GET /api/known-urls` route in `worker/src/index.ts`
- **Worker trigger**: `pipeline/trigger.ts` workflow filename changed from `extract-pdfs.yml` to `pipeline.yml`
- **GitHub Actions**: `discover-cbs.yml` deleted, `extract-pdfs.yml` renamed/absorbed into `pipeline.yml`
- **Python code**: New `action/discover/` module alongside existing `action/extract/`
- **Dependencies**: `requests` already in `action/requirements.txt`; no new deps needed
- **Secrets**: Same secrets used (`INGEST_WEBHOOK_URL`, `INGEST_AUTH_TOKEN`, R2 creds, `ANTHRIPIC_API_KEY`)
- **No schema changes**: D1 tables, R2 paths unchanged

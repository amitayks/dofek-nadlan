## Architecture

### Worker: Known URLs Endpoint

New `GET /api/known-urls` endpoint authenticates with Bearer token and accepts `source` query params (repeatable). Queries D1 `files` table for all `download_url` values matching the requested source prefixes via `publication_id LIKE 'cbs-pub-%'` or `publication_id LIKE 'cbs-media-%'`. Returns `{ urls: string[] }`.

This is a lightweight read-only endpoint — no pagination needed since CBS publishes ~50-100 files/month.

### Python Discovery Module: `action/discover/`

```
action/discover/
  __init__.py
  cbs_client.py    # CBS SharePoint REST API client
  main.py          # Entry point: discover → filter → post manifest
```

**`cbs_client.py`** — Handles CBS SharePoint REST API calls:
- `list_doclib_folders(section, year)` — Lists DocLib subfolders for a given section+year
- `list_folder_files(section, year, folder)` — Lists files in a DocLib subfolder
- `get_page_items(section, list_guid, top)` — Gets page items for title/date metadata
- `build_manifest_entries(section, source, year, folders, page_items)` — Combines folder files with page metadata into ManifestEntry dicts

CBS SharePoint structure:
- Base: `https://www.cbs.gov.il`
- Publications list GUID: `71b30cd4-0261-4757-9482-a52c5a6da90a`
- Media list GUID: `db8f0177-370a-46ec-9ab9-041b54247975`
- DocLib folders use numeric IDs (050, 051...) under `/he/{section}/Madad/DocLib/{year}/`
- File types: xlsx, xls, docx, doc, pdf, zip

**Month filtering**: The Action gets the current year+month. When listing DocLib folders, it fetches page items ordered by `Created desc` and only processes folders whose associated page item's `ArticleStartDate` is in the current month or later. If no page item matches a folder, it's included (safe default).

**`main.py`** — Orchestrates the flow:
1. Fetch known URLs from Worker (`GET /api/known-urls?source=cbs-publications&source=cbs-media`)
2. Discover CBS publications DocLib folders + files for current year
3. Discover CBS media releases DocLib folders + files for current year
4. Filter out entries whose URL is in the known set
5. If no new entries → log "no new files" and exit
6. POST new entries to Worker's `/api/manifest` in batches of 10
7. Return count of new entries and any errors

### Unified Workflow: `.github/workflows/pipeline.yml`

Three jobs chained:

```
discover (runs always on schedule + dispatch)
  → extract (runs if PDFs found, matrix strategy)
    → notify (runs always after extract, sends webhook)
```

**Job 1: `discover`** — Python CBS discovery
- Checkout + setup Python 3.12 + pip install
- Run `python -m action.discover.main`
- Outputs: `new_files` count, `run_id`

**Job 2: `extract`** — PDF extraction (moved from extract-pdfs.yml)
- Needs `discover` job
- Runs if there are extraction requests in R2 for this run_id
- Matrix strategy over request IDs (same as current extract-pdfs.yml)
- Each matrix job: download PDF from R2 → convert to images → AI extract → write result to R2

**Job 3: `notify`** — Webhook to Worker
- Needs `extract` (or discover if no PDFs)
- Posts extraction results to Worker's `/api/ingest`

Triggers:
- `schedule: cron '30 23 * * *'` (daily at 23:30 UTC)
- `workflow_dispatch` (manual, with optional `run_id` input)

### Worker Changes

1. **New route**: `GET /api/known-urls` → `handleKnownUrls(request, env)`
2. **Trigger update**: `pipeline/trigger.ts` → change `workflowFile` from `'extract-pdfs.yml'` to `'pipeline.yml'`
3. **Cleanup**: Delete `discover-cbs.yml` bash workflow

## Key Decisions

- **Known URLs over state file**: Worker's D1 is the source of truth. Querying it directly is more reliable than maintaining a separate state file.
- **Python over bash**: The CBS discovery bash script was fragile (escaping issues, no error handling per-item, `jq` pipelines hard to debug). Python with `requests` is more maintainable.
- **Batch size 10**: Worker has a 30-second CPU limit per request. 10 files per batch keeps each request well under the limit.
- **Month filtering at Action level**: Simpler than modifying the Worker. The Action fetches all DocLib folders but only processes recent ones.

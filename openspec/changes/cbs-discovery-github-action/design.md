## Context

The gov-data-pipeline Cloudflare Worker runs a daily cron that discovers new files from 4 Israeli government data sources, downloads them, extracts structured data, and stores results in D1. Two of the sources (`cbs-publications` and `cbs-media`) use CBS SharePoint REST APIs at `www.cbs.gov.il/_api/...`. These APIs consistently return HTML (a login/challenge page) instead of JSON when called from Cloudflare Worker edge IPs. This is a server-side block that cannot be resolved with headers.

The other two sources work: `cbs-xml-api` uses a separate `api.cbs.gov.il` endpoint, and `gov-il-reviews` uses `data.gov.il` as a fallback. GitHub Actions runners (standard Azure VMs) are not blocked by CBS.

Current architecture: Worker cron (discovery + download + extract + store) → triggers GitHub Action (PDF extraction only).

## Goals / Non-Goals

**Goals:**
- Restore CBS publications and media release discovery by running it from GitHub Actions
- Keep the Worker as the single source of truth for the download/archive/extract/store pipeline
- Minimize architectural changes — reuse existing auth, R2, and D1 infrastructure

**Non-Goals:**
- Changing the D1 schema or R2 path conventions
- Adding new data sources
- Changing the PDF extraction flow (already works via GitHub Action)

## Decisions

### 1. New Worker endpoint (`POST /api/manifest`) instead of writing directly to R2

**Decision**: The GitHub Action posts manifest entries to a new Worker HTTP endpoint, which then runs the standard download → archive → extract → store pipeline.

**Alternatives considered**:
- *Action writes files to R2, Worker picks up on next cron*: Adds a 24-hour delay and requires R2 write access from the Action for a second purpose (currently only used by PDF extraction). The pickup logic would need to understand manifest entries vs extraction results.
- *Action does discovery + download + upload to R2*: Duplicates download/archive logic in Python. Harder to maintain.

**Rationale**: Posting manifest to the Worker keeps all file processing in one place (TypeScript) and gives immediate processing. The Action only needs `INGEST_WEBHOOK_URL` and `INGEST_AUTH_TOKEN` which are already configured as GitHub secrets for the extract-pdfs workflow.

### 2. Separate workflow (`discover-cbs.yml`) instead of extending `extract-pdfs.yml`

**Decision**: Create a new workflow with its own cron schedule.

**Rationale**: `extract-pdfs.yml` is triggered by `workflow_dispatch` from the Worker. CBS discovery should run on its own schedule (before the Worker's midnight cron) so results are processed the same day. Mixing triggers and concerns in one workflow adds complexity.

### 3. Scheduled at 23:30 UTC (before Worker's midnight cron)

**Decision**: The CBS discovery Action runs at 23:30 UTC daily. The Worker cron runs at 00:00 UTC.

**Rationale**: The manifest endpoint processes files immediately, so timing relative to the Worker cron is less critical. Running 30 minutes before midnight ensures that if the Worker cron also triggers discovery for the other 2 sources, everything is processed in the same pipeline run. Also gives a buffer before midnight.

### 4. Inline bash/curl script instead of a Node.js/Python discovery script

**Decision**: The Action uses `curl` + `jq` to query CBS SharePoint APIs and a small inline script to POST manifests to the Worker.

**Rationale**: The CBS SharePoint API queries are straightforward REST calls that return JSON. No need for a full runtime or package installation — `curl` and `jq` are pre-installed on GitHub runners. This keeps the Action fast and dependency-free.

## Risks / Trade-offs

- **[CBS changes API structure]** → SharePoint list GUIDs or response format may change. Mitigation: The Action logs raw responses; monitor for failures.
- **[GitHub Actions outage]** → CBS discovery won't run. Mitigation: The Worker still runs cbs-xml-api and gov-il-reviews. CBS publications/media are supplementary data. Manual trigger via `/api/manifest` is always available.
- **[Rate limiting on /api/manifest]** → Multiple rapid POST calls. Mitigation: The Action batches all manifest entries into a single POST request.
- **[Timing gap]** → If the Action runs but the Worker's download phase times out. Mitigation: The manifest endpoint is a synchronous HTTP handler — it downloads and processes before responding. Cloudflare Worker has a 30-second CPU limit but external fetch time doesn't count.

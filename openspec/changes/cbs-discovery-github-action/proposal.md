## Why

CBS SharePoint REST APIs (`www.cbs.gov.il/_api/...`) return HTML instead of JSON when called from Cloudflare Worker IPs. This is a server-side block (likely WAF/bot detection on cloud provider IPs) that cannot be fixed with headers. The `cbs-publications` and `cbs-media` discovery sources are completely broken in production, while `cbs-xml-api` (hosted on a separate `api.cbs.gov.il` domain) works fine. We need to move CBS SharePoint discovery to an environment that can reach those APIs — GitHub Actions runners.

## What Changes

- Add a new `POST /api/manifest` endpoint to the Worker that accepts externally-discovered manifest entries and runs the download/archive/extract/store pipeline on them
- Create a new scheduled GitHub Action (`discover-cbs.yml`) that queries CBS SharePoint REST APIs daily and posts discovered manifests to the Worker
- Simplify the Worker's `cbs-publications` and `cbs-media` discovery modules to no-ops (log a message, return empty) since discovery is now external
- Remove the now-unnecessary browser-like headers and fallback strategies from the Worker's CBS discovery code

## Capabilities

### New Capabilities
- `external-manifest-ingest`: Worker HTTP endpoint that accepts manifest entries from external sources and triggers the download/extract/store pipeline
- `cbs-discovery-action`: Scheduled GitHub Action that queries CBS SharePoint APIs and posts discovered file manifests to the Worker

### Modified Capabilities

## Impact

- **Worker routes**: New `/api/manifest` route added to `worker/src/index.ts`
- **Worker discovery**: `cbs-publications.ts` and `cbs-media.ts` become stubs (log + return empty)
- **GitHub Actions**: New `discover-cbs.yml` workflow with cron schedule
- **Secrets**: The Action needs `INGEST_WEBHOOK_URL` and `INGEST_AUTH_TOKEN` (already defined as GitHub secrets for the extract-pdfs workflow)
- **No schema changes**: D1 tables, R2 paths, and KV state are unchanged

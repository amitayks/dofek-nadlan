## Why

The pulse-property-insight site needs to display up-to-date Israeli real estate and price index data sourced from government publications. Currently, this data is locked inside PDF/DOCX/XLSX files published periodically on CBS (Central Bureau of Statistics) and gov.il. These files have inconsistent naming, are published on SharePoint/AngularJS-rendered pages, and require manual discovery and extraction. We need an automated daily pipeline that discovers, downloads, extracts, and stores this data — making it queryable and ready for any frontend.

## What Changes

- **New daily pipeline**: A Cloudflare Worker (TypeScript) runs at midnight, discovers new publications across 3 government sources, downloads all files to R2, extracts structured data from XLSX/DOCX/API sources, and stores results in D1.
- **New PDF extraction service**: A GitHub Action (Python) handles heavy PDF-to-image-to-AI extraction, triggered asynchronously by the Worker when PDFs are found. Communicates via R2 (extraction requests/results) and a webhook callback.
- **New data storage layer**: Cloudflare D1 (SQLite) tables for structured data (price indices, average apartment prices, review insights, pipeline state). Cloudflare KV for fast lookups (last-known-state per source, latest release numbers).
- **New file archive**: All raw files archived permanently in Cloudflare R2, organized by source/year/publication, serving as the human-in-the-loop fallback.
- **New ingest webhook**: A Worker HTTP endpoint (`/api/ingest`) that receives extraction results from the GitHub Action and processes them into D1.

## Capabilities

### New Capabilities
- `source-discovery`: Discovers new publications from CBS SharePoint REST API, CBS XML API, and gov.il dynamic collector. Compares against known state (KV) to identify what's new. Produces a manifest of files to process.
- `file-download`: Downloads files from discovered URLs to Cloudflare R2. Handles all formats (XLSX, XLS, DOCX, DOC, PDF, ZIP). Includes retry logic, size validation, and checksum tracking.
- `data-extraction`: Routes files to appropriate extraction strategy — XLSX parsing (SheetJS), DOCX parsing, CBS XML API parsing, or PDF extraction request creation. Outputs structured JSON matching defined schemas.
- `pdf-extraction`: Python-based GitHub Action that processes PDFs through image conversion and AI-powered table/text extraction. Reads requests from R2, writes results back to R2. Runs in parallel via matrix strategy.
- `data-storage`: D1 schema design and write operations for all extracted data types (housing price index, average apartment prices, consumer price index, review insights). Includes pipeline run tracking.
- `pipeline-orchestrator`: Cloudflare Worker cron job that coordinates the full pipeline flow — discovery through storage. Handles the async handoff to GitHub Action for PDFs and the webhook callback for result ingestion.

### Modified Capabilities
<!-- None - greenfield project -->

## Impact

- **New infrastructure**: Cloudflare Worker, D1 database, R2 bucket, KV namespace, GitHub Actions workflow
- **New repository structure**: TypeScript Worker project + Python extraction scripts
- **External dependencies**: CBS SharePoint REST API, CBS XML API, gov.il dynamic collector API, GitHub API (for workflow dispatch)
- **Secrets/config needed**: GitHub token (for Worker to trigger Actions), R2 access credentials (for Action to read/write), AI API key (for PDF extraction)
- **Cost**: Expected $0 on Cloudflare free tier + minimal GitHub Actions minutes (~5 min/day)

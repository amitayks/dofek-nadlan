## 1. Worker Manifest Endpoint

- [x] 1.1 Create `worker/src/routes/manifest.ts` — `POST /api/manifest` handler that validates Bearer auth, accepts `{ entries: ManifestEntry[] }`, checks for duplicate URLs in D1, then runs download → archive → extract → store pipeline on new entries. Returns `{ processed, errors, pdf_requests }`.
- [x] 1.2 Register the `/api/manifest` route in `worker/src/index.ts`
- [x] 1.3 Add duplicate-detection helper: query D1 `files` table by `download_url` to skip already-processed files
- [x] 1.4 Wire up GitHub Action trigger — if any PDF extraction requests are created, trigger `extract-pdfs.yml` with the run ID

## 2. Simplify Worker CBS Discovery

- [x] 2.1 Replace `worker/src/discovery/cbs-publications.ts` with a stub that logs "CBS publications: discovery handled by GitHub Action" and returns `[]`
- [x] 2.2 Replace `worker/src/discovery/cbs-media.ts` with a stub that logs "CBS media: discovery handled by GitHub Action" and returns `[]`

## 3. CBS Discovery GitHub Action

- [x] 3.1 Create `.github/workflows/discover-cbs.yml` with `schedule: cron '30 23 * * *'` and `workflow_dispatch` trigger for manual runs
- [x] 3.2 Implement the CBS publications discovery step — curl CBS SharePoint list API (publications GUID `71b30cd4-...`), parse JSON, extract FileRef/year/folder, enumerate DocLib files, build ManifestEntry array
- [x] 3.3 Implement the CBS media releases discovery step — curl CBS SharePoint list API (media GUID `db8f0177-...`), parse JSON, extract release info, enumerate DocLib files, build ManifestEntry array
- [x] 3.4 Implement state tracking — duplicate detection handled by Worker's `/api/manifest` endpoint (checks D1 `files` table by URL), no separate state file needed
- [x] 3.5 POST combined manifest entries to `$INGEST_WEBHOOK_URL/api/manifest` with Bearer auth

## 4. Testing & Deployment

- [x] 4.1 Write unit test for the `/api/manifest` endpoint with mocked D1/R2 — test auth, empty manifest, successful processing, duplicate detection
- [x] 4.2 Run TypeScript type check and existing test suite to verify no regressions
- [x] 4.3 Deploy updated Worker with `wrangler deploy`
- [x] 4.4 Test the `/api/manifest` endpoint manually with a sample CBS manifest entry via curl
- [ ] 4.5 Commit and push `discover-cbs.yml` to the repo, verify the workflow appears in GitHub Actions
- [ ] 4.6 Trigger `discover-cbs.yml` manually via `workflow_dispatch`, verify it discovers CBS files and posts to the Worker

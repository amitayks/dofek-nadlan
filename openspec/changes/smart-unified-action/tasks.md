## 1. Worker: Known URLs Endpoint

- [ ] 1.1 Create `worker/src/routes/known-urls.ts` — `GET /api/known-urls` handler that validates Bearer auth, reads `source` query params, queries D1 `files` table for matching `download_url` values, returns `{ urls, count }`
- [ ] 1.2 Register the `/api/known-urls` route in `worker/src/index.ts`
- [ ] 1.3 Update `worker/src/pipeline/trigger.ts` — change `workflowFile` from `'extract-pdfs.yml'` to `'pipeline.yml'`

## 2. Python CBS Discovery Module

- [ ] 2.1 Create `action/discover/__init__.py`
- [ ] 2.2 Create `action/discover/cbs_client.py` — CBS SharePoint REST API client with `list_doclib_folders()`, `list_folder_files()`, `get_page_items()`, `build_manifest_entry()`
- [ ] 2.3 Create `action/discover/main.py` — orchestrator: fetch known URLs → discover CBS media + publications → filter duplicates → post manifest to Worker in batches

## 3. Unified Workflow

- [ ] 3.1 Create `.github/workflows/pipeline.yml` — unified workflow with `discover`, `extract`, and `notify` jobs, scheduled cron + workflow_dispatch triggers
- [ ] 3.2 Delete `.github/workflows/discover-cbs.yml` — replaced by pipeline.yml

## 4. Testing & Deployment

- [ ] 4.1 Write unit test for the `/api/known-urls` endpoint with mocked D1
- [ ] 4.2 Run TypeScript type check and existing test suite to verify no regressions
- [ ] 4.3 Deploy updated Worker with `wrangler deploy`
- [ ] 4.4 Test `/api/known-urls` endpoint manually with curl
- [ ] 4.5 Commit and push all changes
- [ ] 4.6 Trigger `pipeline.yml` manually via `workflow_dispatch`, verify CBS discovery + manifest posting works

## Unified Pipeline Workflow

### File: `.github/workflows/pipeline.yml`

### Triggers
```yaml
on:
  schedule:
    - cron: '30 23 * * *'  # 23:30 UTC daily
  workflow_dispatch:
    inputs:
      run_id:
        description: 'Pipeline run ID (date string)'
        required: false
        type: string
      skip_discovery:
        description: 'Skip CBS discovery, only run PDF extraction'
        required: false
        type: boolean
        default: false
```

### Job 1: `discover`
- Runs unless `skip_discovery` is true
- Checkout, setup Python 3.12, pip install
- Run `python -m action.discover.main`
- Captures `new_files` count and `run_id` as outputs
- Env: `INGEST_WEBHOOK_URL`, `INGEST_AUTH_TOKEN`

### Job 2: `extract`
- Needs: `discover` (or runs independently if `skip_discovery`)
- Condition: extraction requests exist in R2 for the run_id
- Sub-job `discover-work`: lists R2 extraction requests, builds matrix
- Sub-job `extract-matrix`: matrix strategy over request IDs
  - Each job: download PDF → pdf2image → AI extract → validate → write result to R2
- Env: R2 creds, `ANTHRIPIC_API_KEY`

### Job 3: `notify`
- Needs: `extract`
- Condition: always runs after extract if there was work
- Posts extraction results webhook to Worker `/api/ingest`
- Env: R2 creds, `INGEST_WEBHOOK_URL`, `INGEST_AUTH_TOKEN`

### Secrets Required
- `INGEST_WEBHOOK_URL` — Worker URL
- `INGEST_AUTH_TOKEN` — Bearer token
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `ANTHRIPIC_API_KEY` — Anthropic API key for PDF extraction

## ADDED Requirements

### Requirement: Scheduled GitHub Action discovers CBS SharePoint publications
A GitHub Action workflow (`discover-cbs.yml`) SHALL run daily on a cron schedule and query the CBS SharePoint REST API for new publications and media releases.

#### Scenario: Daily scheduled run
- **WHEN** the cron trigger fires at 23:30 UTC
- **THEN** the Action SHALL query CBS publications list (GUID `71b30cd4-0261-4757-9482-a52c5a6da90a`) and CBS media releases list (GUID `db8f0177-370a-46ec-9ab9-041b54247975`) via SharePoint REST API

#### Scenario: New publications found
- **WHEN** the CBS SharePoint API returns publication items with associated files in DocLib folders
- **THEN** the Action SHALL construct ManifestEntry objects with source, url, filename, format, publication_id, publish_date, metadata, and is_new fields

#### Scenario: CBS API unreachable
- **WHEN** the CBS SharePoint API returns a non-200 response or non-JSON content
- **THEN** the Action SHALL log the error and exit with a non-zero code so the workflow shows as failed

### Requirement: Action posts manifest to Worker endpoint
After discovery, the Action SHALL POST all discovered manifest entries to the Worker's `/api/manifest` endpoint.

#### Scenario: Manifest posted successfully
- **WHEN** the Action discovers one or more new files
- **THEN** the Action SHALL send a single POST request to `INGEST_WEBHOOK_URL/api/manifest` with `Authorization: Bearer <INGEST_AUTH_TOKEN>` and body `{ "entries": [...] }`

#### Scenario: No new files discovered
- **WHEN** the CBS API returns items but none are newer than the last known state
- **THEN** the Action SHALL skip the POST request and exit successfully

### Requirement: Action tracks discovery state
The Action SHALL track the latest processed publication to avoid re-processing old items on subsequent runs.

#### Scenario: State persistence across runs
- **WHEN** the Action discovers and posts manifest entries
- **THEN** the Action SHALL store the latest publication folder/release key as a workflow artifact or in R2 so the next run can skip already-processed items

#### Scenario: First run with no prior state
- **WHEN** no previous state exists
- **THEN** the Action SHALL process the 20 most recent publications and 15 most recent media releases (matching the current Worker discovery limits)

### Requirement: Worker CBS discovery modules become no-ops
The Worker's `cbs-publications.ts` and `cbs-media.ts` discovery modules SHALL return empty manifests with a log message indicating that discovery is handled externally.

#### Scenario: Worker cron runs CBS publication discovery
- **WHEN** the Worker's daily cron triggers discovery for cbs-publications
- **THEN** the module SHALL log "CBS publications: discovery handled by GitHub Action" and return an empty ManifestEntry array

#### Scenario: Worker cron runs CBS media discovery
- **WHEN** the Worker's daily cron triggers discovery for cbs-media
- **THEN** the module SHALL log "CBS media: discovery handled by GitHub Action" and return an empty ManifestEntry array

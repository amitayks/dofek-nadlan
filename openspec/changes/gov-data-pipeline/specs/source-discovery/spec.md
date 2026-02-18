## ADDED Requirements

### Requirement: CBS Publications Discovery via SharePoint REST API
The system SHALL discover new publications from the CBS (Central Bureau of Statistics) SharePoint site by querying the SharePoint REST API for the publications list. It SHALL check both the `publications/Madad` and `mediarelease/Madad` document libraries. The API endpoints are:
- Publications: `/he/publications/Madad/_api/Web/Lists/Items?$filter=CbsPublishingFolderLevel1 eq '{year}'&$orderby=Created desc`
- Media releases: `/he/mediarelease/Madad/_api/Web/Lists/Items?$filter=Created gt '{last_check_date}'&$orderby=Created desc&$top=20`

For each publication page found, the system SHALL enumerate files in the associated DocLib folder using:
`/he/publications/Madad/_api/web/GetFolderByServerRelativeUrl('/he/publications/Madad/DocLib/{year}/{folder}')/Files?$expand=ListItemAllFields`

The `CbsPublishingFolderLevel1` field contains the year and `CbsPublishingFolderLevel2` contains the folder code (e.g., `price01aa`).

#### Scenario: New CBS publication discovered
- **WHEN** the SharePoint REST API returns a publication page with `CbsPublishingFolderLevel2=price01aa` and year `2026` that is not in the known state
- **THEN** the system SHALL add all files from that publication's DocLib folder to the manifest with source `cbs-publications`, and SHALL include file metadata (filename, size, format, CbsOrderField, Title, CbsEnglishTitle)

#### Scenario: No new CBS publications
- **WHEN** the SharePoint REST API returns only publications that already exist in known state
- **THEN** the manifest SHALL contain zero items for the `cbs-publications` source

#### Scenario: CBS API unreachable
- **WHEN** the CBS SharePoint REST API returns a non-200 status or times out after 30 seconds
- **THEN** the system SHALL log the error, mark the source as `error` in the pipeline run, and continue with other sources

### Requirement: CBS XML API Discovery
The system SHALL check the CBS public XML API at `https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false&lang=he` for updated index values. The API returns structured price index data including CPI, housing price indices, and other economic indicators with index codes (e.g., 120010 for CPI General, 110040 for CPI excluding housing).

#### Scenario: New index data available in XML API
- **WHEN** the XML API returns data with a period newer than the last stored period in KV
- **THEN** the system SHALL add a manifest entry with source `cbs-xml-api`, type `structured-data`, and include the raw XML content reference

#### Scenario: XML API data unchanged
- **WHEN** the XML API returns data with the same latest period as stored in KV
- **THEN** no manifest entry SHALL be created for `cbs-xml-api`

### Requirement: gov.il Dynamic Collector Discovery
The system SHALL discover new periodic reviews from the gov.il Ministry of Finance dynamic collector. The collection GUID is `3ed26e5e-41c1-4dbb-ac3f-b9b0f7b2c7b2`. The system SHALL filter by subject key `01` (Real Estate / נדל"ן). Pagination uses `skip` parameter in increments of 10.

The file download URL pattern is:
`https://www.gov.il/BlobFolder/dynamiccollectorresultitem/{item.UrlName}/he/{file.FileName}`

The system SHALL hit the backing API directly rather than rendering the AngularJS page.

#### Scenario: New real estate review published
- **WHEN** the dynamic collector returns an item with `publish_date` newer than the last known date in KV and subject containing key `01`
- **THEN** the system SHALL construct the PDF download URL from `UrlName` and `FileName` fields and add it to the manifest with source `gov-il-reviews`

#### Scenario: Multiple pages of new results
- **WHEN** the first page (skip=0) returns items and all 10 are newer than last known date
- **THEN** the system SHALL paginate (skip=10, skip=20, etc.) until it finds items already known or reaches an empty page

### Requirement: CBS Media Release File Discovery
The system SHALL discover files attached to CBS media releases (press releases). Files follow the naming pattern `10_{YY}_{NNN}{suffix}.{ext}` where:
- `10` = subject code (Price Statistics)
- `{YY}` = two-digit year
- `{NNN}` = three-digit sequential release number
- `{suffix}` = document type: `b` (body), `t1`-`t4` (tables), `e` (English), `y` (appendix)
- `{ext}` = `pdf`, `docx`, or `xls`

Press release pages follow the URL pattern:
`/he/mediarelease/Madad/Pages/{YEAR}/{Hebrew-title-slug}.aspx`

#### Scenario: New housing price press release
- **WHEN** the media releases API returns a new page with title matching housing price patterns (e.g., containing "שינוי-במחירי-שוק-הדירות" or "מדדי-המחירים-לצרכן")
- **THEN** the system SHALL enumerate all files in the release's DocLib folder `/he/mediarelease/Madad/DocLib/{year}/{release_number}/` and add each to the manifest

### Requirement: Manifest Output Format
The discovery module SHALL output a manifest as a JSON array. Each entry SHALL contain: `source` (string), `url` (string), `filename` (string), `format` (string: xlsx/xls/docx/doc/pdf/zip/xml), `publication_id` (string), `publish_date` (ISO 8601 string), `metadata` (object with source-specific fields), and `is_new` (boolean).

#### Scenario: Manifest combines all sources
- **WHEN** discovery runs for all sources
- **THEN** the manifest SHALL contain entries from all sources that responded successfully, with `is_new=true` for items not in known state and `is_new=false` for items already processed

### Requirement: Known State via KV
The system SHALL store last-known-state per source in Cloudflare KV. Keys:
- `discovery:cbs-publications:last_check` — ISO timestamp of last successful check
- `discovery:cbs-publications:latest_folder` — latest folder code seen (e.g., `2026/price01aa`)
- `discovery:cbs-xml-api:latest_period` — latest data period from XML API
- `discovery:cbs-media:latest_release` — latest release number seen
- `discovery:gov-il:latest_publish_date` — latest publish date from dynamic collector

#### Scenario: First run with empty KV
- **WHEN** KV has no entries for a source
- **THEN** the system SHALL discover publications from the current year only (not historical backfill)

#### Scenario: KV updated after successful discovery
- **WHEN** discovery completes successfully for a source
- **THEN** the system SHALL update the corresponding KV keys with the latest values found

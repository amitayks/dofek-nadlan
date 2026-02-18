## ADDED Requirements

### Requirement: Download Files from Manifest
The system SHALL download all files marked as `is_new=true` in the manifest. Downloads SHALL use direct HTTP GET requests to the URLs provided in the manifest. The system SHALL handle all formats: XLSX, XLS, DOCX, DOC, PDF, ZIP, and XML.

#### Scenario: Successful file download
- **WHEN** a manifest entry has `is_new=true` and the URL returns HTTP 200
- **THEN** the system SHALL download the complete file, verify it is non-empty (>0 bytes), and store it to R2 at the archive path

#### Scenario: Download failure with retry
- **WHEN** a download attempt fails (network error, HTTP 5xx, or timeout)
- **THEN** the system SHALL retry up to 3 times with exponential backoff (1s, 4s, 16s) before marking the file as `download_failed`

#### Scenario: Zero-byte or corrupt file
- **WHEN** a downloaded file is 0 bytes or the HTTP response indicates an error page (HTML content-type for a .pdf URL)
- **THEN** the system SHALL reject the file, log a warning, and mark it as `download_invalid`

### Requirement: Rate Limiting
The system SHALL rate-limit downloads to be respectful of government servers. There SHALL be a minimum delay of 500ms between consecutive requests to the same domain.

#### Scenario: Multiple files from CBS
- **WHEN** the manifest contains 25 files from cbs.gov.il
- **THEN** the system SHALL space downloads at least 500ms apart, resulting in a minimum total time of ~12.5 seconds for all downloads

### Requirement: Download Priority by Format
The system SHALL tag each downloaded file with `is_preferred_format` based on extraction ease:
1. XLSX/XLS — `is_preferred_format=true` (structured, directly parseable)
2. DOCX — `is_preferred_format=true` if no XLSX equivalent exists for the same table
3. PDF — `is_preferred_format=true` only if no XLSX or DOCX equivalent exists
4. ZIP — SHALL be extracted, and contained files tagged individually
5. DOC — `is_preferred_format=true` only if no other format exists for the same table

The system SHALL still download ALL formats regardless of preference (for archive purposes).

#### Scenario: Publication has both XLSX and PDF for same table
- **WHEN** table `aa2_1` is available as both `aa2_1_h.xlsx` and `aa2_1_h.pdf`
- **THEN** both SHALL be downloaded and archived, but only the XLSX SHALL have `is_preferred_format=true`

### Requirement: R2 Archive Path Convention
Files SHALL be stored in R2 with paths following this convention:
- CBS publications: `raw-files/cbs/publications/{year}/{folder}/{filename}`
- CBS media releases: `raw-files/cbs/media-releases/{year}/{release_number}/{filename}`
- CBS API snapshots: `raw-files/cbs/api-snapshots/{date}_price_selected.xml`
- gov.il reviews: `raw-files/gov-il/reviews/{slug}/{filename}`

#### Scenario: File archived to R2
- **WHEN** a file is successfully downloaded
- **THEN** it SHALL be uploaded to R2 at the convention path, with custom metadata including `source`, `publication_id`, `original_url`, `download_date`, and `checksum` (SHA-256)

### Requirement: ZIP File Handling
The system SHALL extract ZIP archives after download and treat each contained file as an individual file entry. The CBS `housing.zip` bundle contains all table files.

#### Scenario: ZIP file downloaded
- **WHEN** a ZIP file (e.g., `housing.zip`) is downloaded
- **THEN** the system SHALL extract all files, archive each individually to R2 under the same publication path, and create separate file records for each

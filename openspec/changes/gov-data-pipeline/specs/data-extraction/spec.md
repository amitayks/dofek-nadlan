## ADDED Requirements

### Requirement: Extraction Router
The system SHALL route each downloaded file to the appropriate extraction strategy based on file format and source:
- XLSX/XLS files → XLSX Parser
- DOCX files → DOCX Parser
- CBS XML API data → XML Parser
- PDF files → Creates an extraction request for the PDF Extraction service (GitHub Action)

The router SHALL only process files where `is_preferred_format=true` for immediate extraction. All other files are archived but not extracted inline.

#### Scenario: XLSX file from CBS publication
- **WHEN** a downloaded file has format `xlsx` and `is_preferred_format=true`
- **THEN** the system SHALL route it to the XLSX Parser strategy

#### Scenario: PDF file requiring external extraction
- **WHEN** a downloaded file has format `pdf` and `is_preferred_format=true`
- **THEN** the system SHALL create an extraction request JSON in R2 at `pipeline/extraction-requests/req-{id}.json` instead of processing inline

### Requirement: XLSX Parser for CBS Housing Data
The system SHALL parse CBS housing publication XLSX files using the SheetJS (xlsx) library. Each table type has a known structure:

**Table 2.1 (aa2_1_h.xlsx)** — Housing Price Index:
- Rows: time periods (bimonthly, e.g., "נובמבר-דצמבר 2025")
- Columns: index values for different base years, monthly percent change
- Output schema: `{period, index_value, base_year, pct_change_monthly, pct_change_annual}`

**Table 2.2 (aa2_2_h.xlsx)** — Average Apartment Prices:
- Rows grouped by district, then by city, then by room count
- Values: average price in NIS thousands
- Output schema: `{period, district, city, rooms, avg_price_nis_thousands}`

**Table 2.3 (aa2_3_h.xlsx)** — Housing Price Index by District:
- Rows: time periods
- Columns: districts (Jerusalem, North, Haifa, Center, Tel Aviv, South)
- Output schema: `{period, district, index_value, base_year, pct_change}`

**Table 2.4 (aa2_4_h.xlsx)** — New Housing Price Index:
- Similar structure to 2.1 but for new dwellings only
- Output schema: `{period, index_value, base_year, pct_change}`

#### Scenario: Parse Table 2.2 average prices
- **WHEN** file `aa2_2_h.xlsx` is processed by the XLSX parser
- **THEN** the system SHALL extract rows for each district/city/room-count combination with their average price values, outputting valid JSON records matching the `avg_apartment_prices` schema

#### Scenario: Unknown XLSX structure
- **WHEN** an XLSX file does not match any known table template (unrecognized filename pattern)
- **THEN** the system SHALL log a warning, store the raw file metadata, and skip extraction without failing the pipeline

### Requirement: XLSX Parser for CBS Consumer Price Index
The system SHALL parse CPI-related XLSX files from the `price{NN}a` publication folders. Key tables:
- Section A tables (a*_h.xlsx): CPI values, weights, sub-indices
- Section G tables (g*_h.xlsx): detailed price statistics

Output schema for CPI: `{period, index_code, index_name, index_value, base_year, pct_change_monthly, pct_change_annual}`

#### Scenario: Parse CPI table
- **WHEN** a file matching pattern `a{chapter}_{table}_h.xlsx` from a `price{NN}a` folder is processed
- **THEN** the system SHALL extract index values with their codes and period information

### Requirement: CBS XML API Parser
The system SHALL parse the CBS XML API response. The XML contains index entries with:
- Index code (e.g., 120010)
- Index name (Hebrew and English)
- Monthly percent change
- Index values for multiple base years (2024, 2022, 2020, 2018, 2016, 2014, 2012, 2010, 2008, 2006, 2002, 2000, 1998, 1993, 1987, 1985, 1980, 1976, 1969, 1964, 1959, 1951)
- Chaining coefficients

Output schema: `{index_code, index_name_he, index_name_en, period, value, base_year, pct_change_monthly}`

#### Scenario: Parse XML API response with multiple indices
- **WHEN** the XML API returns data for 15 different index codes
- **THEN** the system SHALL create one record per index-code per base-year combination, resulting in multiple records per index

### Requirement: DOCX Parser
The system SHALL extract tables and text from DOCX files. DOCX files are ZIP archives containing XML. The system SHALL use a library (e.g., mammoth) to:
1. Extract embedded tables as structured data (same schemas as XLSX equivalents)
2. Extract body text as plain text for narrative content

#### Scenario: DOCX press release with embedded table
- **WHEN** a DOCX press release file (e.g., `10_26_017b.docx`) contains tables
- **THEN** the system SHALL extract both the narrative text and any embedded tables as structured data

### Requirement: Extraction Request Format for PDF Service
When a PDF requires extraction, the system SHALL write an extraction request to R2 at path `pipeline/extraction-requests/req-{request_id}.json` with this structure:
```json
{
  "request_id": "req-{run_date}-{sequence}",
  "run_id": "{YYYY-MM-DD}",
  "source": "cbs|gov-il",
  "publication_id": "{publication identifier}",
  "file": {
    "r2_key": "raw-files/{path to file in R2}",
    "original_url": "{source URL}",
    "format": "pdf",
    "expected_content": "{table type or content description}"
  },
  "extraction_schema": {
    "type": "{schema type name}",
    "fields": ["field1", "field2", ...]
  },
  "created_at": "{ISO 8601 timestamp}"
}
```

#### Scenario: PDF extraction request created
- **WHEN** a PDF file needs extraction and no XLSX/DOCX equivalent exists
- **THEN** the system SHALL write the request JSON to R2 and record the `request_id` in D1 with status `pending_extraction`

### Requirement: Extraction Output Validation
All extraction output SHALL be validated against the expected schema before being passed to storage. Validation SHALL check:
- Required fields are present and non-null
- Numeric fields contain valid numbers
- Period strings match expected date formats
- District/city names match known values (when applicable)

#### Scenario: Extraction produces invalid data
- **WHEN** an extracted record has missing required fields or invalid types
- **THEN** the system SHALL reject that record, log the validation error, and continue processing other records from the same file

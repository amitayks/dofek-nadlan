-- Sources: configuration for each data source
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- cbs-publications, cbs-media, cbs-xml-api, gov-il-reviews
  base_url TEXT,
  check_config TEXT, -- JSON: API endpoints, filters, pagination config
  is_active INTEGER DEFAULT 1
);

-- Publications: each discovered publication/release
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  title TEXT,
  title_en TEXT,
  publish_date TEXT, -- ISO 8601
  period_start TEXT,
  period_end TEXT,
  discovery_url TEXT,
  raw_metadata TEXT, -- JSON
  status TEXT DEFAULT 'discovered', -- discovered, downloading, downloaded, extracting, extracted, failed
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_publications_source ON publications(source_id);
CREATE INDEX IF NOT EXISTS idx_publications_date ON publications(publish_date);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status);

-- Files: each file associated with a publication
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  filename TEXT NOT NULL,
  format TEXT NOT NULL, -- xlsx, xls, docx, doc, pdf, zip, xml
  download_url TEXT,
  r2_key TEXT, -- path in R2
  file_size_bytes INTEGER,
  checksum_sha256 TEXT,
  is_preferred_format INTEGER DEFAULT 0,
  extraction_status TEXT DEFAULT 'pending', -- pending, extracted, failed, not_needed, pending_extraction
  extraction_request_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_publication ON files(publication_id);
CREATE INDEX IF NOT EXISTS idx_files_extraction ON files(extraction_status);
CREATE INDEX IF NOT EXISTS idx_files_download_url ON files(download_url);

-- Housing price index values
CREATE TABLE IF NOT EXISTS housing_price_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  file_id TEXT REFERENCES files(id),
  period TEXT NOT NULL, -- e.g., "2025-11/2025-12"
  district TEXT, -- NULL for national
  index_value REAL NOT NULL,
  base_year INTEGER NOT NULL,
  pct_change_monthly REAL,
  pct_change_annual REAL,
  is_new_dwellings INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hpi_period ON housing_price_index(period);
CREATE INDEX IF NOT EXISTS idx_hpi_district ON housing_price_index(district);

-- Average apartment prices by location
CREATE TABLE IF NOT EXISTS avg_apartment_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  file_id TEXT REFERENCES files(id),
  period TEXT NOT NULL,
  district TEXT NOT NULL,
  city TEXT,
  rooms TEXT, -- e.g., "3", "4", "5+"
  avg_price_nis_thousands REAL NOT NULL,
  sample_size INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aap_period ON avg_apartment_prices(period);
CREATE INDEX IF NOT EXISTS idx_aap_district ON avg_apartment_prices(district);
CREATE INDEX IF NOT EXISTS idx_aap_city ON avg_apartment_prices(city);

-- Consumer price index data
CREATE TABLE IF NOT EXISTS consumer_price_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  file_id TEXT REFERENCES files(id),
  period TEXT NOT NULL,
  index_code TEXT NOT NULL, -- e.g., "120010"
  index_name_he TEXT,
  index_name_en TEXT,
  index_value REAL NOT NULL,
  base_year INTEGER NOT NULL,
  pct_change_monthly REAL,
  pct_change_annual REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cpi_period ON consumer_price_index(period);
CREATE INDEX IF NOT EXISTS idx_cpi_code ON consumer_price_index(index_code);

-- Review insights from gov.il PDFs
CREATE TABLE IF NOT EXISTS review_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  file_id TEXT REFERENCES files(id),
  topic TEXT,
  key_figures TEXT, -- JSON array of {label, value, unit}
  summary TEXT,
  extracted_text TEXT,
  confidence REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pipeline run tracking
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY, -- date-based: "2026-02-17"
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT DEFAULT 'running', -- running, completed, partial, failed
  sources_checked INTEGER DEFAULT 0,
  files_discovered INTEGER DEFAULT 0,
  files_downloaded INTEGER DEFAULT 0,
  files_extracted INTEGER DEFAULT 0,
  pdf_requests_created INTEGER DEFAULT 0,
  pdf_results_processed INTEGER DEFAULT 0,
  errors TEXT, -- JSON array of error objects
  created_at TEXT DEFAULT (datetime('now'))
);

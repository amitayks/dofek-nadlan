// Cloudflare Worker environment bindings
export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  STATE: KVNamespace;
  GH_TOKEN: string;
  INGEST_AUTH_TOKEN: string;
  ANTHRIPIC_API_KEY: string;
}

// Discovery manifest entry — what was found during discovery
export interface ManifestEntry {
  source: 'cbs-publications' | 'cbs-media' | 'cbs-xml-api' | 'gov-il-reviews';
  url: string;
  filename: string;
  format: 'xlsx' | 'xls' | 'docx' | 'doc' | 'pdf' | 'zip' | 'xml';
  publication_id: string;
  publish_date: string; // ISO 8601
  metadata: Record<string, unknown>;
  is_new: boolean;
}

// Downloaded file ready for archiving
export interface DownloadedFile {
  manifest_entry: ManifestEntry;
  data: ArrayBuffer;
  file_size_bytes: number;
  checksum_sha256: string;
  is_preferred_format: boolean;
}

// File record for D1
export interface FileRecord {
  id: string;
  publication_id: string;
  filename: string;
  format: string;
  download_url: string;
  r2_key: string;
  file_size_bytes: number;
  checksum_sha256: string;
  is_preferred_format: boolean;
  extraction_status: 'pending' | 'extracted' | 'failed' | 'not_needed' | 'pending_extraction';
  extraction_request_id?: string;
}

// Publication record for D1
export interface PublicationRecord {
  id: string;
  source_id: string;
  title?: string;
  title_en?: string;
  publish_date?: string;
  period_start?: string;
  period_end?: string;
  discovery_url?: string;
  raw_metadata?: string; // JSON string
  status: 'discovered' | 'downloading' | 'downloaded' | 'extracting' | 'extracted' | 'failed';
}

// Extraction request — written to R2 for GitHub Action
export interface ExtractionRequest {
  request_id: string;
  run_id: string;
  source: string;
  publication_id: string;
  file: {
    r2_key: string;
    original_url: string;
    format: string;
    expected_content: string;
  };
  extraction_schema: {
    type: string;
    fields: string[];
  };
  created_at: string;
}

// Extraction result — written to R2 by GitHub Action
export interface ExtractionResult {
  request_id: string;
  status: 'success' | 'extraction_failed' | 'partial';
  data: Record<string, unknown>[];
  confidence: number;
  extraction_method: string;
  pages_processed?: number;
  processed_at: string;
}

// Ingest webhook payload from GitHub Action
export interface IngestPayload {
  event: 'extraction_complete';
  run_id: string;
  results: string[]; // request IDs
  stats: {
    total: number;
    success: number;
    failed: number;
  };
}

// Pipeline run record for D1
export interface PipelineRun {
  id: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  sources_checked: number;
  files_discovered: number;
  files_downloaded: number;
  files_extracted: number;
  pdf_requests_created: number;
  pdf_results_processed: number;
  errors: PipelineError[];
}

export interface PipelineError {
  phase: string;
  source?: string;
  file?: string;
  error_message: string;
  timestamp: string;
}

// KV discovery state per source
export interface DiscoveryState {
  last_check: string; // ISO timestamp
  latest_folder?: string;
  latest_period?: string;
  latest_release?: string;
  latest_publish_date?: string;
}

// Extracted data types for D1 insertion

export interface HousingPriceIndexRow {
  publication_id: string;
  file_id: string;
  period: string;
  district?: string;
  index_value: number;
  base_year: number;
  pct_change_monthly?: number;
  pct_change_annual?: number;
  is_new_dwellings: boolean;
}

export interface AvgApartmentPriceRow {
  publication_id: string;
  file_id: string;
  period: string;
  district: string;
  city?: string;
  rooms?: string;
  avg_price_nis_thousands: number;
  sample_size?: number;
}

export interface ConsumerPriceIndexRow {
  publication_id: string;
  file_id: string;
  period: string;
  index_code: string;
  index_name_he?: string;
  index_name_en?: string;
  index_value: number;
  base_year: number;
  pct_change_monthly?: number;
  pct_change_annual?: number;
}

export interface ReviewInsightRow {
  publication_id: string;
  file_id: string;
  topic?: string;
  key_figures?: string; // JSON
  summary?: string;
  extracted_text?: string;
  confidence?: number;
}

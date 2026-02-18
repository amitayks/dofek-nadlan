import type { FileRecord, ExtractionRequest } from '../types';
import { writeJson } from '../storage/r2';
import { updateFileExtractionStatus } from '../storage/d1';

// Map filename patterns to expected content types and extraction schemas
function inferExtractionSchema(
  file: FileRecord
): { expected_content: string; schema: ExtractionRequest['extraction_schema'] } {
  const name = file.filename.toLowerCase();

  // Housing price index tables
  if (name.match(/aa2_1/)) {
    return {
      expected_content: 'Housing Price Index (national)',
      schema: {
        type: 'housing_price_index',
        fields: ['period', 'index_value', 'base_year', 'pct_change_monthly', 'pct_change_annual'],
      },
    };
  }
  if (name.match(/aa2_2/)) {
    return {
      expected_content: 'Average Apartment Prices by district, city, and rooms',
      schema: {
        type: 'avg_apartment_prices',
        fields: ['period', 'district', 'city', 'rooms', 'avg_price_nis_thousands'],
      },
    };
  }
  if (name.match(/aa2_3/)) {
    return {
      expected_content: 'Housing Price Index by District',
      schema: {
        type: 'housing_price_index',
        fields: ['period', 'district', 'index_value', 'base_year', 'pct_change'],
      },
    };
  }
  if (name.match(/aa2_4/)) {
    return {
      expected_content: 'New Housing Price Index',
      schema: {
        type: 'housing_price_index',
        fields: ['period', 'index_value', 'base_year', 'pct_change_monthly'],
      },
    };
  }

  // Media release press body
  if (name.match(/10_\d{2}_\d{3}b\./)) {
    return {
      expected_content: 'Press release body text with key statistics',
      schema: {
        type: 'review_insights',
        fields: ['topic', 'key_figures', 'summary'],
      },
    };
  }

  // gov.il review PDFs
  if (file.publication_id.startsWith('gov-il')) {
    return {
      expected_content: 'Real estate periodic review with market analysis and statistics',
      schema: {
        type: 'review_insights',
        fields: ['topic', 'key_figures', 'summary', 'extracted_text'],
      },
    };
  }

  // Fallback
  return {
    expected_content: 'Government statistical data table',
    schema: {
      type: 'review_insights',
      fields: ['topic', 'key_figures', 'summary', 'extracted_text'],
    },
  };
}

let requestSequence = 0;

export async function createPdfExtractionRequest(
  bucket: R2Bucket,
  db: D1Database,
  file: FileRecord,
  runId: string
): Promise<string> {
  requestSequence++;
  const requestId = `req-${runId}-${String(requestSequence).padStart(3, '0')}`;

  const { expected_content, schema } = inferExtractionSchema(file);

  const request: ExtractionRequest = {
    request_id: requestId,
    run_id: runId,
    source: file.publication_id.startsWith('gov-il') ? 'gov-il' : 'cbs',
    publication_id: file.publication_id,
    file: {
      r2_key: file.r2_key,
      original_url: file.download_url,
      format: 'pdf',
      expected_content,
    },
    extraction_schema: schema,
    created_at: new Date().toISOString(),
  };

  // Write request to R2
  await writeJson(bucket, `pipeline/extraction-requests/${requestId}.json`, request);

  // Update file record in D1
  await updateFileExtractionStatus(db, file.id, 'pending_extraction', requestId);

  console.log(`Created PDF extraction request ${requestId} for ${file.filename}`);
  return requestId;
}

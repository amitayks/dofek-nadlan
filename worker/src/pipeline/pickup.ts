import type { Env, ExtractionResult, PipelineError } from '../types';
import { listFiles, readJson, deleteFile } from '../storage/r2';
import {
  updateFileExtractionStatus,
  getFilesByExtractionStatus,
  insertHousingPriceIndex,
  insertAvgApartmentPrices,
  insertConsumerPriceIndex,
  insertReviewInsights,
} from '../storage/d1';

interface PickupResult {
  processed: number;
  errors: PipelineError[];
}

export async function pickupUnprocessedResults(env: Env): Promise<PickupResult> {
  const errors: PipelineError[] = [];
  let processed = 0;

  // List all result files in R2
  const resultObjects = await listFiles(env.STORAGE, 'pipeline/extracted/');
  if (resultObjects.length === 0) {
    return { processed: 0, errors: [] };
  }

  console.log(`Pickup: Found ${resultObjects.length} extraction results to process`);

  // Get files that are waiting for extraction
  const pendingFiles = await getFilesByExtractionStatus(env.DB, 'pending_extraction');
  const pendingByRequestId = new Map(
    pendingFiles
      .filter((f) => f.extraction_request_id)
      .map((f) => [f.extraction_request_id!, f])
  );

  for (const obj of resultObjects) {
    try {
      const result = await readJson<ExtractionResult>(env.STORAGE, obj.key);
      if (!result) continue;

      const file = pendingByRequestId.get(result.request_id);

      if (result.status === 'success' || result.status === 'partial') {
        // Insert extracted data based on the data type
        await processExtractionData(env.DB, result);

        if (file) {
          await updateFileExtractionStatus(env.DB, file.id, 'extracted');
        }
      } else {
        // Extraction failed
        if (file) {
          await updateFileExtractionStatus(env.DB, file.id, 'failed');
        }
        console.warn(`Extraction failed for ${result.request_id}: ${result.status}`);
      }

      // Clean up the result file and corresponding request file
      await deleteFile(env.STORAGE, obj.key);
      const requestKey = obj.key.replace('extracted/', 'extraction-requests/').replace('-result', '');
      await deleteFile(env.STORAGE, requestKey).catch(() => {});

      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({
        phase: 'pickup',
        file: obj.key,
        error_message: errMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  console.log(`Pickup: Processed ${processed} results`);
  return { processed, errors };
}

async function processExtractionData(
  db: D1Database,
  result: ExtractionResult
): Promise<void> {
  if (!result.data || result.data.length === 0) return;

  // Determine data type from the first record or from the result metadata
  const sample = result.data[0];

  if ('index_value' in sample && 'district' in sample) {
    await insertHousingPriceIndex(
      db,
      result.data as unknown as Parameters<typeof insertHousingPriceIndex>[1]
    );
  } else if ('avg_price_nis_thousands' in sample) {
    await insertAvgApartmentPrices(
      db,
      result.data as unknown as Parameters<typeof insertAvgApartmentPrices>[1]
    );
  } else if ('index_code' in sample) {
    await insertConsumerPriceIndex(
      db,
      result.data as unknown as Parameters<typeof insertConsumerPriceIndex>[1]
    );
  } else if ('summary' in sample || 'key_figures' in sample || 'extracted_text' in sample) {
    await insertReviewInsights(
      db,
      result.data as unknown as Parameters<typeof insertReviewInsights>[1]
    );
  } else {
    console.warn(`Unknown data type in extraction result ${result.request_id}`);
  }
}

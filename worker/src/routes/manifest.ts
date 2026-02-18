import type { Env, ManifestEntry, PipelineError } from '../types';
import { getFileByDownloadUrl, insertHousingPriceIndex, insertAvgApartmentPrices, insertConsumerPriceIndex, insertReviewInsights, updateFileExtractionStatus } from '../storage/d1';
import { downloadFiles } from '../download/downloader';
import { archiveFiles } from '../download/archive';
import { extractFiles } from '../extraction/router';
import { triggerGitHubAction } from '../pipeline/trigger';

interface ManifestPayload {
  entries: ManifestEntry[];
}

export async function handleManifest(request: Request, env: Env): Promise<Response> {
  // Validate auth
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.INGEST_AUTH_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const payload = (await request.json()) as ManifestPayload;
    const entries = payload.entries ?? [];

    if (entries.length === 0) {
      return Response.json({ processed: 0, errors: 0, pdf_requests: 0 });
    }

    // Filter out duplicates — skip entries whose URL is already in D1
    const newEntries: ManifestEntry[] = [];
    for (const entry of entries) {
      const existing = await getFileByDownloadUrl(env.DB, entry.url);
      if (existing) {
        console.log(`Manifest: skipping duplicate ${entry.url}`);
      } else {
        newEntries.push(entry);
      }
    }

    if (newEntries.length === 0) {
      console.log('Manifest: all entries already processed');
      return Response.json({ processed: 0, errors: 0, pdf_requests: 0 });
    }

    const errors: PipelineError[] = [];
    const runId = new Date().toISOString().slice(0, 10);

    // Phase 1: Download
    console.log(`Manifest: downloading ${newEntries.length} files...`);
    const downloadResult = await downloadFiles(newEntries);
    errors.push(...downloadResult.errors);

    // Phase 2: Archive to R2 + create D1 records
    console.log(`Manifest: archiving ${downloadResult.files.length} files...`);
    const archiveResult = await archiveFiles(env.STORAGE, env.DB, downloadResult.files);
    errors.push(...archiveResult.errors);

    // Phase 3: Extract inline (XLSX, DOCX)
    console.log(`Manifest: extracting data...`);
    const extractionResult = await extractFiles(
      env.STORAGE,
      env.DB,
      archiveResult.fileRecords,
      runId
    );
    errors.push(...extractionResult.errors);

    // Store extracted data
    let filesExtracted = 0;
    for (const item of extractionResult.extracted) {
      for (const output of item.outputs) {
        try {
          switch (output.type) {
            case 'housing_price_index':
              await insertHousingPriceIndex(env.DB, output.data as any);
              break;
            case 'avg_apartment_prices':
              await insertAvgApartmentPrices(env.DB, output.data as any);
              break;
            case 'consumer_price_index':
              await insertConsumerPriceIndex(env.DB, output.data as any);
              break;
            case 'review_insights':
              await insertReviewInsights(env.DB, output.data as any);
              break;
          }
          await updateFileExtractionStatus(env.DB, item.fileId, 'extracted');
          filesExtracted++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push({
            phase: 'store',
            file: item.fileId,
            error_message: errMsg,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Phase 4: Trigger GitHub Action if PDFs need extraction
    let pdfRequests = extractionResult.pdfRequestsCreated;
    if (pdfRequests > 0) {
      console.log(`Manifest: triggering GitHub Action for ${pdfRequests} PDFs...`);
      const triggerResult = await triggerGitHubAction(env.GH_TOKEN, runId);
      if (triggerResult.error) {
        errors.push(triggerResult.error);
      }
    }

    console.log(
      `Manifest: processed=${filesExtracted}, errors=${errors.length}, pdf_requests=${pdfRequests}`
    );

    return Response.json({
      processed: filesExtracted,
      errors: errors.length,
      pdf_requests: pdfRequests,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Manifest handler error:', errMsg);
    return Response.json({ error: errMsg }, { status: 500 });
  }
}

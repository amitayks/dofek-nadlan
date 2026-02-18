import type { Env, PipelineRun, PipelineError } from '../types';
import { createPipelineRun, updatePipelineRun, insertHousingPriceIndex, insertAvgApartmentPrices, insertConsumerPriceIndex, updateFileExtractionStatus } from '../storage/d1';
import { setLastRun, setLastSuccessfulRun } from '../storage/kv';
import { pickupUnprocessedResults } from './pickup';
import { runDiscovery } from './discover';
import { downloadFiles } from '../download/downloader';
import { archiveFiles } from '../download/archive';
import { extractFiles } from '../extraction/router';
import { triggerGitHubAction } from './trigger';

export async function runPipeline(env: Env): Promise<PipelineRun> {
  const runId = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const errors: PipelineError[] = [];

  const run: PipelineRun = {
    id: runId,
    started_at: new Date().toISOString(),
    status: 'running',
    sources_checked: 0,
    files_discovered: 0,
    files_downloaded: 0,
    files_extracted: 0,
    pdf_requests_created: 0,
    pdf_results_processed: 0,
    errors: [],
  };

  await createPipelineRun(env.DB, run);
  await setLastRun(env.STATE, run.started_at);

  try {
    // Phase 0: Pickup unprocessed results from previous runs
    console.log('Phase 0: Picking up unprocessed extraction results...');
    const pickupResult = await pickupUnprocessedResults(env);
    run.pdf_results_processed = pickupResult.processed;
    errors.push(...pickupResult.errors);

    // Phase 1: Discovery
    console.log('Phase 1: Running discovery...');
    const discoveryResult = await runDiscovery(env.STATE);
    run.sources_checked = discoveryResult.sourcesChecked;
    run.files_discovered = discoveryResult.manifest.length;
    errors.push(...discoveryResult.errors);

    await updatePipelineRun(env.DB, runId, {
      sources_checked: run.sources_checked,
      files_discovered: run.files_discovered,
    });

    if (discoveryResult.manifest.length === 0) {
      console.log('No new files discovered. Pipeline complete.');
      run.status = errors.length > 0 ? 'partial' : 'completed';
      run.finished_at = new Date().toISOString();
      run.errors = errors;
      await updatePipelineRun(env.DB, runId, run);
      if (run.status === 'completed') await setLastSuccessfulRun(env.STATE, run.finished_at);
      return run;
    }

    // Phase 2: Download
    console.log('Phase 2: Downloading files...');
    const downloadResult = await downloadFiles(discoveryResult.manifest);
    run.files_downloaded = downloadResult.files.length;
    errors.push(...downloadResult.errors);

    // Archive to R2 and create D1 records
    console.log('Phase 2b: Archiving files to R2...');
    const archiveResult = await archiveFiles(env.STORAGE, env.DB, downloadResult.files);
    errors.push(...archiveResult.errors);

    await updatePipelineRun(env.DB, runId, {
      files_downloaded: run.files_downloaded,
    });

    // Phase 3: Extract inline (XLSX, XML API)
    console.log('Phase 3: Extracting data from files...');
    const extractionResult = await extractFiles(
      env.STORAGE,
      env.DB,
      archiveResult.fileRecords,
      runId
    );
    run.pdf_requests_created = extractionResult.pdfRequestsCreated;
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
    run.files_extracted = filesExtracted;

    await updatePipelineRun(env.DB, runId, {
      files_extracted: run.files_extracted,
      pdf_requests_created: run.pdf_requests_created,
    });

    // Phase 4: Trigger GitHub Action for PDF extraction
    if (extractionResult.pdfRequestsCreated > 0) {
      console.log(`Phase 4: Triggering GitHub Action for ${extractionResult.pdfRequestsCreated} PDFs...`);
      const triggerResult = await triggerGitHubAction(env.GH_TOKEN, runId);
      if (triggerResult.error) {
        errors.push(triggerResult.error);
      }
    } else {
      console.log('Phase 4: No PDF extraction needed, skipping.');
    }

    // Phase 5: Finalize
    console.log('Phase 5: Finalizing pipeline run...');
    run.status = errors.length > 0 ? 'partial' : 'completed';
    run.finished_at = new Date().toISOString();
    run.errors = errors;

    await updatePipelineRun(env.DB, runId, run);
    if (run.status === 'completed') {
      await setLastSuccessfulRun(env.STATE, run.finished_at);
    }

    console.log(`Pipeline ${runId} finished: ${run.status}`);
    return run;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Pipeline failed:', errMsg);
    errors.push({
      phase: 'orchestrator',
      error_message: errMsg,
      timestamp: new Date().toISOString(),
    });
    run.status = 'failed';
    run.finished_at = new Date().toISOString();
    run.errors = errors;
    await updatePipelineRun(env.DB, runId, run);
    return run;
  }
}

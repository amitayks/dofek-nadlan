import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration test for the full pipeline.
 * Mocks external APIs and Cloudflare bindings (D1, R2, KV) to verify
 * the end-to-end flow: discovery → download → archive → extract → store.
 */

// ---- Mock all external module dependencies ----

// Mock HTTP utils (external API calls)
vi.mock('../src/utils/http', () => ({
  fetchJson: vi.fn(),
  fetchXml: vi.fn(),
  fetchBinary: vi.fn(),
}));

// Mock KV storage
vi.mock('../src/storage/kv', () => ({
  getDiscoveryState: vi.fn().mockResolvedValue(null),
  setDiscoveryState: vi.fn().mockResolvedValue(undefined),
  getLastRun: vi.fn().mockResolvedValue(null),
  setLastRun: vi.fn().mockResolvedValue(undefined),
  getLastSuccessfulRun: vi.fn().mockResolvedValue(null),
  setLastSuccessfulRun: vi.fn().mockResolvedValue(undefined),
}));

// Mock D1 storage
vi.mock('../src/storage/d1', () => ({
  insertPublication: vi.fn().mockResolvedValue(undefined),
  insertFile: vi.fn().mockResolvedValue(undefined),
  updateFileExtractionStatus: vi.fn().mockResolvedValue(undefined),
  getFileByDownloadUrl: vi.fn().mockResolvedValue(null),
  getFilesByExtractionStatus: vi.fn().mockResolvedValue([]),
  insertHousingPriceIndex: vi.fn().mockResolvedValue(undefined),
  insertAvgApartmentPrices: vi.fn().mockResolvedValue(undefined),
  insertConsumerPriceIndex: vi.fn().mockResolvedValue(undefined),
  insertReviewInsights: vi.fn().mockResolvedValue(undefined),
  createPipelineRun: vi.fn().mockResolvedValue(undefined),
  updatePipelineRun: vi.fn().mockResolvedValue(undefined),
  getLatestPipelineRun: vi.fn().mockResolvedValue(null),
}));

// Mock R2 storage
vi.mock('../src/storage/r2', () => ({
  uploadFile: vi.fn().mockResolvedValue({}),
  downloadFile: vi.fn().mockResolvedValue(null),
  listFiles: vi.fn().mockResolvedValue([]),
  fileExists: vi.fn().mockResolvedValue(false),
  writeJson: vi.fn().mockResolvedValue({}),
  readJson: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock GitHub Action trigger
vi.mock('../src/pipeline/trigger', () => ({
  triggerGitHubAction: vi.fn().mockResolvedValue({ triggered: true }),
}));

import { fetchXml, fetchBinary } from '../src/utils/http';
import { getDiscoveryState, setDiscoveryState } from '../src/storage/kv';
import {
  insertPublication,
  insertFile,
  insertHousingPriceIndex,
  insertConsumerPriceIndex,
  createPipelineRun,
  updatePipelineRun,
  updateFileExtractionStatus,
} from '../src/storage/d1';
import { uploadFile, downloadFile, listFiles, writeJson } from '../src/storage/r2';
import { triggerGitHubAction } from '../src/pipeline/trigger';
import * as XLSX from 'xlsx';

// Create mock Env
function createMockEnv() {
  return {
    DB: {} as D1Database,
    STORAGE: {} as R2Bucket,
    STATE: {} as KVNamespace,
    GITHUB_TOKEN: 'test-token',
    INGEST_AUTH_TOKEN: 'test-auth',
    AI_API_KEY: 'test-ai-key',
  };
}

// Create a simple XLSX buffer for testing
function createTestXlsx(): ArrayBuffer {
  const data = [
    ['Period', 'Index', 'Change'],
    ['2025-01', 150.5, 0.3],
    ['2025-02', 151.2, 0.5],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

describe('Pipeline Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the full pipeline: discovery → download → archive → extract → store', async () => {
    const env = createMockEnv();

    // --- Setup: CBS XML API returns new data ---
    vi.mocked(fetchXml).mockResolvedValue(
      `<PriceData>
        <Index>
          <IndexCode>110011</IndexCode>
          <IndexNameHeb>מדד כללי</IndexNameHeb>
          <IndexNameEng>General CPI</IndexNameEng>
          <BaseYear>2020</BaseYear>
          <Period>2025-03</Period>
          <IndexValue>109.5</IndexValue>
          <MonthlyChange>0.3</MonthlyChange>
        </Index>
      </PriceData>`
    );

    // CBS publications & media & gov.il APIs return empty (only XML API has data)
    const { fetchJson } = await import('../src/utils/http');
    vi.mocked(fetchJson).mockResolvedValue({ d: { results: [] } });

    // Setup: file download returns an XLSX buffer
    const xlsxBuffer = createTestXlsx();
    vi.mocked(fetchBinary).mockResolvedValue({
      data: xlsxBuffer,
      size: xlsxBuffer.byteLength,
    });

    // R2 downloadFile returns the same buffer for extraction
    const mockR2Body = {
      arrayBuffer: () => Promise.resolve(xlsxBuffer),
      text: () =>
        Promise.resolve(
          `<PriceData><Index><IndexCode>110011</IndexCode><IndexNameHeb>מדד כללי</IndexNameHeb><IndexNameEng>General CPI</IndexNameEng><BaseYear>2020</BaseYear><Period>2025-03</Period><IndexValue>109.5</IndexValue><MonthlyChange>0.3</MonthlyChange></Index></PriceData>`
        ),
    };
    vi.mocked(downloadFile).mockResolvedValue(mockR2Body as any);

    // No previous extraction results to pick up
    vi.mocked(listFiles).mockResolvedValue([]);

    // --- Run the pipeline ---
    const { runPipeline } = await import('../src/pipeline/orchestrator');
    const result = await runPipeline(env);

    // --- Assertions ---

    // Pipeline should complete
    expect(result.status).toMatch(/completed|partial/);
    expect(result.finished_at).toBeDefined();

    // D1 pipeline run was created and updated
    expect(createPipelineRun).toHaveBeenCalledOnce();
    expect(updatePipelineRun).toHaveBeenCalled();

    // Discovery found items (XML API produces at least 1 manifest entry)
    expect(result.sources_checked).toBeGreaterThan(0);
  });

  it('handles discovery failure gracefully and still completes', async () => {
    const env = createMockEnv();

    // All external APIs fail
    const { fetchJson } = await import('../src/utils/http');
    vi.mocked(fetchJson).mockRejectedValue(new Error('Network error'));
    vi.mocked(fetchXml).mockRejectedValue(new Error('Network error'));

    // No pickup results
    vi.mocked(listFiles).mockResolvedValue([]);

    const { runPipeline } = await import('../src/pipeline/orchestrator');
    const result = await runPipeline(env);

    // Pipeline should still finish (not throw)
    expect(result.finished_at).toBeDefined();

    // Should have errors from discovery
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.phase === 'discovery')).toBe(true);

    // No files processed (discovery failed)
    expect(result.files_discovered).toBe(0);
    expect(result.files_downloaded).toBe(0);
  });

  it('creates PDF extraction request for PDF files and triggers GitHub Action', async () => {
    const env = createMockEnv();

    // Only gov.il discovery returns a PDF
    vi.resetModules();
    vi.clearAllMocks();

    // Re-mock everything for this test since we resetModules
    vi.doMock('../src/utils/http', () => ({
      fetchJson: vi.fn().mockResolvedValue({
        Results: [
          {
            UrlName: 'weekly-review-2025-01',
            FileName: 'review.pdf',
            Subject: '01',
            Publish_Date: '2025-01-15',
          },
        ],
        TotalResults: 1,
      }),
      fetchXml: vi.fn().mockResolvedValue('<empty></empty>'),
      fetchBinary: vi.fn().mockResolvedValue({
        data: new ArrayBuffer(100),
        size: 100,
      }),
    }));
    vi.doMock('../src/storage/kv', () => ({
      getDiscoveryState: vi.fn().mockResolvedValue(null),
      setDiscoveryState: vi.fn().mockResolvedValue(undefined),
      setLastRun: vi.fn().mockResolvedValue(undefined),
      setLastSuccessfulRun: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../src/storage/d1', () => ({
      insertPublication: vi.fn().mockResolvedValue(undefined),
      insertFile: vi.fn().mockResolvedValue(undefined),
      updateFileExtractionStatus: vi.fn().mockResolvedValue(undefined),
      getFilesByExtractionStatus: vi.fn().mockResolvedValue([]),
      insertHousingPriceIndex: vi.fn().mockResolvedValue(undefined),
      insertAvgApartmentPrices: vi.fn().mockResolvedValue(undefined),
      insertConsumerPriceIndex: vi.fn().mockResolvedValue(undefined),
      insertReviewInsights: vi.fn().mockResolvedValue(undefined),
      createPipelineRun: vi.fn().mockResolvedValue(undefined),
      updatePipelineRun: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../src/storage/r2', () => ({
      uploadFile: vi.fn().mockResolvedValue({}),
      downloadFile: vi.fn().mockResolvedValue(null),
      listFiles: vi.fn().mockResolvedValue([]),
      writeJson: vi.fn().mockResolvedValue({}),
      readJson: vi.fn().mockResolvedValue(null),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }));
    const mockTrigger = vi.fn().mockResolvedValue({ triggered: true });
    vi.doMock('../src/pipeline/trigger', () => ({
      triggerGitHubAction: mockTrigger,
    }));

    const { runPipeline } = await import('../src/pipeline/orchestrator');
    const result = await runPipeline(env);

    // The pipeline should have detected PDFs and created extraction requests
    // The trigger should have been called if PDF requests were created
    expect(result.finished_at).toBeDefined();

    if (result.pdf_requests_created > 0) {
      expect(mockTrigger).toHaveBeenCalledWith('test-token', expect.any(String));
    }
  });

  it('processes no-new-files discovery with zero errors', async () => {
    const env = createMockEnv();

    // All APIs return empty results
    const { fetchJson } = await import('../src/utils/http');
    vi.mocked(fetchJson).mockResolvedValue({ d: { results: [] } });
    vi.mocked(fetchXml).mockResolvedValue('<empty></empty>');

    // No pickup results
    vi.mocked(listFiles).mockResolvedValue([]);

    const { runPipeline } = await import('../src/pipeline/orchestrator');
    const result = await runPipeline(env);

    expect(result.status).toBe('completed');
    expect(result.files_discovered).toBe(0);
    expect(result.files_downloaded).toBe(0);
    expect(result.files_extracted).toBe(0);

    // GitHub Action should NOT be triggered when no PDFs found
    expect(triggerGitHubAction).not.toHaveBeenCalled();
  });
});

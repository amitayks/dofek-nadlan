import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before importing handler
vi.mock('../src/storage/d1', () => ({
  getFileByDownloadUrl: vi.fn(),
  insertHousingPriceIndex: vi.fn(),
  insertAvgApartmentPrices: vi.fn(),
  insertConsumerPriceIndex: vi.fn(),
  insertReviewInsights: vi.fn(),
  updateFileExtractionStatus: vi.fn(),
}));

vi.mock('../src/download/downloader', () => ({
  downloadFiles: vi.fn(),
}));

vi.mock('../src/download/archive', () => ({
  archiveFiles: vi.fn(),
}));

vi.mock('../src/extraction/router', () => ({
  extractFiles: vi.fn(),
}));

vi.mock('../src/pipeline/trigger', () => ({
  triggerGitHubAction: vi.fn(),
}));

import { handleManifest } from '../src/routes/manifest';
import { getFileByDownloadUrl } from '../src/storage/d1';
import { downloadFiles } from '../src/download/downloader';
import { archiveFiles } from '../src/download/archive';
import { extractFiles } from '../src/extraction/router';
import { triggerGitHubAction } from '../src/pipeline/trigger';
import type { Env, ManifestEntry } from '../src/types';

function makeRequest(body: unknown, token = 'test-token'): Request {
  return new Request('https://example.com/api/manifest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const mockEnv = {
  DB: {} as D1Database,
  STORAGE: {} as R2Bucket,
  STATE: {} as KVNamespace,
  GH_TOKEN: 'gh-token',
  INGEST_AUTH_TOKEN: 'test-token',
  ANTHRIPIC_API_KEY: 'test',
} as Env;

const sampleEntry: ManifestEntry = {
  source: 'cbs-publications',
  url: 'https://www.cbs.gov.il/he/publications/Madad/DocLib/2026/test/table.xlsx',
  filename: 'table.xlsx',
  format: 'xlsx',
  publication_id: 'cbs-pub-2026-test',
  publish_date: '2026-02-18T00:00:00Z',
  metadata: { title: 'Test Publication', year: '2026', folder: 'test' },
  is_new: true,
};

describe('POST /api/manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const req = new Request('https://example.com/api/manifest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    const res = await handleManifest(req, mockEnv);
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong token', async () => {
    const req = makeRequest({ entries: [] }, 'wrong-token');
    const res = await handleManifest(req, mockEnv);
    expect(res.status).toBe(401);
  });

  it('returns success for empty manifest', async () => {
    const req = makeRequest({ entries: [] });
    const res = await handleManifest(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ processed: 0, errors: 0, pdf_requests: 0 });
  });

  it('skips duplicate entries already in D1', async () => {
    vi.mocked(getFileByDownloadUrl).mockResolvedValue({
      id: 'existing',
      publication_id: 'x',
      filename: 'table.xlsx',
      format: 'xlsx',
      download_url: sampleEntry.url,
      r2_key: 'raw-files/test.xlsx',
      file_size_bytes: 100,
      checksum_sha256: 'abc',
      is_preferred_format: true,
      extraction_status: 'extracted',
    });

    const req = makeRequest({ entries: [sampleEntry] });
    const res = await handleManifest(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ processed: 0, errors: 0, pdf_requests: 0 });
    expect(downloadFiles).not.toHaveBeenCalled();
  });

  it('processes new entries through the full pipeline', async () => {
    vi.mocked(getFileByDownloadUrl).mockResolvedValue(null);
    vi.mocked(downloadFiles).mockResolvedValue({
      files: [{
        manifest_entry: sampleEntry,
        data: new ArrayBuffer(10),
        file_size_bytes: 10,
        checksum_sha256: 'abc123',
        is_preferred_format: true,
      }],
      errors: [],
    });
    vi.mocked(archiveFiles).mockResolvedValue({
      fileRecords: [{
        id: 'file-1',
        publication_id: sampleEntry.publication_id,
        filename: sampleEntry.filename,
        format: 'xlsx',
        download_url: sampleEntry.url,
        r2_key: 'raw-files/cbs-publications/2026/test/table.xlsx',
        file_size_bytes: 10,
        checksum_sha256: 'abc123',
        is_preferred_format: true,
        extraction_status: 'pending',
      }],
      errors: [],
    });
    vi.mocked(extractFiles).mockResolvedValue({
      extracted: [],
      pdfRequestsCreated: 0,
      errors: [],
    });

    const req = makeRequest({ entries: [sampleEntry] });
    const res = await handleManifest(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.errors).toBe(0);
    expect(body.pdf_requests).toBe(0);
    expect(downloadFiles).toHaveBeenCalledWith([sampleEntry]);
    expect(archiveFiles).toHaveBeenCalled();
    expect(extractFiles).toHaveBeenCalled();
    expect(triggerGitHubAction).not.toHaveBeenCalled();
  });

  it('triggers GitHub Action when PDFs need extraction', async () => {
    vi.mocked(getFileByDownloadUrl).mockResolvedValue(null);
    vi.mocked(downloadFiles).mockResolvedValue({ files: [], errors: [] });
    vi.mocked(archiveFiles).mockResolvedValue({ fileRecords: [], errors: [] });
    vi.mocked(extractFiles).mockResolvedValue({
      extracted: [],
      pdfRequestsCreated: 2,
      errors: [],
    });
    vi.mocked(triggerGitHubAction).mockResolvedValue({ triggered: true });

    const req = makeRequest({ entries: [{ ...sampleEntry, format: 'pdf', filename: 'doc.pdf' }] });
    const res = await handleManifest(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pdf_requests).toBe(2);
    expect(triggerGitHubAction).toHaveBeenCalledWith('gh-token', expect.any(String));
  });
});

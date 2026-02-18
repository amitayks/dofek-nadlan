import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKnownUrls } from '../src/routes/known-urls';
import type { Env } from '../src/types';

function createMockEnv(files: { download_url: string; publication_id: string }[] = []): Env {
  return {
    INGEST_AUTH_TOKEN: 'test-token',
    DB: {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: files.map((f) => ({ download_url: f.download_url })),
        }),
      }),
    } as unknown as D1Database,
    STORAGE: {} as R2Bucket,
    STATE: {} as KVNamespace,
    GH_TOKEN: '',
    ANTHRIPIC_API_KEY: '',
  };
}

describe('GET /api/known-urls', () => {
  it('returns 401 without auth', async () => {
    const env = createMockEnv();
    const req = new Request('http://localhost/api/known-urls');
    const res = await handleKnownUrls(req, env);
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong token', async () => {
    const env = createMockEnv();
    const req = new Request('http://localhost/api/known-urls', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    const res = await handleKnownUrls(req, env);
    expect(res.status).toBe(401);
  });

  it('returns empty list when no files exist', async () => {
    const env = createMockEnv([]);
    const req = new Request('http://localhost/api/known-urls', {
      headers: { Authorization: 'Bearer test-token' },
    });
    const res = await handleKnownUrls(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { urls: string[]; count: number };
    expect(body.urls).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('returns known URLs for cbs-publications source', async () => {
    const env = createMockEnv([
      { download_url: 'https://cbs.gov.il/file1.xlsx', publication_id: 'cbs-pub-2026-050' },
    ]);
    const req = new Request('http://localhost/api/known-urls?source=cbs-publications', {
      headers: { Authorization: 'Bearer test-token' },
    });
    const res = await handleKnownUrls(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { urls: string[]; count: number };
    expect(body.count).toBe(1);
    expect(body.urls).toContain('https://cbs.gov.il/file1.xlsx');
  });

  it('returns all CBS URLs when no source filter specified', async () => {
    const env = createMockEnv([
      { download_url: 'https://cbs.gov.il/pub.xlsx', publication_id: 'cbs-pub-2026-050' },
      { download_url: 'https://cbs.gov.il/media.xlsx', publication_id: 'cbs-media-2026-051' },
    ]);
    const req = new Request('http://localhost/api/known-urls', {
      headers: { Authorization: 'Bearer test-token' },
    });
    const res = await handleKnownUrls(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { urls: string[]; count: number };
    expect(body.count).toBe(2);
  });
});

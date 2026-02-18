import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies before importing
vi.mock('../src/utils/http', () => ({
  fetchJson: vi.fn(),
  fetchXml: vi.fn(),
  fetchBinary: vi.fn(),
}));

vi.mock('../src/storage/kv', () => ({
  getDiscoveryState: vi.fn().mockResolvedValue(null),
  setDiscoveryState: vi.fn().mockResolvedValue(undefined),
}));

import { fetchXml } from '../src/utils/http';
import { getDiscoveryState } from '../src/storage/kv';

const REAL_CBS_XML = `<?xml version="1.0"?>
<indices UpdateDate="2026-01-15T08:00:00">
  <date year="2026" month="ינואר">
    <code code="120010">
      <name>מדד המחירים לצרכן - כללי</name>
      <percent>-0.3</percent>
      <index base="2024 ממוצע">103.3</index>
      <index base="2020 ממוצע" chainingCoefficient="1.059">117.49</index>
    </code>
  </date>
</indices>`;

describe('Discovery modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CBS XML API discovery', () => {
    it('discovers new data when period differs from state', async () => {
      const { discoverCbsXmlApi } = await import('../src/discovery/cbs-xml-api');

      vi.mocked(getDiscoveryState).mockResolvedValue(null);
      vi.mocked(fetchXml).mockResolvedValue(REAL_CBS_XML);

      const mockKv = {} as KVNamespace;
      const entries = await discoverCbsXmlApi(mockKv);

      expect(entries.length).toBe(1);
      expect(entries[0].source).toBe('cbs-xml-api');
      expect(entries[0].format).toBe('xml');
      expect(entries[0].is_new).toBe(true);
      expect(entries[0].publication_id).toContain('2026-ינואר');
    });

    it('skips when period matches existing state', async () => {
      const { discoverCbsXmlApi } = await import('../src/discovery/cbs-xml-api');

      vi.mocked(getDiscoveryState).mockResolvedValue({
        last_check: '2026-01-10T00:00:00Z',
        latest_period: '2026-ינואר',
      });
      vi.mocked(fetchXml).mockResolvedValue(REAL_CBS_XML);

      const mockKv = {} as KVNamespace;
      const entries = await discoverCbsXmlApi(mockKv);

      expect(entries.length).toBe(0);
    });
  });

  describe('Discovery coordinator', () => {
    it('handles individual source failures gracefully', async () => {
      vi.resetModules();

      vi.doMock('../src/discovery/cbs-publications', () => ({
        discoverCbsPublications: vi.fn().mockRejectedValue(new Error('Network error')),
      }));
      vi.doMock('../src/discovery/cbs-media', () => ({
        discoverCbsMediaReleases: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock('../src/discovery/cbs-xml-api', () => ({
        discoverCbsXmlApi: vi.fn().mockResolvedValue([
          {
            source: 'cbs-xml-api',
            url: 'https://api.cbs.gov.il/test',
            filename: 'cpi-2026-01.xml',
            format: 'xml',
            publication_id: 'cbs-xml-api-2026-ינואר',
            publish_date: '2026-01-15',
            metadata: {},
            is_new: true,
          },
        ]),
      }));
      vi.doMock('../src/discovery/gov-il-reviews', () => ({
        discoverGovIlReviews: vi.fn().mockResolvedValue([]),
      }));

      const { runDiscovery } = await import('../src/pipeline/discover');
      const mockKv = {} as KVNamespace;
      const result = await runDiscovery(mockKv);

      expect(result.manifest).toHaveLength(1);
      expect(result.manifest[0].source).toBe('cbs-xml-api');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('cbs-publications');
      expect(result.sourcesChecked).toBe(3);
    });
  });
});

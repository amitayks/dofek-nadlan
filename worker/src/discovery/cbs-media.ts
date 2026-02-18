import type { ManifestEntry } from '../types';
import { fetchJson } from '../utils/http';
import { getDiscoveryState, setDiscoveryState } from '../storage/kv';

const CBS_BASE = 'https://www.cbs.gov.il';
const SOURCE_ID = 'cbs-media';

interface SharePointListItem {
  Id: number;
  Title: string;
  CbsEnglishTitle?: string;
  CbsPublishingFolderLevel1: string; // year
  CbsPublishingFolderLevel2: string; // release number
  Created: string;
}

interface SharePointFile {
  Name: string;
  ServerRelativeUrl: string;
  Length: string;
}

interface SharePointResponse<T> {
  d: {
    results: T[];
  };
}

// Maps filename suffix to content type description
function classifyMediaFile(filename: string): string {
  // Pattern: 10_{YY}_{NNN}{suffix}.{ext}
  const match = filename.match(/^10_\d{2}_\d{3}(\w+)\.\w+$/);
  if (!match) return 'unknown';

  const suffix = match[1];
  const suffixMap: Record<string, string> = {
    b: 'press_release_body_he',
    e: 'press_release_body_en',
    y: 'appendix',
    t1: 'table_1',
    t2: 'table_2',
    t3: 'table_3',
    t4: 'table_4',
    te1: 'table_1_en',
    te2: 'table_2_en',
    te3: 'table_3_en',
  };
  return suffixMap[suffix] ?? `other_${suffix}`;
}

export async function discoverCbsMediaReleases(kv: KVNamespace): Promise<ManifestEntry[]> {
  const state = await getDiscoveryState(kv, SOURCE_ID);
  const currentYear = new Date().getFullYear().toString();
  const manifest: ManifestEntry[] = [];

  try {
    let filter = `CbsPublishingFolderLevel1 eq '${currentYear}'`;
    if (state?.last_check) {
      filter += ` and Created gt datetime'${state.last_check}'`;
    }

    const listUrl =
      `${CBS_BASE}/he/mediarelease/Madad/_api/Web/Lists/Items` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$orderby=Created desc` +
      `&$top=30` +
      `&$select=Id,Title,CbsEnglishTitle,CbsPublishingFolderLevel1,CbsPublishingFolderLevel2,Created`;

    const response = await fetchJson<SharePointResponse<SharePointListItem>>(listUrl);
    const items = response.d?.results ?? [];

    for (const item of items) {
      const releaseNum = item.CbsPublishingFolderLevel2;
      const year = item.CbsPublishingFolderLevel1;

      // Enumerate files in the release's DocLib folder
      const filesUrl =
        `${CBS_BASE}/he/mediarelease/Madad/_api/web/GetFolderByServerRelativeUrl(` +
        `'/he/mediarelease/Madad/DocLib/${year}/${releaseNum}'` +
        `)/Files`;

      try {
        const filesResponse = await fetchJson<SharePointResponse<SharePointFile>>(filesUrl);
        const files = filesResponse.d?.results ?? [];

        const pubId = `cbs-media-${year}-${releaseNum}`;

        for (const file of files) {
          const ext = file.Name.split('.').pop()?.toLowerCase() ?? '';
          const format = normalizeFormat(ext);
          if (!format) continue;

          manifest.push({
            source: SOURCE_ID,
            url: `${CBS_BASE}${file.ServerRelativeUrl}`,
            filename: file.Name,
            format,
            publication_id: pubId,
            publish_date: item.Created,
            metadata: {
              title: item.Title,
              title_en: item.CbsEnglishTitle,
              year,
              release_number: releaseNum,
              content_type: classifyMediaFile(file.Name),
              size: parseInt(file.Length, 10),
            },
            is_new: true,
          });
        }
      } catch (err) {
        console.error(`Failed to enumerate files for media release ${year}/${releaseNum}:`, err);
      }
    }

    // Update KV state
    if (items.length > 0) {
      const latestRelease = `${items[0].CbsPublishingFolderLevel1}/${items[0].CbsPublishingFolderLevel2}`;
      await setDiscoveryState(kv, SOURCE_ID, {
        last_check: new Date().toISOString(),
        latest_release: latestRelease,
      });
    }
  } catch (err) {
    console.error('CBS media releases discovery failed:', err);
    throw err;
  }

  return manifest;
}

function normalizeFormat(ext: string): ManifestEntry['format'] | null {
  const map: Record<string, ManifestEntry['format']> = {
    xlsx: 'xlsx', xls: 'xls', docx: 'docx', doc: 'doc', pdf: 'pdf', zip: 'zip',
  };
  return map[ext] ?? null;
}

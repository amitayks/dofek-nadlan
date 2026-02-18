import type { ManifestEntry } from '../types';
import { fetchJson } from '../utils/http';
import { getDiscoveryState, setDiscoveryState } from '../storage/kv';

const SOURCE_ID = 'gov-il-reviews';
const ITEMS_PER_PAGE = 10;

// Gov.il www domain is blocked by Cloudflare WAF for automated requests.
// We use the data.gov.il CKAN API as primary source, and the
// PublicationsSearchApi on www.gov.il as fallback (may fail with 403).

// data.gov.il dataset for real estate reviews (if available)
const DATA_GOV_IL_API = 'https://data.gov.il/api/3/action';

// www.gov.il API patterns (may be blocked by Cloudflare)
const GOV_IL_BASE = 'https://www.gov.il';
const COLLECTION_GUID = '3ed26e5e-41c1-4dbb-ac3f-b9b0f7b2c7b2';

interface GovIlSearchResponse {
  results?: GovIlSearchItem[];
  TotalResults?: number;
}

interface GovIlSearchItem {
  UrlName: string;
  Title?: string;
  Subject?: string;
  Publish_Date?: string;
  Files?: GovIlFileRef[];
  // data.gov.il uses different field names
  name?: string;
  title?: string;
  resources?: DataGovResource[];
}

interface GovIlFileRef {
  FileName: string;
  FileType: string;
}

interface DataGovResource {
  url: string;
  name: string;
  format: string;
}

function parseDate(dateStr: string): Date {
  // Handle d.M.yyyy format from gov.il
  const dotParts = dateStr.split('.');
  if (dotParts.length === 3) {
    return new Date(parseInt(dotParts[2]), parseInt(dotParts[1]) - 1, parseInt(dotParts[0]));
  }
  return new Date(dateStr);
}

function buildFileUrl(urlName: string, fileName: string): string {
  return `${GOV_IL_BASE}/BlobFolder/dynamiccollectorresultitem/${urlName}/he/${fileName}`;
}

export async function discoverGovIlReviews(kv: KVNamespace): Promise<ManifestEntry[]> {
  const state = await getDiscoveryState(kv, SOURCE_ID);
  const manifest: ManifestEntry[] = [];

  // Try multiple API patterns since gov.il blocks automated access
  const strategies = [
    () => tryGovIlSearchApi(state, manifest),
    () => tryDataGovIl(state, manifest),
  ];

  let succeeded = false;
  for (const strategy of strategies) {
    try {
      await strategy();
      succeeded = true;
      break;
    } catch (err) {
      console.warn(`Gov.il discovery strategy failed:`, err);
    }
  }

  if (!succeeded) {
    throw new Error('All gov.il API strategies failed (likely Cloudflare WAF block)');
  }

  // Update KV state
  if (manifest.length > 0) {
    const latestDate = manifest
      .map((m) => m.publish_date)
      .sort()
      .reverse()[0];
    await setDiscoveryState(kv, SOURCE_ID, {
      last_check: new Date().toISOString(),
      latest_publish_date: latestDate,
    });
  }

  return manifest;
}

async function tryGovIlSearchApi(
  state: Awaited<ReturnType<typeof getDiscoveryState>>,
  manifest: ManifestEntry[]
): Promise<void> {
  const lastKnownDate = state?.latest_publish_date
    ? new Date(state.latest_publish_date)
    : null;

  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    // Try the PublicationSearchApi pattern
    const apiUrl =
      `${GOV_IL_BASE}/he/api/PublicationSearchApi/Index` +
      `?limit=${ITEMS_PER_PAGE}` +
      `&skip=${skip}` +
      `&CollectionId=${COLLECTION_GUID}`;

    const response = await fetchJson<GovIlSearchResponse>(apiUrl);
    const items = response.results ?? [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    let allKnown = true;
    for (const item of items) {
      const dateStr = item.Publish_Date ?? '';
      if (!dateStr) continue;

      const publishDate = parseDate(dateStr);

      if (lastKnownDate && publishDate <= lastKnownDate) {
        hasMore = false;
        break;
      }

      allKnown = false;

      const files = item.Files ?? [];
      for (const file of files) {
        const ext = file.FileName.split('.').pop()?.toLowerCase() ?? '';
        const format = ext === 'pdf' ? 'pdf' as const : ext === 'docx' ? 'docx' as const : null;
        if (!format) continue;

        manifest.push({
          source: SOURCE_ID,
          url: buildFileUrl(item.UrlName, file.FileName),
          filename: file.FileName,
          format,
          publication_id: `gov-il-${item.UrlName}`,
          publish_date: publishDate.toISOString(),
          metadata: {
            title: item.Title,
            url_name: item.UrlName,
            original_date: dateStr,
          },
          is_new: true,
        });
      }
    }

    if (allKnown || items.length < ITEMS_PER_PAGE) {
      hasMore = false;
    } else {
      skip += ITEMS_PER_PAGE;
    }
  }
}

async function tryDataGovIl(
  state: Awaited<ReturnType<typeof getDiscoveryState>>,
  manifest: ManifestEntry[]
): Promise<void> {
  // Search data.gov.il for real estate review datasets
  // This is a CKAN API - search for relevant packages
  const searchUrl =
    `${DATA_GOV_IL_API}/package_search` +
    `?q=נדל"ן+סקירה+שבועית` +
    `&rows=10` +
    `&sort=metadata_modified desc`;

  const response = await fetchJson<{
    success: boolean;
    result: { results: GovIlSearchItem[] };
  }>(searchUrl);

  if (!response.success || !response.result?.results) {
    throw new Error('data.gov.il search returned no results');
  }

  const lastKnownDate = state?.latest_publish_date
    ? new Date(state.latest_publish_date)
    : null;

  for (const pkg of response.result.results) {
    const resources = pkg.resources ?? [];
    for (const res of resources) {
      if (!res.url || !res.format) continue;

      const format = res.format.toLowerCase();
      if (format !== 'pdf' && format !== 'docx') continue;

      const filename = res.url.split('/').pop() ?? res.name ?? 'unknown.pdf';
      const pubDate = new Date();

      if (lastKnownDate && pubDate <= lastKnownDate) continue;

      manifest.push({
        source: SOURCE_ID,
        url: res.url,
        filename,
        format: format as 'pdf' | 'docx',
        publication_id: `gov-il-data-${pkg.name ?? filename}`,
        publish_date: pubDate.toISOString(),
        metadata: {
          title: pkg.title ?? res.name,
          data_gov_package: pkg.name,
        },
        is_new: true,
      });
    }
  }

  if (manifest.length === 0) {
    console.log('Gov.il: No new reviews found on data.gov.il');
  }
}

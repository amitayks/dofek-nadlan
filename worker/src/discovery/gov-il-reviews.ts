import type { ManifestEntry } from '../types';
import { fetchJson } from '../utils/http';
import { getDiscoveryState, setDiscoveryState } from '../storage/kv';

const SOURCE_ID = 'gov-il-reviews';
const GOV_IL_BASE = 'https://www.gov.il';
const COLLECTION_GUID = '3ed26e5e-41c1-4dbb-ac3f-b9b0f7b2c7b2';
const ITEMS_PER_PAGE = 10;
const SUBJECT_REAL_ESTATE = '01';

interface GovIlCollectorResponse {
  results: GovIlItem[];
  totalResults: number;
}

interface GovIlItem {
  UrlName: string;
  Data: {
    search_by_name: string;
    subject: string; // comma-separated keys
    publish_date: string; // d.M.yyyy format
    file: GovIlFile[];
  };
}

interface GovIlFile {
  FileName: string;
  FileType: string;
}

function parseGovIlDate(dateStr: string): Date {
  // Format: d.M.yyyy
  const parts = dateStr.split('.');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  return new Date(dateStr);
}

function buildFileUrl(urlName: string, fileName: string): string {
  return `${GOV_IL_BASE}/BlobFolder/dynamiccollectorresultitem/${urlName}/he/${fileName}`;
}

export async function discoverGovIlReviews(kv: KVNamespace): Promise<ManifestEntry[]> {
  const state = await getDiscoveryState(kv, SOURCE_ID);
  const lastKnownDate = state?.latest_publish_date
    ? new Date(state.latest_publish_date)
    : null;
  const manifest: ManifestEntry[] = [];

  try {
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      // Hit the dynamic collector API
      // The actual API endpoint needs to be confirmed; trying the common gov.il pattern
      const apiUrl =
        `${GOV_IL_BASE}/he/api/DynamicCollectorResult/` +
        `${COLLECTION_GUID}` +
        `?skip=${skip}` +
        `&search_by_name=` +
        `&subject=${SUBJECT_REAL_ESTATE}`;

      let response: GovIlCollectorResponse;
      try {
        response = await fetchJson<GovIlCollectorResponse>(apiUrl);
      } catch {
        // Fallback: try alternative API pattern
        const fallbackUrl =
          `${GOV_IL_BASE}/he/Departments/DynamicCollectors/weekly-review` +
          `?skip=${skip}&search_by_name=%D7%A0%D7%93%D7%9C%22%D7%9F`;
        // If API doesn't work, we'll need browser rendering. For now, try JSON.
        console.warn('Primary API failed, trying fallback URL');
        response = await fetchJson<GovIlCollectorResponse>(fallbackUrl);
      }

      const items = response.results ?? [];
      if (items.length === 0) {
        hasMore = false;
        break;
      }

      let allKnown = true;
      for (const item of items) {
        const publishDate = parseGovIlDate(item.Data.publish_date);

        // Stop if we've seen this date before
        if (lastKnownDate && publishDate <= lastKnownDate) {
          hasMore = false;
          break;
        }

        allKnown = false;

        // Get files for this item
        const files = item.Data.file ?? [];
        for (const file of files) {
          const ext = file.FileName.split('.').pop()?.toLowerCase() ?? '';
          const format = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : null;
          if (!format) continue;

          manifest.push({
            source: SOURCE_ID,
            url: buildFileUrl(item.UrlName, file.FileName),
            filename: file.FileName,
            format,
            publication_id: `gov-il-${item.UrlName}`,
            publish_date: publishDate.toISOString(),
            metadata: {
              name: item.Data.search_by_name,
              subject: item.Data.subject,
              url_name: item.UrlName,
              original_date: item.Data.publish_date,
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

    // Update KV state with the latest date we've seen
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
  } catch (err) {
    console.error('gov.il reviews discovery failed:', err);
    throw err;
  }

  return manifest;
}

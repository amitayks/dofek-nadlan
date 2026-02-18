import type { ManifestEntry, DiscoveryState } from '../types';
import { fetchJson } from '../utils/http';
import { getDiscoveryState, setDiscoveryState } from '../storage/kv';

const CBS_BASE = 'https://www.cbs.gov.il';
const SOURCE_ID = 'cbs-publications';

interface SharePointListItem {
  Id: number;
  Title: string;
  CbsEnglishTitle?: string;
  CbsPublishingFolderLevel1: string; // year
  CbsPublishingFolderLevel2: string; // folder code, e.g., "price01aa"
  Created: string;
  PublishingPageContent?: string;
}

interface SharePointFile {
  Name: string;
  ServerRelativeUrl: string;
  Length: string;
  ListItemAllFields: {
    Title?: string;
    CbsEnglishTitle?: string;
    CbsOrderField?: number;
  };
}

interface SharePointResponse<T> {
  d: {
    results: T[];
  };
}

export async function discoverCbsPublications(kv: KVNamespace): Promise<ManifestEntry[]> {
  const state = await getDiscoveryState(kv, SOURCE_ID);
  const currentYear = new Date().getFullYear().toString();
  const manifest: ManifestEntry[] = [];

  try {
    // Query publications list for current year
    const listUrl =
      `${CBS_BASE}/he/publications/Madad/_api/Web/Lists/Items` +
      `?$filter=CbsPublishingFolderLevel1 eq '${currentYear}'` +
      `&$orderby=Created desc` +
      `&$top=50` +
      `&$select=Id,Title,CbsEnglishTitle,CbsPublishingFolderLevel1,CbsPublishingFolderLevel2,Created`;

    const response = await fetchJson<SharePointResponse<SharePointListItem>>(listUrl);
    const items = response.d?.results ?? [];

    for (const item of items) {
      const folderKey = `${item.CbsPublishingFolderLevel1}/${item.CbsPublishingFolderLevel2}`;

      // Check if this folder is already known
      if (state?.latest_folder && folderKey <= state.latest_folder) {
        continue;
      }

      // Enumerate files in this publication's DocLib folder
      const filesUrl =
        `${CBS_BASE}/he/publications/Madad/_api/web/GetFolderByServerRelativeUrl(` +
        `'/he/publications/Madad/DocLib/${item.CbsPublishingFolderLevel1}/${item.CbsPublishingFolderLevel2}'` +
        `)/Files?$expand=ListItemAllFields`;

      try {
        const filesResponse = await fetchJson<SharePointResponse<SharePointFile>>(filesUrl);
        const files = filesResponse.d?.results ?? [];

        const pubId = `cbs-pub-${item.CbsPublishingFolderLevel1}-${item.CbsPublishingFolderLevel2}`;

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
              year: item.CbsPublishingFolderLevel1,
              folder: item.CbsPublishingFolderLevel2,
              file_title: file.ListItemAllFields?.Title,
              file_title_en: file.ListItemAllFields?.CbsEnglishTitle,
              order: file.ListItemAllFields?.CbsOrderField,
              size: parseInt(file.Length, 10),
            },
            is_new: true,
          });
        }
      } catch (err) {
        console.error(`Failed to enumerate files for ${folderKey}:`, err);
      }
    }

    // Update state with the latest folder we've seen
    if (items.length > 0) {
      const latest = items[0];
      const latestFolder = `${latest.CbsPublishingFolderLevel1}/${latest.CbsPublishingFolderLevel2}`;
      await setDiscoveryState(kv, SOURCE_ID, {
        last_check: new Date().toISOString(),
        latest_folder: state?.latest_folder
          ? latestFolder > state.latest_folder
            ? latestFolder
            : state.latest_folder
          : latestFolder,
      });
    }
  } catch (err) {
    console.error('CBS publications discovery failed:', err);
    throw err;
  }

  return manifest;
}

function normalizeFormat(ext: string): ManifestEntry['format'] | null {
  const map: Record<string, ManifestEntry['format']> = {
    xlsx: 'xlsx',
    xls: 'xls',
    docx: 'docx',
    doc: 'doc',
    pdf: 'pdf',
    zip: 'zip',
  };
  return map[ext] ?? null;
}

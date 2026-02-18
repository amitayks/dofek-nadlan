import type { ManifestEntry } from '../types';

// CBS SharePoint REST API is blocked from Cloudflare Worker IPs.
// Discovery is handled by the discover-cbs.yml GitHub Action,
// which posts manifest entries to POST /api/manifest.

export async function discoverCbsMediaReleases(_kv: KVNamespace): Promise<ManifestEntry[]> {
  console.log('CBS media: discovery handled by GitHub Action');
  return [];
}

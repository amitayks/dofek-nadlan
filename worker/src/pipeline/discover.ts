import type { ManifestEntry, PipelineError } from '../types';
import { discoverCbsPublications } from '../discovery/cbs-publications';
import { discoverCbsMediaReleases } from '../discovery/cbs-media';
import { discoverCbsXmlApi } from '../discovery/cbs-xml-api';
import { discoverGovIlReviews } from '../discovery/gov-il-reviews';

interface DiscoveryResult {
  manifest: ManifestEntry[];
  sourcesChecked: number;
  errors: PipelineError[];
}

export async function runDiscovery(kv: KVNamespace): Promise<DiscoveryResult> {
  const errors: PipelineError[] = [];
  const manifest: ManifestEntry[] = [];
  let sourcesChecked = 0;

  // Run all discovery sources in parallel
  const sources = [
    { name: 'cbs-publications', fn: () => discoverCbsPublications(kv) },
    { name: 'cbs-media', fn: () => discoverCbsMediaReleases(kv) },
    { name: 'cbs-xml-api', fn: () => discoverCbsXmlApi(kv) },
    { name: 'gov-il-reviews', fn: () => discoverGovIlReviews(kv) },
  ];

  const results = await Promise.allSettled(sources.map((s) => s.fn()));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = sources[i];

    if (result.status === 'fulfilled') {
      manifest.push(...result.value);
      sourcesChecked++;
      console.log(`Discovery: ${source.name} found ${result.value.length} items`);
    } else {
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Discovery: ${source.name} failed: ${errMsg}`);
      errors.push({
        phase: 'discovery',
        source: source.name,
        error_message: errMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  console.log(`Discovery complete: ${manifest.length} total items from ${sourcesChecked} sources`);

  return { manifest, sourcesChecked, errors };
}

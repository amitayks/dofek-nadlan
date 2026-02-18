import type { DiscoveryState } from '../types';

const DISCOVERY_PREFIX = 'discovery:';
const PIPELINE_PREFIX = 'pipeline:';

export async function getDiscoveryState(
  kv: KVNamespace,
  source: string
): Promise<DiscoveryState | null> {
  const raw = await kv.get(`${DISCOVERY_PREFIX}${source}`, 'json');
  return (raw as DiscoveryState) ?? null;
}

export async function setDiscoveryState(
  kv: KVNamespace,
  source: string,
  state: DiscoveryState
): Promise<void> {
  await kv.put(`${DISCOVERY_PREFIX}${source}`, JSON.stringify(state));
}

export async function getLastRun(kv: KVNamespace): Promise<string | null> {
  return kv.get(`${PIPELINE_PREFIX}last_run`);
}

export async function setLastRun(kv: KVNamespace, timestamp: string): Promise<void> {
  await kv.put(`${PIPELINE_PREFIX}last_run`, timestamp);
}

export async function getLastSuccessfulRun(kv: KVNamespace): Promise<string | null> {
  return kv.get(`${PIPELINE_PREFIX}last_successful_run`);
}

export async function setLastSuccessfulRun(kv: KVNamespace, timestamp: string): Promise<void> {
  await kv.put(`${PIPELINE_PREFIX}last_successful_run`, timestamp);
}

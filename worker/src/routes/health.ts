import type { Env } from '../types';
import { getLastRun } from '../storage/kv';

export async function handleHealth(env: Env): Promise<Response> {
  const lastRun = await getLastRun(env.STATE);

  return Response.json({
    status: 'ok',
    last_run: lastRun ?? 'never',
  });
}

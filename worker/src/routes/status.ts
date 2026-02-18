import type { Env } from '../types';
import { getLatestPipelineRun } from '../storage/d1';

export async function handleStatus(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.INGEST_AUTH_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const run = await getLatestPipelineRun(env.DB);
  if (!run) {
    return Response.json({ message: 'No pipeline runs found' }, { status: 404 });
  }

  return Response.json(run);
}

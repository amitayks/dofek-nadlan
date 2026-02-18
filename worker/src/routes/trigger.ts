import type { Env } from '../types';
import { runPipeline } from '../pipeline/orchestrator';

export async function handleTrigger(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.INGEST_AUTH_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const run = await runPipeline(env);
  return Response.json({
    run_id: run.id,
    status: run.status,
    files_discovered: run.files_discovered,
    files_downloaded: run.files_downloaded,
    files_extracted: run.files_extracted,
    pdf_requests_created: run.pdf_requests_created,
  });
}

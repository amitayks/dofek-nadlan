import type { Env, IngestPayload } from '../types';
import { pickupUnprocessedResults } from '../pipeline/pickup';

export async function handleIngest(request: Request, env: Env): Promise<Response> {
  // Validate auth
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.INGEST_AUTH_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const payload = (await request.json()) as IngestPayload;

    if (payload.event !== 'extraction_complete') {
      return Response.json({ error: 'Unknown event type' }, { status: 400 });
    }

    console.log(
      `Ingest webhook: run_id=${payload.run_id}, ` +
        `${payload.stats.success} success, ${payload.stats.failed} failed`
    );

    // Process all pending extraction results from R2
    const result = await pickupUnprocessedResults(env);

    return Response.json({
      processed: result.processed,
      errors: result.errors.length,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Ingest handler error:', errMsg);
    return Response.json({ error: errMsg }, { status: 500 });
  }
}

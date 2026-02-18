import type { Env } from '../types';

export async function handleKnownUrls(request: Request, env: Env): Promise<Response> {
  // Validate auth
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.INGEST_AUTH_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const sources = url.searchParams.getAll('source');

    const conditions: string[] = [];
    if (sources.length === 0 || sources.includes('cbs-publications')) {
      conditions.push("publication_id LIKE 'cbs-pub-%'");
    }
    if (sources.length === 0 || sources.includes('cbs-media')) {
      conditions.push("publication_id LIKE 'cbs-media-%'");
    }

    if (conditions.length === 0) {
      return Response.json({ urls: [], count: 0 });
    }

    const where = conditions.join(' OR ');
    const result = await env.DB
      .prepare(`SELECT download_url FROM files WHERE ${where}`)
      .all<{ download_url: string }>();

    const urls = result.results.map((r) => r.download_url);

    return Response.json({ urls, count: urls.length });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Known URLs handler error:', errMsg);
    return Response.json({ error: errMsg }, { status: 500 });
  }
}

import type { Env } from './types';
import { runPipeline } from './pipeline/orchestrator';
import { handleIngest } from './routes/ingest';
import { handleManifest } from './routes/manifest';
import { handleStatus } from './routes/status';
import { handleTrigger } from './routes/trigger';
import { handleHealth } from './routes/health';

export default {
  // Cron trigger handler — runs daily at midnight
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Cron triggered at ${new Date().toISOString()}`);
    ctx.waitUntil(runPipeline(env).then((run) => {
      console.log(`Pipeline run ${run.id} completed with status: ${run.status}`);
    }));
  },

  // HTTP request handler
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for API access
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    let response: Response;

    try {
      switch (true) {
        case path === '/api/ingest' && request.method === 'POST':
          response = await handleIngest(request, env);
          break;
        case path === '/api/manifest' && request.method === 'POST':
          response = await handleManifest(request, env);
          break;
        case path === '/api/status' && request.method === 'GET':
          response = await handleStatus(request, env);
          break;
        case path === '/api/trigger' && request.method === 'POST':
          response = await handleTrigger(request, env);
          break;
        case path === '/api/health' && request.method === 'GET':
          response = await handleHealth(env);
          break;
        default:
          response = Response.json({ error: 'Not found' }, { status: 404 });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Unhandled error:', errMsg);
      response = Response.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Add CORS headers to response
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
} satisfies ExportedHandler<Env>;

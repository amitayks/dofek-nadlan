## GET /api/known-urls

### Authentication
Bearer token via `Authorization` header, validated against `env.INGEST_AUTH_TOKEN`.

### Query Parameters
- `source` (string, repeatable) — Source filter. Values: `cbs-publications`, `cbs-media`. If omitted, returns all CBS URLs.

### Response
```json
{
  "urls": [
    "https://www.cbs.gov.il/he/mediarelease/Madad/DocLib/2026/050/10_26_050t1.xlsx",
    ...
  ],
  "count": 42
}
```

### Implementation
File: `worker/src/routes/known-urls.ts`

```typescript
export async function handleKnownUrls(request: Request, env: Env): Promise<Response>
```

Query D1:
- If `source=cbs-publications`: `SELECT download_url FROM files WHERE publication_id LIKE 'cbs-pub-%'`
- If `source=cbs-media`: `SELECT download_url FROM files WHERE publication_id LIKE 'cbs-media-%'`
- If both or neither: union of both queries

### Route Registration
In `worker/src/index.ts`:
```typescript
case path === '/api/known-urls' && request.method === 'GET':
  response = await handleKnownUrls(request, env);
  break;
```

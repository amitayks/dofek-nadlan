interface FetchOptions {
  timeout?: number; // ms, default 30000
  retries?: number; // default 3
  headers?: Record<string, string>;
}

// Track last request time per domain for rate limiting
const lastRequestTime = new Map<string, number>();
const MIN_DELAY_MS = 500;

async function rateLimitDelay(url: string): Promise<void> {
  const domain = new URL(url).hostname;
  const lastTime = lastRequestTime.get(domain);
  if (lastTime) {
    const elapsed = Date.now() - lastTime;
    if (elapsed < MIN_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_DELAY_MS - elapsed));
    }
  }
  lastRequestTime.set(domain, Date.now());
}

export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { timeout = 30000, retries = 3, headers = {} } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < retries; attempt++) {
    await rateLimitDelay(url);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          ...headers,
        },
      });

      clearTimeout(timeoutId);

      if (response.status >= 500 && attempt < retries - 1) {
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        const backoff = Math.pow(4, attempt) * 1000; // 1s, 4s, 16s
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < retries - 1) {
        const backoff = Math.pow(4, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      Accept: 'application/json;odata=nometadata',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json') && !contentType.includes('odata')) {
    const bodyPreview = (await response.text()).slice(0, 200);
    throw new Error(
      `Expected JSON but got ${contentType} from ${url}: ${bodyPreview}`
    );
  }

  return response.json() as Promise<T>;
}

export async function fetchXml(
  url: string,
  options: FetchOptions = {}
): Promise<string> {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      Accept: 'application/xml, text/xml',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.text();
}

export async function fetchBinary(
  url: string,
  options: FetchOptions = {}
): Promise<{ data: ArrayBuffer; contentType: string; size: number }> {
  const response = await fetchWithRetry(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  const data = await response.arrayBuffer();
  return {
    data,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    size: data.byteLength,
  };
}

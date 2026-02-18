export async function uploadFile(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | ReadableStream | string,
  metadata?: Record<string, string>
): Promise<R2Object> {
  return bucket.put(key, data, {
    customMetadata: metadata,
  });
}

export async function downloadFile(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function listFiles(
  bucket: R2Bucket,
  prefix: string,
  limit = 1000
): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix, limit, cursor });
    objects.push(...listed.objects);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return objects;
}

export async function fileExists(bucket: R2Bucket, key: string): Promise<boolean> {
  const head = await bucket.head(key);
  return head !== null;
}

export async function writeJson(
  bucket: R2Bucket,
  key: string,
  data: unknown,
  metadata?: Record<string, string>
): Promise<R2Object> {
  return bucket.put(key, JSON.stringify(data, null, 2), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: metadata,
  });
}

export async function readJson<T = unknown>(
  bucket: R2Bucket,
  key: string
): Promise<T | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const text = await obj.text();
  return JSON.parse(text) as T;
}

export async function deleteFile(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

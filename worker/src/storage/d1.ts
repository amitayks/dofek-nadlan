import type {
  Env,
  PublicationRecord,
  FileRecord,
  HousingPriceIndexRow,
  AvgApartmentPriceRow,
  ConsumerPriceIndexRow,
  ReviewInsightRow,
  PipelineRun,
  PipelineError,
} from '../types';

export async function insertPublication(db: D1Database, pub: PublicationRecord): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO publications (id, source_id, title, title_en, publish_date, period_start, period_end, discovery_url, raw_metadata, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      pub.id,
      pub.source_id,
      pub.title ?? null,
      pub.title_en ?? null,
      pub.publish_date ?? null,
      pub.period_start ?? null,
      pub.period_end ?? null,
      pub.discovery_url ?? null,
      pub.raw_metadata ?? null,
      pub.status
    )
    .run();
}

export async function updatePublicationStatus(
  db: D1Database,
  id: string,
  status: PublicationRecord['status']
): Promise<void> {
  await db
    .prepare(`UPDATE publications SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(status, id)
    .run();
}

export async function insertFile(db: D1Database, file: FileRecord): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO files (id, publication_id, filename, format, download_url, r2_key, file_size_bytes, checksum_sha256, is_preferred_format, extraction_status, extraction_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      file.id,
      file.publication_id,
      file.filename,
      file.format,
      file.download_url,
      file.r2_key,
      file.file_size_bytes,
      file.checksum_sha256,
      file.is_preferred_format ? 1 : 0,
      file.extraction_status,
      file.extraction_request_id ?? null
    )
    .run();
}

export async function updateFileExtractionStatus(
  db: D1Database,
  fileId: string,
  status: FileRecord['extraction_status'],
  requestId?: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE files SET extraction_status = ?, extraction_request_id = COALESCE(?, extraction_request_id) WHERE id = ?`
    )
    .bind(status, requestId ?? null, fileId)
    .run();
}

export async function getFileByDownloadUrl(
  db: D1Database,
  url: string
): Promise<FileRecord | null> {
  const result = await db
    .prepare(`SELECT * FROM files WHERE download_url = ? LIMIT 1`)
    .bind(url)
    .first<FileRecord>();
  return result ?? null;
}

export async function getFilesByExtractionStatus(
  db: D1Database,
  status: string
): Promise<FileRecord[]> {
  const result = await db
    .prepare(`SELECT * FROM files WHERE extraction_status = ?`)
    .bind(status)
    .all<FileRecord>();
  return result.results;
}

export async function insertHousingPriceIndex(
  db: D1Database,
  rows: HousingPriceIndexRow[]
): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO housing_price_index (publication_id, file_id, period, district, index_value, base_year, pct_change_monthly, pct_change_annual, is_new_dwellings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = rows.map((r) =>
    stmt.bind(
      r.publication_id,
      r.file_id,
      r.period,
      r.district ?? null,
      r.index_value,
      r.base_year,
      r.pct_change_monthly ?? null,
      r.pct_change_annual ?? null,
      r.is_new_dwellings ? 1 : 0
    )
  );
  if (batch.length > 0) {
    await db.batch(batch);
  }
}

export async function insertAvgApartmentPrices(
  db: D1Database,
  rows: AvgApartmentPriceRow[]
): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO avg_apartment_prices (publication_id, file_id, period, district, city, rooms, avg_price_nis_thousands, sample_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = rows.map((r) =>
    stmt.bind(
      r.publication_id,
      r.file_id,
      r.period,
      r.district,
      r.city ?? null,
      r.rooms ?? null,
      r.avg_price_nis_thousands,
      r.sample_size ?? null
    )
  );
  if (batch.length > 0) {
    await db.batch(batch);
  }
}

export async function insertConsumerPriceIndex(
  db: D1Database,
  rows: ConsumerPriceIndexRow[]
): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO consumer_price_index (publication_id, file_id, period, index_code, index_name_he, index_name_en, index_value, base_year, pct_change_monthly, pct_change_annual)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = rows.map((r) =>
    stmt.bind(
      r.publication_id,
      r.file_id,
      r.period,
      r.index_code,
      r.index_name_he ?? null,
      r.index_name_en ?? null,
      r.index_value,
      r.base_year,
      r.pct_change_monthly ?? null,
      r.pct_change_annual ?? null
    )
  );
  if (batch.length > 0) {
    await db.batch(batch);
  }
}

export async function insertReviewInsights(
  db: D1Database,
  rows: ReviewInsightRow[]
): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO review_insights (publication_id, file_id, topic, key_figures, summary, extracted_text, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = rows.map((r) =>
    stmt.bind(
      r.publication_id,
      r.file_id,
      r.topic ?? null,
      r.key_figures ?? null,
      r.summary ?? null,
      r.extracted_text ?? null,
      r.confidence ?? null
    )
  );
  if (batch.length > 0) {
    await db.batch(batch);
  }
}

export async function createPipelineRun(db: D1Database, run: PipelineRun): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO pipeline_runs (id, started_at, finished_at, status, sources_checked, files_discovered, files_downloaded, files_extracted, pdf_requests_created, pdf_results_processed, errors)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      run.id,
      run.started_at,
      run.finished_at ?? null,
      run.status,
      run.sources_checked,
      run.files_discovered,
      run.files_downloaded,
      run.files_extracted,
      run.pdf_requests_created,
      run.pdf_results_processed,
      JSON.stringify(run.errors)
    )
    .run();
}

export async function updatePipelineRun(
  db: D1Database,
  id: string,
  updates: Partial<PipelineRun>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.finished_at !== undefined) {
    fields.push('finished_at = ?');
    values.push(updates.finished_at);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.sources_checked !== undefined) {
    fields.push('sources_checked = ?');
    values.push(updates.sources_checked);
  }
  if (updates.files_discovered !== undefined) {
    fields.push('files_discovered = ?');
    values.push(updates.files_discovered);
  }
  if (updates.files_downloaded !== undefined) {
    fields.push('files_downloaded = ?');
    values.push(updates.files_downloaded);
  }
  if (updates.files_extracted !== undefined) {
    fields.push('files_extracted = ?');
    values.push(updates.files_extracted);
  }
  if (updates.pdf_requests_created !== undefined) {
    fields.push('pdf_requests_created = ?');
    values.push(updates.pdf_requests_created);
  }
  if (updates.pdf_results_processed !== undefined) {
    fields.push('pdf_results_processed = ?');
    values.push(updates.pdf_results_processed);
  }
  if (updates.errors !== undefined) {
    fields.push('errors = ?');
    values.push(JSON.stringify(updates.errors));
  }

  if (fields.length === 0) return;

  values.push(id);
  await db
    .prepare(`UPDATE pipeline_runs SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function getLatestPipelineRun(db: D1Database): Promise<PipelineRun | null> {
  const row = await db
    .prepare(`SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1`)
    .first<PipelineRun & { errors: string }>();
  if (!row) return null;
  return {
    ...row,
    errors: row.errors ? JSON.parse(row.errors as string) : [],
  };
}

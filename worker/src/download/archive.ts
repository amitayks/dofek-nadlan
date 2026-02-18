import type { DownloadedFile, FileRecord, PublicationRecord, PipelineError } from '../types';
import { uploadFile } from '../storage/r2';
import { insertPublication, insertFile } from '../storage/d1';

interface ArchiveResult {
  fileRecords: FileRecord[];
  errors: PipelineError[];
}

function buildR2Key(file: DownloadedFile): string {
  const entry = file.manifest_entry;

  switch (entry.source) {
    case 'cbs-publications': {
      const year = entry.metadata.year as string;
      const folder = entry.metadata.folder as string;
      return `raw-files/cbs/publications/${year}/${folder}/${entry.filename}`;
    }
    case 'cbs-media': {
      const year = entry.metadata.year as string;
      const release = entry.metadata.release_number as string;
      return `raw-files/cbs/media-releases/${year}/${release}/${entry.filename}`;
    }
    case 'cbs-xml-api': {
      return `raw-files/cbs/api-snapshots/${entry.filename}`;
    }
    case 'gov-il-reviews': {
      const slug = entry.metadata.url_name as string;
      return `raw-files/gov-il/reviews/${slug}/${entry.filename}`;
    }
    default:
      return `raw-files/other/${entry.filename}`;
  }
}

export async function archiveFiles(
  bucket: R2Bucket,
  db: D1Database,
  files: DownloadedFile[]
): Promise<ArchiveResult> {
  const fileRecords: FileRecord[] = [];
  const errors: PipelineError[] = [];

  // Group files by publication for batch publication creation
  const pubMap = new Map<string, DownloadedFile>();
  for (const file of files) {
    if (!pubMap.has(file.manifest_entry.publication_id)) {
      pubMap.set(file.manifest_entry.publication_id, file);
    }
  }

  // Create publication records
  for (const [pubId, sampleFile] of pubMap) {
    const entry = sampleFile.manifest_entry;
    const pub: PublicationRecord = {
      id: pubId,
      source_id: entry.source,
      title: entry.metadata.title as string | undefined,
      title_en: entry.metadata.title_en as string | undefined,
      publish_date: entry.publish_date,
      discovery_url: entry.url,
      raw_metadata: JSON.stringify(entry.metadata),
      status: 'downloaded',
    };
    try {
      await insertPublication(db, pub);
    } catch (err) {
      // Ignore duplicate key errors (idempotent)
      console.warn(`Publication ${pubId} may already exist:`, err);
    }
  }

  // Upload files to R2 and create file records
  for (const file of files) {
    const r2Key = buildR2Key(file);
    const entry = file.manifest_entry;
    const fileId = `${entry.publication_id}:${entry.filename}`;

    try {
      // Upload to R2 with metadata
      await uploadFile(bucket, r2Key, file.data, {
        source: entry.source,
        publication_id: entry.publication_id,
        original_url: entry.url,
        download_date: new Date().toISOString(),
        checksum: file.checksum_sha256,
      });

      // Create file record in D1
      const record: FileRecord = {
        id: fileId,
        publication_id: entry.publication_id,
        filename: entry.filename,
        format: entry.format,
        download_url: entry.url,
        r2_key: r2Key,
        file_size_bytes: file.file_size_bytes,
        checksum_sha256: file.checksum_sha256,
        is_preferred_format: file.is_preferred_format,
        extraction_status: file.is_preferred_format ? 'pending' : 'not_needed',
      };

      await insertFile(db, record);
      fileRecords.push(record);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Archive failed for ${entry.filename}:`, errMsg);
      errors.push({
        phase: 'archive',
        source: entry.source,
        file: entry.filename,
        error_message: errMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  console.log(`Archived ${fileRecords.length}/${files.length} files to R2`);
  return { fileRecords, errors };
}

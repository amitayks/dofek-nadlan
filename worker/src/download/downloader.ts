import type { ManifestEntry, DownloadedFile, PipelineError } from '../types';
import { fetchBinary } from '../utils/http';
import { expandZipFile } from './zip-extract';

interface DownloadResult {
  files: DownloadedFile[];
  errors: PipelineError[];
}

// Determine if a format is preferred for extraction given what other formats exist
function determinePreferred(entry: ManifestEntry, allEntries: ManifestEntry[]): boolean {
  // Find sibling files from the same publication that represent the same table
  const baseName = entry.filename.replace(/\.\w+$/, ''); // remove extension
  const siblings = allEntries.filter(
    (e) =>
      e.publication_id === entry.publication_id &&
      e.filename.replace(/\.\w+$/, '') === baseName &&
      e.filename !== entry.filename
  );

  const formatPriority: Record<string, number> = {
    xlsx: 1,
    xls: 2,
    docx: 3,
    doc: 4,
    pdf: 5,
    zip: 0, // special handling
    xml: 1,
  };

  const myPriority = formatPriority[entry.format] ?? 99;

  // If no siblings, this format is preferred
  if (siblings.length === 0) return true;

  // Check if any sibling has better priority
  const hasBetter = siblings.some((s) => {
    const sibPriority = formatPriority[s.format] ?? 99;
    return sibPriority < myPriority;
  });

  return !hasBetter;
}

async function computeChecksum(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function downloadFiles(
  manifest: ManifestEntry[]
): Promise<DownloadResult> {
  const newEntries = manifest.filter((e) => e.is_new);
  const files: DownloadedFile[] = [];
  const errors: PipelineError[] = [];

  for (const entry of newEntries) {
    // Skip XML API entries — they carry data inline, no download needed
    if (entry.source === 'cbs-xml-api') {
      const encoded = new TextEncoder().encode(
        (entry.metadata._xml_content as string) ?? ''
      );
      const xmlBuf = new ArrayBuffer(encoded.byteLength);
      new Uint8Array(xmlBuf).set(encoded);
      files.push({
        manifest_entry: entry,
        data: xmlBuf,
        file_size_bytes: 0,
        checksum_sha256: '',
        is_preferred_format: true,
      });
      continue;
    }

    try {
      const { data, size } = await fetchBinary(entry.url);

      // Validate non-zero size
      if (size === 0) {
        errors.push({
          phase: 'download',
          source: entry.source,
          file: entry.filename,
          error_message: `Downloaded file is 0 bytes: ${entry.url}`,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const checksum = await computeChecksum(data);
      const isPreferred = determinePreferred(entry, manifest);

      const downloadedFile: DownloadedFile = {
        manifest_entry: entry,
        data,
        file_size_bytes: size,
        checksum_sha256: checksum,
        is_preferred_format: isPreferred,
      };

      // Handle ZIP files: extract contents and add each as individual file
      if (entry.format === 'zip') {
        try {
          const extracted = await expandZipFile(downloadedFile, manifest);
          files.push(...extracted);
        } catch (zipErr) {
          const zipMsg = zipErr instanceof Error ? zipErr.message : String(zipErr);
          console.error(`ZIP extraction failed for ${entry.filename}:`, zipMsg);
          errors.push({
            phase: 'download',
            source: entry.source,
            file: entry.filename,
            error_message: `ZIP extraction failed: ${zipMsg}`,
            timestamp: new Date().toISOString(),
          });
          // Still archive the raw ZIP
          files.push(downloadedFile);
        }
      } else {
        files.push(downloadedFile);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Download failed for ${entry.filename}:`, errMsg);
      errors.push({
        phase: 'download',
        source: entry.source,
        file: entry.filename,
        error_message: errMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  console.log(`Downloaded ${files.length}/${newEntries.length} files`);
  return { files, errors };
}

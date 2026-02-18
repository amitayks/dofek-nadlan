import { unzipSync } from 'fflate';
import type { ManifestEntry, DownloadedFile } from '../types';

interface ExtractedEntry {
  filename: string;
  data: ArrayBuffer;
}

function getFormat(filename: string): ManifestEntry['format'] {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, ManifestEntry['format']> = {
    xlsx: 'xlsx',
    xls: 'xls',
    docx: 'docx',
    doc: 'doc',
    pdf: 'pdf',
    xml: 'xml',
  };
  return map[ext] ?? 'pdf'; // fallback
}

export function extractZip(data: ArrayBuffer): ExtractedEntry[] {
  const uint8 = new Uint8Array(data);
  const unzipped = unzipSync(uint8);
  const entries: ExtractedEntry[] = [];

  for (const [path, content] of Object.entries(unzipped)) {
    // Skip directories and macOS metadata files
    if (path.endsWith('/') || path.startsWith('__MACOSX/') || path.startsWith('.')) {
      continue;
    }
    // Skip zero-byte entries
    if (content.byteLength === 0) continue;

    const filename = path.includes('/') ? path.split('/').pop()! : path;
    // Copy to a new ArrayBuffer to avoid SharedArrayBuffer issues
    const buf = new ArrayBuffer(content.byteLength);
    new Uint8Array(buf).set(content);
    entries.push({
      filename,
      data: buf,
    });
  }

  return entries;
}

export async function expandZipFile(
  zipFile: DownloadedFile,
  allEntries: ManifestEntry[]
): Promise<DownloadedFile[]> {
  const entries = extractZip(zipFile.data);
  const results: DownloadedFile[] = [];

  for (const entry of entries) {
    const format = getFormat(entry.filename);

    // Build a manifest entry for the extracted file
    const childManifest: ManifestEntry = {
      ...zipFile.manifest_entry,
      filename: entry.filename,
      format,
      url: `${zipFile.manifest_entry.url}#${entry.filename}`,
      metadata: {
        ...zipFile.manifest_entry.metadata,
        _extracted_from_zip: zipFile.manifest_entry.filename,
      },
    };

    const hashBuffer = await crypto.subtle.digest('SHA-256', entry.data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const checksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // Determine format preference among extracted siblings
    const formatPriority: Record<string, number> = { xlsx: 1, xls: 2, docx: 3, doc: 4, pdf: 5 };
    const myPriority = formatPriority[format] ?? 99;
    const baseName = entry.filename.replace(/\.\w+$/, '');
    const siblings = entries.filter(
      (e) => e.filename !== entry.filename && e.filename.replace(/\.\w+$/, '') === baseName
    );
    const hasBetter = siblings.some((s) => {
      const sibFormat = getFormat(s.filename);
      return (formatPriority[sibFormat] ?? 99) < myPriority;
    });

    results.push({
      manifest_entry: childManifest,
      data: entry.data,
      file_size_bytes: entry.data.byteLength,
      checksum_sha256: checksum,
      is_preferred_format: !hasBetter,
    });
  }

  console.log(`Extracted ${results.length} files from ZIP ${zipFile.manifest_entry.filename}`);
  return results;
}

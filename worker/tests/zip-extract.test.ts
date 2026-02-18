import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractZip, expandZipFile } from '../src/download/zip-extract';
import type { DownloadedFile, ManifestEntry } from '../src/types';

function createZipBuffer(files: Record<string, string>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = strToU8(content);
  }
  const zipped = zipSync(entries);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

describe('ZIP Extract', () => {
  describe('extractZip', () => {
    it('extracts files from a ZIP', () => {
      const buffer = createZipBuffer({
        'data.xlsx': 'xlsx-content',
        'info.pdf': 'pdf-content',
      });

      const entries = extractZip(buffer);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.filename).sort()).toEqual(['data.xlsx', 'info.pdf']);
    });

    it('skips macOS metadata directories', () => {
      const buffer = createZipBuffer({
        '__MACOSX/._data.xlsx': 'metadata',
        'data.xlsx': 'real-content',
      });

      const entries = extractZip(buffer);
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe('data.xlsx');
    });

    it('skips dot files', () => {
      const buffer = createZipBuffer({
        '.DS_Store': 'garbage',
        'actual-file.xlsx': 'content',
      });

      const entries = extractZip(buffer);
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe('actual-file.xlsx');
    });

    it('handles nested directory paths', () => {
      const buffer = createZipBuffer({
        'folder/subfolder/data.xlsx': 'content',
      });

      const entries = extractZip(buffer);
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe('data.xlsx');
    });
  });

  describe('expandZipFile', () => {
    it('creates DownloadedFile entries for each extracted file', async () => {
      const buffer = createZipBuffer({
        'table1.xlsx': 'xlsx-data',
        'table1.pdf': 'pdf-data',
      });

      const manifest: ManifestEntry = {
        source: 'cbs-publications',
        url: 'https://example.com/housing.zip',
        filename: 'housing.zip',
        format: 'zip',
        publication_id: 'pub-001',
        publish_date: '2025-01-15',
        metadata: { year: '2025', folder: 'test' },
        is_new: true,
      };

      const zipFile: DownloadedFile = {
        manifest_entry: manifest,
        data: buffer,
        file_size_bytes: buffer.byteLength,
        checksum_sha256: 'abc123',
        is_preferred_format: false,
      };

      const expanded = await expandZipFile(zipFile, [manifest]);
      expect(expanded).toHaveLength(2);

      // xlsx should be preferred over pdf
      const xlsxFile = expanded.find((f) => f.manifest_entry.filename === 'table1.xlsx');
      const pdfFile = expanded.find((f) => f.manifest_entry.filename === 'table1.pdf');
      expect(xlsxFile).toBeDefined();
      expect(pdfFile).toBeDefined();
      expect(xlsxFile!.is_preferred_format).toBe(true);
      expect(pdfFile!.is_preferred_format).toBe(false);
    });

    it('preserves source metadata from parent ZIP', async () => {
      const buffer = createZipBuffer({
        'file.xlsx': 'content',
      });

      const manifest: ManifestEntry = {
        source: 'cbs-publications',
        url: 'https://example.com/data.zip',
        filename: 'data.zip',
        format: 'zip',
        publication_id: 'pub-001',
        publish_date: '2025-01-15',
        metadata: { year: '2025', folder: 'jan' },
        is_new: true,
      };

      const zipFile: DownloadedFile = {
        manifest_entry: manifest,
        data: buffer,
        file_size_bytes: buffer.byteLength,
        checksum_sha256: 'def456',
        is_preferred_format: false,
      };

      const expanded = await expandZipFile(zipFile, [manifest]);
      expect(expanded[0].manifest_entry.source).toBe('cbs-publications');
      expect(expanded[0].manifest_entry.publication_id).toBe('pub-001');
      expect(expanded[0].manifest_entry.metadata._extracted_from_zip).toBe('data.zip');
    });
  });
});

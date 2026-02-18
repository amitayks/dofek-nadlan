import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { parseDocx } from '../src/extraction/docx-parser';

// Helper to create a minimal DOCX buffer (DOCX = ZIP with XML)
function createDocx(documentXml: string): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      </Types>`
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`
    ),
    'word/document.xml': strToU8(documentXml),
  };

  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

describe('DOCX Parser', () => {
  it('extracts text from paragraphs', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Hello World</w:t></w:r></w:p>
        <w:p><w:r><w:t>Second paragraph with data.</w:t></w:r></w:p>
      </w:body>
    </w:document>`;

    const buffer = createDocx(docXml);
    const outputs = parseDocx(buffer, 'test.docx', 'pub-001', 'file-001');

    expect(outputs).toHaveLength(1);
    expect(outputs[0].type).toBe('review_insights');

    const record = outputs[0].data[0] as Record<string, unknown>;
    expect(record.publication_id).toBe('pub-001');
    expect(record.file_id).toBe('file-001');
    expect((record.extracted_text as string)).toContain('Hello World');
    expect((record.extracted_text as string)).toContain('Second paragraph');
  });

  it('extracts text from table cells', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Table data below</w:t></w:r></w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>District</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Jerusalem</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>2,500</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      </w:body>
    </w:document>`;

    const buffer = createDocx(docXml);
    const outputs = parseDocx(buffer, 'test.docx', 'pub-001', 'file-001');

    expect(outputs).toHaveLength(1);
    const record = outputs[0].data[0] as Record<string, unknown>;
    expect(record.tables).toBeDefined();
    // Table should have header row and data row
    expect((record.tables as string[][]).length).toBeGreaterThanOrEqual(2);
  });

  it('extracts key figures (percentages, NIS amounts)', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Prices rose by 5.2% this quarter. Average price is ₪1,850,000.</w:t></w:r></w:p>
      </w:body>
    </w:document>`;

    const buffer = createDocx(docXml);
    const outputs = parseDocx(buffer, 'test.docx', 'pub-001', 'file-001');

    const record = outputs[0].data[0] as Record<string, unknown>;
    expect(record.key_figures).toBeDefined();
    const figures = JSON.parse(record.key_figures as string);
    expect(figures.some((f: string) => f.includes('5.2'))).toBe(true);
  });

  it('returns empty for invalid ZIP data', () => {
    const invalidBuffer = new ArrayBuffer(100);
    const outputs = parseDocx(invalidBuffer, 'bad.docx', 'pub-001', 'file-001');
    expect(outputs).toHaveLength(0);
  });

  it('returns empty for ZIP without word/document.xml', () => {
    const files: Record<string, Uint8Array> = {
      'other.xml': strToU8('<root></root>'),
    };
    const zipped = zipSync(files);
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    const outputs = parseDocx(buffer, 'noword.docx', 'pub-001', 'file-001');
    expect(outputs).toHaveLength(0);
  });

  it('returns empty for document with no text content', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body></w:body>
    </w:document>`;

    const buffer = createDocx(docXml);
    const outputs = parseDocx(buffer, 'empty.docx', 'pub-001', 'file-001');
    expect(outputs).toHaveLength(0);
  });

  it('infers topic from content keywords', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>מדד המחירים לצרכן עלה ב-0.3 אחוז בחודש ינואר</w:t></w:r></w:p>
      </w:body>
    </w:document>`;

    const buffer = createDocx(docXml);
    const outputs = parseDocx(buffer, 'report.docx', 'pub-001', 'file-001');

    const record = outputs[0].data[0] as Record<string, unknown>;
    expect(record.topic).toBe('Price Index');
  });
});

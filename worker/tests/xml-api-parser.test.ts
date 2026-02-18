import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseXmlApi } from '../src/extraction/xml-api-parser';

// Sample XML matching the real CBS API format
const SAMPLE_XML = `<?xml version="1.0"?>
<indices UpdateDate="2026-01-15T08:00:00">
  <date year="2026" month="ינואר">
    <code code="120010">
      <name>מדד המחירים לצרכן - כללי</name>
      <percent>-0.3</percent>
      <index base="2024 ממוצע">103.3</index>
      <index base="2020 ממוצע" chainingCoefficient="1.059">117.49</index>
    </code>
    <code code="120020">
      <name>המדד ללא ירקות ופירות</name>
      <percent>-0.3</percent>
      <index base="2024 ממוצע">103.4</index>
      <index base="2020 ממוצע" chainingCoefficient="1.071">110.74</index>
    </code>
  </date>
</indices>`;

describe('XML API Parser (real CBS format)', () => {
  it('parses <code> blocks with correct index codes and names', () => {
    const outputs = parseXmlApi(SAMPLE_XML, 'pub-001', 'file-001');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].type).toBe('consumer_price_index');

    const rows = outputs[0].data;
    expect(rows).toHaveLength(2);

    const first = rows[0] as Record<string, unknown>;
    expect(first.index_code).toBe('120010');
    expect(first.index_name_he).toBe('מדד המחירים לצרכן - כללי');
    expect(first.period).toBe('2026-ינואר');
    expect(first.pct_change_monthly).toBe(-0.3);
  });

  it('prefers base year 2020 index value', () => {
    const outputs = parseXmlApi(SAMPLE_XML, 'pub-001', 'file-001');
    const first = outputs[0].data[0] as Record<string, unknown>;

    // Should use the 2020 base year value (117.49), not 2024 (103.3)
    expect(first.index_value).toBe(117.49);
    expect(first.base_year).toBe(2020);
  });

  it('falls back to first (most recent) base year if 2020 not available', () => {
    const xml = `<indices>
      <date year="2026" month="פברואר">
        <code code="999999">
          <name>Test Index</name>
          <percent>0.5</percent>
          <index base="2024 ממוצע">105.0</index>
        </code>
      </date>
    </indices>`;

    const outputs = parseXmlApi(xml, 'pub-002', 'file-002');
    expect(outputs).toHaveLength(1);

    const row = outputs[0].data[0] as Record<string, unknown>;
    expect(row.index_value).toBe(105.0);
    expect(row.base_year).toBe(2024);
  });

  it('returns empty for XML with no date element', () => {
    const outputs = parseXmlApi('<indices></indices>', 'pub-003', 'file-003');
    expect(outputs).toHaveLength(0);
  });

  it('returns empty for XML with no code elements', () => {
    const xml = '<indices><date year="2026" month="ינואר"></date></indices>';
    const outputs = parseXmlApi(xml, 'pub-004', 'file-004');
    expect(outputs).toHaveLength(0);
  });

  it('sets publication_id and file_id on all rows', () => {
    const outputs = parseXmlApi(SAMPLE_XML, 'my-pub', 'my-file');
    for (const row of outputs[0].data) {
      expect((row as Record<string, unknown>).publication_id).toBe('my-pub');
      expect((row as Record<string, unknown>).file_id).toBe('my-file');
    }
  });

  it('parses the real CBS XML API fixture file', () => {
    const fixturePath = join(__dirname, 'fixtures', 'cbs-xml-api-response.xml');
    const xmlText = readFileSync(fixturePath, 'utf-8');

    const outputs = parseXmlApi(xmlText, 'cbs-fixture', 'fixture-file');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].type).toBe('consumer_price_index');

    const rows = outputs[0].data;
    // The real file has many index codes
    expect(rows.length).toBeGreaterThan(5);

    // Verify first row has expected structure
    const first = rows[0] as Record<string, unknown>;
    expect(first.index_code).toBeDefined();
    expect(first.index_name_he).toBeDefined();
    expect(first.period).toMatch(/^\d{4}-/);
    expect(typeof first.index_value).toBe('number');
    expect(typeof first.base_year).toBe('number');

    // Verify the general CPI is present (code 120010)
    const generalCpi = rows.find((r) => (r as Record<string, unknown>).index_code === '120010');
    expect(generalCpi).toBeDefined();
    expect((generalCpi as Record<string, unknown>).index_name_he).toBe('מדד המחירים לצרכן - כללי');
  });
});

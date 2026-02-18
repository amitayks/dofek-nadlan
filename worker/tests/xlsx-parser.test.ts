import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseXlsx } from '../src/extraction/xlsx-parser';

// Helper to create a simple XLSX buffer from rows
function createXlsx(data: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return buf;
}

describe('XLSX Parser', () => {
  describe('Housing Price Index (Table 2.1)', () => {
    it('parses national housing price index data', () => {
      const data = [
        ['תקופה', 'מדד', 'שינוי חודשי'],
        ['2025-01', 150.5, 0.3],
        ['2025-02', 151.2, 0.5],
      ];
      const buffer = createXlsx(data);
      const outputs = parseXlsx(buffer, 'aa2_1_h.xlsx', 'pub-001', 'file-001');

      expect(outputs).toHaveLength(1);
      expect(outputs[0].type).toBe('housing_price_index');

      const rows = outputs[0].data;
      expect(rows).toHaveLength(2);

      const first = rows[0] as Record<string, unknown>;
      expect(first.period).toBe('2025-01');
      expect(first.index_value).toBe(150.5);
      expect(first.pct_change_monthly).toBe(0.3);
      expect(first.is_new_dwellings).toBe(false);
    });

    it('skips header rows containing Hebrew headers', () => {
      const data = [
        ['תקופה', 'ערך מדד', 'שינוי'],
        ['2025-01', 100.0, 0.1],
      ];
      const buffer = createXlsx(data);
      const outputs = parseXlsx(buffer, 'aa2_1_h.xlsx', 'pub-001', 'file-001');

      expect(outputs).toHaveLength(1);
      expect(outputs[0].data).toHaveLength(1);
    });
  });

  describe('Housing Price Index New (Table 2.4)', () => {
    it('marks records as new dwellings', () => {
      const data = [
        ['Period', 'Index', 'Change'],
        ['2025-01', 145.0, 0.2],
      ];
      const buffer = createXlsx(data);
      const outputs = parseXlsx(buffer, 'aa2_4_h.xlsx', 'pub-001', 'file-001');

      expect(outputs).toHaveLength(1);
      const row = outputs[0].data[0] as Record<string, unknown>;
      expect(row.is_new_dwellings).toBe(true);
    });
  });

  describe('Housing Price Index by District (Table 2.3)', () => {
    it('creates rows for each district column', () => {
      const data = [
        ['תקופה', 'ירושלים', 'צפון', 'חיפה', 'מרכז', 'תל אביב', 'דרום'],
        ['2025-01', 120.0, 115.0, 118.0, 125.0, 130.0, 112.0],
      ];
      const buffer = createXlsx(data);
      const outputs = parseXlsx(buffer, 'aa2_3_h.xlsx', 'pub-001', 'file-001');

      expect(outputs).toHaveLength(1);
      const rows = outputs[0].data;
      expect(rows).toHaveLength(6);

      const districts = rows.map((r) => (r as Record<string, unknown>).district);
      expect(districts).toContain('Jerusalem');
      expect(districts).toContain('Tel Aviv');
      expect(districts).toContain('South');
    });
  });

  describe('Average Apartment Prices (Table 2.2)', () => {
    it('parses district-grouped apartment price data', () => {
      const data = [
        ['', '1.5-2 חד', '2.5-3 חד', '3.5-4 חד'],
        ['ירושלים', '', '', ''],
        ['ירושלים עיר', 1200, 1800, 2500],
        ['בית שמש', 900, 1400, 2000],
      ];
      const buffer = createXlsx(data);
      const outputs = parseXlsx(buffer, 'aa2_2_h.xlsx', 'pub-001', 'file-001');

      expect(outputs).toHaveLength(1);
      expect(outputs[0].type).toBe('avg_apartment_prices');

      const rows = outputs[0].data;
      expect(rows.length).toBeGreaterThan(0);

      const first = rows[0] as Record<string, unknown>;
      expect(first.district).toBe('ירושלים');
      expect(first.avg_price_nis_thousands).toBeTypeOf('number');
    });
  });

  describe('Unknown file patterns', () => {
    it('returns empty for unrecognized filename patterns', () => {
      const data = [['test', 1]];
      const buffer = createXlsx(data);
      const outputs = parseXlsx(buffer, 'unknown_file.xlsx', 'pub-001', 'file-001');
      expect(outputs).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('handles empty sheet', () => {
      const buffer = createXlsx([]);
      const outputs = parseXlsx(buffer, 'aa2_1_h.xlsx', 'pub-001', 'file-001');
      expect(outputs).toHaveLength(0);
    });

    it('skips rows with non-numeric index values', () => {
      const data = [
        ['Period', 'Index'],
        ['2025-01', 'N/A'],
        ['2025-02', 105.0],
      ];
      const buffer = createXlsx(data);
      const outputs = parseXlsx(buffer, 'aa2_1_h.xlsx', 'pub-001', 'file-001');

      expect(outputs).toHaveLength(1);
      expect(outputs[0].data).toHaveLength(1);
      expect((outputs[0].data[0] as Record<string, unknown>).period).toBe('2025-02');
    });
  });
});

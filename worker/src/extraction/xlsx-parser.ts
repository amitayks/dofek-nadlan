import * as XLSX from 'xlsx';
import type { ExtractionOutput } from './router';
import type { HousingPriceIndexRow, AvgApartmentPriceRow } from '../types';

// Determine which parser to use based on filename pattern
function identifyTableType(filename: string): string | null {
  const lower = filename.toLowerCase();

  // Housing publication files: aa{chapter}_{table}_{lang}.xlsx
  if (lower.match(/^aa2_1_[he]\.xlsx?$/)) return 'housing_price_index_national';
  if (lower.match(/^aa2_2_[he]\.xlsx?$/)) return 'avg_apartment_prices';
  if (lower.match(/^aa2_3_[he]\.xlsx?$/)) return 'housing_price_index_by_district';
  if (lower.match(/^aa2_4_[he]\.xlsx?$/)) return 'housing_price_index_new';

  // CPI files: a{chapter}_{table}_{lang}.xlsx
  if (lower.match(/^a\d+_\d+_[he]\.xlsx?$/)) return 'cpi_table';

  // Section G files
  if (lower.match(/^g\d+_\d+_[he]\.xlsx?$/)) return 'price_statistics';

  // Media release tables: 10_YY_NNN{suffix}.xls(x)
  if (lower.match(/^10_\d{2}_\d{3}t\d\.xlsx?$/)) return 'media_release_table';

  return null;
}

export function parseXlsx(
  buffer: ArrayBuffer,
  filename: string,
  publicationId: string,
  fileId: string
): ExtractionOutput[] {
  const tableType = identifyTableType(filename);
  if (!tableType) {
    console.warn(`Unknown XLSX structure for ${filename}, skipping`);
    return [];
  }

  const workbook = XLSX.read(buffer, { type: 'array' });
  const outputs: ExtractionOutput[] = [];

  switch (tableType) {
    case 'housing_price_index_national':
      outputs.push(...parseHousingPriceIndex(workbook, publicationId, fileId, false));
      break;
    case 'housing_price_index_new':
      outputs.push(...parseHousingPriceIndex(workbook, publicationId, fileId, true));
      break;
    case 'housing_price_index_by_district':
      outputs.push(...parseHousingPriceIndexByDistrict(workbook, publicationId, fileId));
      break;
    case 'avg_apartment_prices':
      outputs.push(...parseAvgApartmentPrices(workbook, publicationId, fileId));
      break;
    default:
      console.log(`Parser for ${tableType} not yet implemented, skipping ${filename}`);
  }

  return outputs;
}

function parseHousingPriceIndex(
  workbook: XLSX.WorkBook,
  publicationId: string,
  fileId: string,
  isNew: boolean
): ExtractionOutput[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 });
  const rows: HousingPriceIndexRow[] = [];

  // CBS XLSX files typically have headers in the first few rows
  // The actual data starts after the header rows
  // Structure varies but generally: period | index values for different base years | % changes

  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown as unknown[];
    if (!Array.isArray(row) || row.length < 2) continue;

    const period = String(row[0] ?? '').trim();
    // Skip header rows and empty rows
    if (!period || period.includes('תקופה') || period.includes('Period')) continue;

    const indexValue = parseFloat(String(row[1] ?? ''));
    if (isNaN(indexValue)) continue;

    const pctChange = row.length > 2 ? parseFloat(String(row[2] ?? '')) : undefined;

    rows.push({
      publication_id: publicationId,
      file_id: fileId,
      period,
      index_value: indexValue,
      base_year: 2020, // Default base year, adjust based on header parsing
      pct_change_monthly: isNaN(pctChange ?? NaN) ? undefined : pctChange,
      is_new_dwellings: isNew,
    });
  }

  if (rows.length === 0) return [];
  return [{ type: 'housing_price_index', data: rows as unknown as Record<string, unknown>[] }];
}

function parseHousingPriceIndexByDistrict(
  workbook: XLSX.WorkBook,
  publicationId: string,
  fileId: string
): ExtractionOutput[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 });
  const rows: HousingPriceIndexRow[] = [];

  // Table 2.3 has districts as columns: period | Jerusalem | North | Haifa | Center | Tel Aviv | South
  const districts = ['ירושלים', 'צפון', 'חיפה', 'מרכז', 'תל אביב', 'דרום'];
  const districtsEn = ['Jerusalem', 'North', 'Haifa', 'Center', 'Tel Aviv', 'South'];

  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown as unknown[];
    if (!Array.isArray(row) || row.length < 3) continue;

    const period = String(row[0] ?? '').trim();
    if (!period || period.includes('תקופה') || period.includes('מחוז')) continue;

    for (let d = 0; d < Math.min(districts.length, row.length - 1); d++) {
      const val = parseFloat(String(row[d + 1] ?? ''));
      if (isNaN(val)) continue;

      rows.push({
        publication_id: publicationId,
        file_id: fileId,
        period,
        district: districtsEn[d],
        index_value: val,
        base_year: 2020,
        is_new_dwellings: false,
      });
    }
  }

  if (rows.length === 0) return [];
  return [{ type: 'housing_price_index', data: rows as unknown as Record<string, unknown>[] }];
}

function parseAvgApartmentPrices(
  workbook: XLSX.WorkBook,
  publicationId: string,
  fileId: string
): ExtractionOutput[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 });
  const rows: AvgApartmentPriceRow[] = [];

  // Table 2.2 is grouped by district/city with room count columns
  // Structure: area/city | 1.5-2 rooms | 2.5-3 rooms | 3.5-4 rooms | 4.5-5 rooms | 5+ rooms
  let currentDistrict = '';

  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown as unknown[];
    if (!Array.isArray(row) || row.length < 2) continue;

    const label = String(row[0] ?? '').trim();
    if (!label || label.includes('מחוז') || label.includes('District')) continue;

    // Check if this is a district header (bold / standalone text)
    const hasNumericValues = row.slice(1).some((v) => !isNaN(parseFloat(String(v ?? ''))));

    if (!hasNumericValues && label.length > 0) {
      currentDistrict = label;
      continue;
    }

    const roomCategories = ['1.5-2', '2.5-3', '3.5-4', '4.5-5', '5+'];
    for (let r = 0; r < Math.min(roomCategories.length, row.length - 1); r++) {
      const price = parseFloat(String(row[r + 1] ?? ''));
      if (isNaN(price) || price === 0) continue;

      rows.push({
        publication_id: publicationId,
        file_id: fileId,
        period: '', // Will be set from publication metadata
        district: currentDistrict,
        city: label !== currentDistrict ? label : undefined,
        rooms: roomCategories[r],
        avg_price_nis_thousands: price,
      });
    }
  }

  if (rows.length === 0) return [];
  return [{ type: 'avg_apartment_prices', data: rows as unknown as Record<string, unknown>[] }];
}

import type { ExtractionOutput } from './router';
import type { ConsumerPriceIndexRow } from '../types';

/**
 * Parse the real CBS XML API response.
 *
 * Actual format:
 * <indices UpdateDate="...">
 *   <date year="2026" month="ינואר">
 *     <code code="120010">
 *       <name>מדד המחירים לצרכן - כללי</name>
 *       <percent>-0.3</percent>
 *       <index base="2024 ממוצע">103.3</index>
 *       <index base="2020 ממוצע" chainingCoefficient="1.059">117.49</index>
 *       ...
 *     </code>
 *     ...
 *   </date>
 * </indices>
 */

const PREFERRED_BASE_YEAR = 2020;

export function parseXmlApi(
  xmlText: string,
  publicationId: string,
  fileId: string
): ExtractionOutput[] {
  const rows: ConsumerPriceIndexRow[] = [];

  // Extract period from <date year="..." month="...">
  const dateMatch = xmlText.match(/<date\s+year="(\d+)"\s+month="([^"]+)"/);
  if (!dateMatch) return [];

  const year = dateMatch[1];
  const monthHe = dateMatch[2];
  const period = `${year}-${monthHe}`;

  // Extract all <code> blocks
  const codeRegex = /<code\s+code="(\d+)">([\s\S]*?)<\/code>/g;
  let codeMatch: RegExpExecArray | null;

  while ((codeMatch = codeRegex.exec(xmlText)) !== null) {
    const indexCode = codeMatch[1];
    const block = codeMatch[2];

    // Extract name
    const nameMatch = block.match(/<name>([^<]*)<\/name>/);
    const nameHe = nameMatch ? nameMatch[1].trim() : '';

    // Extract percent change
    const pctMatch = block.match(/<percent>([^<]*)<\/percent>/);
    const pctChange = pctMatch ? parseFloat(pctMatch[1]) : undefined;

    // Extract index values by base year
    const indexRegex = /<index\s+base="([^"]*)"(?:\s+chainingCoefficient="[^"]*")?>([\d.]+)<\/index>/g;
    let indexMatch: RegExpExecArray | null;

    let preferredValue: number | null = null;
    let preferredBase = PREFERRED_BASE_YEAR;
    let firstValue: number | null = null;
    let firstBase = '';

    while ((indexMatch = indexRegex.exec(block)) !== null) {
      const baseName = indexMatch[1]; // e.g. "2020 ממוצע" or "2024 ממוצע"
      const value = parseFloat(indexMatch[2]);

      // Track the first (most recent base year) value
      if (firstValue === null) {
        firstValue = value;
        firstBase = baseName;
      }

      // Find the preferred base year
      const baseYearNum = parseInt(baseName, 10);
      if (baseYearNum === PREFERRED_BASE_YEAR) {
        preferredValue = value;
        preferredBase = baseYearNum;
      }
    }

    // Use preferred base year value, or fall back to first (most recent)
    const indexValue = preferredValue ?? firstValue;
    const baseYear = preferredValue !== null ? preferredBase : parseInt(firstBase, 10) || PREFERRED_BASE_YEAR;

    if (indexValue === null || isNaN(indexValue)) continue;

    rows.push({
      publication_id: publicationId,
      file_id: fileId,
      period,
      index_code: indexCode,
      index_name_he: nameHe,
      index_value: indexValue,
      base_year: baseYear,
      pct_change_monthly: pctChange !== undefined && !isNaN(pctChange) ? pctChange : undefined,
    });
  }

  if (rows.length === 0) return [];
  return [{ type: 'consumer_price_index', data: rows as unknown as Record<string, unknown>[] }];
}

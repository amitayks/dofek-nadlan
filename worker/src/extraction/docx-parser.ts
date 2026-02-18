import { unzipSync } from 'fflate';
import type { ExtractionOutput } from './router';

/**
 * Parse DOCX files by unzipping and reading word/document.xml.
 * DOCX is a ZIP archive containing XML files.
 * We extract text content and simple table structures.
 */
export function parseDocx(
  buffer: ArrayBuffer,
  filename: string,
  publicationId: string,
  fileId: string
): ExtractionOutput[] {
  const uint8 = new Uint8Array(buffer);
  let unzipped: Record<string, Uint8Array>;

  try {
    unzipped = unzipSync(uint8);
  } catch {
    console.warn(`Failed to unzip DOCX ${filename}`);
    return [];
  }

  // Read word/document.xml
  const docXml = unzipped['word/document.xml'];
  if (!docXml) {
    console.warn(`No word/document.xml in ${filename}`);
    return [];
  }

  const xmlText = new TextDecoder('utf-8').decode(docXml);

  // Extract all text runs from the document
  const extractedText = extractText(xmlText);
  if (!extractedText.trim()) return [];

  // Extract tables if present
  const tables = extractTables(xmlText);
  const keyFigures = extractKeyFigures(extractedText);

  // Build a summary from the first ~500 chars
  const summary = extractedText.slice(0, 500).trim();

  const record: Record<string, unknown> = {
    publication_id: publicationId,
    file_id: fileId,
    topic: inferTopic(filename, extractedText),
    summary,
    extracted_text: extractedText,
    confidence: 0.7,
  };

  if (keyFigures.length > 0) {
    record.key_figures = JSON.stringify(keyFigures);
  }

  if (tables.length > 0) {
    record.tables = tables;
  }

  return [{ type: 'review_insights', data: [record] }];
}

/** Extract plain text from DOCX XML by pulling <w:t> elements. */
function extractText(xml: string): string {
  const paragraphs: string[] = [];
  // Match paragraph blocks
  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pBlock = pMatch[0];
    // Extract text runs within the paragraph
    const runs: string[] = [];
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;

    while ((tMatch = tRegex.exec(pBlock)) !== null) {
      runs.push(tMatch[1]);
    }

    if (runs.length > 0) {
      paragraphs.push(runs.join(''));
    }
  }

  return paragraphs.join('\n');
}

/** Extract simple table data from DOCX XML. */
function extractTables(xml: string): string[][] {
  const tables: string[][] = [];
  const tblRegex = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let tblMatch: RegExpExecArray | null;

  while ((tblMatch = tblRegex.exec(xml)) !== null) {
    const tblBlock = tblMatch[0];
    const rowRegex = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(tblBlock)) !== null) {
      const rowBlock = rowMatch[0];
      const cells: string[] = [];
      const cellRegex = /<w:tc[ >][\s\S]*?<\/w:tc>/g;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellRegex.exec(rowBlock)) !== null) {
        const cellBlock = cellMatch[0];
        const texts: string[] = [];
        const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
        let tMatch: RegExpExecArray | null;

        while ((tMatch = tRegex.exec(cellBlock)) !== null) {
          texts.push(tMatch[1]);
        }
        cells.push(texts.join(''));
      }

      if (cells.length > 0) {
        tables.push(cells);
      }
    }
  }

  return tables;
}

/** Extract numeric figures from text (prices, percentages, indices). */
function extractKeyFigures(text: string): string[] {
  const figures: string[] = [];

  // Match percentage patterns
  const pctMatches = text.match(/[\d.,]+\s*%/g);
  if (pctMatches) {
    figures.push(...pctMatches.slice(0, 10));
  }

  // Match NIS amounts
  const nisMatches = text.match(/₪\s*[\d,]+(?:\.\d+)?/g);
  if (nisMatches) {
    figures.push(...nisMatches.slice(0, 10));
  }

  // Match large numbers (likely monetary/statistical)
  const numMatches = text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g);
  if (numMatches) {
    figures.push(...numMatches.slice(0, 10));
  }

  return [...new Set(figures)];
}

/** Infer topic from filename or content. */
function inferTopic(filename: string, text: string): string {
  const lower = filename.toLowerCase();

  if (lower.includes('price') || lower.includes('מחיר')) return 'Housing Prices';
  if (lower.includes('madad') || lower.includes('מדד')) return 'Price Index';
  if (lower.includes('review') || lower.includes('סקירה')) return 'Market Review';

  // Check content for clues
  const textLower = text.slice(0, 500).toLowerCase();
  if (textLower.includes('דירות') || textLower.includes('apartment')) return 'Housing';
  if (textLower.includes('מדד') || textLower.includes('index')) return 'Price Index';
  if (textLower.includes('נדל"ן') || textLower.includes('real estate')) return 'Real Estate';

  return 'Government Publication';
}

import type { FileRecord, PipelineError } from '../types';
import { parseXlsx } from './xlsx-parser';
import { parseXmlApi } from './xml-api-parser';
import { parseDocx } from './docx-parser';
import { createPdfExtractionRequest } from './pdf-request';
import { downloadFile } from '../storage/r2';

export interface ExtractionOutput {
  type: 'housing_price_index' | 'avg_apartment_prices' | 'consumer_price_index' | 'review_insights';
  data: Record<string, unknown>[];
}

interface ExtractionResult {
  extracted: { fileId: string; outputs: ExtractionOutput[] }[];
  pdfRequestsCreated: number;
  errors: PipelineError[];
}

export async function extractFiles(
  bucket: R2Bucket,
  db: D1Database,
  fileRecords: FileRecord[],
  runId: string
): Promise<ExtractionResult> {
  const pendingFiles = fileRecords.filter((f) => f.extraction_status === 'pending');
  const extracted: { fileId: string; outputs: ExtractionOutput[] }[] = [];
  const errors: PipelineError[] = [];
  let pdfRequestsCreated = 0;

  for (const file of pendingFiles) {
    try {
      switch (file.format) {
        case 'xlsx':
        case 'xls': {
          const obj = await downloadFile(bucket, file.r2_key);
          if (!obj) throw new Error(`File not found in R2: ${file.r2_key}`);
          const buffer = await obj.arrayBuffer();
          const outputs = parseXlsx(buffer, file.filename, file.publication_id, file.id);
          if (outputs.length > 0) {
            extracted.push({ fileId: file.id, outputs });
          }
          break;
        }
        case 'xml': {
          const obj = await downloadFile(bucket, file.r2_key);
          if (!obj) throw new Error(`File not found in R2: ${file.r2_key}`);
          const text = await obj.text();
          const outputs = parseXmlApi(text, file.publication_id, file.id);
          if (outputs.length > 0) {
            extracted.push({ fileId: file.id, outputs });
          }
          break;
        }
        case 'pdf': {
          // Create extraction request for GitHub Action
          await createPdfExtractionRequest(bucket, db, file, runId);
          pdfRequestsCreated++;
          break;
        }
        case 'docx': {
          const docxObj = await downloadFile(bucket, file.r2_key);
          if (!docxObj) throw new Error(`File not found in R2: ${file.r2_key}`);
          const docxBuffer = await docxObj.arrayBuffer();
          const docxOutputs = parseDocx(docxBuffer, file.filename, file.publication_id, file.id);
          if (docxOutputs.length > 0) {
            extracted.push({ fileId: file.id, outputs: docxOutputs });
          }
          break;
        }
        case 'doc': {
          // Legacy .doc format can't be parsed inline. Send to PDF extraction pipeline.
          await createPdfExtractionRequest(bucket, db, file, runId);
          pdfRequestsCreated++;
          break;
        }
        default:
          console.log(`Unknown format ${file.format} for ${file.filename}, skipping`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Extraction failed for ${file.filename}:`, errMsg);
      errors.push({
        phase: 'extraction',
        file: file.filename,
        error_message: errMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return { extracted, pdfRequestsCreated, errors };
}

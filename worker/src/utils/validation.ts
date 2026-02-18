import type {
  HousingPriceIndexRow,
  AvgApartmentPriceRow,
  ConsumerPriceIndexRow,
  ReviewInsightRow,
} from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateHousingPriceIndex(row: Partial<HousingPriceIndexRow>): ValidationResult {
  const errors: string[] = [];

  if (!row.publication_id) errors.push('Missing publication_id');
  if (!row.file_id) errors.push('Missing file_id');
  if (!row.period) errors.push('Missing period');
  if (row.index_value === undefined || row.index_value === null || isNaN(row.index_value)) {
    errors.push('Invalid or missing index_value');
  }
  if (!row.base_year || isNaN(row.base_year)) errors.push('Invalid or missing base_year');
  if (row.index_value !== undefined && (row.index_value < 0 || row.index_value > 10000)) {
    errors.push(`index_value ${row.index_value} out of reasonable range`);
  }

  return { valid: errors.length === 0, errors };
}

export function validateAvgApartmentPrice(row: Partial<AvgApartmentPriceRow>): ValidationResult {
  const errors: string[] = [];

  if (!row.publication_id) errors.push('Missing publication_id');
  if (!row.file_id) errors.push('Missing file_id');
  if (!row.period) errors.push('Missing period');
  if (!row.district) errors.push('Missing district');
  if (
    row.avg_price_nis_thousands === undefined ||
    row.avg_price_nis_thousands === null ||
    isNaN(row.avg_price_nis_thousands)
  ) {
    errors.push('Invalid or missing avg_price_nis_thousands');
  }
  if (
    row.avg_price_nis_thousands !== undefined &&
    (row.avg_price_nis_thousands < 0 || row.avg_price_nis_thousands > 100000)
  ) {
    errors.push(`avg_price_nis_thousands ${row.avg_price_nis_thousands} out of reasonable range`);
  }

  return { valid: errors.length === 0, errors };
}

export function validateConsumerPriceIndex(row: Partial<ConsumerPriceIndexRow>): ValidationResult {
  const errors: string[] = [];

  if (!row.publication_id) errors.push('Missing publication_id');
  if (!row.period) errors.push('Missing period');
  if (!row.index_code) errors.push('Missing index_code');
  if (row.index_value === undefined || row.index_value === null || isNaN(row.index_value)) {
    errors.push('Invalid or missing index_value');
  }
  if (!row.base_year || isNaN(row.base_year)) errors.push('Invalid or missing base_year');

  return { valid: errors.length === 0, errors };
}

export function validateReviewInsight(row: Partial<ReviewInsightRow>): ValidationResult {
  const errors: string[] = [];

  if (!row.publication_id) errors.push('Missing publication_id');
  if (!row.file_id) errors.push('Missing file_id');
  // Reviews are more free-form, so fewer strict requirements
  if (!row.summary && !row.extracted_text && !row.key_figures) {
    errors.push('At least one of summary, extracted_text, or key_figures must be present');
  }

  return { valid: errors.length === 0, errors };
}

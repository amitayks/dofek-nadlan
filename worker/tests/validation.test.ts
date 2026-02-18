import { describe, it, expect } from 'vitest';
import {
  validateHousingPriceIndex,
  validateAvgApartmentPrice,
  validateConsumerPriceIndex,
  validateReviewInsight,
} from '../src/utils/validation';

describe('Validation', () => {
  describe('validateHousingPriceIndex', () => {
    it('passes valid row', () => {
      const result = validateHousingPriceIndex({
        publication_id: 'pub-1',
        file_id: 'file-1',
        period: '2025-01',
        index_value: 150.5,
        base_year: 2020,
        is_new_dwellings: false,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing period', () => {
      const result = validateHousingPriceIndex({
        publication_id: 'pub-1',
        file_id: 'file-1',
        index_value: 150.5,
        base_year: 2020,
        is_new_dwellings: false,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing period');
    });

    it('rejects out-of-range index value', () => {
      const result = validateHousingPriceIndex({
        publication_id: 'pub-1',
        file_id: 'file-1',
        period: '2025-01',
        index_value: 15000,
        base_year: 2020,
        is_new_dwellings: false,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('out of reasonable range'))).toBe(true);
    });

    it('rejects NaN index value', () => {
      const result = validateHousingPriceIndex({
        publication_id: 'pub-1',
        file_id: 'file-1',
        period: '2025-01',
        index_value: NaN,
        base_year: 2020,
        is_new_dwellings: false,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateAvgApartmentPrice', () => {
    it('passes valid row', () => {
      const result = validateAvgApartmentPrice({
        publication_id: 'pub-1',
        file_id: 'file-1',
        period: '2025-01',
        district: 'Jerusalem',
        avg_price_nis_thousands: 2500,
      });
      expect(result.valid).toBe(true);
    });

    it('rejects missing district', () => {
      const result = validateAvgApartmentPrice({
        publication_id: 'pub-1',
        file_id: 'file-1',
        period: '2025-01',
        avg_price_nis_thousands: 2500,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing district');
    });

    it('rejects out-of-range price', () => {
      const result = validateAvgApartmentPrice({
        publication_id: 'pub-1',
        file_id: 'file-1',
        period: '2025-01',
        district: 'Jerusalem',
        avg_price_nis_thousands: 200000,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateConsumerPriceIndex', () => {
    it('passes valid row', () => {
      const result = validateConsumerPriceIndex({
        publication_id: 'pub-1',
        period: '2025-01',
        index_code: '110011',
        index_value: 108.3,
        base_year: 2020,
      });
      expect(result.valid).toBe(true);
    });

    it('rejects missing index_code', () => {
      const result = validateConsumerPriceIndex({
        publication_id: 'pub-1',
        period: '2025-01',
        index_value: 108.3,
        base_year: 2020,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing index_code');
    });
  });

  describe('validateReviewInsight', () => {
    it('passes row with summary', () => {
      const result = validateReviewInsight({
        publication_id: 'pub-1',
        file_id: 'file-1',
        summary: 'Market shows growth',
      });
      expect(result.valid).toBe(true);
    });

    it('passes row with extracted_text only', () => {
      const result = validateReviewInsight({
        publication_id: 'pub-1',
        file_id: 'file-1',
        extracted_text: 'Some extracted content',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects row with no content fields', () => {
      const result = validateReviewInsight({
        publication_id: 'pub-1',
        file_id: 'file-1',
      });
      expect(result.valid).toBe(false);
    });
  });
});

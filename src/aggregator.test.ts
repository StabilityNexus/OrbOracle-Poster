import { calculateMedianAndNormalize } from './aggregator.js';

describe('Data Aggregator - Median & Normalization', () => {
    it('should correctly calculate the median of a simple list of odd length numbers', () => {
        const prices = [10.5, 12.0, 11.2]; // sorted: 10.5, 11.2, 12.0 -> median: 11.2
        const result = calculateMedianAndNormalize(prices);
        
        // 11.2 * 1e18 = 11200000000000000000
        expect(result).toBe(11200000000000000000n);
    });

    it('should correctly calculate the median of a simple list of even length numbers', () => {
        const prices = [10.5, 12.0, 11.2, 10.8]; // sorted: 10.5, 10.8, 11.2, 12.0 -> median: (10.8 + 11.2) / 2 = 11.0
        const result = calculateMedianAndNormalize(prices);
        
        // 11.0 * 1e18 = 11000000000000000000
        expect(result).toBe(11000000000000000000n);
    });

    it('should filter out null and undefined values and still compute the median correctly', () => {
        const prices = [15.0, null, 14.0, undefined, 16.0]; // sorted valid: 14.0, 15.0, 16.0 -> median 15.0
        const result = calculateMedianAndNormalize(prices);
        
        expect(result).toBe(15000000000000000000n);
    });

    it('should handle large decimals reliably and truncate precisely', () => {
        const prices = [10.123456789, 10.123456789, 10.123456789]; 
        const result = calculateMedianAndNormalize(prices);
        
        // Math.floor(10.123456789 * 1e8) = Math.floor(1012345678.9) = 1012345678
        // 1012345678 * 1e10 = 10123456780000000000
        expect(result).toBe(10123456780000000000n);
    });

    it('should filter out NaN and compute properly', () => {
        const prices = [1.0, NaN, 3.0, 2.0]; // valid: 1.0, 2.0, 3.0 -> median 2.0
        const result = calculateMedianAndNormalize(prices);
        
        expect(result).toBe(2000000000000000000n);
    });

    it('should correctly work with a single precise input', () => {
        const prices = [null, undefined, 42.42]; 
        const result = calculateMedianAndNormalize(prices);
        
        expect(result).toBe(42420000000000000000n);
    });

    it('should panic if all provided sources fail (are null/undefined/NaN)', () => {
        const prices = [null, undefined, NaN]; 
        
        expect(() => {
            calculateMedianAndNormalize(prices);
        }).toThrow("All data sources failed to return a valid price.");
    });
});

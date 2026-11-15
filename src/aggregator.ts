const SOURCE_PRECISION_DECIMALS = 8;
const ORACLE_DECIMALS = 18;
const SOURCE_SCALE = 10 ** SOURCE_PRECISION_DECIMALS;
const ORACLE_SCALE = 10n ** BigInt(ORACLE_DECIMALS - SOURCE_PRECISION_DECIMALS);

export function calculateMedianAndNormalize(prices: (number | null | undefined)[]): bigint {
    const validPrices = prices.filter((p): p is number => p !== null && p !== undefined && !isNaN(p));

    if (validPrices.length === 0) {
        throw new Error("All data sources failed to return a valid price.");
    }

    // Median aggregation
    validPrices.sort((a, b) => a - b);
    const mid = Math.floor(validPrices.length / 2);
    const medianPrice = validPrices.length % 2 !== 0 
        ? validPrices[mid]! 
        : (validPrices[mid - 1]! + validPrices[mid]!) / 2;

    // Scale through an 8-decimal integer first so the 18-decimal result never
    // passes through a floating-point number above Number.MAX_SAFE_INTEGER.
    const sourceScaled = BigInt(Math.floor(medianPrice * SOURCE_SCALE));
    return sourceScaled * ORACLE_SCALE;
}

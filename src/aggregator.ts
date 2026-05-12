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

    // Convert to BigInt scaled up by 1e8 for precise integer arithmetic
    const normalizedPrice = BigInt(Math.floor(medianPrice * 1e8));
    return normalizedPrice;
}

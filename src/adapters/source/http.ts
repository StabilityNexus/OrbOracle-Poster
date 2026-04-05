export function normalizePriceTo18(value: unknown): bigint {
  const numeric = typeof value === 'string' ? Number(value) : (value as number);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Invalid non-positive price from source');
  }

  const scaled = Math.round(numeric * 1e8);
  return BigInt(scaled) * 10n ** 10n;
}

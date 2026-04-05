export function isPositiveBigint(value: bigint): boolean {
  return value > 0n;
}

export function isStale(nowMs: number, sourceTimestampMs: number, staleAfterMs: number): boolean {
  return nowMs - sourceTimestampMs > staleAfterMs;
}

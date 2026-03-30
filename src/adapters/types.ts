export interface PriceResult {
  price: bigint;
  timestamp: number;
  confidence: number;
}

export interface PriceAdapter {
  name: string;
  fetchPrice(pair: string): Promise<PriceResult>;
}

import { parseGwei } from 'viem';
import { logger } from '../utils/logger';

type GasClient = {
  getBlock: (args: { blockTag: 'latest' }) => Promise<Record<string, unknown>>;
};

class PriorityFeeRingBuffer {
  private buffer: bigint[];
  private index = 0;
  private filled = false;

  constructor(private capacity: number) {
    this.buffer = new Array<bigint>(capacity).fill(0n);
  }

  add(fee: bigint): void {
    this.buffer[this.index] = fee;
    this.index = (this.index + 1) % this.capacity;
    if (this.index === 0) this.filled = true;
  }

  getMedian(): bigint {
    const values = this.filled ? this.buffer : this.buffer.slice(0, this.index);
    if (values.length === 0 || values.every((v) => v === 0n)) return 0n;
    const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2n;
  }
}

export class GasEstimator {
  private feeHistory: PriorityFeeRingBuffer;

  constructor(
    private client: GasClient,
    opts: {
      historyWindowSize?: number;
    } = {},
  ) {
    const capacity = opts.historyWindowSize && opts.historyWindowSize > 0 ? opts.historyWindowSize : 20;
    this.feeHistory = new PriorityFeeRingBuffer(capacity);
  }

  recordPriorityFee(fee: bigint): void {
    if (fee <= 0n) return;
    this.feeHistory.add(fee);
  }

  getHistoricalMedian(): bigint {
    return this.feeHistory.getMedian();
  }

  async estimateGasFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    try {
      const block = await this.client.getBlock({ blockTag: 'latest' });
      const baseFee = (block as { baseFeePerGas?: bigint | null }).baseFeePerGas ?? 0n;
      
      // Basic EIP-1559 estimation: BASE_FEE * 1.5 + Priority Fee
      // Fallback priority fee to 2 gwei if not directly available
      const historicalMedian = this.getHistoricalMedian();
      const maxPriorityFeePerGas = historicalMedian > 0n ? historicalMedian : parseGwei('2');
      const maxFeePerGas = (baseFee * 150n) / 100n + maxPriorityFeePerGas;

      logger.debug({ 
        event: 'GAS_ESTIMATED', 
        maxFeePerGas: maxFeePerGas.toString(), 
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString() 
      });

      return { maxFeePerGas, maxPriorityFeePerGas };
    } catch (error: any) {
      logger.error({ event: 'GAS_ESTIMATE_ERROR', error: error.message });
      throw error;
    }
  }
}

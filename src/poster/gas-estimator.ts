import { parseGwei } from 'viem';
import { logger } from '../utils/logger';

type GasClient = {
  getBlock: (args: { blockTag: 'latest' }) => Promise<Record<string, unknown>>;
};

export class GasEstimator {
  constructor(private client: GasClient) {}

  async estimateGasFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    try {
      const block = await this.client.getBlock({ blockTag: 'latest' });
      const baseFee = (block as { baseFeePerGas?: bigint | null }).baseFeePerGas ?? 0n;
      
      // Basic EIP-1559 estimation: BASE_FEE * 1.5 + Priority Fee
      // Fallback priority fee to 2 gwei if not directly available
      const maxPriorityFeePerGas = parseGwei('2');
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

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { OneInchAdapter } from '../src/adapters/oneinch';
import { CircuitState } from '../src/utils/circuit-breaker';

jest.mock('axios');

const TEST_STATE_FILE = path.resolve(process.cwd(), './data/circuit-breaker-state.json');

function clearCircuitState() {
  try {
    if (fs.existsSync(TEST_STATE_FILE)) {
      fs.unlinkSync(TEST_STATE_FILE);
    }
  } catch {}
}

describe('OneInchAdapter', () => {
  const mockedAxios = axios as unknown as { get: jest.Mock };

  beforeEach(() => {
    clearCircuitState();
    mockedAxios.get.mockReset();
  });

  afterAll(() => {
    clearCircuitState();
  });

  it('starts with NORMAL circuit breaker state', () => {
    const adapter = new OneInchAdapter({ baseUrl: 'http://example.invalid' });
    expect(adapter.getCircuitBreakerState()).toBe(CircuitState.NORMAL);
  });

  it('fetches ETH/USD and scales USDC quote amount to 18 decimals', async () => {
    // toTokenAmount is in USDC base units (6 decimals)
    mockedAxios.get.mockResolvedValue({
      data: {
        toTokenAmount: '123456789',
        toToken: { decimals: 6 },
      },
    });

    const adapter = new OneInchAdapter({ baseUrl: 'http://example.invalid' });
    const result = await adapter.fetchPrice('ETH/USD');

    // 123.456789 USDC => 123456789 * 10^(18-6)
    expect(result.price).toBe(123456789n * 10n ** 12n);
    expect(result.timestamp).toEqual(expect.any(Number));
    expect(result.confidence).toBeGreaterThan(0);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('falls back to known USDC decimals when response omits token decimals', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        toTokenAmount: '1000000',
      },
    });

    const adapter = new OneInchAdapter({ baseUrl: 'http://example.invalid' });
    const result = await adapter.fetchPrice('ETH/USD');

    // 1 USDC => 1e6 base units => 1e18 after scaling
    expect(result.price).toBe(10n ** 18n);
  });

  it('throws on unsupported pair', async () => {
    const adapter = new OneInchAdapter({ baseUrl: 'http://example.invalid' });
    await expect(adapter.fetchPrice('SOL/USD')).rejects.toThrow('Unsupported pair');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

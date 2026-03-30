import { PosterConfigSchema } from '../src/config/schema';

describe('PosterConfigSchema', () => {
  const validConfig = {
    oracles: [
      {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        chainId: 534351,
        rpcUrl: 'https://sepolia-rpc.scroll.io',
        pricePair: 'ETH/USD',
        policy: {
          heartbeatIntervalMs: 60000,
          deviationThresholdBps: 50,
          maxRetries: 3,
          backoffMultiplier: 2,
          staleAfterMs: 120000,
        },
      },
    ],
    priceSources: ['coingecko'],
    walletKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    pollingIntervalMs: 10000,
    dryRun: false,
    stateFilePath: '.orb-poster-state.json',
  };

  it('accepts a valid config', () => {
    const parsed = PosterConfigSchema.parse(validConfig);
    expect(parsed.oracles).toHaveLength(1);
  });

  it('rejects invalid chain id', () => {
    const invalid = {
      ...validConfig,
      oracles: [{ ...validConfig.oracles[0], chainId: 0 }],
    };
    expect(() => PosterConfigSchema.parse(invalid)).toThrow();
  });

  it('rejects invalid oracle address', () => {
    const invalid = {
      ...validConfig,
      oracles: [{ ...validConfig.oracles[0], address: 'not-an-address' }],
    };
    expect(() => PosterConfigSchema.parse(invalid)).toThrow();
  });

  it('rejects invalid thresholds and intervals', () => {
    const invalid = {
      ...validConfig,
      oracles: [
        {
          ...validConfig.oracles[0],
          policy: {
            ...validConfig.oracles[0].policy,
            heartbeatIntervalMs: -1,
          },
        },
      ],
    };
    expect(() => PosterConfigSchema.parse(invalid)).toThrow();
  });
});

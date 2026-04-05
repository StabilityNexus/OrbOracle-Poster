import { loadConfig } from './config/load';
import { logger } from './utils/logger';
import { PriceAdapter } from './adapters/types';
import { CoingeckoAdapter } from './adapters/coingecko';
import { CoinmarketcapAdapter } from './adapters/coinmarketcap';
import { BinanceAdapter } from './adapters/binance';
import { MedianAggregator } from './adapters/aggregator';
import { PolicyEngine } from './poster/policy';
import { Submitter } from './poster/submitter';
import { withRetry } from './utils/retry';
import { getMonitor } from './monitor/ws-server';
import { getHttpServer, HttpServer } from './monitor/http-server';
import { incrementPriceUpdates, incrementSubmissions } from './monitor/metrics';
import { alertDispatcher } from './monitor/alerts';
import { FileStateStore } from './store/state';
import dotenv from 'dotenv';
import { CoinbaseAdapter } from './adapters/coinbase';
import { KrakenAdapter } from './adapters/kraken';
import { OneInchAdapter } from './adapters/oneinch';

dotenv.config({ path: process.env.ENV_PATH || '.env.local' });

function instantiateAdapters(names: string[]): PriceAdapter[] {
  const adapters: PriceAdapter[] = [];
  for (const name of names) {
    if (name === 'coingecko') adapters.push(new CoingeckoAdapter());
    else if (name === 'coinmarketcap') adapters.push(new CoinmarketcapAdapter());
    else if (name === 'binance') adapters.push(new BinanceAdapter());
    else if (name === 'coinbase') adapters.push(new CoinbaseAdapter());
    else if (name === 'kraken') adapters.push(new KrakenAdapter());
    else if (name === 'oneinch') adapters.push(new OneInchAdapter());
    else logger.warn({ event: 'UNKNOWN_ADAPTER', name });
  }
  return adapters;
}

function oracleKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

let stateStoreRef: FileStateStore | null = null;
let httpServerRef: ReturnType<typeof getHttpServer> | null = null;
let shutdownRequested = false;
let nonceSyncTimer: NodeJS.Timeout | null = null;

async function main() {
  logger.info({ event: 'BOOTSTRAP', msg: 'OrbOracle Poster Daemon starting' });

  const config = loadConfig();
  
  // Configure alert dispatcher from config
  if (config.alertConfig) {
    alertDispatcher.configure({
      enabled: config.alertConfig.enabled,
      webhookUrls: config.alertConfig.webhookUrls,
      minSeverity: config.alertConfig.minSeverity,
    });
  }

  // Start HTTP server for health and metrics
  const httpServer = getHttpServer();
  await httpServer.start();
  httpServerRef = httpServer;

  const adapters = instantiateAdapters(config.priceSources);
  if (adapters.length === 0) {
    logger.fatal({ event: 'NO_ADAPTERS' }, 'No valid price adapters configured');
    process.exit(1);
  }

  const aggregator = new MedianAggregator(adapters);
  const stateStore = new FileStateStore(config.stateFilePath);
  stateStoreRef = stateStore;
  const privateKey = config.walletKey || process.env.PRIVATE_KEY;
  if (!config.dryRun && !privateKey) {
    logger.fatal({ event: 'NO_PRIVATE_KEY' }, 'No wallet private key found in config or environment');
    process.exit(1);
  }

  const targets = config.oracles.map((oracleConf) => ({
    config: oracleConf,
    policy: new PolicyEngine(oracleConf.policy),
    submitter:
      config.dryRun || !privateKey
        ? null
        : new Submitter(oracleConf, privateKey, { gasHistoryWindowSize: config.gasHistoryWindowSize }),
  }));
  const monitor = getMonitor();

  httpServer.configure({
    aggregator,
    adapters,
    stateStore,
    getGasEstimate: async () => {
      const first = targets.find((t) => t.submitter)?.submitter;
      if (!first) return { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
      return first.estimateGasFees();
    },
    getPendingTxCount: async () => {
      const submitters = targets.map((t) => t.submitter).filter((s): s is Submitter => !!s);
      const counts = await Promise.all(submitters.map((s) => s.getPendingTxCount()));
      return counts.reduce((acc, v) => acc + v, 0);
    },
  });

  logger.info({
    event: 'START_LOOP',
    msg: 'Started execution loop',
    oraclesCount: targets.length,
    pollingIntervalMs: config.pollingIntervalMs,
    dryRun: config.dryRun,
  });

  // Periodically sync nonce state with network to detect external gaps.
  nonceSyncTimer = setInterval(() => {
    const submitters = targets.map((t) => t.submitter).filter((s): s is Submitter => !!s);
    for (const submitter of submitters) {
      submitter.syncNonceWithNetwork().catch((error: any) => {
        logger.warn({ event: 'NONCE_SYNC_ERROR', error: error.message });
      });
    }
  }, 30000);

  while (!shutdownRequested) {
    for (const target of targets) {
      const key = oracleKey(target.config.chainId, target.config.address);
      const state = stateStore.get(key);

      try {
        const aggResult = await aggregator.aggregate(target.config.pricePair);
        const nowMs = Date.now();

        stateStore.update(key, {
          lastFetchedPrice: aggResult.price,
          lastFetchTime: nowMs,
          lastSourceTimestamp: aggResult.timestamp,
        });

        // Increment metrics for successful price fetch
        incrementPriceUpdates();

        const gasPriceGwei = target.submitter ? await target.submitter.getCurrentGasGwei() : undefined;
        const decision = target.policy.evaluate(
          aggResult.price,
          {
            lastSubmitTime: state.lastSubmitTime,
            lastSubmittedPrice: state.lastSubmittedPrice,
          },
          {
            nowMs,
            sourceTimestampMs: aggResult.timestamp,
            dryRun: config.dryRun,
            gasPriceGwei,
          },
        );

        stateStore.update(key, { lastDecisionReason: decision.reason });

        logger.info({
          event: 'POLICY_DECISION',
          oracle: target.config.address,
          chainId: target.config.chainId,
          pair: target.config.pricePair,
          shouldSubmit: decision.shouldSubmit,
          reason: decision.reason,
          trigger: decision.trigger,
          deviationBps: decision.deviationBps,
          trace: decision.trace,
        });

        if (!decision.shouldSubmit) {
          if (decision.reason === 'dry_run_only' && decision.trigger) {
            // In dry-run mode, simulate a successful submit so state advances.
            stateStore.update(key, {
              lastSubmittedPrice: aggResult.price,
              lastSubmitTime: nowMs,
              lastSuccessTime: nowMs,
              lastDecisionReason: decision.reason,
            });
            logger.info({
              event: 'DRY_RUN_SIMULATION',
              oracle: target.config.address,
              pair: target.config.pricePair,
              price: aggResult.price.toString(),
              trigger: decision.trigger,
            });
          }
          continue;
        }

        if (!target.submitter) {
          // dry-run with shouldSubmit true should still update state
          stateStore.update(key, {
            lastSubmittedPrice: aggResult.price,
            lastSubmitTime: nowMs,
            lastSuccessTime: nowMs,
            lastDecisionReason: decision.reason,
          });
          logger.info({
            event: 'DRY_RUN_SIMULATION',
            oracle: target.config.address,
            pair: target.config.pricePair,
            price: aggResult.price.toString(),
            trigger: decision.trigger,
          });
          continue;
        }

        const minStake = BigInt(target.config.minStake ?? '0');
        if (minStake > 0n) {
          const stakeStatus = await target.submitter.hasSufficientStake(minStake);
          if (!stakeStatus.ok) {
            stateStore.update(key, { lastDecisionReason: 'insufficient_stake' });
            logger.warn({
              event: 'STAKE_INSUFFICIENT',
              oracle: target.config.address,
              chainId: target.config.chainId,
              required: minStake.toString(),
              actual: stakeStatus.total.toString(),
            });
            continue;
          }
        }

        const hash = await withRetry(
          () => target.submitter!.submitPrice(aggResult.price, decision.trigger || 'deviation'),
          {
            maxAttempts: target.config.policy.maxRetries,
            backoffMultiplier: target.config.policy.backoffMultiplier,
            operationName: `SubmitPrice-${target.config.pricePair}`,
            isRetryable: Submitter.isRetryableError,
          }
        );

        stateStore.update(key, {
          lastSubmittedPrice: aggResult.price,
          lastSubmitTime: nowMs,
          lastTxHash: hash,
          recentFailures: [],
          lastDecisionReason: decision.reason,
        });

        // Increment metrics for successful submission
        incrementSubmissions(true);

        // WebSocket submission events are emitted by Submitter.
      } catch (error: any) {
        const previous = stateStore.get(key);
        const recentFailures = [...previous.recentFailures.slice(-3), `${new Date().toISOString()}: ${error.message}`];
        stateStore.update(key, {
          recentFailures,
        });

        // Increment metrics for failed submission
        incrementSubmissions(false);

        // Send alert for critical errors
        await alertDispatcher.alertError('EXECUTION_ERROR', `Oracle error for ${target.config.pricePair}`, {
          chainId: target.config.chainId,
          oracle: target.config.address,
          error: error.message,
        });

        logger.error({
          event: 'EXECUTION_LOOP_ERROR',
          oracle: target.config.address,
          chainId: target.config.chainId,
          pair: target.config.pricePair,
          error: error.message,
        });
      }
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollingIntervalMs));
  }
}

if (require.main === module) {
  const shutdown = async (signal: string) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.fatal({ event: 'SHUTDOWN_SIGNAL', signal });
    try {
      if (nonceSyncTimer) {
        clearInterval(nonceSyncTimer);
        nonceSyncTimer = null;
      }
      if (httpServerRef) {
        await httpServerRef.stop();
      }
      if (stateStoreRef && typeof (stateStoreRef as any)?.flushPersist === 'function') {
        await (stateStoreRef as any).flushPersist();
      }
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ event: 'UNHANDLED_REJECTION', reason });
    void shutdown('UNHANDLED_REJECTION');
  });

  main();
}

export { main };

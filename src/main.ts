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
import { monitor } from './monitor/ws-server';
import { FileStateStore } from './store/state';
import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_PATH || '.env.local' });

function instantiateAdapters(names: string[]): PriceAdapter[] {
  const adapters: PriceAdapter[] = [];
  for (const name of names) {
    if (name === 'coingecko') adapters.push(new CoingeckoAdapter());
    else if (name === 'coinmarketcap') adapters.push(new CoinmarketcapAdapter());
    else if (name === 'binance') adapters.push(new BinanceAdapter());
    else logger.warn({ event: 'UNKNOWN_ADAPTER', name });
  }
  return adapters;
}

function oracleKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

async function main() {
  logger.info({ event: 'BOOTSTRAP', msg: 'OrbOracle Poster Daemon starting' });

  const config = loadConfig();
  const adapters = instantiateAdapters(config.priceSources);
  if (adapters.length === 0) {
    logger.fatal({ event: 'NO_ADAPTERS' }, 'No valid price adapters configured');
    process.exit(1);
  }

  const aggregator = new MedianAggregator(adapters);
  const stateStore = new FileStateStore(config.stateFilePath);
  const privateKey = config.walletKey || process.env.PRIVATE_KEY;
  if (!config.dryRun && !privateKey) {
    logger.fatal({ event: 'NO_PRIVATE_KEY' }, 'No wallet private key found in config or environment');
    process.exit(1);
  }

  const targets = config.oracles.map((oracleConf) => ({
    config: oracleConf,
    policy: new PolicyEngine(oracleConf.policy),
    submitter: config.dryRun || !privateKey ? null : new Submitter(oracleConf, privateKey),
  }));

  logger.info({
    event: 'START_LOOP',
    msg: 'Started execution loop',
    oraclesCount: targets.length,
    pollingIntervalMs: config.pollingIntervalMs,
    dryRun: config.dryRun,
  });

  while (true) {
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
          target.config.policy.maxRetries,
          target.config.policy.backoffMultiplier,
          `SubmitPrice-${target.config.pricePair}`,
        );

        stateStore.update(key, {
          lastSubmittedPrice: aggResult.price,
          lastSubmitTime: nowMs,
          lastSuccessTime: nowMs,
          lastTxHash: hash,
          recentFailures: [],
          lastDecisionReason: decision.reason,
        });

        monitor?.broadcast({
          event: 'PRICE_SUBMITTED',
          oracle: target.config.address,
          chainId: target.config.chainId,
          pair: target.config.pricePair,
          price: aggResult.price.toString(),
          trigger: decision.trigger,
          txHash: hash,
          timestamp: nowMs,
        });
      } catch (error: any) {
        const previous = stateStore.get(key);
        const recentFailures = [...previous.recentFailures.slice(-4), `${new Date().toISOString()}: ${error.message}`];
        stateStore.update(key, {
          recentFailures,
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
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ event: 'UNHANDLED_REJECTION', reason });
    process.exit(1);
  });
  main();
}

export { main };

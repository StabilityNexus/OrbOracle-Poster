import http from 'http';
import { logger } from '../utils/logger';
import { healthRouter } from './health';
import { metricsRouter } from './metrics';
import type { MedianAggregator } from '../adapters/aggregator';
import { UnsupportedTokenError } from '../adapters/aggregator';
import type { PriceAdapter } from '../adapters/types';
import { CircuitState } from '../utils/circuit-breaker';
import type { FileStateStore } from '../store/state';

type GasFeeEstimate = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

export type HttpServerDeps = {
  aggregator: MedianAggregator;
  adapters: PriceAdapter[];
  stateStore: FileStateStore;
  getGasEstimate?: () => Promise<GasFeeEstimate>;
  getPendingTxCount?: () => number | Promise<number>;
};

function jsonResponse(res: http.ServerResponse, data: unknown, statusCode = 200): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function mapCircuitState(state: CircuitState): 'closed' | 'open' | 'half-open' {
  if (state === CircuitState.NORMAL) return 'closed';
  if (state === CircuitState.OPEN) return 'open';
  return 'half-open';
}

export class HttpServer {
  private server: http.Server | null = null;
  private port: number = 3001;
  private deps: HttpServerDeps | null = null;

  configure(deps: HttpServerDeps): void {
    this.deps = deps;
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${this.port}`);
      
      try {
        if (url.pathname === '/health/ready' || url.pathname === '/health/live') {
          await healthRouter(req, res, url.pathname);
        } else if (url.pathname === '/metrics') {
          await metricsRouter(req, res);
        } else if (req.method === 'GET' && url.pathname.startsWith('/price/')) {
          if (!this.deps) {
            jsonResponse(res, { error: 'Service not ready' }, 503);
            return;
          }

          const token = decodeURIComponent(url.pathname.slice('/price/'.length)).trim();
          if (!token) {
            jsonResponse(res, { error: 'Token is required' }, 404);
            return;
          }

          try {
            const detailed = await this.deps.aggregator.getPrice(token);
            jsonResponse(res, {
              token: detailed.token,
              price: detailed.price.toString(),
              sources: detailed.sources.map((s) => ({
                name: s.name,
                price: s.price.toString(),
                age: s.age,
              })),
              timestamp: new Date(detailed.timestamp).toISOString(),
              median: detailed.median.toString(),
            });
          } catch (error: any) {
            if (error instanceof UnsupportedTokenError) {
              jsonResponse(res, { error: error.message }, 404);
              return;
            }
            jsonResponse(res, { error: error.message || 'Failed to fetch price' }, 500);
          }
        } else if (req.method === 'GET' && url.pathname === '/status') {
          if (!this.deps) {
            jsonResponse(res, { error: 'Service not ready' }, 503);
            return;
          }

          const lastFetchTime = Math.max(
            0,
            ...this.deps.stateStore.entries().map(([, state]) => state.lastFetchTime || 0),
          );

          const gasEstimate = this.deps.getGasEstimate
            ? await this.deps.getGasEstimate()
            : { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };

          const pendingTxCount = this.deps.getPendingTxCount ? await this.deps.getPendingTxCount() : 0;

          jsonResponse(res, {
            lastUpdate: new Date(lastFetchTime).toISOString(),
            circuitBreakers: this.deps.adapters.map((a) => ({
              name: a.name,
              state: mapCircuitState(a.getCircuitBreakerState()),
            })),
            gasPrice: {
              maxFeePerGas: gasEstimate.maxFeePerGas.toString(),
              maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas.toString(),
            },
            pendingTxCount: Number(pendingTxCount),
          });
        } else {
          jsonResponse(res, { error: 'Not found' }, 404);
        }
      } catch (error: any) {
        logger.error({ event: 'HTTP_ERROR', path: url.pathname, error: error.message });
        jsonResponse(res, { error: 'Internal server error' }, 500);
      }
    });

    this.server.listen(this.port, () => {
      logger.info({ event: 'HTTP_SERVER_STARTED', port: this.port });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.close(() => {
        logger.info({ event: 'HTTP_SERVER_STOPPED' });
        resolve();
      });
    });
  }
}

let httpServerInstance: HttpServer | null = null;

export function getHttpServer(): HttpServer {
  if (!httpServerInstance) {
    httpServerInstance = new HttpServer();
  }
  return httpServerInstance;
}

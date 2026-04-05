import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger';

export class WsMonitor {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(port = 3002) {
    this.wss = new WebSocketServer({ port });
    
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info({ event: 'WS_MONITOR_CONNECTED', clients: this.clients.size });
      
      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });

    logger.info({ event: 'WS_SERVER_STARTED', port });
  }

  broadcast(message: object) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private emit(event: string, data: unknown) {
    this.broadcast({
      event,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  emitPriceUpdate(data: { token: string; price: string; sources: Array<{ name: string; price: string; age: number }> }) {
    this.emit('price:update', data);
  }

  emitSubmissionPending(data: { token: string; nonce: number; txHash?: string }) {
    this.emit('submission:pending', data);
  }

  emitSubmissionConfirmed(data: { token: string; nonce: number; txHash: string }) {
    this.emit('submission:confirmed', data);
  }

  emitSubmissionFailed(data: { token: string; nonce: number; error: string }) {
    this.emit('submission:failed', data);
  }

  emitApiError(data: { source: string; error: string }) {
    this.emit('error:api', data);
  }

  emitChainError(data: { error: string }) {
    this.emit('error:chain', data);
  }

  emitGasError(data: { error: string }) {
    this.emit('error:gas', data);
  }
}

export const monitor = process.env.NODE_ENV !== 'test' ? new WsMonitor() : null;

export function getMonitor() {
  return monitor;
}

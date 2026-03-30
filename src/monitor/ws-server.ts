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
}

export const monitor = process.env.NODE_ENV !== 'test' ? new WsMonitor() : null;

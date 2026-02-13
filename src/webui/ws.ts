import type { WebSocket } from '@fastify/websocket';
import type { WsEvent } from './types.js';

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
}

export function broadcast(event: WsEvent): void {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

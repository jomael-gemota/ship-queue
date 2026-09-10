import type { Response } from 'express';

/**
 * Fan-out for Doc Tidy server-sent events, so the results table can update the
 * moment an extraction stores something instead of waiting for a client poll.
 *
 * Deliberately in-memory and best-effort: an event is a hint to refetch, never
 * the data itself, so a client that misses one recovers on its next refetch or
 * reconnect.
 */

export interface DocTidyEvent {
  type: 'imported' | 'ping' | 'connected';
  /** Number of newly stored messages, for `imported`. */
  imported?: number;
  at?: string;
}

const HEARTBEAT_MS = 25_000;

const clients = new Set<Response>();
let heartbeat: ReturnType<typeof setInterval> | null = null;

function write(res: Response, event: DocTidyEvent): void {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    // The socket is gone; the 'close' handler will do the removal.
  }
}

function startHeartbeat(): void {
  if (heartbeat) return;

  // Idle streams get dropped by proxies and load balancers. A periodic comment
  // also surfaces half-open sockets, which otherwise linger in `clients`.
  heartbeat = setInterval(() => {
    for (const res of clients) write(res, { type: 'ping', at: new Date().toISOString() });
  }, HEARTBEAT_MS);

  if (typeof heartbeat.unref === 'function') heartbeat.unref();
}

function stopHeartbeat(): void {
  if (heartbeat && clients.size === 0) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

/** Registers an SSE response and returns a cleanup function. */
export function addClient(res: Response): () => void {
  clients.add(res);
  startHeartbeat();

  return () => {
    clients.delete(res);
    stopHeartbeat();
  };
}

export function broadcast(event: DocTidyEvent): void {
  const payload = { ...event, at: event.at ?? new Date().toISOString() };
  for (const res of clients) write(res, payload);
}

export function clientCount(): number {
  return clients.size;
}

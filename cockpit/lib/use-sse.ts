'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * SSE client hook — connects to /api/ops/events, reconnects with backoff.
 * Deduplicates by event ID. Calls onEvent for each received event.
 */
export function useSse(onEvent: (event: SseEvent) => void) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const lastIdRef = useRef<string>('0');
  const retriesRef = useRef(0);

  const connect = useCallback(() => {
    if (esRef.current) return;

    const es = new EventSource('/api/ops/events');
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      retriesRef.current = 0;
    };

    const handler = (e: MessageEvent) => {
      // Deduplicate by event ID
      if (e.lastEventId && e.lastEventId <= lastIdRef.current) return;
      if (e.lastEventId) lastIdRef.current = e.lastEventId;

      try {
        const parsed = JSON.parse(e.data) as SseEvent;
        onEvent(parsed);
      } catch { /* ignore malformed events */ }
    };

    // Listen to all event types
    for (const type of [
      'worker:status', 'tunnel:status', 'dispatch:lifecycle',
      'limits:denial', 'breaker:state', 'connected',
    ]) {
      es.addEventListener(type, handler);
    }

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      // Reconnect with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 30000);
      retriesRef.current++;
      setTimeout(connect, delay);
    };
  }, [onEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  return { connected };
}

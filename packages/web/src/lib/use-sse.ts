"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UseSSEOptions<T> {
  url: string | null;
  onMessage?: (data: T) => void;
}

export function useSSE<T = unknown>({ url, onMessage }: UseSSEOptions<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const close = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!url) {
      close();
      return;
    }

    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as T;
        setData(parsed);
        onMessageRef.current?.(parsed);
      } catch {
        // Non-JSON messages (like pings) are ignored
      }
    };

    source.onerror = () => {
      setError("SSE connection lost");
      setConnected(false);
      source.close();
      sourceRef.current = null;
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [url, close]);

  return { data, error, connected, close };
}

import { useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly pending: boolean;
}

export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  enabled: boolean,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(enabled);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();

    const tick = async (): Promise<void> => {
      try {
        const next = await fetcherRef.current(controller.signal);
        if (!active) return;
        setData(next);
        setError(null);
      } catch (caught) {
        if (!active || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (active) setPending(false);
      }
    };

    void tick();
    const handle = window.setInterval(() => void tick(), intervalMs);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(handle);
    };
  }, [intervalMs, enabled]);

  return { data, error, pending };
}

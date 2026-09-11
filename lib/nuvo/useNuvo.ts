"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChainClient } from "./chain";
import { getClient } from "./client";

// One place where screens read from the client. A write that lands, or a wallet
// that changes, pushes through onChange so every mounted screen re-reads.

export const client = getClient();

export function useNuvo<T>(load: (client: ChainClient) => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => client.onChange(refresh), [refresh]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load(client)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setData(undefined);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, refresh };
}

/** Ticks once a second, for countdowns and quote expiry. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

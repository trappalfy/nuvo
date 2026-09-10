"use client";

import { useCallback, useEffect, useState } from "react";
import { getClient, isMock } from "./client";
import type { NuvoClient } from "./types";

// One place where screens read from the client. Mock writes (subscribe, claim,
// the week fast forward) push a change through onChange, so every mounted screen
// repaints without a manual refresh.

export const client = getClient();

export function useNuvo<T>(load: (client: NuvoClient) => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (isMock(client)) return client.onChange(refresh);
  }, [refresh]);

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

/** Ticks once a second, for the countdown in the week strip. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

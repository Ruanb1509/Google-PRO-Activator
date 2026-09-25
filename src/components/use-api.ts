"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";

/** Loads a GET endpoint and re-loads whenever `path` changes. `path = null` skips loading. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api<T>(path);
      if (id === seq.current) setData(res);
    } catch (err) {
      if (id === seq.current) setError(errorMessage(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Wraps a mutation with loading + error/success message state. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async <R,>(key: string, fn: () => Promise<R>, success?: string): Promise<R | undefined> => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const r = await fn();
      if (success) setMessage(success);
      return r;
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, error, message, run, setError, setMessage };
}

import { useCallback, useEffect, useRef } from "react";

type TimerId = ReturnType<typeof window.setTimeout>;

export type UseTimersResult = {
  schedule: (key: string, fn: () => void, ms: number) => void;
  cancel: (key: string) => void;
};

export function useTimers(): UseTimersResult {
  const timers = useRef<Map<string, TimerId>>(new Map());

  const schedule = useCallback((key: string, fn: () => void, ms: number) => {
    const prev = timers.current.get(key);
    if (prev) {
      try {
        window.clearTimeout(prev);
      } catch {}
      timers.current.delete(key);
    }
    const id = window.setTimeout(() => {
      try {
        timers.current.delete(key);
      } catch {}
      try {
        fn();
      } catch {}
    }, Math.max(0, ms));
    timers.current.set(key, id);
  }, []);

  const cancel = useCallback((key: string) => {
    const prev = timers.current.get(key);
    if (!prev) return;
    try {
      window.clearTimeout(prev);
    } catch {}
    timers.current.delete(key);
  }, []);

  useEffect(() => {
    return () => {
      try {
        for (const id of timers.current.values()) {
          window.clearTimeout(id);
        }
      } catch {}
      timers.current.clear();
    };
  }, []);

  return { schedule, cancel };
}

export default useTimers;

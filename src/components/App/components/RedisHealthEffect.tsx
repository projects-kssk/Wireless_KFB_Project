import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SerialState } from "@/components/Header/useSerialEvents";

/** React 19–friendly structural ref shape */
type RefLike<T> = { current: T };

export type RedisHealthEffectProps = {
  serial: SerialState;
  assumeRedisReady: boolean;
  redisDegraded: boolean;
  setRedisDegraded: Dispatch<SetStateAction<boolean>>;

  // Refs (avoid deprecated MutableRefObject in public API)
  redisReadyRef: RefLike<boolean>;
  prevRedisReadyRef: RefLike<boolean | null>;
  redisDropTimerRef: RefLike<number | null>;
  lastRedisDropAtRef: RefLike<number | null>;
  macRef: RefLike<string>;

  rehydrateOnRecovery: boolean;
  suppressLive: boolean;
  macRegex: RegExp;
  isScanning: boolean;
  isChecking: boolean;

  setNormalPins: Dispatch<SetStateAction<number[] | undefined>>;
  setLatchPins: Dispatch<SetStateAction<number[] | undefined>>;
  setNameHints: Dispatch<SetStateAction<Record<string, string> | undefined>>;
};

export function RedisHealthEffect({
  serial,
  assumeRedisReady,
  redisDegraded,
  setRedisDegraded,
  redisReadyRef,
  prevRedisReadyRef,
  redisDropTimerRef,
  lastRedisDropAtRef,
  rehydrateOnRecovery,
  suppressLive,
  macRef,
  macRegex,
  isScanning,
  isChecking,
  setNormalPins,
  setLatchPins,
  setNameHints,
}: RedisHealthEffectProps): null {
  useEffect(() => {
    if (assumeRedisReady) {
      prevRedisReadyRef.current = !!(serial as any).redisReady;
      if (redisDegraded) setRedisDegraded(false);
      return;
    }
    const ready = !!(serial as any).redisReady;
    const prev = prevRedisReadyRef.current;
    prevRedisReadyRef.current = ready;
    if (prev === null) return;

    const DEBOUNCE_MS = Math.max(
      300,
      Number(process.env.NEXT_PUBLIC_REDIS_DROP_DEBOUNCE_MS ?? "900")
    );

    if (prev === true && ready === false) {
      if (redisDropTimerRef.current == null) {
        lastRedisDropAtRef.current = Date.now();
        redisDropTimerRef.current = window.setTimeout(() => {
          redisDropTimerRef.current = null;
          if (!redisReadyRef.current) setRedisDegraded(true);
        }, DEBOUNCE_MS);
      }
    }
    if (prev === false && ready === true) {
      if (redisDropTimerRef.current != null) {
        try {
          clearTimeout(redisDropTimerRef.current);
        } catch {}
        redisDropTimerRef.current = null;
      }
      lastRedisDropAtRef.current = null;
      setRedisDegraded(false);
    }
  }, [
    (serial as any).redisReady,
    assumeRedisReady,
    redisDegraded,
    setRedisDegraded,
  ]);

  const rehydrateBlockUntilRef = useRef<number>(0);
  useEffect(() => {
    if (!rehydrateOnRecovery) return;
    if (redisDegraded) return;
    if (suppressLive) return;

    const mac = (macRef.current || "").toUpperCase();
    if (!mac || !macRegex.test(mac)) return;
    if (!isScanning && !isChecking) return;

    const now = Date.now();
    if (now < (rehydrateBlockUntilRef.current || 0)) return;
    rehydrateBlockUntilRef.current = now + 30_000;

    (async () => {
      try {
        await fetch("/api/aliases/rehydrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac }),
        }).catch(() => {});
        const r = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}`, {
          cache: "no-store",
        });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j?.normalPins))
            setNormalPins(j.normalPins as number[]);
          if (Array.isArray(j?.latchPins))
            setLatchPins(j.latchPins as number[]);
          if (j?.aliases && typeof j.aliases === "object")
            setNameHints(j.aliases as Record<string, string>);
        }
      } catch {}
    })();
  }, [
    rehydrateOnRecovery,
    redisDegraded,
    suppressLive,
    macRef,
    macRegex,
    isScanning,
    isChecking,
    setNormalPins,
    setLatchPins,
    setNameHints,
  ]);

  return null;
}

export default RedisHealthEffect;

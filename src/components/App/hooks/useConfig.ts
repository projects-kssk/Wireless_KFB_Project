import { useMemo } from "react";

export type RetryStrategyConfig = {
  OVERLAY_MS: number;
  STUCK_MS: number;
  OK_MS: number;
  CHECK_CLIENT_MS: number;
  RETRIES: number;
  RETRY_COOLDOWN_MS: number;
  FINALIZED_RESCAN_BLOCK_MS: number;
};

export type FeatureFlags = {
  USE_LOCKS: boolean;
  REHYDRATE_ON_LOAD: boolean;
  REHYDRATE_ON_RECOVERY: boolean;
  STATION_WARMUP: boolean;
  SCANNER_POLL: boolean;
  HINT_ON_EMPTY: boolean;
  CHECK_ON_EMPTY: boolean;
  SIMULATE: boolean;
  SIM_AUTORUN: boolean;
};

export type UseConfigResult = {
  CFG: RetryStrategyConfig;
  FLAGS: FeatureFlags;
  ASSUME_REDIS_READY: boolean;
  ALLOW_IDLE_SCANS: boolean;
};

const asBool = (value: string | undefined | null): boolean =>
  String(value || "")
    .trim()
    .toLowerCase() === "1" ||
  String(value || "")
    .trim()
    .toLowerCase() === "true";

export function useConfig(): UseConfigResult {
  return useMemo(() => {
    const cfg: RetryStrategyConfig = {
      OVERLAY_MS: Math.max(
        1000,
        Number(process.env.NEXT_PUBLIC_SCAN_OVERLAY_MS ?? 3000)
      ),
      STUCK_MS: Math.max(
        4000,
        Number(process.env.NEXT_PUBLIC_SCAN_STUCK_MS ?? 7000)
      ),
      OK_MS: Math.max(400, Number(process.env.NEXT_PUBLIC_OK_OVERLAY_MS ?? 1200)),
      CHECK_CLIENT_MS: Math.max(
        1000,
        Number(process.env.NEXT_PUBLIC_CHECK_CLIENT_TIMEOUT_MS ?? 5000)
      ),
      RETRIES: Math.max(
        0,
        Number(process.env.NEXT_PUBLIC_CHECK_RETRY_COUNT ?? 1)
      ),
      RETRY_COOLDOWN_MS: Math.max(
        2000,
        Number(process.env.NEXT_PUBLIC_RETRY_COOLDOWN_MS ?? 5000)
      ),
      FINALIZED_RESCAN_BLOCK_MS: Math.max(
        0,
        Number(process.env.NEXT_PUBLIC_FINALIZED_RESCAN_BLOCK_MS ?? 0)
      ),
    };

    const flags: FeatureFlags = {
      USE_LOCKS: asBool(process.env.NEXT_PUBLIC_USE_LOCKS),
      REHYDRATE_ON_LOAD: asBool(process.env.NEXT_PUBLIC_REHYDRATE_ON_LOAD),
      REHYDRATE_ON_RECOVERY: asBool(
        process.env.NEXT_PUBLIC_REHYDRATE_ON_RECOVERY
      ),
      STATION_WARMUP: asBool(process.env.NEXT_PUBLIC_STATION_WARMUP),
      SCANNER_POLL: asBool(process.env.NEXT_PUBLIC_SCANNER_POLL_ENABLED),
      HINT_ON_EMPTY: asBool(process.env.NEXT_PUBLIC_HINT_ON_EMPTY),
      CHECK_ON_EMPTY: asBool(process.env.NEXT_PUBLIC_CHECK_ON_EMPTY),
      SIMULATE: asBool(process.env.NEXT_PUBLIC_SIMULATE),
      SIM_AUTORUN: asBool(process.env.NEXT_PUBLIC_SIMULATE_AUTORUN),
    };

    const assumeRedisReady = asBool(process.env.NEXT_PUBLIC_ASSUME_REDIS_READY);
    const allowIdleScans = asBool(
      process.env.NEXT_PUBLIC_DASHBOARD_ALLOW_IDLE_SCANS ?? "1"
    );

    return {
      CFG: cfg,
      FLAGS: flags,
      ASSUME_REDIS_READY: assumeRedisReady,
      ALLOW_IDLE_SCANS: allowIdleScans,
    };
  }, []);
}

export default useConfig;

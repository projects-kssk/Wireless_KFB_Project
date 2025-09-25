import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SerialState } from "@/components/Header/useSerialEvents";
import type { BranchDisplayData } from "@/types/types";
import { macKey } from "../utils/mac";

/** React 19–friendly structural ref shape */
type RefLike<T> = { current: T };

export type DeviceEventsEffectProps = {
  serial: SerialState;
  setupGateActive: boolean;
  suppressLive: boolean;
  zeroMac: string;
  retryCooldownMs: number;
  hasSetupForCurrentMac: () => boolean;

  // Refs (use RefLike<T> instead of MutableRefObject<T>)
  macRef: RefLike<string>;
  lastScanRef: RefLike<string>;
  blockedMacRef: RefLike<Set<string>>;
  lastFinalizedAtRef: RefLike<number>;
  isCheckingRef: RefLike<boolean>;
  okFlashAllowedRef: RefLike<boolean>;
  okShownOnceRef: RefLike<boolean>;
  lastRunHadFailuresRef: RefLike<boolean>;

  // Setters
  setOkFlashTick: Dispatch<SetStateAction<number>>;
  setMacAddress: Dispatch<SetStateAction<string>>;
  setKfbNumber: Dispatch<SetStateAction<string>>;
  setIsChecking: Dispatch<SetStateAction<boolean>>;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  setBranchesData: Dispatch<SetStateAction<BranchDisplayData[]>>;
  setCheckFailures: Dispatch<SetStateAction<number[] | null>>;

  finalizeOkForMac: (mac: string) => Promise<void>;
  clearFailureFlag?: () => void;
};

export function DeviceEventsEffect({
  serial,
  setupGateActive,
  suppressLive,
  zeroMac,
  retryCooldownMs,
  hasSetupForCurrentMac,
  macRef,
  lastScanRef,
  blockedMacRef,
  lastFinalizedAtRef,
  isCheckingRef,
  okFlashAllowedRef,
  okShownOnceRef,
  lastRunHadFailuresRef,
  clearFailureFlag,
  setOkFlashTick,
  setMacAddress,
  setKfbNumber,
  setIsChecking,
  setIsScanning,
  setBranchesData,
  setCheckFailures,
  finalizeOkForMac,
}: DeviceEventsEffectProps): null {
  useEffect(() => {
    if (setupGateActive) return;
    if (suppressLive) return;

    const ev = (serial as any).lastEv as {
      kind?: string;
      mac?: string | null;
      line?: string;
      raw?: string;
      ok?: any;
    } | null;
    if (!ev) return;

    const raw = String(ev.line ?? ev.raw ?? "");
    const kind = String(ev.kind || "").toUpperCase();

    const current = (macRef.current || "").toUpperCase();
    const setupReady = hasSetupForCurrentMac();

    if (kind === "START") {
      if (isCheckingRef.current) return;
      let evMac = String(ev.mac || "").toUpperCase();
      const active = (macRef.current || "").toUpperCase();
      if (!evMac || evMac === zeroMac) {
        evMac = active || (lastScanRef.current || "").toUpperCase();
      }
      if (!evMac) return;
      const lastFinalizedAgo = Date.now() - (lastFinalizedAtRef.current || 0);
      const evKey = macKey(evMac);
      if (blockedMacRef.current.has(evKey)) return;
      if (lastFinalizedAgo >= 0 && lastFinalizedAgo < retryCooldownMs) return;
      if (!active) {
        setMacAddress(evMac);
        setKfbNumber(evMac);
      }
      setIsChecking(true);
      okFlashAllowedRef.current = true;
    }

    const ok =
      (/\bRESULT\b/i.test(raw) && /\b(SUCCESS|OK)\b/i.test(raw)) ||
      String(ev.ok).toLowerCase() === "true";

    if (!current) return;

    if ((kind === "RESULT" || kind === "DONE") && ok) {
      setBranchesData((prev) =>
        prev.map((b) => ({ ...b, testStatus: "ok" as const }))
      );
      setCheckFailures([]);
      setIsChecking(false);
      setIsScanning(false);
      lastRunHadFailuresRef.current = false;
      clearFailureFlag?.();
      if (okFlashAllowedRef.current && !okShownOnceRef.current) {
        okShownOnceRef.current = true;
        setOkFlashTick((t) => t + 1);
      }
      void finalizeOkForMac(current);
    }
  }, [
    finalizeOkForMac,
    hasSetupForCurrentMac,
    lastFinalizedAtRef,
    lastScanRef,
    okFlashAllowedRef,
    okShownOnceRef,
    retryCooldownMs,
    serial,
    setBranchesData,
    setCheckFailures,
    setIsChecking,
    setIsScanning,
    setKfbNumber,
    setMacAddress,
    setOkFlashTick,
    setupGateActive,
    suppressLive,
    zeroMac,
    blockedMacRef,
    macRef,
    isCheckingRef,
  ]);

  useEffect(() => {
    if (suppressLive) return;
    if (!hasSetupForCurrentMac()) return;
    const ev = (serial as any).lastEv as {
      kind?: string;
      mac?: string | null;
      line?: string;
      raw?: string;
      ok?: any;
    } | null;
    if (!ev) return;

    const raw = String(ev.line ?? ev.raw ?? "");
    const kind = String(ev.kind || "").toUpperCase();
    const current = (macRef.current || "").toUpperCase();
    if (!current) return;

    const isResultish =
      kind === "DONE" || kind === "RESULT" || /\bRESULT\b/i.test(raw);
    const isFailure =
      String(ev.ok).toLowerCase() === "false" || /\bFAIL(?:URE)?\b/i.test(raw);

    if (isResultish && isFailure && !isCheckingRef.current) {
      setIsChecking(true);
      okFlashAllowedRef.current = true;
      try {
        const m = raw.match(/MISSING\s+([0-9 ,]+)/i);
        if (m && m[1]) {
          const pins = m[1]
            .split(/[, ]+/)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n));
          if (pins.length) {
            setCheckFailures(pins);
            setBranchesData((prev) =>
              prev.map((b) =>
                pins.includes(Number(b.pinNumber))
                  ? { ...b, testStatus: "nok" as const }
                  : b
              )
            );
          }
        }
      } catch {}
    }
  }, [
    hasSetupForCurrentMac,
    isCheckingRef,
    macRef,
    okFlashAllowedRef,
    serial,
    setBranchesData,
    setCheckFailures,
    setIsChecking,
    suppressLive,
  ]);

  return null;
}

export default DeviceEventsEffect;

import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SerialState } from "@/components/Header/useSerialEvents";

type MainView = "dashboard" | "settingsConfiguration" | "settingsBranches";
type ScanTrigger = "sse" | "poll";
type ScanResultState = { text: string; kind: "info" | "error" } | null;

/** React 19–friendly structural ref shape */
type RefLike<T> = { current: T };

type PollingEffectProps = {
  serial: SerialState;
  scannerPollEnabled: boolean;
  mainView: MainView;
  isSettingsSidebarOpen: boolean;
  suppressLive: boolean;
  isScanning: boolean; // <-- add this
  macRef: RefLike<string>;
  isCheckingRef: RefLike<boolean>;
  idleCooldownUntilRef: RefLike<number>;
  blockedMacRef: RefLike<Set<string>>;
  scanResultTimerRef: RefLike<number | null>;
  resolveDesiredPath: () => string | null;
  pathsEqual: (a?: string | null, b?: string | null) => boolean;
  isAcmPath: (path?: string | null) => boolean;
  handleScan: (code: string, trigger: ScanTrigger) => Promise<void> | void;
  setScanResult: Dispatch<SetStateAction<ScanResultState>>;
};

export function PollingEffect({
  serial,
  scannerPollEnabled,
  mainView,
  isSettingsSidebarOpen,
  suppressLive,
  isScanning, // <-- and destructure it
  macRef,
  isCheckingRef,
  idleCooldownUntilRef,
  blockedMacRef,
  scanResultTimerRef,
  resolveDesiredPath,
  pathsEqual,
  isAcmPath,
  handleScan,
  setScanResult,
}: PollingEffectProps): null {
  useEffect(() => {
    if (!scannerPollEnabled) return;
    if (mainView !== "dashboard") return;
    if (isSettingsSidebarOpen) return;
    if (suppressLive) return;
    if (macRef.current) return;
    if (isCheckingRef.current) return;
    if (isScanning) return;

    const STALE_MS = Number(
      process.env.NEXT_PUBLIC_SCANNER_POLL_IF_STALE_MS ?? "4000"
    );
    if (!(typeof STALE_MS === "number" && isFinite(STALE_MS)) || STALE_MS <= 0)
      return;

    let stopped = false;
    let timer: number | null = null;
    let ctrl: AbortController | null = null;

    const tick = async () => {
      try {
        const lastAtNow = (serial as any).lastScanAt as
          | number
          | null
          | undefined;
        const sseOkNow = !!(serial as any).sseConnected;
        const staleNow =
          !(typeof lastAtNow === "number" && isFinite(lastAtNow)) ||
          Date.now() - (lastAtNow as number) > STALE_MS;

        if (sseOkNow && !staleNow) {
          stopped = true;
          return;
        }
        if (isScanning) {
          timer = window.setTimeout(tick, 500);
          return;
        }

        ctrl = new AbortController();
        const want = resolveDesiredPath();
        if (!want) {
          timer = window.setTimeout(tick, 1200);
          return;
        }

        const url = `/api/serial/scanner?path=${encodeURIComponent(want)}&consume=1`;
        const res = await fetch(url, {
          cache: "no-store",
          signal: ctrl.signal,
        });

        if (res.ok) {
          const { code, path, error } = await res.json();
          const raw = typeof code === "string" ? code.trim() : "";
          if (raw) {
            const norm = raw.toUpperCase();
            if (path && !isAcmPath(path)) return;
            if (
              want &&
              path &&
              !(isAcmPath(path) && isAcmPath(want)) &&
              !pathsEqual(path, want)
            )
              return;
            if (Date.now() < (idleCooldownUntilRef.current || 0)) return;
            if (blockedMacRef.current.has(norm)) return;
            await handleScan(norm, "poll");
          } else if (error) {
            const str = String(error);
            const lower = str.toLowerCase();
            const isNotPresent =
              lower.includes("not present") || lower.includes("not_present");
            if (!isNotPresent) {
              setScanResult({ text: str, kind: "error" });
              if (scanResultTimerRef.current)
                clearTimeout(scanResultTimerRef.current);
              scanResultTimerRef.current = window.setTimeout(() => {
                setScanResult(null);
                scanResultTimerRef.current = null;
              }, 2000);
            }
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          console.error("[SCANNER] poll error", e);
        }
      } finally {
        if (!stopped) timer = window.setTimeout(tick, 1800);
      }
    };

    tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      if (ctrl) ctrl.abort();
    };
  }, [
    (serial as any).lastScanAt,
    (serial as any).sseConnected,
    blockedMacRef,
    handleScan,
    idleCooldownUntilRef,
    isAcmPath,
    isCheckingRef,
    isScanning,
    isSettingsSidebarOpen,
    macRef,
    mainView,
    pathsEqual,
    resolveDesiredPath,
    scannerPollEnabled,
    scanResultTimerRef,
    setScanResult,
    suppressLive,
  ]);

  return null;
}

export default PollingEffect;

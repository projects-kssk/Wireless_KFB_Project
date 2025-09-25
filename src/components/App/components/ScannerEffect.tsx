import { useEffect } from "react";
import type { SerialState } from "@/components/Header/useSerialEvents";
import { macKey } from "../utils/mac";

type MainView = "dashboard" | "settingsConfiguration" | "settingsBranches";
type ScanTrigger = "sse" | "poll";

/** React 19–friendly structural ref shape */
type RefLike<T> = { current: T };

type ScannerEffectProps = {
  serial: SerialState;
  mainView: MainView;
  isSettingsSidebarOpen: boolean;
  isScanning: boolean;
  isCheckingRef: RefLike<boolean>;
  idleCooldownUntilRef: RefLike<number>;
  blockedMacRef: RefLike<Set<string>>;
  resolveDesiredPath: () => string | null;
  pathsEqual: (a?: string | null, b?: string | null) => boolean;
  isAcmPath: (path?: string | null) => boolean;
  handleScan: (code: string, trigger: ScanTrigger) => Promise<void> | void;
};

export function ScannerEffect({
  serial,
  mainView,
  isSettingsSidebarOpen,
  isScanning,
  isCheckingRef,
  idleCooldownUntilRef,
  blockedMacRef,
  resolveDesiredPath,
  pathsEqual,
  isAcmPath,
  handleScan,
}: ScannerEffectProps): null {
  useEffect(() => {
    if (mainView !== "dashboard") return;
    if (isSettingsSidebarOpen) return;
    if (!(serial as any).lastScanTick) return;

    const want = resolveDesiredPath();
    const seen = (serial as any).lastScanPath as string | null | undefined;
    const pathOk =
      !want ||
      !seen ||
      (isAcmPath(seen) && isAcmPath(want)) ||
      pathsEqual(seen, want);
    if (!pathOk) return;

    const code = (serial as any).lastScan;
    if (!code) return;
    if (isCheckingRef.current || isScanning) return;

    const raw = String(code).trim();
    if (!raw) return;
    const key = macKey(raw);
    if (Date.now() < (idleCooldownUntilRef.current || 0)) return;
    if (blockedMacRef.current.has(key)) return;

    void handleScan(raw, "sse");
  }, [
    (serial as any).lastScanTick,
    (serial as any).lastScanPath,
    blockedMacRef,
    handleScan,
    idleCooldownUntilRef,
    isAcmPath,
    isCheckingRef,
    isScanning,
    isSettingsSidebarOpen,
    mainView,
    pathsEqual,
    resolveDesiredPath,
  ]);

  return null;
}

export default ScannerEffect;

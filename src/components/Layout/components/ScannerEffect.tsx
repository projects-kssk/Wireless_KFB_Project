import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { SerialState } from "@/components/Header/useSerialEvents";

type MainView = "dashboard" | "settingsConfiguration" | "settingsBranches";
type ScanTrigger = "sse" | "poll";

type ScannerEffectProps = {
  serial: SerialState;
  mainView: MainView;
  isSettingsSidebarOpen: boolean;
  isScanning: boolean;
  isCheckingRef: MutableRefObject<boolean>;
  idleCooldownUntilRef: MutableRefObject<number>;
  blockedMacRef: MutableRefObject<Set<string>>;
  resolveDesiredPath: () => string | null;
  pathsEqual: (a?: string | null, b?: string | null) => boolean;
  isAcmPath: (path?: string | null) => boolean;
  handleScan: (code: string, trigger: ScanTrigger) => Promise<void> | void;
};

export const ScannerEffect: React.FC<ScannerEffectProps> = ({
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
}) => {
  useEffect(() => {
    if (mainView !== "dashboard") return;
    if (isSettingsSidebarOpen) return;
    if (!(serial as any).lastScanTick) return;

    const want = resolveDesiredPath();
    const seen = (serial as any).lastScanPath as string | null | undefined;
    const pathOk =
      !want ||
      !seen ||
      ((isAcmPath(seen) && isAcmPath(want)) || pathsEqual(seen, want));
    if (!pathOk) return;

    const code = (serial as any).lastScan;
    if (!code) return;
    if (isCheckingRef.current || isScanning) return;

    const norm = String(code).trim().toUpperCase();
    if (!norm) return;
    if (Date.now() < (idleCooldownUntilRef.current || 0)) return;
    if (blockedMacRef.current.has(norm)) return;

    void handleScan(norm, "sse");
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
};

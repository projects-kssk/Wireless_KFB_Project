import { useEffect, useMemo } from "react";

export type HudMode = "idle" | "scanning" | "info" | "error";

export type ScanResultState = {
  text?: string | null;
  kind: HudMode;
} | null;

export type UseHudParams = {
  mainView: "dashboard" | "settingsConfiguration" | "settingsBranches";
  isScanning: boolean;
  showScanUi: boolean;
  scanResult: ScanResultState;
  macAddress: string | null | undefined;
  serial: any;
  redisDegraded: boolean;
  infoHideAt: number | null;
  onIdle?: () => void;
};

export type UseHudResult = {
  hudMode: HudMode | null;
  hudMessage: string | undefined;
  hudSubMessage: string | undefined;
  scannerDetected: boolean;
};

export const useHud = ({
  mainView,
  isScanning,
  showScanUi,
  scanResult,
  macAddress,
  serial,
  redisDegraded,
  infoHideAt,
  onIdle,
}: UseHudParams): UseHudResult => {
  const scannerDetected = useMemo(() => {
    try {
      return (
        (serial as any)?.scannersDetected > 0 || !!(serial as any)?.sseConnected
      );
    } catch {
      return false;
    }
  }, [(serial as any)?.scannersDetected, (serial as any)?.sseConnected]);

  const hudMode: HudMode | null = useMemo(() => {
    if (mainView !== "dashboard") return null;
    if (isScanning && showScanUi) return "scanning";
    if (scanResult) return scanResult.kind;
    const hasMac = !!(macAddress && macAddress.trim());
    if (!hasMac) return "idle";
    return null;
  }, [mainView, isScanning, showScanUi, scanResult, macAddress]);

  useEffect(() => {
    if (hudMode === "idle") onIdle?.();
  }, [hudMode, onIdle]);

  const hudMessage = useMemo(() => {
    if (hudMode === "scanning") return "Scanning…";
    if (hudMode === "error") return scanResult?.text || "Error";
    if (hudMode === "info") return scanResult?.text || "Notice";
    if (hudMode === "idle") return "Scan a barcode to begin";
    return undefined;
  }, [hudMode, scanResult?.text]);

  const hudSubMessage = useMemo(() => {
    if (hudMode === "scanning") return "Hold steady for a moment";
    if (hudMode === "idle") return scannerDetected ? "" : "Scanner not detected.";
    if (hudMode === "info") {
      if (infoHideAt) {
        const remMs = Math.max(0, infoHideAt - Date.now());
        const secs = Math.ceil(remMs / 1000);
        return secs > 0 ? String(secs) : undefined;
      }
      if (redisDegraded)
        return "Live cache recently degraded—retry if needed.";
      return undefined;
    }
    return undefined;
  }, [hudMode, scannerDetected, redisDegraded, infoHideAt]);

  return { hudMode, hudMessage, hudSubMessage, scannerDetected };
};

export default useHud;

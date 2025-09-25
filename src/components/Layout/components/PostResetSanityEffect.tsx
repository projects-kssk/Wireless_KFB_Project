import { useEffect } from "react";
import type { MutableRefObject } from "react";

type MainView = "dashboard" | "settingsConfiguration" | "settingsBranches";

type PostResetSanityEffectProps = {
  lastFinalizedMacRef: MutableRefObject<string | null>;
  mainView: MainView;
  macRef: MutableRefObject<string>;
  isScanning: boolean;
  isChecking: boolean;
  clearKskLocksFully: (mac: string) => Promise<boolean>;
};

export const PostResetSanityEffect: React.FC<PostResetSanityEffectProps> = ({
  lastFinalizedMacRef,
  mainView,
  macRef,
  isScanning,
  isChecking,
  clearKskLocksFully,
}) => {
  useEffect(() => {
    const mac = lastFinalizedMacRef.current;
    if (!mac) return;
    const onScanView =
      mainView === "dashboard" && !(macRef.current && macRef.current.trim());
    if (!onScanView) return;
    if (isScanning || isChecking) return;

    (async () => {
      try {
        await fetch("/api/aliases/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac }),
        }).catch(() => {});
        await clearKskLocksFully(mac).catch(() => {});
      } finally {
        lastFinalizedMacRef.current = null;
      }
    })();
  }, [
    clearKskLocksFully,
    isChecking,
    isScanning,
    lastFinalizedMacRef,
    macRef,
    mainView,
  ]);

  return null;
};

import { useEffect } from "react";

type MainView = "dashboard" | "settingsConfiguration" | "settingsBranches";

/** React 19–friendly structural ref shape */
type RefLike<T> = { current: T };

type PostResetSanityEffectProps = {
  lastFinalizedMacRef: RefLike<string | null>;
  mainView: MainView;
  macRef: RefLike<string>;
  isScanning: boolean;
  isChecking: boolean;
  clearKskLocksFully: (mac: string) => Promise<boolean>;
};

export function PostResetSanityEffect({
  lastFinalizedMacRef,
  mainView,
  macRef,
  isScanning,
  isChecking,
  clearKskLocksFully,
}: PostResetSanityEffectProps): null {
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
}

export default PostResetSanityEffect;

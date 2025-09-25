import { useEffect, useRef } from "react";
import { useSerialEvents } from "@/components/Header/useSerialEvents";

/** React 19–friendly structural ref type */
export type RefLike<T> = { current: T };

export type UseSerialLiveParams = {
  macAddress: string;
  setupGateActive: boolean;
  suppressLive: boolean;
  simulateEnabled: boolean;
  mainView: "dashboard" | "settingsConfiguration" | "settingsBranches";
};

export type UseSerialLiveResult<TSerial = any> = {
  serial: TSerial;
  redisReadyRef: RefLike<boolean>;
};

export const useSerialLive = <TSerial = any>({
  macAddress,
  setupGateActive,
  suppressLive,
  simulateEnabled,
  mainView,
}: UseSerialLiveParams): UseSerialLiveResult<TSerial> => {
  const serial = useSerialEvents(
    setupGateActive || (suppressLive && !simulateEnabled)
      ? undefined
      : (macAddress || "").toUpperCase(),
    {
      disabled:
        setupGateActive ||
        (suppressLive && !simulateEnabled) ||
        mainView !== "dashboard",
      base: !setupGateActive,
    }
  ) as TSerial;

  // useRef still returns a MutableRefObject at runtime,
  // but we expose it as a structural RefLike in our API surface.
  const redisReadyRef = useRef<boolean>(false) as unknown as RefLike<boolean>;

  useEffect(() => {
    redisReadyRef.current = !!(serial as any)?.redisReady;
  }, [(serial as any)?.redisReady]);

  return { serial, redisReadyRef };
};

export default useSerialLive;

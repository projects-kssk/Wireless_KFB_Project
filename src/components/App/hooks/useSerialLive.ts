import { useEffect, useRef } from "react";
import { useSerialEvents } from "@/components/Header/useSerialEvents";

export type UseSerialLiveParams = {
  macAddress: string;
  setupGateActive: boolean;
  suppressLive: boolean;
  simulateEnabled: boolean;
  mainView: "dashboard" | "settingsConfiguration" | "settingsBranches";
};

export type UseSerialLiveResult<TSerial = any> = {
  serial: TSerial;
  redisReadyRef: React.MutableRefObject<boolean>;
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

  const redisReadyRef = useRef<boolean>(false);
  useEffect(() => {
    redisReadyRef.current = !!(serial as any)?.redisReady;
  }, [(serial as any)?.redisReady]);

  return { serial, redisReadyRef };
};

export default useSerialLive;

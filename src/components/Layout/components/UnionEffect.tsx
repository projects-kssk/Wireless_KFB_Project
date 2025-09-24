import { useEffect } from "react";
import type { SerialState } from "@/components/Header/useSerialEvents";

export type UnionEffectProps = {
  serial: SerialState;
  suppressLive: boolean;
  hasSetupForCurrentMac: () => boolean;
  macRef: React.MutableRefObject<string>;
  redisDegraded: boolean;
  lastActiveIdsRef: React.MutableRefObject<string[]>;
  activeKssks: string[];
  computeActivePins: (
    items:
      | Array<{
          ksk?: string;
          kssk?: string;
          normalPins?: number[];
          latchPins?: number[];
        }>
      | undefined,
    activeIds: string[] | undefined
  ) => { normal: number[]; latch: number[] };
  itemsAllFromAliasesRef: React.MutableRefObject<
    Array<{
      ksk: string;
      aliases?: Record<string, string>;
      normalPins?: number[];
      latchPins?: number[];
    }>
  >;
  setNormalPins: React.Dispatch<React.SetStateAction<number[] | undefined>>;
  setLatchPins: React.Dispatch<React.SetStateAction<number[] | undefined>>;
  setNameHints: React.Dispatch<
    React.SetStateAction<Record<string, string> | undefined>
  >;
};

export const UnionEffect: React.FC<UnionEffectProps> = ({
  serial,
  suppressLive,
  hasSetupForCurrentMac,
  macRef,
  redisDegraded,
  lastActiveIdsRef,
  activeKssks,
  computeActivePins,
  itemsAllFromAliasesRef,
  setNormalPins,
  setLatchPins,
  setNameHints,
}) => {
  useEffect(() => {
    const union = serial.lastUnion as {
      mac?: string;
      normalPins?: number[];
      latchPins?: number[];
      names?: Record<string, string>;
    } | null;
    if (!union) return;
    if (suppressLive) return;
    if (!hasSetupForCurrentMac()) return;

    const currentMac = (macRef.current || "").toUpperCase();
    if (!currentMac) return;

    if (redisDegraded) {
      const np = Array.isArray(union.normalPins) ? union.normalPins.length : 0;
      const lp = Array.isArray(union.latchPins) ? union.latchPins.length : 0;
      const nm =
        union.names && typeof union.names === "object"
          ? Object.keys(union.names).length
          : 0;
      if (np === 0 && lp === 0 && nm === 0) return;
    }

    const activeIds =
      lastActiveIdsRef.current && lastActiveIdsRef.current.length
        ? lastActiveIdsRef.current
        : activeKssks;

    const fromItems = computeActivePins(
      itemsAllFromAliasesRef.current,
      activeIds
    );
    setNormalPins(fromItems.normal);
    setLatchPins(fromItems.latch);
    if (union.names && typeof union.names === "object") {
      setNameHints(union.names as Record<string, string>);
    }
  }, [
    serial.lastUnion,
    suppressLive,
    activeKssks,
    computeActivePins,
    redisDegraded,
    hasSetupForCurrentMac,
    itemsAllFromAliasesRef,
    lastActiveIdsRef,
    macRef,
    setLatchPins,
    setNameHints,
    setNormalPins,
  ]);

  return null;
};

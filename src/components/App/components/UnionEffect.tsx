import { useEffect } from "react";
import type { SerialState } from "@/components/Header/useSerialEvents";

/** React 19–friendly structural ref shape */
type RefLike<T> = { current: T };

const areNumberArraysEqual = (
  a: number[] | undefined,
  b: number[] | undefined
) => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const areNameRecordsEqual = (
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined
) => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

export type UnionEffectProps = {
  serial: SerialState;
  suppressLive: boolean;
  hasSetupForCurrentMac: () => boolean;

  // Refs (avoid deprecated MutableRefObject in public API)
  macRef: RefLike<string>;
  lastActiveIdsRef: RefLike<string[]>;
  itemsAllFromAliasesRef: RefLike<
    Array<{
      ksk: string;
      aliases?: Record<string, string>;
      normalPins?: number[];
      latchPins?: number[];
    }>
  >;

  redisDegraded: boolean;
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

  setNormalPins: React.Dispatch<React.SetStateAction<number[] | undefined>>;
  setLatchPins: React.Dispatch<React.SetStateAction<number[] | undefined>>;
  setNameHints: React.Dispatch<
    React.SetStateAction<Record<string, string> | undefined>
  >;
};

export function UnionEffect({
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
}: UnionEffectProps): null {
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

    // When Redis is degraded, ignore empty union snapshots to avoid nuking state.
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
    const nextNormalPins = fromItems.normal;
    const nextLatchPins = fromItems.latch;

    setNormalPins((prev) =>
      areNumberArraysEqual(prev, nextNormalPins) ? prev : nextNormalPins
    );
    setLatchPins((prev) =>
      areNumberArraysEqual(prev, nextLatchPins) ? prev : nextLatchPins
    );

    if (union.names && typeof union.names === "object") {
      const names = union.names as Record<string, string>;
      setNameHints((prev) =>
        areNameRecordsEqual(prev, names) ? prev : names
      );
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
}

export default UnionEffect;

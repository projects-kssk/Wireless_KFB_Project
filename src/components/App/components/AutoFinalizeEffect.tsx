import { useEffect, type FC } from "react";
import type { BranchDisplayData } from "@/types/types";

/** React 19–friendly structural ref shape */
type RefLike<T> = { current: T };

export type AutoFinalizeEffectProps = {
  isScanning: boolean;
  isChecking: boolean;
  okFlashAllowedRef: RefLike<boolean>;
  checkFailures: number[] | null;
  branchesData: BranchDisplayData[];
  groupedBranches: Array<{ ksk: string; branches: BranchDisplayData[] }>;
  macRef: RefLike<string>;
  lastRunHadFailuresRef?: RefLike<boolean>;
  finalizeOkForMac: (mac: string) => Promise<void>;
};

export const AutoFinalizeEffect: FC<AutoFinalizeEffectProps> = ({
  isScanning,
  isChecking,
  okFlashAllowedRef,
  checkFailures,
  branchesData,
  groupedBranches,
  macRef,
  lastRunHadFailuresRef,
  finalizeOkForMac,
}) => {
  useEffect(() => {
    if (isScanning || isChecking) {
      okFlashAllowedRef.current = false;
      return;
    }
    const anyFailures =
      Array.isArray(checkFailures) && checkFailures.length > 0;
    if (anyFailures) return;
    if (lastRunHadFailuresRef?.current) {
      okFlashAllowedRef.current = false;
      return;
    }

    const flatOk =
      Array.isArray(branchesData) &&
      branchesData.length > 0 &&
      branchesData.every((b) => b.testStatus === "ok");

    const groupedOk =
      Array.isArray(groupedBranches) &&
      groupedBranches.length > 0 &&
      groupedBranches.every(
        (g) =>
          g.branches.length > 0 &&
          g.branches.every((b) => b.testStatus === "ok")
      );

    if (flatOk || groupedOk) {
      const macUp = (macRef.current || "").toUpperCase();
      if (macUp) void finalizeOkForMac(macUp);
    }
  }, [
    branchesData,
    groupedBranches,
    checkFailures,
    finalizeOkForMac,
    isChecking,
    isScanning,
    macRef,
    lastRunHadFailuresRef,
    okFlashAllowedRef,
  ]);

  return null;
};

export default AutoFinalizeEffect;

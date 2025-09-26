// src/components/Program/hooks/useStatusByPin.ts
import { useMemo } from "react";
import { BranchDisplayData } from "@/types/types";

const useStatusByPin = (branches: BranchDisplayData[]) =>
  useMemo(() => {
    const map = new Map<number, BranchDisplayData["testStatus"]>();
    for (const branch of branches) {
      if (typeof branch.pinNumber === "number") {
        map.set(branch.pinNumber, branch.testStatus);
      }
    }
    return map;
  }, [branches]);

export default useStatusByPin;


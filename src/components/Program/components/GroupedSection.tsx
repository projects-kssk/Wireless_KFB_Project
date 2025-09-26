// src/components/Program/components/GroupedSection.tsx
import React, { useMemo } from "react";
import { BranchDisplayData } from "@/types/types";

export interface GroupedSectionProps {
  group: { ksk: string; branches: BranchDisplayData[] };
  statusByPin: Map<number, BranchDisplayData["testStatus"]>;
  labelForPin: (pin: number) => string;
  isLatchPin: (pin?: number) => boolean;
  nameHints?: Record<string, string> | undefined;
  isDarkMode: boolean;
  surfaceBg: string;
  surfaceBorder: string;
  primaryText: string;
  mutedText: string;
}

const GroupedSection: React.FC<GroupedSectionProps> = ({
  group,
  statusByPin,
  labelForPin,
  isLatchPin,
  nameHints,
  isDarkMode,
  surfaceBg,
  surfaceBorder,
  primaryText,
  mutedText,
}) => {
  const branchesLive = useMemo(
    () =>
      group.branches.map((b) => {
        if (typeof b.pinNumber !== "number") return b;
        const s = statusByPin.get(b.pinNumber);
        return s ? { ...b, testStatus: s } : b;
      }),
    [group.branches, statusByPin]
  );

  const okNames = useMemo(() => {
    return branchesLive
      .filter((b) => {
        if (b.testStatus !== "ok" || typeof b.pinNumber !== "number")
          return false;
        const isContactless =
          (b as any).isLatch === true || isLatchPin(b.pinNumber);
        const noCheck =
          (b as any).noCheck === true || (b as any).notTested === true;
        return !(isContactless || noCheck);
      })
      .map((b) =>
        b.pinNumber != null && nameHints?.[String(b.pinNumber)]
          ? nameHints[String(b.pinNumber)]
          : b.branchName
      )
      .filter(Boolean);
  }, [branchesLive, isLatchPin, nameHints]);

  const failedItems = useMemo(
    () =>
      branchesLive
        .filter((b) => {
          if (typeof b.pinNumber !== "number") return false;
          if (b.testStatus === "nok") return true;
          const latch = (b as any).isLatch === true || isLatchPin(b.pinNumber);
          return b.testStatus !== "ok" && latch;
        })
        .map((b) => ({
          pin: b.pinNumber as number,
          name:
            b.pinNumber != null && nameHints?.[String(b.pinNumber)]
              ? nameHints[String(b.pinNumber)]
              : b.branchName,
          isLatch: (b as any).isLatch === true || isLatchPin(b.pinNumber),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branchesLive, isLatchPin, nameHints]
  );

  return (
    <section
      className="rounded-2xl transition-shadow"
      style={{
        background: surfaceBg,
        border: `1px solid ${surfaceBorder}`,
        boxShadow: isDarkMode
          ? "0 26px 55px -32px rgba(0,0,0,0.6)"
          : "0 20px 45px -28px rgba(15,23,42,0.16)",
      }}
    >
      <header
        className="px-4 py-3"
        style={{
          borderBottom: `1px solid ${surfaceBorder}`,
          background: isDarkMode
            ? "linear-gradient(90deg,#242424 0%,#1f1f1f 100%)"
            : "linear-gradient(90deg,#f7f9fc 0%,#ffffff 100%)",
        }}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div
              className="text-2xl md:text-3xl font-black leading-tight"
              style={{ color: primaryText }}
            >
              KSK: {group.ksk}
            </div>
            {failedItems.length > 0 ? (
              <span className="inline-flex items-center rounded-full bg-red-600 text-white px-2.5 py-1 text-xs md:text-sm font-extrabold shadow-sm">
                {failedItems.length} missing
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-emerald-600 text-white px-2.5 py-1 text-xs md:text-sm font-extrabold shadow-sm">
                OK
              </span>
            )}
          </div>
        </div>
      </header>
      <div className="p-4 grid gap-4">
        {failedItems.length > 0 && (
          <div>
            <div
              className="text-[12px] font-bold uppercase mb-2"
              style={{ color: mutedText }}
            >
              Missing items
            </div>
            <div className="flex flex-wrap gap-3">
              {failedItems.map((f) => (
                <div
                  key={`f-${group.ksk}-${f.pin}`}
                  className="group relative inline-flex items-center flex-wrap gap-3 rounded-xl px-4 py-3 shadow-sm"
                  style={{
                    background: isDarkMode ? "#2a1f1f" : "#ffffff",
                    border: `1px solid ${isDarkMode ? "#5f1f1f" : "#fecaca"}`,
                    color: isDarkMode ? "#fee2e2" : undefined,
                  }}
                  title={`PIN ${f.pin}${f.isLatch ? " (Contactless)" : ""}`}
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-xs font-extrabold shadow-sm">
                    !
                  </span>
                  <span
                    className="text-2xl md:text-3xl font-black leading-none text-slate-800 dark:text-white tracking-tight"
                    style={{ color: isDarkMode ? "#ffffff" : undefined }}
                  >
                    {f.name}
                  </span>
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold"
                    style={{
                      background: isDarkMode ? "#3c3c3c" : "#f1f5f9",
                      color: isDarkMode ? "#e2e8f0" : "#1f2937",
                      border: `1px solid ${isDarkMode ? "#4a4a4a" : "#cbd5e1"}`,
                    }}
                  >
                    PIN {f.pin}
                  </span>
                  {f.isLatch && (
                    <span
                      className="inline-flex items-center rounded-full px-2 py-[3px] text-[11px]"
                      style={{
                        background: isDarkMode
                          ? "rgba(253,230,138,0.16)"
                          : "#fef3c7",
                        color: isDarkMode ? "#fcd34d" : "#92400e",
                        border: `1px solid ${isDarkMode ? "rgba(253,230,138,0.35)" : "#fcd34d"}`,
                      }}
                      title="Contactless pin"
                    >
                      Contactless
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {okNames.length > 0 && (
          <div>
            <div
              className="text-[12px] font-bold uppercase mb-2"
              style={{ color: mutedText }}
            >
              Passed
            </div>
            <div className="flex flex-wrap gap-1.5">
              {okNames.slice(0, 24).map((nm, i) => (
                <span
                  key={`ok-${group.ksk}-${i}`}
                  className="inline-flex items-center rounded-full px-2 py-[5px] text-[12px] font-semibold"
                  style={{
                    background: isDarkMode
                      ? "rgba(148,163,184,0.12)"
                      : "#f8fafc",
                    color: isDarkMode ? "#cbd5f5" : "#475569",
                    border: `1px solid ${isDarkMode ? "rgba(148,163,184,0.25)" : "#e2e8f0"}`,
                  }}
                >
                  {nm}
                </span>
              ))}
              {okNames.length > 24 && (
                <span className="text-[11px] text-slate-500 dark:text-slate-300">
                  +{okNames.length - 24} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default GroupedSection;


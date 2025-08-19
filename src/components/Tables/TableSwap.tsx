// src/components/Tables/TableSwap.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";

type TableSwapProps = {
  cycleKey: number;      // bump when BOTH scans are valid
  queues?: string[];     // upcoming KFB labels (for the big table title)
  holdMs?: number;       // shadow/hold time before swap
  slideMs?: number;      // slide duration
  dotsCount?: number;    // kept for backward compat (ignored when clsXml is provided)
  /** Optional: raw KROSY XML response containing <objPos>CL_####</objPos> entries */
  clsXml?: string;
  /** Number of non-highlight (gray) points to render alongside the CL points */
  nonHighlightCount?: number;
};

export default function TableSwap({
  cycleKey,
  queues,
  holdMs = 4200,
  slideMs = 0.6,
  dotsCount = 26,
  clsXml,
  nonHighlightCount = 10,
}: TableSwapProps) {
  const data = useMemo(
    () =>
      (queues?.length ? queues : ["KFB 61-001", "KFB 70-004", "IWO16029"]).map((t, i) => ({
        id: `${i}-${t}`,
        title: t,
      })),
    [queues]
  );

  const [idx, setIdx] = useState(0);
  const [shadowing, setShadowing] = useState(false);
  const [highlightCount, setHighlightCount] = useState(0); // red CL points for CURRENT table
  const prev = useRef(cycleKey);

  // On cycle bump: shadow current table, then swap, then apply CL highlights to the NEW table.
  useEffect(() => {
    if (cycleKey === prev.current) return;
    prev.current = cycleKey;
    setShadowing(true);

    // compute next highlights from XML while shadowing
    const nextCL = clsXml ? extractCLCount(clsXml) : 0;

    const t = setTimeout(() => {
      setShadowing(false);
      setIdx((n) => (n + 1) % data.length);
      setHighlightCount(nextCL); // apply AFTER the swap
    }, holdMs);

    return () => clearTimeout(t);
  }, [cycleKey, holdMs, data.length, clsXml]);

  const current = data[idx];

  const variants = {
    enter: { x: "100%", opacity: 0.98, scale: 0.998 },
    center: { x: "0%", opacity: 1, scale: 1 },
    exit: { x: "-120%", opacity: 0.92, scale: 0.996 },
  };

  // When no XML is provided, fall back to legacy dotsCount.
  const totalPoints =
    (clsXml ? highlightCount + nonHighlightCount : dotsCount) || 0;

  return (
    <div style={{ width: "min(1400px, 100%)", margin: "0 auto" }}>
      <div
        style={{
          position: "relative",
          height: 380,
          overflow: "hidden",
          borderRadius: 20,
          border: "2px dashed #94a3b8",
          background:
            "linear-gradient(180deg,#f8fafc 0%,#f1f5f9 60%,#eef2f6 100%)",
        }}
      >
        {/* sliding stage */}
        <AnimatePresence initial={false} mode="popLayout">
          <m.div
            key={current.id}
            variants={variants}
            initial="center"
            animate="center"
            exit="exit"
            transition={{ duration: slideMs, ease: "easeInOut" }}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
            }}
          >
            <TableSketch
              layoutId="active-table"
              title={current.title}
              totalCount={totalPoints}
              highlightCount={clsXml ? highlightCount : 0}
            />
          </m.div>
        </AnimatePresence>

        {/* corner callout */}
        <div
          style={{
            position: "absolute",
            right: 22,
            top: 22,
            padding: "14px 18px",
            borderRadius: 14,
            border: "2px solid #cbd5e1",
            background: "#fff",
            boxShadow: "0 8px 18px rgba(0,0,0,0.10)",
            color: "#0f172a",
            fontWeight: 900,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <ScanIcon />
          <span>Please scan next table</span>
        </div>

        {/* subtle shadow during hold */}
        <AnimatePresence>
          {shadowing && (
            <m.div
              key="shadow"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(15,23,42,0.22)",
                backdropFilter: "blur(1.5px)",
                pointerEvents: "none",
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- visuals ---------- */

function TableSketch({
  title,
  totalCount = 24,
  highlightCount = 0, // first N points will be red
  layoutId,
}: {
  title: string;
  totalCount?: number;
  highlightCount?: number;
  layoutId?: string;
}) {
  const base = { w: 1040, h: 320, p: 24 };
  const accent = "#334155";
  const border = "#cbd5e1";

  const points = useMemo(
    () => scatterFromSeed(title, totalCount),
    [title, totalCount]
  );

  return (
    <m.div
      layoutId={layoutId}
      layout
      style={{
        width: base.w,
        height: base.h,
        borderRadius: 18,
        background: "#ffffff",
        border: `3px solid ${border}`,
        boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.03)",
        padding: base.p,
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: "0.03em",
            color: accent,
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
        <div
          style={{
            width: 140,
            height: 22,
            background: "#e2e8f0",
            borderRadius: 999,
            opacity: 0.8,
          }}
        />
      </div>

      <div
        style={{
          position: "relative",
          borderRadius: 14,
          background: "#f8fafc",
          border: "2px solid #e2e8f0",
        }}
      >
        {points.map((p, i) => {
          const isRed = i < highlightCount; // first N are CL points
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: 16,
                height: 16,
                border: isRed ? "3px solid #ef4444" : "3px solid #94a3b8",
                background: isRed ? "#fecaca" : "transparent",
                borderRadius: 6,
                transform: "translate(-50%, -50%) rotate(45deg)",
                boxShadow: isRed ? "0 0 0 3px rgba(239,68,68,0.15)" : "none",
                opacity: 0.95,
              }}
              aria-label={isRed ? "CL point" : "marker"}
            />
          );
        })}
      </div>
    </m.div>
  );
}

/* ---------- utilities & small icons ---------- */

// Count all CL_#### occurrences in the XML
function extractCLCount(xml: string): number {
  const matches = xml.match(/<objPos>\s*CL_\d+\s*<\/objPos>/gi) || [];
  return matches.length;
}

function scatterFromSeed(seedStr: string, n: number) {
  let h =
    1779033703 ^
    seedStr.split("").reduce(
      (a, c) => ((a ^ c.charCodeAt(0)) * 3432918353) >>> 0,
      0
    );
  const rnd = () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }).map(() => {
    const x = 8 + rnd() * 84; // padding from edges
    const y = 12 + rnd() * 76;
    return { x, y };
  });
}

function ScanIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="3" stroke="#64748b" strokeWidth="2" />
      <path d="M7 6V5a5 5 0 0 1 10 0v1" stroke="#64748b" strokeWidth="2" />
    </svg>
  );
}

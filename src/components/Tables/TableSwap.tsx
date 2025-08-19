// src/components/Tables/TableSwap.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";

type TableSwapProps = {
  cycleKey: number;      // bump when BOTH scans are valid
  queues?: string[];     // upcoming KFB labels (for the big table title)
  holdMs?: number;       // shadow/hold time before swap
  slideMs?: number;      // slide duration
  dotsCount?: number;    // legacy fallback when no XML
  /** Raw KROSY XML with <objPos>CL_####</objPos> entries */
  clsXml?: string;
  /** Extra non-CL gray points to render */
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
      (queues?.length ? queues : ["KFB 61-001", "KFB 70-004", "IWO16029"]).map(
        (t, i) => ({ id: `${i}-${t}`, title: t })
      ),
    [queues]
  );

  const [idx, setIdx] = useState(0);
  const [shadowing, setShadowing] = useState(false);
  const [highlightLabels, setHighlightLabels] = useState<string[]>([]); // CL_#### list for CURRENT table
  const prev = useRef(cycleKey);

  // On cycle bump: shadow current table, then swap, then apply CL highlights to the NEW table.
  useEffect(() => {
    if (cycleKey === prev.current) return;
    prev.current = cycleKey;
    setShadowing(true);

    const nextCLs = clsXml ? extractCLs(clsXml) : [];

    const t = setTimeout(() => {
      setShadowing(false);
      setIdx((n) => (n + 1) % data.length);
      setHighlightLabels(nextCLs); // apply AFTER the swap
    }, holdMs);

    return () => clearTimeout(t);
  }, [cycleKey, holdMs, data.length, clsXml]);

  const current = data[idx];

  const stageVariants = {
    enter: { x: "8%", opacity: 0, scale: 0.985, filter: "blur(2px)" as any },
    center: { x: "0%", opacity: 1, scale: 1, filter: "blur(0px)" as any },
    exit: { x: "-12%", opacity: 0.85, scale: 0.985, filter: "blur(2px)" as any },
  };

  // When no XML is provided, fall back to legacy behavior.
  const totalPoints = clsXml
    ? highlightLabels.length + nonHighlightCount
    : dotsCount;

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
        <AnimatePresence initial={false} mode="wait">
          <m.div
            key={current.id}
            variants={stageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: slideMs, ease: [0.22, 0.8, 0.2, 1] }}
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
              highlightLabels={clsXml ? highlightLabels : []}
              nonHighlightCount={clsXml ? nonHighlightCount : Math.max(0, dotsCount)}
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

        {/* shadow during hold */}
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
  highlightLabels = [],
  nonHighlightCount = 10,
  layoutId,
}: {
  title: string;
  totalCount?: number;
  highlightLabels?: string[]; // exact CL_#### labels to show in red with captions
  nonHighlightCount?: number;
  layoutId?: string;
}) {
  const base = { w: 1040, h: 320, p: 24 };
  const accent = "#334155";
  const border = "#cbd5e1";

  // Positions for CL points are seeded by their own label for stability.
  const clPoints = useMemo(
    () =>
      highlightLabels.map((label) => ({
        ...scatterOne(`${title}-cl-${label}`),
        label,
      })),
    [title, highlightLabels]
  );

  // Generate gray points, avoiding crowding CL points.
  const grayPoints = useMemo(
    () => scatterManyAvoid(`${title}-gray`, nonHighlightCount, clPoints, 7),
    [title, nonHighlightCount, clPoints]
  );

  // Legacy fallback when no XML/labels are present.
  const fallbackPoints = useMemo(
    () => (!highlightLabels.length ? scatterFromSeed(title, totalCount) : []),
    [title, totalCount, highlightLabels.length]
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
          overflow: "hidden",
        }}
      >
        {/* Gray points */}
        {grayPoints.map((p, i) => (
          <m.div
            key={`g-${i}`}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.95 }}
            transition={{ type: "spring", stiffness: 280, damping: 20, delay: 0.03 * i }}
            style={markerStyle(p.x, p.y, false)}
            aria-label="marker"
          />
        ))}

        {/* Red CL points with labels */}
        {clPoints.map((p, i) => (
          <m.div
            key={`cl-${p.label}-${i}`}
            initial={{ scale: 0.85, opacity: 0, y: -4 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.05 * i }}
            style={markerStyle(p.x, p.y, true)}
            aria-label={p.label}
          >
            {/* label */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "100%",
                transform: "translateX(-50%)",
                marginTop: 8,
                padding: "2px 6px",
                fontSize: 12,
                fontWeight: 800,
                color: "#7f1d1d",
                background: "#ffe4e6",
                border: "1px solid #fecaca",
                borderRadius: 8,
                whiteSpace: "nowrap",
                letterSpacing: "0.02em",
              }}
            >
              {p.label}
            </div>
          </m.div>
        ))}

        {/* Fallback legacy scatter if no XML */}
        {!highlightLabels.length &&
          fallbackPoints.map((p, i) => (
            <div key={`f-${i}`} style={markerStyle(p.x, p.y, false)} />
          ))}
      </div>
    </m.div>
  );
}

/* ---------- utilities & small icons ---------- */

// Extract ordered CL labels from XML (e.g., ["CL_1301","CL_1302",...])
function extractCLs(xml: string): string[] {
  const re = /<sequence[\s\S]*?<objPos>\s*(CL_\d+)\s*<\/objPos>[\s\S]*?<\/sequence>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// Marker style generator
function markerStyle(xPct: number, yPct: number, isRed: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left: `${xPct}%`,
    top: `${yPct}%`,
    width: 16,
    height: 16,
    border: isRed ? "3px solid #ef4444" : "3px solid #94a3b8",
    background: isRed ? "#fecaca" : "transparent",
    borderRadius: 6,
    transform: "translate(-50%, -50%) rotate(45deg)",
    boxShadow: isRed ? "0 0 0 3px rgba(239,68,68,0.18)" : "none",
    opacity: isRed ? 1 : 0.9,
  };
}

// Single deterministic scatter point in percentages with padding.
function scatterOne(seedStr: string) {
  let h = 1779033703 ^ seedStr.split("").reduce((a, c) => ((a ^ c.charCodeAt(0)) * 3432918353) >>> 0, 0);
  const rnd = () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const x = 10 + rnd() * 80;
  const y = 14 + rnd() * 72;
  return { x, y };
}

// Many gray points avoiding existing CL points by ~dMin in percentage space.
function scatterManyAvoid(seed: string, n: number, avoid: { x: number; y: number }[], dMin = 7) {
  const pts: { x: number; y: number }[] = [];
  let attempts = 0;
  while (pts.length < n && attempts < n * 50) {
    const p = scatterOne(`${seed}-${attempts}`);
    if (
      avoid.every((a) => dist(a, p) > dMin) &&
      pts.every((a) => dist(a, p) > dMin)
    ) {
      pts.push(p);
    }
    attempts++;
  }
  return pts;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// Legacy scatter when no XML is provided
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

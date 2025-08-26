// src/components/Tables/TableSwap.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";

type TableSwapProps = {
  cycleKey: number;
  queues?: string[];                 // e.g. ["KFB 61-001"]
  okMs?: number;                     // legacy, unused
  slideMs?: number;                  // fade timings; x uses spring
  clsXml?: string;
  hasBoard?: boolean;
  ksskCount?: number;
  ksskTarget?: number;
  swapDelayMs?: number;              // delay before swapping after OK trigger
  okAppearDelayMs?: number;          // delay before showing the big SETUP OK overlay
   boardName?: string | null;            // <-- allow null
  boardMap?: Record<string, string>; // e.g. { KFB1: "KFB 61-001" }
  flashKind?: "success" | "error";   // NEW
  flashSeq?: number;                 // NEW
};

export default function TableSwap({
  cycleKey,
  queues,
  okMs = 5000,
  slideMs = 0.45,
  clsXml,
  hasBoard = false,
  ksskCount = 0,
  ksskTarget = 3,
  swapDelayMs = 2000,       // 2s swap delay
  okAppearDelayMs = 600,    // small extra delay before showing SETUP OK
  boardName,
  boardMap,
  flashKind,
  flashSeq,
}: TableSwapProps) {
  // resolve incoming display title from source
  const incomingTitle = useMemo(() => {
    const mapped = boardName && boardMap?.[boardName];
    return mapped ?? queues?.[0] ?? boardName ?? "";
  }, [boardName, boardMap, queues]);

  // state machine
  const [visibleKey, setVisibleKey] = useState<number>(cycleKey);
  const [visibleTitle, setVisibleTitle] = useState<string>(incomingTitle);
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "okPending" | "swapping">("idle");
  const [okKind, setOkKind] = useState<"success" | "error">("success");
  const prevFlashSeq = useRef<number | null>(null);

  
  const [dir, setDir] = useState<1 | -1>(1);

  const prevCycle = useRef<number>(cycleKey);
  const okTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 useEffect(() => {
    if (flashSeq == null) return;
    if (prevFlashSeq.current === flashSeq) return;
    prevFlashSeq.current = flashSeq;
    setOkKind(flashKind === "error" ? "error" : "success");
    setPhase("okPending");
    const t = setTimeout(() => setPhase("idle"), 900);
    return () => clearTimeout(t);
  }, [flashSeq, flashKind]);
  // new cycle: delay showing OK, then swap; frame never hides
  useEffect(() => {
    if (cycleKey === prevCycle.current) return;

    const nextDir: 1 | -1 = cycleKey > prevCycle.current ? 1 : -1;
    prevCycle.current = cycleKey;
    setDir(nextDir);
    setPendingTitle(incomingTitle);

    if (swapTimer.current) clearTimeout(swapTimer.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);

    swapTimer.current = setTimeout(() => {
      setPhase("swapping");
      setVisibleKey(cycleKey);
      settleTimer.current = setTimeout(() => {
        if (pendingTitle) setVisibleTitle(pendingTitle);
        setPendingTitle(null);
        setPhase("idle");
      }, 650);
    }, Math.max(0, swapDelayMs));

    return () => {
      if (swapTimer.current) clearTimeout(swapTimer.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleKey, incomingTitle, okAppearDelayMs, swapDelayMs]);

  // prompt text
  const prompt = !hasBoard || ksskCount >= ksskTarget ? "Please scan new board number" : "Please scan KSSK";
  const Icon = prompt.includes("KSSK") ? BarsIcon : ScanIcon;
  const showProgress = prompt.includes("KSSK");

 const okTheme =
    okKind === "success"
      ? { bg: "rgba(220, 252, 231, 0.92)", bd: "#86efac", fg: "#065f46", label: "Setup OK" }
      : { bg: "rgba(254, 226, 226, 0.92)", bd: "#fecaca", fg: "#7f1d1d", label: "Setup NOT OK" };


  // directional slide for panel content
  const panelVariants = {
    enter: (d: 1 | -1) => ({
      x: `${d * 26}%`,
      opacity: 0,
      scale: 0.985,
      rotate: d * 0.2,
      filter: "blur(2px)" as any,
    }),
    center: { x: "0%", opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" as any },
    exit: (d: 1 | -1) => ({
      x: `${d * -26}%`,
      opacity: 0,
      scale: 0.985,
      rotate: d * -0.1,
      filter: "blur(2px)" as any,
    }),
  } as const;

  return (
    <div style={{ width: "min(1400px, 100%)", margin: "0 auto" }}>
      <div
        style={{
          position: "relative",
          height: 420,
          overflow: "hidden",
          borderRadius: 28,
          background: "linear-gradient(180deg,#f8fafc 0%,#eef2f7 100%)",
          boxShadow: "0 1px 0 rgba(0,0,0,0.06) inset",
          padding: 16,
        }}
      >
        {/* static frame */}
        <div
          style={{
            position: "absolute",
            inset: 16,
            borderRadius: 24,
            background: "rgba(255,255,255,0.80)",
            backdropFilter: "saturate(180%) blur(14px)",
            WebkitBackdropFilter: "saturate(180%) blur(14px)",
            border: "1px solid rgba(15,23,42,0.08)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.15)",
            display: "grid",
            gridTemplateRows: "auto 1fr",
            rowGap: 12,
            padding: 20,
          }}
        >
          {/* header persists */}
          <Header title={visibleTitle} muted={phase !== "idle"} />

          {/* sliding content area */}
          <div
            style={{
              position: "relative",
              borderRadius: 18,
              background: "#f8fafc",
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
          >
            <AnimatePresence initial={false} custom={dir} mode="wait">
              <m.div
                key={visibleKey}
                custom={dir}
                variants={panelVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: "spring", stiffness: 700, damping: 60, mass: 0.7 },
                  opacity: { duration: slideMs * 0.36 },
                  scale: { duration: slideMs * 0.44 },
                  filter: { duration: slideMs * 0.5 },
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 28,
                  textAlign: "center",
                  willChange: "transform",
                }}
              >
                {/* Hide the prompt while OK is visible */}
                {phase !== "okPending" && <Body prompt={prompt} />}

                {/* Big SETUP OK overlay inside the table */}
            <AnimatePresence>
            {phase === "okPending" && (
              <m.div
                key={`okOverlay-${prevFlashSeq.current ?? 0}`}   // ensure remount
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                style={{
                  position: "absolute",
                  inset: 12,
                  borderRadius: 16,
                  background: okTheme.bg,
                  border: `1px solid ${okTheme.bd}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    fontWeight: 1000,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    fontSize: "clamp(44px, 7.5vw, 96px)",
                    color: okTheme.fg,
                    lineHeight: 1.02,
                    textAlign: "center",
                  }}
                >
                  {okTheme.label}
                </div>
              </m.div>
            )}
          </AnimatePresence>
              </m.div>
            </AnimatePresence>
          </div>
        </div>

        {/* floating callout hidden during OK as well */}
        <AnimatePresence>
          {phase !== "okPending" && (
            <m.div
              key="callout"
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              style={{
                position: "absolute",
                right: 24,
                top: 24,
                padding: "12px 16px",
                borderRadius: 20,
                border: "1px solid rgba(15,23,42,0.06)",
                background: "rgba(255,255,255,0.72)",
                backdropFilter: "saturate(180%) blur(12px)",
                WebkitBackdropFilter: "saturate(180%) blur(12px)",
                boxShadow: "0 6px 22px rgba(0,0,0,0.12)",
                color: "#0f172a",
                fontWeight: 800,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                gap: 10,
                maxWidth: "70%",
                whiteSpace: "nowrap",
              }}
            >
              <Icon />
              <span>{prompt}</span>
              {showProgress && (
                <span
                  style={{
                    marginLeft: 8,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "rgba(15,23,42,0.06)",
                    fontWeight: 700,
                    letterSpacing: 0,
                    textTransform: "none",
                  }}
                >
                  {ksskCount}/{ksskTarget}
                </span>
              )}
              <m.span
                aria-hidden
                animate={{ x: [0, 4, 0] }}
                transition={{ repeat: Infinity, repeatType: "loop", duration: 1.6 }}
                style={{ display: "inline-flex", marginLeft: 6 }}
              >
                <ChevronRight />
              </m.span>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- parts ---------- */

function Header({ title, muted }: { title: string; muted: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center" }}>
      <div
        style={{
          fontWeight: 900,
          fontSize: 22,
          letterSpacing: "0.02em",
          color: "#0f172a",
          textTransform: "uppercase",
          lineHeight: 1.1,
          opacity: muted ? 0.85 : 1,
          transition: "opacity .2s ease",
        }}
      >
        {title}
      </div>
      <div style={{ width: 124, height: 10, background: "#e5e7eb", borderRadius: 999, opacity: 0.9 }} />
    </div>
  );
}

function Body({ prompt }: { prompt: string }) {
  return (
    <div
      style={{
        maxWidth: "92%",
        fontWeight: 1000,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontSize: "clamp(36px, 6vw, 64px)",
        color: "#0f172a",
        opacity: 0.9,
        lineHeight: 1.05,
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
        textWrap: "balance" as any,
      }}
    >
      {prompt}
    </div>
  );
}

/* ---------- icons ---------- */

function ScanIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="3" stroke="#64748b" strokeWidth="2" />
      <path d="M7 6V5a5 5 0 0 1 10 0v1" stroke="#64748b" strokeWidth="2" />
    </svg>
  );
}

function BarsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      {Array.from({ length: 10 }).map((_, i) => (
        <rect key={i} x={3 + i * 1.8} y={4 + (i % 2 ? 2 : 0)} width="1.2" height={14 - (i % 2 ? 2 : 0)} rx="0.6" fill="#64748b" />
      ))}
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// src/components/Tables/TableSwap.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";

type TableSwapProps = {
  cycleKey: number;
  queues?: string[];
  okMs?: number;
  slideMs?: number;
  clsXml?: string;

  /** new: control banner text by workflow */
  hasBoard?: boolean;     // true after KFB scanned
  ksskCount?: number;     // 0..3
  ksskTarget?: number;    // default 3
};

export default function TableSwap({
  cycleKey,
  queues,
  okMs = 5000,
  slideMs = 0.6,
  clsXml,
  hasBoard = false,
  ksskCount = 0,
  ksskTarget = 3,
}: TableSwapProps) {
  const data = useMemo(
    () => (queues?.length ? queues : ["KFB 61-001"]).map((t, i) => ({ id: `${i}-${t}`, title: t })),
    [queues]
  );
  const current = data[0];

  // internal splash state
  const [mode, setMode] = useState<"idle" | "ok">("idle");
  const prev = useRef<number>(cycleKey);

  useEffect(() => {
    if (cycleKey === prev.current) return;
    prev.current = cycleKey;
    setMode("ok");
  }, [cycleKey]);

  useEffect(() => {
    if (mode !== "ok") return;
    const t = setTimeout(() => setMode("idle"), okMs);
    return () => clearTimeout(t);
  }, [mode, okMs]);

  // banner logic
  const prompt =
    mode === "ok"
      ? ""
      : !hasBoard || ksskCount >= ksskTarget
      ? "Please scan new board number"
      : "Please scan KSSK";

  const stageVariants = {
    enter: { x: "10%", opacity: 0, scale: 0.985, filter: "blur(2px)" as any },
    center: { x: "0%", opacity: 1, scale: 1, filter: "blur(0px)" as any },
    exit: { x: "-12%", opacity: 0, scale: 0.985, filter: "blur(2px)" as any },
  };

  const Icon = prompt.includes("KSSK") ? BarsIcon : ScanIcon;

  return (
    <div style={{ width: "min(1400px, 100%)", margin: "0 auto" }}>
      <div
        style={{
          position: "relative",
          height: 380,
          overflow: "hidden",
          borderRadius: 20,
          border: "2px dashed #94a3b8",
          background: "linear-gradient(180deg,#f8fafc 0%,#f1f5f9 60%,#eef2f6 100%)",
        }}
      >
        {/* card */}
        <AnimatePresence initial={false} mode="wait">
          <m.div
            key={`${current.id}-${mode}`}
            variants={stageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: slideMs, ease: [0.22, 0.8, 0.2, 1] }}
            style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
          >
            <Card title={current.title} mode={mode} prompt={prompt} />
          </m.div>
        </AnimatePresence>

        {/* animated callout */}
        {prompt && (
          <m.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
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
              overflow: "hidden",
            }}
          >
            <Icon />
            <span style={{ whiteSpace: "nowrap" }}>{prompt}</span>
            <m.span
              aria-hidden
              animate={{ x: [0, 4, 0] }}
              transition={{ repeat: Infinity, repeatType: "loop", duration: 1.6 }}
              style={{ display: "inline-flex", marginLeft: 4 }}
            >
              <ChevronRight />
            </m.span>
          </m.div>
        )}
      </div>
    </div>
  );
}

/* ---------- presentational ---------- */

function Card({ title, mode, prompt }: { title: string; mode: "idle" | "ok"; prompt: string }) {
  const base = { w: 1040, h: 320, p: 24 };
  const accent = "#334155";
  const border = "#cbd5e1";

  return (
    <div
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
      {/* header */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center" }}>
        <div
          style={{
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: "0.03em",
            color: accent,
            textTransform: "uppercase",
            lineHeight: 1.1,
          }}
        >
          {mode === "ok" ? title : ""}
        </div>
        <div style={{ width: 140, height: 22, background: "#e2e8f0", borderRadius: 999, opacity: 0.8 }} />
      </div>

      {/* body */}
      <div
        style={{
          position: "relative",
          borderRadius: 14,
          background: "#f8fafc",
          border: "2px solid #e2e8f0",
          overflow: "hidden",
          display: "grid",
          placeItems: "center",
        }}
      >
        {mode === "ok" ? (
          <m.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "#dcfce7",
              border: "2px solid #86efac",
              borderRadius: 12,
            }}
          >
            <div style={{ textAlign: "center", lineHeight: 1.1 }}>
              <div
                style={{
                  fontWeight: 1000,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontSize: "clamp(40px, 8vw, 80px)",
                  color: "#065f46",
                }}
              >
                Setup Ok
              </div>
            </div>
          </m.div>
        ) : (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#f8fafc" }}
          >
            <div
              style={{
                fontWeight: 1000,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontSize: "clamp(40px, 8vw, 60px)",
                color: "#0f172a",
                opacity: 0.8,
              }}
            >
              {prompt}
            </div>
          </m.div>
        )}
      </div>
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

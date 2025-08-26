// src/app/setup/page.tsx
"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  memo,
  type CSSProperties,
} from "react";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import TableSwap from "@/components/Tables/TableSwap";

/* ===== Config ===== */
const OK_DISPLAY_MS = 3000;
const HTTP_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SETUP_HTTP_TIMEOUT_MS ?? "8000");
const KROSY_OFFLINE_URL =
  process.env.NEXT_PUBLIC_KROSY_OFFLINE_CHECKPOINT ?? "/api/krosy-offline";

/* ===== Regex / small UI ===== */
function compileRegex(src: string | undefined, fallback: RegExp): RegExp {
  if (!src) return fallback;
  try {
    const m = src.match(/^\/(.+)\/([gimsuy]*)$/);
    return m ? new RegExp(m[1], m[2]) : new RegExp(src);
  } catch {
    return fallback;
  }
}

function InlineErrorBadge({ text, onClear }: { text: string; onClear?: () => void }) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderRadius: 999,
    background: "rgba(239,68,68,0.12)",
    border: "3px solid #fca5a5",
    boxShadow: "0 2px 10px rgba(239,68,68,0.18), inset 0 1px 0 #fff",
    color: "#7f1d1d",
    fontWeight: 1000,
    fontSize: 18,
    letterSpacing: "0.01em",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
  const iconWrap: CSSProperties = {
    width: 22, height: 22, borderRadius: 999,
    background: "linear-gradient(180deg,#fb7185,#ef4444)",
    boxShadow: "0 0 0 3px rgba(239,68,68,0.20)",
    display: "grid", placeItems: "center", flex: "0 0 auto",
  };
  const closeBtn: CSSProperties = {
    marginLeft: 6, border: 0, background: "transparent",
    color: "#7f1d1d", fontSize: 22, lineHeight: 1, cursor: "pointer",
  };
  return (
    <div style={base} role="status" aria-live="polite" title={text}>
      <span aria-hidden style={iconWrap}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 7v6m0 4h.01" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      <span style={{ maxWidth: 760, overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      {onClear && (
        <button type="button" onClick={onClear} aria-label="Dismiss error" style={closeBtn}>
          ×
        </button>
      )}
    </div>
  );
}
function extractPinsFromKrosy(data: any): { normalPins: number[]; latchPins: number[] } {
  const take = (node: any) => (Array.isArray(node) ? node : node != null ? [node] : []);

  // segment can live under workingData or loadedData
  const segmentRoot =
    data?.response?.krosy?.body?.visualControl?.workingData?.sequencer?.segmentList?.segment ??
    data?.response?.krosy?.body?.visualControl?.loadedData?.sequencer?.segmentList?.segment;

  const segments = take(segmentRoot);

  const normal: number[] = [];
  const latch: number[] = [];

  for (const seg of segments) {
    const seqArr = take(seg?.sequenceList?.sequence);
    for (const s of seqArr) {
      const mt = String(s?.measType ?? "").trim().toLowerCase();
      if (mt !== "default") continue; // ignore no_check etc.

      const parts = String(s?.objPos ?? "").split(",");
      let isLatch = false;
      if (parts.length && parts[parts.length - 1].trim().toUpperCase() === "C") {
        isLatch = true;
        parts.pop();
      }
      const last = parts[parts.length - 1] ?? "";
      const pin = Number(String(last).replace(/[^\d]/g, ""));
      if (!Number.isFinite(pin)) continue;
      (isLatch ? latch : normal).push(pin);
    }
  }

  const uniq = (xs: number[]) => Array.from(new Set(xs));
  return { normalPins: uniq(normal), latchPins: uniq(latch) };
}

/* ===== KFB as MAC (AA:BB:CC:DD:EE:FF) ===== */
const MAC_REGEX = compileRegex(
  process.env.NEXT_PUBLIC_KFB_REGEX,
  /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i);
const KSSK_DIGITS_REGEX = /^\d{12}$/;
const digitsOnly = (s: string) => String(s ?? "").replace(/\D+/g, "");
function canonicalMac(raw: string): string | null {
  if (!/[:\-]/.test(raw) && !/[A-Fa-f]/.test(raw)) return null; // no separators & no hex letters → not a MAC
  const hex = String(raw ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) return null;
  const mac = hex.match(/.{2}/g)!.join(":");
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(mac) ? mac : null;
}


/* ===== Types ===== */
type ScanState = "idle" | "valid" | "invalid";
type KsskIndex = 0 | 1 | 2;
type KsskPanel = `kssk${KsskIndex}`;
type PanelKey = "kfb" | KsskPanel;
type OfflineResp = { ok: boolean; status: number; data: any | null };

/* ===== Page ===== */
export default function SetupPage() {
  const allowManual = true;
  const prefersReduced = useReducedMotion();

  const [kfb, setKfb] = useState<string | null>(null);
  const [ksskSlots, setKsskSlots] = useState<Array<string | null>>([null, null, null]);

  const [showManualFor, setShowManualFor] = useState<Record<string, boolean>>({});
  const [overlay, setOverlay] = useState<{ open: boolean; kind: "success" | "error"; code: string; msg?: string }>(
    { open: false, kind: "success", code: "" }
  );
  const [tableCycle, setTableCycle] = useState(0);
  const [kbdBuffer, setKbdBuffer] = useState("");

  const sendBusyRef = useRef(false);

  /* ===== Helpers ===== */
  const normalizeKssk = (s: string) => digitsOnly(s);
  const classify = (raw: string): { type: "kfb" | "kssk" | null; code: string } => {
    const asKssk = normalizeKssk(raw);
    if (KSSK_DIGITS_REGEX.test(asKssk)) return { type: "kssk", code: asKssk };

    const mac = canonicalMac(raw);
    if (mac) return { type: "kfb", code: mac };

    return { type: null, code: raw };
  };


  const [lastError, setLastError] = useState<string | null>(null);

  const showOk = (code: string, msg?: string) => {
    setOverlay({ open: true, kind: "success", code, msg });
    setLastError(null);
  };
  const showErr = (code: string, msg?: string) => {
    setOverlay({ open: true, kind: "error", code, msg });
    setLastError(`${code}${msg ? ` — ${msg}` : ""}`);
  };

  const resetAll = useCallback(() => {
    setKfb(null);
    setKsskSlots([null, null, null]);
    setShowManualFor({});
    setLastError(null);
  }, []);

  /* ===== Network ===== */
  const withTimeout = async <T,>(fn: (signal: AbortSignal) => Promise<T>) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), HTTP_TIMEOUT_MS);
    try {
      return await fn(c.signal);
    } finally {
      clearTimeout(t);
    }
  };

  const sendKsskToOffline = useCallback(async (ksskDigits: string): Promise<OfflineResp> => {
    return withTimeout(async (signal) => {
      try {
        const res = await fetch(KROSY_OFFLINE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          signal,
          body: JSON.stringify({
            intksk: ksskDigits,
            requestID: "1",
            sourceHostname: typeof window !== "undefined" ? window.location.hostname : undefined,
            targetHostName: process.env.NEXT_PUBLIC_KROSY_XML_TARGET ?? undefined,
          }),
        });

        let data: any = null;
        try { data = await res.json(); } catch {}
        return { ok: res.ok, status: res.status, data };
      } catch {
        return { ok: false, status: 0, data: null };
      }
    });
  }, []);

  /* ===== Acceptors ===== */
  const acceptKfb = useCallback((code: string) => {
    setKfb((prev) => {
      if (prev !== code) {
        setKsskSlots([null, null, null]);
        setShowManualFor({});
      }
      return code;
    });
    setTableCycle((n) => n + 1);
    showOk(code, "BOARD SET");
  }, []);

  const acceptKsskToIndex = useCallback(
    async (code: string, idx?: number) => {
      if (!kfb) { showErr(code, "Scan MAC address first"); return; }
      if (ksskSlots.some((c) => c === code)) { showErr(code, "Duplicate KSSK"); return; }
      const target = typeof idx === "number" ? idx : ksskSlots.findIndex((v) => v === null);
      if (target === -1) { showErr(code, "Batch full (3/3)"); return; }

      // optimistic fill
      setKsskSlots((prev) => { const n = [...prev]; n[target] = code; return n; });
      setTableCycle((n) => n + 1);

      if (sendBusyRef.current) return;
      sendBusyRef.current = true;
      const resp = await sendKsskToOffline(code);
      sendBusyRef.current = false;

      // Krosy comms error (no network/timeout)
      if (!resp.ok && resp.status === 0) {
        setKsskSlots((prev) => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
        showErr(code, "Krosy communication error");
        return;
      }

      if (resp.ok) {
        // Extract pins
        const pins = resp.data ? extractPinsFromKrosy(resp.data) : null;
        const hasPins = !!pins && ((pins.normalPins?.length ?? 0) + (pins.latchPins?.length ?? 0)) > 0;

        if (!hasPins) {
          // No pins => big error + revert slot
          setKsskSlots((prev) => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
          showErr(code, "Krosy configuration error: no PINS");
          return;
        }

        // Send to ESP + log happens in server route; include kssk for audit
        try {
          const r = await fetch("/api/serial", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              normalPins: pins!.normalPins,
              latchPins: pins!.latchPins,
              mac: kfb.toUpperCase(),
              kssk: code,
            }),
          });

          if (!r.ok) {
            const t = await r.text().catch(() => "");
            setLastError(`ESP write failed — ${t || r.status}`);
          }
        } catch (e: any) {
          setLastError(`ESP write failed — ${e?.message ?? "unknown error"}`);
        }

        // UX success pulse then maybe reset at 3/3
        showOk(code, "KSSK OK");
        setTimeout(() => {
          setKsskSlots((prev) => {
            const filled = prev.filter(Boolean).length;
            if (filled >= 3) resetAll();
            return prev;
          });
        }, OK_DISPLAY_MS);
      } else {
        // HTTP error with status
        setKsskSlots((prev) => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
        showErr(code, `KSSK send failed (${resp.status || "no status"})`);
      }
    },
    [kfb, ksskSlots, resetAll, sendKsskToOffline]
  );

  /* ===== Manual + Scanner wedge ===== */
  const handleManualSubmit = useCallback(
    (panel: PanelKey, raw: string) => {
      const { type, code } = classify(raw);
      if (!type) { showErr(raw, "Unrecognized code"); return; }

      if (panel === "kfb") {
        if (type !== "kfb") { showErr(code, "Expected ESP MAC (AA:BB:CC:DD:EE:FF)"); return; }
        acceptKfb(code);
      } else {
        if (type !== "kssk") { showErr(code, "Expected KSSK (12 digits)"); return; }
        const idx = Number(panel.slice(-1)) as KsskIndex;
        void acceptKsskToIndex(code, idx);
      }
      setShowManualFor((s) => ({ ...s, [panel]: false }));
    },
    [acceptKfb, acceptKsskToIndex]
  );

  const handleScanned = useCallback((raw: string) => {
    const { type, code } = classify(raw);
    if (!type) { showErr(code || raw, "Unrecognized code"); return; }
    if (type === "kfb") acceptKfb(code);
    else void acceptKsskToIndex(code);
  }, [acceptKfb, acceptKsskToIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Enter") {
        if (kbdBuffer.trim()) { handleScanned(kbdBuffer.trim()); setKbdBuffer(""); }
      } else if (e.key.length === 1) setKbdBuffer((s) => (s + e.key).slice(-128));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kbdBuffer, handleScanned]);

  /* ===== Styles ===== */
  const fontStack =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"';

  const page: CSSProperties = { minHeight: "100vh", display: "grid", gap: 16, alignContent: "start", background: "#ffffff", padding: "18px 16px 40px", fontFamily: fontStack };
  const containerWide: CSSProperties = { width: "min(1280px, 100%)", margin: "0 auto" };

  const hero: CSSProperties = { ...containerWide, border: "1px solid #edf2f7", background: "#fff", borderRadius: 16, padding: 16, display: "grid", gap: 6 };
  const heroTopRow: CSSProperties = { display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" };
  const heroLeft: CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };
  const heroBoard: CSSProperties = { fontSize: 44, fontWeight: 1000, letterSpacing: "0.01em", color: "#0f172a", textTransform: "uppercase" };

  const heroProgressPill: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 999,
    border: "2px solid #a7f3d0",
    background: "rgba(16,185,129,0.08)",
    fontSize: 18,
    fontWeight: 900,
    color: "#065f46",
  };

  const section: CSSProperties = { ...containerWide, display: "grid", gap: 10 };
  const card: CSSProperties = { border: "1px solid #edf2f7", borderRadius: 16, background: "#fff", padding: 18, display: "grid", gap: 12 };
  const eyebrow: CSSProperties = { fontSize: 11, letterSpacing: "0.08em", color: "#64748b", textTransform: "uppercase", fontWeight: 800 };
  const heading: CSSProperties = { fontSize: 28, fontWeight: 900, letterSpacing: "0.01em", color: "#0f172a" };

  const slotsGrid: CSSProperties = { display: "grid", gap: 14, gridTemplateColumns: "repeat(3, minmax(220px, 1fr))" };

  const hint: CSSProperties = { fontSize: 12, color: "#2563eb", textDecoration: "underline", cursor: "pointer", fontWeight: 700 };
  const input: CSSProperties = { width: "100%", height: 46, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 12px", fontSize: 18, outline: "none", background: "#fff", color: "#0f172a", caretColor: "#0f172a" };

  const ksskCount = ksskSlots.filter(Boolean).length;

  return (
    <main style={page}>
      {/* HERO */}
      <m.section layout style={hero} aria-live="polite">
        {!kfb ? (
          <m.div layout style={heroLeft}>
            <m.div
              layout
              initial={{ y: prefersReduced ? 0 : 6, opacity: 0.0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 30, mass: 0.7 }}
              style={heroBoard}
            >
              Scan BOARD NUMBER
            </m.div>
          </m.div>
        ) : (
          <m.div layout style={heroTopRow}>
            <m.div layout style={heroLeft}>
              <m.div
                layout
                initial={{ scale: prefersReduced ? 1 : 0.985, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 680, damping: 32 }}
                style={heroBoard}
              >
                BOARD: {kfb}
              </m.div>

              <m.div layout style={heroProgressPill}>
                <SignalDot />
                {ksskCount}/3 KSSK
              </m.div>
            </m.div>

            {lastError && (
              <InlineErrorBadge text={lastError} onClear={() => setLastError(null)} />
            )}

            {ksskCount >= 1 && (
              <m.div layout>
                <StepBadge label="SCAN NEW BOARD TO START OVER" onClick={resetAll} />
              </m.div>
            )}
          </m.div>
        )}
      </m.section>

      {/* Step 1: KFB (animated scanner, full width) */}
      <AnimatePresence initial={false}>
        {!kfb && (
          <m.section
            key="kfb-stage"
            style={section}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: prefersReduced ? 0 : 0.14, ease: "easeOut" }}
          >
            <m.section layout style={card}>
              <div style={{ display: "grid", gap: 4 }}>
                <span style={eyebrow}>Step 1</span>
                <h2 style={heading}>BOARD NUMBER (MAC)</h2>
              </div>

              <ScanBoxAnimated ariaLabel="KFB scan zone" height={160} />

              {allowManual && (
                <button
                  type="button"
                  style={{ ...hint, justifySelf: "start", background: "transparent", border: 0 }}
                  onClick={() => setShowManualFor((s) => ({ ...s, kfb: !s.kfb }))}
                >
                  Enter manually
                </button>
              )}

              <AnimatePresence initial={false}>
                {showManualFor.kfb && allowManual && (
                  <m.div
                    key="kfb-manual"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: prefersReduced ? 0 : 0.14 }}
                  >
                    <ManualInput placeholder="Type ESP MAC e.g. 08:3A:8D:15:27:54" onSubmit={(v) => handleManualSubmit("kfb", v)} inputStyle={input} />
                  </m.div>
                )}
              </AnimatePresence>
            </m.section>
          </m.section>
        )}
      </AnimatePresence>

      {/* Step 2: KSSK (compact) */}
      {kfb && (
        <section style={section}>
          <section style={card}>
            <div style={{ display: "grid", gap: 4 }}>
              <span style={eyebrow}>Step 2</span>
              <h2 style={heading}>KSSK</h2>
            </div>

            <div style={slotsGrid}>
              {([0, 1, 2] as const).map((idx) => {
                const code = ksskSlots[idx];
                return (
                  <KsskSlotCompact
                    key={idx}
                    index={idx}
                    code={code}
                    onManualToggle={() => setShowManualFor((s) => ({ ...s, [`kssk${idx}`]: !s[`kssk${idx}`] }))}
                    manualOpen={!!showManualFor[`kssk${idx}`]}
                    onSubmit={(v) => handleManualSubmit(`kssk${idx}`, v)}
                  />
                );
              })}
            </div>
          </section>
        </section>
      )}

      {/* TableSwap */}
      <div style={{ ...containerWide, marginTop: 6 }}>
        <TableSwap
          cycleKey={tableCycle}
          hasBoard={!!kfb}
          ksskCount={ksskCount}
          ksskTarget={3}
          boardName={kfb}
          boardMap={{}}
          okAppearDelayMs={350}
          swapDelayMs={1400}
        />
      </div>

      {/* Overlay */}
      <ResultOverlay
        open={overlay.open}
        kind={overlay.kind}
        code={overlay.code}
        msg={overlay.msg}
        onClose={() => setOverlay((o) => ({ ...o, open: false }))}
      />
    </main>
  );
}

/* ===== Scan visuals (animated only for KFB) ===== */

function ScanBoxAnimated({ ariaLabel, height = 160 }: { ariaLabel: string; height?: number }) {
  const prefersReduced = useReducedMotion();
  return (
    <div
      style={{
        width: "100%",
        height,
        borderRadius: 14,
        background: "#fbfdff",
        border: "1px solid #e6eef7",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        position: "relative",
        willChange: "transform",
      }}
      aria-label={ariaLabel}
    >
      {!prefersReduced && (
        <m.div
          initial={{ backgroundPositionX: "0%" }}
          animate={{ backgroundPositionX: "100%" }}
          transition={{ repeat: Infinity, duration: 2.2, ease: "linear" }}
          style={{
            position: "absolute",
            inset: 0,
            backgroundSize: "120px 100%",
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(30,58,138,0.06) 0 1px, transparent 1px 12px)",
            opacity: 0.45,
            willChange: "background-position",
          }}
        />
      )}
      <m.div
        initial={{ scale: prefersReduced ? 1 : 0.985, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 680, damping: 28 }}
        style={{
          width: "min(100%, 720px)",
          height: 84,
          borderRadius: 12,
          background:
            "repeating-linear-gradient(90deg, rgba(6,30,62,0.32) 0 6px, transparent 6px 14px)",
        }}
      />
      {!prefersReduced && (
        <m.div
          initial={{ y: -90, opacity: 0.0 }}
          animate={{ y: 90, opacity: 0.9 }}
          transition={{ repeat: Infinity, repeatType: "reverse", duration: 1.1, ease: "easeInOut" }}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 38,
            filter: "blur(10px)",
            background:
              "linear-gradient(180deg, rgba(59,130,246,0.00) 0%, rgba(59,130,246,0.28) 45%, rgba(59,130,246,0.00) 100%)",
            pointerEvents: "none",
            willChange: "transform, opacity",
          }}
        />
      )}
    </div>
  );
}

/* ===== KSSK slots (compact, no animation in scan area) ===== */

const KsskSlotCompact = memo(function KsskSlotCompact({
  index,
  code,
  manualOpen,
  onManualToggle,
  onSubmit,
}: {
  index: 0 | 1 | 2;
  code: string | null;
  manualOpen: boolean;
  onManualToggle: () => void;
  onSubmit: (v: string) => void;
}) {
  const filled = !!code;

  return (
    <div
      style={{
        border: "1px solid #edf2f7",
        borderRadius: 14,
        background: filled ? "#f0fdf4" : "#fbfdff",
        padding: 14,
        display: "grid",
        gap: 10,
        position: "relative",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: 14,
            background: "#eef6ff", border: "1px solid #d9e7ff",
            display: "grid", placeItems: "center",
          }}
        >
          <span style={{ fontSize: 24, fontWeight: 1000, color: "#0b1220" }}>{index + 1}</span>
        </div>
        <StateIcon state={filled ? "valid" : "idle"} size={40} />
      </div>

      {/* code pill */}
      <div>
        <CodePill value={code || "—"} highlight={filled ? "success" : "neutral"} big />
      </div>

      {/* Static scan stripes */}
      <div
        aria-label={`KSSK scan zone ${index + 1}`}
        style={{
          width: "100%",
          height: 112,
          borderRadius: 12,
          background: "#fbfdff",
          border: "1px dashed #d6e3f0",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "min(100%, 520px)",
            height: 64,
            borderRadius: 8,
            background: "repeating-linear-gradient(90deg,#8aa0b8 0 6px,transparent 6px 14px)",
            opacity: 0.9,
          }}
        />
      </div>

      <button
        type="button"
        onClick={onManualToggle}
        style={{
          fontSize: 12, color: "#2563eb", textDecoration: "underline",
          cursor: "pointer", fontWeight: 700, background: "transparent", border: 0, justifySelf: "start"
        }}
      >
        Enter manually
      </button>

      <AnimatePresence initial={false}>
        {manualOpen && (
          <m.div
            key="manual"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.14 }}
          >
            <ManualInput
              placeholder={`Type KSSK for slot ${index + 1}`}
              onSubmit={onSubmit}
              inputStyle={{ width: "100%", height: 46, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 12px", fontSize: 18, outline: "none", background: "#fff", color: "#0f172a", caretColor: "#0f172a" }}
            />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/* ===== Shared bits ===== */

function ManualInput({ placeholder, onSubmit, inputStyle }: { placeholder: string; onSubmit: (value: string) => void; inputStyle: CSSProperties }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); setV(""); }}>
      <input
        style={inputStyle}
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.currentTarget.value)}
        inputMode="text"
        autoFocus
        aria-label={placeholder}
      />
    </form>
  );
}

function StateIcon({ state, size = 36 }: { state: ScanState; size?: number }) {
  if (state === "idle")
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 3} fill="#ffffff" stroke="#d1d9e6" strokeWidth="3" />
      </svg>
    );
  if (state === "valid")
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="32" fill="#10b981" />
        <path d="M18 34l10 9L46 22" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="28" fill="#ef4444" />
      <path d="M18 18l20 20M38 18l-20 20" stroke="white" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function StepBadge({ label, onClick }: { label: string; onClick?: () => void }) {
  const base: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 999,
    background: "#fff",
    border: "1px solid #e6eef7",
    boxShadow: "0 2px 6px rgba(15,23,42,0.04)",
    cursor: onClick ? "pointer" : "default",
    userSelect: "none",
  };
  const text: CSSProperties = { fontSize: 14, fontWeight: 900, color: "#0f172a", whiteSpace: "nowrap", letterSpacing: "0.02em" };
  return (
    <div
      style={base}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      aria-label={label}
    >
      <NextStepIcon size={20} />
      <div style={text}>{label}</div>
    </div>
  );
}

function NextStepIcon({ size = 20 }: { size?: number }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#e6f6ff" stroke="#c7e2ff" strokeWidth="2" />
      <path d="M18 16 L30 24 L18 32" fill="none" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignalDot() {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: 999,
        background: "linear-gradient(180deg,#34d399,#10b981)",
        boxShadow: "0 0 0 2px rgba(16,185,129,0.18)",
        display: "inline-block",
      }}
    />
  );
}

function CodePill({
  value,
  highlight = "neutral",
  big = false,
}: {
  value: string;
  highlight?: "neutral" | "success" | "danger";
  big?: boolean;
}) {
  const palette =
    highlight === "success"
      ? { bg: "rgba(16,185,129,0.08)", bd: "#a7f3d0", fg: "#065f46", dot: "linear-gradient(180deg,#34d399,#10b981)", ring: "rgba(16,185,129,0.18)" }
      : highlight === "danger"
      ? { bg: "rgba(239,68,68,0.08)", bd: "#fecaca", fg: "#7f1d1d", dot: "linear-gradient(180deg,#fb7185,#ef4444)", ring: "rgba(239,68,68,0.18)" }
      : { bg: "rgba(2,6,23,0.04)", bd: "#dbe3ee", fg: "#0f172a", dot: "linear-gradient(180deg,#cbd5e1,#94a3b8)", ring: "rgba(2,6,23,0.06)" };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: big ? "10px 14px" : "6px 10px",
        borderRadius: 999,
        background: palette.bg,
        border: `2px solid ${palette.bd}`,
        lineHeight: 1,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.8)`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: big ? 18 : 14,
          height: big ? 18 : 14,
          borderRadius: 999,
          background: palette.dot,
          boxShadow: `0 0 0 2px ${palette.ring}`,
          display: "inline-block",
          flex: "0 0 auto",
        }}
      />
      <span
        style={{
          fontSize: big ? 26 : 18,
          fontWeight: 1000,
          letterSpacing: big ? "0.01em" : "0",
          color: palette.fg,
          whiteSpace: "nowrap",
          fontFeatureSettings: '"tnum" 1',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ===== Overlay ===== */
function ResultOverlay({
  open, kind, code, msg, onClose,
}: { open: boolean; kind: "success" | "error"; code: string; msg?: string; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
  }, [open, onClose]);

  const isOk = kind === "success";
  const BG = isOk ? "rgba(16,185,129,0.50)" : "rgba(239,68,68,0.50)";
  const EDGE = isOk ? "rgba(5,150,105,1)" : "rgba(127,29,29,1)";

  return (
    <AnimatePresence>
      {open && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: "tween", duration: 0.12 }}
          style={{
            position: "fixed", inset: 0, background: BG, display: "grid", placeItems: "center",
            zIndex: 80, pointerEvents: "none", willChange: "opacity",
          }}
          aria-live="assertive"
          aria-label={isOk ? "OK" : "ERROR"}
        >
          <m.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.6 }}
            style={{ display: "grid", justifyItems: "center", gap: 10, padding: 8, transform: "translateZ(0)", willChange: "transform, opacity" }}
          >
            <div
              style={{
                fontSize: 180, lineHeight: 1, fontWeight: 1000, letterSpacing: "0.03em",
                color: "#fff", textShadow: `0 0 0 ${EDGE}, 0 10px 28px rgba(0,0,0,0.45)`,
                fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
              }}
            >
              {isOk ? "OK" : "ERROR"}
            </div>

            {(code || msg) && (
              <div
                style={{
                  fontSize: 24, fontWeight: 900, color: "#fff",
                  textShadow: "0 2px 10px rgba(0,0,0,0.45)", textAlign: "center",
                  maxWidth: 960, padding: "0 12px", wordBreak: "break-all",
                }}
              >
                {code}{msg ? ` — ${msg}` : ""}
              </div>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

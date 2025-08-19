// src/app/setup/page.tsx
"use client";

import { useEffect, useState, useCallback, useRef, type CSSProperties } from "react";
import { m, AnimatePresence } from "framer-motion"; // KEEP THIS

type StepKey = "kssk" | "kfb";
type ScanState = "idle" | "valid" | "invalid";

const KSSK_REGEX = /^KSK\d{10}$/; // e.g. KSK9866358756
const KFB_REGEX  = /^[A-Z0-9]{9}$/;  // e.g. 83AUD8722
const OK_DISPLAY_MS = 3000;

export default function SetupPage() {
  // feature toggles
  const allowManual = true;

  // data
  const [kssk, setKssk] = useState<string | null>(null);
  const [kfb,  setKfb]  = useState<string | null>(null);

  // status
  const [ksskStatus, setKsskStatus] = useState<ScanState>("idle");
  const [kfbStatus,  setKfbStatus]  = useState<ScanState>("idle");
  const [activeStep, setActiveStep] = useState<StepKey>("kssk");
  const [showManualFor, setShowManualFor] = useState<Partial<Record<StepKey, boolean>>>({});

  // overlay
  const [overlay, setOverlay] = useState<{open: boolean; kind: "success" | "error"; code: string}>({
    open: false,
    kind: "success",
    code: "",
  });

  // cycle banners
  const [showCycleOk, setShowCycleOk]   = useState(false);
  const [waitingNext, setWaitingNext]   = useState(false);
  const okTimer = useRef<number | null>(null);

  // fake keyboard wedge to simulate a scanner
  const [kbdBuffer, setKbdBuffer] = useState("");
  const handleScanned = useCallback(
    (raw: string) => {
      const { step, code } = classify(raw);
      if (!step) {
        setOverlay({ open: true, kind: "error", code });
        return;
      }
      if (step === "kssk") {
        setKssk(code);
        setKsskStatus("valid");
        if (!kfb) setActiveStep("kfb");
      } else {
        setKfb(code);
        setKfbStatus("valid");
        if (!kssk) setActiveStep("kssk");
      }
      setWaitingNext(false); // new cycle begins
      setOverlay({ open: true, kind: "success", code });
    },
    [kssk, kfb]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Enter") {
        if (kbdBuffer.trim()) {
          handleScanned(kbdBuffer.trim());
          setKbdBuffer("");
        }
      } else if (e.key.length === 1) {
        setKbdBuffer((s) => (s + e.key).slice(-128));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kbdBuffer, handleScanned]);

  // order-agnostic classification
  const normalize = (s: string) => s.trim().toUpperCase();
  const classify = (raw: string): { step: StepKey | null; code: string } => {
    const code = normalize(raw);
    if (KSSK_REGEX.test(code)) return { step: "kssk", code };
    if (KFB_REGEX.test(code))  return { step: "kfb",  code };
    return { step: null, code };
  };

  const handleManualSubmit = useCallback(
    (_step: StepKey, raw: string) => {
      if (!raw.trim()) return;
      const { step, code } = classify(raw);
      if (!step) {
        setOverlay({ open: true, kind: "error", code });
        return;
      }
      if (step === "kssk") {
        setKssk(code);
        setKsskStatus("valid");
        if (!kfb) setActiveStep("kfb");
      } else {
        setKfb(code);
        setKfbStatus("valid");
        if (!kssk) setActiveStep("kssk");
      }
      setWaitingNext(false);
      setOverlay({ open: true, kind: "success", code });
      setShowManualFor((s) => ({ ...s, [_step]: false }));
    },
    [kssk, kfb]
  );

  // when both valid → show OK 3s → reset → show “scan next table”
  useEffect(() => {
    const bothValid = ksskStatus === "valid" && kfbStatus === "valid";
    if (!bothValid) return;
    if (okTimer.current) window.clearTimeout(okTimer.current);
    setShowCycleOk(true);
    okTimer.current = window.setTimeout(() => {
      setShowCycleOk(false);
      // reset to defaults
      setKssk(null);
      setKfb(null);
      setKsskStatus("idle");
      setKfbStatus("idle");
      setActiveStep("kssk");
      setShowManualFor({});
      setWaitingNext(true);
    }, OK_DISPLAY_MS);
    return () => {
      if (okTimer.current) window.clearTimeout(okTimer.current);
    };
  }, [ksskStatus, kfbStatus]);

  // styles
  const page: CSSProperties = { minHeight: "100vh", display: "grid", gap: 32, alignContent: "start", background: "#f6f8fb", padding: "40px 24px 64px" };
  const topBar: CSSProperties = { width: "min(1200px, 100%)", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 };
  const statusCardBase: CSSProperties = { borderRadius: 16, background: "#ffffff", padding: 20, display: "flex", alignItems: "center", gap: 16, minHeight: 100, boxShadow: "0 4px 10px rgba(16,24,40,0.06)", border: "2px solid transparent" };
  const statusLabel: CSSProperties = { fontSize: 16, color: "#334155" };
  const codeText: CSSProperties = { fontWeight: 800, color: "#0f172a", fontSize: 22, wordBreak: "break-all" };

  const grid: CSSProperties = { width: "min(1200px, 100%)", display: "grid", gap: 28, gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", margin: "0 auto" };
  const card: CSSProperties = { border: "2px dashed #9aa7b6", borderRadius: 20, background: "#ffffff", padding: "48px 32px 40px", display: "flex", flexDirection: "column", gap: 22, boxShadow: "0 4px 12px rgba(16,24,40,0.08)" };
  const titleRow: CSSProperties = { display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" };
  const stepNum: CSSProperties = { fontSize: 64, fontWeight: 900, color: "#64748b", lineHeight: 1 };
  const heading: CSSProperties = { fontSize: 52, fontWeight: 900, letterSpacing: "0.06em", color: "#334155", textTransform: "uppercase" };
  const scanBox: CSSProperties = { width: "100%", height: 220, borderRadius: 14, background: "#eef2f6", display: "grid", placeItems: "center" };
  const barcode: CSSProperties = { width: 360, height: 108, borderRadius: 12, background: "repeating-linear-gradient(90deg,#94a3b8 0 7px,transparent 7px 16px)", opacity: 0.8 };
  const hint: CSSProperties = { fontSize: 16, color: "#475569", textDecoration: "underline", cursor: "pointer" };
  const input: CSSProperties = { width: "100%", height: 56, borderRadius: 12, border: "2px solid #cbd5e1", padding: "0 16px", fontSize: 20, outline: "none", background: "#ffffff", color: "#0f172a", caretColor: "#0f172a" };

  return (
    <main style={page}>
      {/* Top status */}
      <div style={topBar}>
        <StatusField label="KSSK"    code={kssk} state={ksskStatus} />
        <StatusField label="KFB INFO" code={kfb}  state={kfbStatus} />
      </div>

      {/* Steps */}
      <div style={grid}>
        <section style={card} aria-live="polite" aria-busy={activeStep === "kssk" && !kssk}>
          <div style={titleRow}><div style={stepNum}>1.</div><h2 style={heading}>Please scan KSSK</h2></div>
          <div style={scanBox} aria-label="KSSK scan zone"><div style={barcode} /></div>
          {allowManual && (
            <button type="button" style={{ ...hint, alignSelf: "center", background: "transparent", border: 0 }} onClick={() => setShowManualFor((s) => ({ ...s, kssk: !s.kssk }))}>
              Or enter number manually
            </button>
          )}
          <AnimatePresence initial={false}>
            {showManualFor.kssk && allowManual && (
              <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "tween", duration: 0.2 }}>
                <ManualInput placeholder="Type KSSK code" onSubmit={(v) => handleManualSubmit("kssk", v)} inputStyle={input} />
              </m.div>
            )}
          </AnimatePresence>
        </section>

        <section style={card} aria-live="polite" aria-busy={activeStep === "kfb" && !kfb}>
          <div style={titleRow}><div style={stepNum}>2.</div><h2 style={heading}>Please scan KFB info</h2></div>
          <div style={scanBox} aria-label="KFB scan zone"><div style={barcode} /></div>
          {allowManual && (
            <button type="button" style={{ ...hint, alignSelf: "center", background: "transparent", border: 0 }} onClick={() => setShowManualFor((s) => ({ ...s, kfb: !s.kfb }))}>
              Or enter number manually
            </button>
          )}
          <AnimatePresence initial={false}>
            {showManualFor.kfb && allowManual && (
              <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "tween", duration: 0.2 }}>
                <ManualInput placeholder="Type KFB info code" onSubmit={(v) => handleManualSubmit("kfb", v)} inputStyle={input} />
              </m.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* Cycle banner: OK → reset → prompt next */}
      <div style={{ width: "min(1200px, 100%)", margin: "8px auto 0" }}>
        <AnimatePresence initial={false}>
          {showCycleOk && (
            <m.div
              key="ok"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              style={{
                display: "grid",
                placeItems: "center",
                padding: "18px 20px",
                borderRadius: 14,
                background: "#ecfdf5",
                color: "#065f46",
                fontWeight: 900,
                fontSize: 42,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                boxShadow: "0 8px 24px rgba(16,185,129,0.25)",
              }}
            >
              OK
            </m.div>
          )}
          {!showCycleOk && waitingNext && (
            <m.div
              key="next"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              style={{
                display: "grid",
                placeItems: "center",
                padding: "14px 18px",
                borderRadius: 12,
                background: "#e2e8f0",
                color: "#0f172a",
                fontWeight: 800,
                fontSize: 28,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Please scan the next table
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {/* Center success/error overlay with dimmed backdrop */}
      <ResultOverlay
        open={overlay.open}
        kind={overlay.kind}
        code={overlay.code}
        onClose={() => setOverlay((o) => ({ ...o, open: false }))}
      />
    </main>
  );

  // ---------- inner components ----------
  function StatusField({ label, code, state }: { label: string; code: string | null; state: ScanState }) {
    const palette =
      state === "valid"   ? { border: "#10b981", bg: "#ecfdf5" } :
      state === "invalid" ? { border: "#ef4444", bg: "#fef2f2" } :
                            { border: "#cbd5e1", bg: "#ffffff" };
    return (
      <div style={{ ...statusCardBase, background: palette.bg, borderColor: palette.border }}>
        <StateIcon state={state} size={48} />
        <div style={{ display: "grid" }}>
          <span style={statusLabel}>{label}</span>
          <span style={codeText}>{code ?? "—"}</span>
        </div>
      </div>
    );
  }
}

function ManualInput({
  placeholder,
  onSubmit,
  inputStyle,
}: {
  placeholder: string;
  onSubmit: (value: string) => void;
  inputStyle: CSSProperties;
}) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
        setV("");
      }}
    >
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
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 3} fill="#ffffff" stroke="#cbd5e1" strokeWidth="3" />
      </svg>
    );
  if (state === "valid")
    return (
      <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden>
        <circle cx="28" cy="28" r="28" fill="#10b981" />
        <path d="M16 30l8 7.5L40 20" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="28" fill="#ef4444" />
      <path d="M18 18l20 20M38 18l-20 20" stroke="white" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function ResultOverlay({
  open,
  kind,
  code,
  onClose,
}: {
  open: boolean;
  kind: "success" | "error";
  code: string;
  onClose: () => void;
}) {
  const size = 220;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center" }}
          aria-live="assertive"
        >
          {/* iOS-like dim/backdrop */}
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
          />
          <m.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            style={{
              background: "white",
              borderRadius: 28,
              padding: 28,
              boxShadow: "0 16px 40px rgba(0,0,0,.18)",
              display: "grid",
              justifyItems: "center",
              gap: 14,
              minWidth: 360,
              zIndex: 1,
            }}
            role="dialog"
            aria-label={kind === "success" ? "Success" : "Invalid code"}
          >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              <circle cx={size / 2} cy={size / 2} r={r} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
              <m.circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={kind === "success" ? "#10b981" : "#ef4444"}
                strokeWidth={stroke}
                strokeLinecap="round"
                fill="none"
                style={{ rotate: -90, transformOrigin: "50% 50%" }}
                initial={{ strokeDasharray: c, strokeDashoffset: c }}
                animate={{ strokeDashoffset: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
              {kind === "success" ? (
                <m.path
                  d={`M ${size * 0.30} ${size * 0.54} L ${size * 0.45} ${size * 0.68} L ${size * 0.74} ${size * 0.38}`}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth={16}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ delay: 0.45, duration: 0.35, ease: "easeOut" }}
                />
              ) : (
                <m.path
                  d={`M ${size * 0.34} ${size * 0.34} L ${size * 0.66} ${size * 0.66} M ${size * 0.66} ${size * 0.34} L ${size * 0.34} ${size * 0.66}`}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={16}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ delay: 0.45, duration: 0.35, ease: "easeOut" }}
                />
              )}
            </svg>
            <m.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} style={{ fontWeight: 900, color: "#0f172a", fontSize: 22, textAlign: "center", maxWidth: 320 }}>
              {kind === "success" ? "Success" : "Invalid code"}
            </m.div>
            {code && (
              <m.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} style={{ fontSize: 16, color: "#334155", wordBreak: "break-all", textAlign: "center" }}>
                {code}
              </m.div>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

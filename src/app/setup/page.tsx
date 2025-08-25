// src/app/setup/page.tsx
"use client";

import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { m, AnimatePresence } from "framer-motion";
import TableSwap from "@/components/Tables/TableSwap";

type ScanState = "idle" | "valid" | "invalid";
const OK_DISPLAY_MS = 3000;

// Regex
function compileRegex(src: string | undefined, fallback: RegExp): RegExp {
  if (!src) return fallback;
  try {
    const m = src.match(/^\/(.+)\/([gimsuy]*)$/);
    return m ? new RegExp(m[1], m[2]) : new RegExp(src);
  } catch {
    return fallback;
  }
}




const KSSK_REGEX = compileRegex(process.env.NEXT_PUBLIC_KSSK_REGEX, /^KSK\d{10}$/);
const KFB_REGEX  = compileRegex(process.env.NEXT_PUBLIC_KFB_REGEX,  /^[A-Z0-9]{4}$/);



// ---------- Strong panel types fix ----------
type KsskIndex = 0 | 1 | 2;
type KsskPanel = `kssk${KsskIndex}`;
type PanelKey = "kfb" | KsskPanel;

// ---------- Page ----------
export default function SetupPage() {
  const allowManual = true;

  const [kfb, setKfb] = useState<string | null>(null);
  const [ksskSlots, setKsskSlots] = useState<Array<string | null>>([null, null, null]);
  const [kfbStatus, setKfbStatus] = useState<ScanState>("idle");

  const [showManualFor, setShowManualFor] = useState<Record<string, boolean>>({});
  const [overlay, setOverlay] = useState<{ open: boolean; kind: "success" | "error"; code: string; msg?: string }>({
    open: false, kind: "success", code: ""
  });
  const [tableCycle, setTableCycle] = useState(0);
  const [kbdBuffer, setKbdBuffer] = useState("");

  // Helpers
  const normalize = (s: string) => s.trim().toUpperCase();
  const classify = (raw: string): { type: "kfb" | "kssk" | null; code: string } => {
    const code = normalize(raw);
    if (KFB_REGEX.test(code)) return { type: "kfb", code };
    if (KSSK_REGEX.test(code)) return { type: "kssk", code };
    return { type: null, code };
  };
  const showOk = (code: string) => setOverlay({ open: true, kind: "success", code });
  const showErr = (code: string, msg?: string) => setOverlay({ open: true, kind: "error", code, msg });

  const ksskCount = ksskSlots.filter(Boolean).length;
  const nextEmptyIndex = () => ksskSlots.findIndex((v) => v === null);

  const resetAll = useCallback(() => {
    setKfb(null);
    setKfbStatus("idle");
    setKsskSlots([null, null, null]);
    setShowManualFor({});
  }, []);

  const acceptKfb = useCallback((code: string) => {
    setKfb(code);
    setKfbStatus("valid");
    setKsskSlots([null, null, null]); // reset batch on new board
    showOk(code);
  }, []);

  const acceptKsskToIndex = useCallback(
    (code: string, idx?: number) => {
      if (!kfb) { showErr(code, "Scan KFB first"); return; }
      if (ksskSlots.some((c) => c === code)) { showErr(code, "Duplicate KSSK"); return; }
      const target = typeof idx === "number" ? idx : nextEmptyIndex();
      if (target === -1) { showErr(code, "Batch full (3/3)"); return; }

      setKsskSlots((prev) => { const n = [...prev]; n[target] = code; return n; });
      showOk(code);
      setTableCycle((n) => n + 1);

      if (ksskCount + 1 >= 3) {
        setTimeout(() => { resetAll(); }, OK_DISPLAY_MS); // auto-advance to new board
      }
    },
    [kfb, ksskSlots, ksskCount, resetAll]
  );

  // Manual submit with strong typing
  const handleManualSubmit = useCallback(
    (panel: PanelKey, raw: string) => {
      const { type, code } = classify(raw);
      if (!type) { showErr(raw, "Unrecognized code"); return; }

      if (panel === "kfb") {
        if (type !== "kfb") { showErr(code, "Expected KFB"); return; }
        acceptKfb(code);
      } else {
        if (type !== "kssk") { showErr(code, "Expected KSSK"); return; }
        const idx = Number(panel.slice(-1)) as KsskIndex;
        acceptKsskToIndex(code, idx);
      }
      setShowManualFor((s) => ({ ...s, [panel]: false }));
    },
    [acceptKfb, acceptKsskToIndex]
  );

  // Scanner wedge
  const handleScanned = useCallback((raw: string) => {
    const { type, code } = classify(raw);
    if (!type) { showErr(code || raw, "Unrecognized code"); return; }
    if (type === "kfb") acceptKfb(code);
    else acceptKsskToIndex(code);
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


  
  // Styles
  const fontStack =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"';

  const page: CSSProperties = { minHeight: "100vh", display: "grid", gap: 22, alignContent: "start", background: "#f7f9fc", padding: "24px 20px 60px", fontFamily: fontStack };
  const containerWide: CSSProperties = { width: "min(1320px, 100%)", margin: "0 auto" };

  // HERO
  const hero: CSSProperties = { ...containerWide, border: "1px dashed #c7d2e5", background: "#ffffff", borderRadius: 24, padding: 24, display: "grid", gap: 10, boxShadow: "0 8px 22px rgba(2,6,23,0.06)" };
  const heroTopRow: CSSProperties = { display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" };
  const heroLeft: CSSProperties = { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" };
  const heroBoard: CSSProperties = { fontSize: 58, fontWeight: 1000, letterSpacing: "0.01em", color: "#0f172a", textTransform: "uppercase" };
  const heroProgress: CSSProperties = { fontSize: 36, fontWeight: 1000, color: "#065f46", padding: "8px 14px", borderRadius: 14, border: "2px solid #86efac", background: "#ecfdf5" };

  // “or scan a new board” callout (appears after first KSSK)
  const heroCallout: CSSProperties = { display: "flex", gap: 12, alignItems: "center" };
  const calloutText: CSSProperties = { fontSize: 28, fontWeight: 1000, color: "#0f172a", whiteSpace: "nowrap" };
  const calloutBadge: CSSProperties = { display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderRadius: 14, border: "2px solid #cbd5e1", background: "#f8fafc" };

  const card: CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 24, background: "#ffffff", padding: "26px", display: "grid", gap: 18, boxShadow: "0 10px 24px rgba(2,6,23,0.06)" };
  const eyebrow: CSSProperties = { fontSize: 12, letterSpacing: "0.08em", color: "#64748b", textTransform: "uppercase", fontWeight: 800 };
  const heading: CSSProperties = { fontSize: 40, fontWeight: 900, letterSpacing: "0.01em", color: "#0f172a" };

  const slotsGrid: CSSProperties = { display: "grid", gap: 18, gridTemplateColumns: "repeat(3, minmax(240px, 1fr))" };
  const slotCard: CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 18, background: "#f8fafc", padding: 16, display: "grid", gap: 10, position: "relative" };
  const slotCardDone: CSSProperties = { background: "#f0fdf4", borderColor: "#86efac" };
  const slotHeader: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between" };
  const slotIndexWrap: CSSProperties = { width: 68, height: 68, borderRadius: 18, background: "#e5f0ff", border: "1px solid #bfd7ff", display: "grid", placeItems: "center" };
  const slotIndexText: CSSProperties = { fontSize: 32, fontWeight: 1000, color: "#0b1220" };
  const slotCode: CSSProperties = { fontWeight: 1000, color: "#0f172a", fontSize: 20, wordBreak: "break-all", minHeight: 28, display: "grid", alignContent: "center" };

  const scanBox: CSSProperties = { width: "100%", height: 140, borderRadius: 14, background: "linear-gradient(180deg,#f3f6fb 0%, #eef3f9 100%)", border: "1px dashed #c7d2e5", display: "grid", placeItems: "center" };
  const barcode: CSSProperties = { width: "min(100%, 300px)", height: 84, borderRadius: 10, background: "repeating-linear-gradient(90deg,#8aa0b8 0 6px,transparent 6px 14px)", opacity: 0.85 };

  const hint: CSSProperties = { fontSize: 13, color: "#2563eb", textDecoration: "underline", cursor: "pointer", fontWeight: 700 };
  const input: CSSProperties = { width: "100%", height: 52, borderRadius: 12, border: "1px solid #cbd5e1", padding: "0 14px", fontSize: 20, outline: "none", background: "#ffffff", color: "#0f172a", caretColor: "#0f172a" };

  return (
    <main style={page}>
      {/* HERO */}
      <section style={hero} aria-live="polite">
        {!kfb ? (
          <div style={heroLeft}><div style={heroBoard}>Scan BOARD NUMBER</div></div>
        ) : (
          <div style={heroTopRow}>
            <div style={heroLeft}>
              <div style={heroBoard}>BOARD: {kfb}</div>
              <div style={heroProgress}>{ksskCount}/3 KSSK</div>
            </div>

            {/* Show after first KSSK */}
          {ksskCount >= 1 && <StepBadge label="OR SCAN A NEW BOARD NUMBER TO START OVER" onClick={resetAll} />}
          </div>
        )}
      </section>

      {/* Step 1: KFB */}
      <AnimatePresence>
        {!kfb && (
          <m.section
            style={{ ...containerWide, display: "grid", gap: 16 }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <section style={card}>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={eyebrow}>Step 1</span>
                <h2 style={heading}>BOARD NUMBER</h2>
              </div>

              <div style={scanBox} aria-label="KFB scan zone">
                <div style={barcode} />
              </div>

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
                  <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "tween", duration: 0.2 }}>
                    <ManualInput placeholder="Type KFB code" onSubmit={(v) => handleManualSubmit("kfb", v)} inputStyle={input} />
                  </m.div>
                )}
              </AnimatePresence>
            </section>
          </m.section>
        )}
      </AnimatePresence>

      {/* Step 2: KSSK */}
      {kfb && (
        <section style={{ ...containerWide, display: "grid", gap: 16 }}>
          <section style={card}>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={eyebrow}>Step 2</span>
              <h2 style={heading}>KSSK</h2>
            </div>

            <div style={slotsGrid}>
              {([0, 1, 2] as const).map((idx) => {
                const code = ksskSlots[idx];
                const filled = !!code;
                return (
                  <div key={idx} style={{ ...slotCard, ...(filled ? slotCardDone : {}) }}>
                    <div style={slotHeader}>
                      <div style={slotIndexWrap}><span style={slotIndexText}>{idx + 1}</span></div>
                      <StateIcon state={filled ? "valid" : "idle"} size={44} />
                    </div>

                    <div style={slotCode}>{code ?? "—"}</div>

                    <div style={scanBox} aria-label={`KSSK scan zone ${idx + 1}`}>
                      <div style={barcode} />
                    </div>

                    {allowManual && (
                      <button
                        type="button"
                        style={{ ...hint, background: "transparent", border: 0, justifySelf: "start" }}
                        onClick={() => setShowManualFor((s) => ({ ...s, [`kssk${idx}`]: !s[`kssk${idx}`] }))}
                      >
                        Enter manually
                      </button>
                    )}

                    <AnimatePresence initial={false}>
                      {showManualFor[`kssk${idx}`] && allowManual && (
                        <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "tween", duration: 0.2 }}>
                          <ManualInput
                            placeholder={`Type KSSK for slot ${idx + 1}`}
                            onSubmit={(v) => handleManualSubmit(`kssk${idx}`, v)} // <- typed via const tuple
                            inputStyle={input}
                          />
                        </m.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </section>
        </section>
      )}

      {/* TableSwap */}
      <div style={{ ...containerWide, marginTop: 8 }}>
       <TableSwap
  cycleKey={tableCycle}
  okMs={OK_DISPLAY_MS}
  hasBoard={!!kfb}
  ksskCount={ksskSlots.filter(Boolean).length}
  ksskTarget={3}
/>
      </div>

      {/* Overlay */}
      <ResultOverlay open={overlay.open} kind={overlay.kind} code={overlay.code} msg={overlay.msg} onClose={() => setOverlay((o) => ({ ...o, open: false }))} />
    </main>
  );
}

// ---------- Inner components ----------
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
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 3} fill="#ffffff" stroke="#cbd5e1" strokeWidth="3" />
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

// Simple QR glyph
function StepBadge({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  const base: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 18px",
    borderRadius: 18,
    background: "linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)",
    border: "1px solid #dbe3ee",
    boxShadow: "0 4px 12px rgba(15,23,42,0.06), inset 0 1px 0 #ffffff",
    cursor: onClick ? "pointer" : "default",
    userSelect: "none",
  };
  const text: CSSProperties = { fontSize: 22, fontWeight: 1000, color: "#0f172a", whiteSpace: "nowrap" };

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
      <NextStepIcon size={44} />
      <div style={text}>{label}</div>
    </div>
  );
}

function NextStepIcon({ size = 44 }: { size?: number }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id="ns_g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e0f2fe" />
          <stop offset="1" stopColor="#bae6fd" />
        </linearGradient>
      </defs>
      {/* outer pill */}
      <circle cx="24" cy="24" r="22" fill="url(#ns_g)" stroke="#93c5fd" strokeWidth="2" />
      {/* forward chevron */}
      <path
        d="M18 16 L30 24 L18 32"
        fill="none"
        stroke="#0f172a"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* subtle progress dots */}
      <circle cx="12" cy="24" r="2" fill="#0f172a" opacity="0.3" />
      <circle cx="36" cy="24" r="2" fill="#0f172a" opacity="0.3" />
    </svg>
  );
}



function ResultOverlay({
  open, kind, code, msg, onClose,
}: { open: boolean; kind: "success" | "error"; code: string; msg?: string; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, 1200);
    return () => clearTimeout(t);
  }, [open, onClose]);

  const label = kind === "success" ? "OK" : "ERROR";

  return (
    <AnimatePresence>
      {open && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.64)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", zIndex: 60 }}
          aria-live="assertive"
          aria-label={label}
        >
          <m.div
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            style={{ display: "grid", justifyItems: "center", gap: 8 }}
          >
            <m.div
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.22 }}
              style={{ fontSize: 128, fontWeight: 900, letterSpacing: "0.02em", color: kind === "success" ? "#10b981" : "#ef4444", textShadow: "0 8px 24px rgba(0,0,0,0.45)", fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial' }}
            >
              {label}
            </m.div>
            {(code || msg) && (
              <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} style={{ fontSize: 16, color: "#f1f5f9", opacity: 0.95, wordBreak: "break-all", textAlign: "center", maxWidth: 640 }}>
                {code}{msg ? ` — ${msg}` : ""}
              </m.div>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

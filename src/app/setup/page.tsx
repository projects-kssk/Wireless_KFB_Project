// src/app/setup/page.tsx
"use client";

import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { m, AnimatePresence } from "framer-motion";
import TableSwap from "@/components/Tables/TableSwap";

type StepKey = "kssk" | "kfb";
type ScanState = "idle" | "valid" | "invalid";

const OK_DISPLAY_MS = 3000;

/** Compile regex from NEXT_PUBLIC_* env var with robust fallback */
function compileRegex(src: string | undefined, fallback: RegExp): RegExp {
  if (!src) return fallback;
  try {
    const m = src.match(/^\/(.+)\/([gimsuy]*)$/);
    return m ? new RegExp(m[1], m[2]) : new RegExp(src);
  } catch {
    return fallback;
  }
}

const KSSK_REGEX = compileRegex(process.env.NEXT_PUBLIC_KSSK_REGEX, /^KSK\d{10}$/); // e.g. KSK9866358756
const KFB_REGEX  = compileRegex(process.env.NEXT_PUBLIC_KFB_REGEX,  /^[A-Z0-9]{4}$/); // e.g. ABC1

export default function SetupPage() {
  const allowManual = true;

  // data
  const [kssk, setKssk] = useState<string | null>(null);
  const [kfb, setKfb] = useState<string | null>(null);

  // status
  const [ksskStatus, setKsskStatus] = useState<ScanState>("idle");
  const [kfbStatus, setKfbStatus] = useState<ScanState>("idle");
  const [activeStep, setActiveStep] = useState<StepKey>("kssk");
  const [showManualFor, setShowManualFor] = useState<Partial<Record<StepKey, boolean>>>({});

  // per-scan overlay
  const [overlay, setOverlay] = useState<{ open: boolean; kind: "success" | "error"; code: string }>({
    open: false,
    kind: "success",
    code: "",
  });

  // drives OK+swap inside TableSwap
  const [tableCycle, setTableCycle] = useState(0);
// Place inside SetupPage(), above the JSX where it's used
const handleManualSubmit = useCallback(
  (panel: StepKey, raw: string) => {
    const input = raw.trim();
    if (!input) return;

    const { step, code } = classify(input);

    if (!step) {
      setOverlay({ open: true, kind: "error", code: input });
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

    setOverlay({ open: true, kind: "success", code });
    setShowManualFor((s) => ({ ...s, [panel]: false }));
  },
  [kssk, kfb]
);

  // keyboard wedge (scanner)
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

  // helpers
  const normalize = (s: string) => s.trim().toUpperCase();
  const classify = (raw: string): { step: StepKey | null; code: string } => {
    const code = normalize(raw);
    if (KSSK_REGEX.test(code)) return { step: "kssk", code };
    if (KFB_REGEX.test(code)) return { step: "kfb", code };
    return { step: null, code };
  };

  // both valid → trigger TableSwap OK cycle → reset inputs
  useEffect(() => {
    if (!(ksskStatus === "valid" && kfbStatus === "valid")) return;
    setTableCycle((n) => n + 1);
    const t = setTimeout(() => {
      setKssk(null);
      setKfb(null);
      setKsskStatus("idle");
      setKfbStatus("idle");
      setActiveStep("kssk");
      setShowManualFor({});
    }, OK_DISPLAY_MS);
    return () => clearTimeout(t);
  }, [ksskStatus, kfbStatus]);

  // design tokens
  const fontStack =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"';

  // styles
  const page: CSSProperties = {
    minHeight: "100vh",
    display: "grid",
    gap: 28,
    alignContent: "start",
    background: "#f7f9fc",
    padding: "36px 20px 60px",
    fontFamily: fontStack,
  };
  const containerWide: CSSProperties = { width: "min(1320px, 100%)", margin: "0 auto" };
  const topBar: CSSProperties = {
    ...containerWide,
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 16,
  };
  const statusCardBase: CSSProperties = {
    borderRadius: 16,
    background: "#ffffff",
    padding: 16,
    display: "flex",
    alignItems: "center",
    gap: 14,
    minHeight: 88,
    boxShadow: "0 6px 14px rgba(2,6,23,0.06)",
    border: "1px solid #e2e8f0",
  };
  const statusLabel: CSSProperties = { fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase", color: "#64748b", fontWeight: 700 };
  const codeText: CSSProperties = { fontWeight: 800, color: "#0f172a", fontSize: 20, wordBreak: "break-all" };

  const grid: CSSProperties = {
    ...containerWide,
    display: "grid",
    gap: 22,
    gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))",
  };
  const card: CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    background: "#ffffff",
    padding: "40px 28px 36px",
    display: "flex",
    flexDirection: "column",
    gap: 22,
    boxShadow: "0 10px 24px rgba(2,6,23,0.06)",
  };
  const titleRow: CSSProperties = { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" };
  const stepBadge: CSSProperties = {
    width: 48,
    height: 48,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 20,
    color: "#0b1220",
    background: "#e5f0ff",
    border: "1px solid #bfd7ff",
  };
  const eyebrow: CSSProperties = { fontSize: 12, letterSpacing: "0.08em", color: "#64748b", textTransform: "uppercase", fontWeight: 800 };
  const heading: CSSProperties = { fontSize: 44, fontWeight: 900, letterSpacing: "0.01em", color: "#0f172a" };

  // Bigger scan zones
  const scanBox: CSSProperties = {
    width: "100%",
    height: 320, // was 220
    borderRadius: 16,
    background: "linear-gradient(180deg,#f3f6fb 0%, #eef3f9 100%)",
    border: "1px dashed #c7d2e5",
    display: "grid",
    placeItems: "center",
  };
  const barcode: CSSProperties = {
    width: 560,  // was 420
    height: 160, // was 120
    borderRadius: 12,
    background: "repeating-linear-gradient(90deg,#8aa0b8 0 7px,transparent 7px 16px)",
    opacity: 0.85,
  };
  const hint: CSSProperties = {
    fontSize: 14,
    color: "#2563eb",
    textDecoration: "underline",
    cursor: "pointer",
    fontWeight: 600,
  };
  const input: CSSProperties = {
    width: "100%",
    height: 64, // taller input
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    padding: "0 16px",
    fontSize: 22,
    outline: "none",
    background: "#ffffff",
    color: "#0f172a",
    caretColor: "#0f172a",
    boxShadow: "0 1px 0 rgba(2,6,23,0.03)",
  };

  return (
    <main style={page}>
      {/* Top status */}
      <div style={topBar}>
        <StatusField label="KSSK" code={kssk} state={ksskStatus} />
        <StatusField label="KFB INFO" code={kfb} state={kfbStatus} />
      </div>

      {/* Steps */}
      <div style={grid}>
        <section style={card} aria-live="polite" aria-busy={activeStep === "kssk" && !kssk}>
          <div style={titleRow}>
            <div style={{ ...stepBadge, background: activeStep === "kssk" ? "#dbeafe" : "#e5f0ff", borderColor: activeStep === "kssk" ? "#93c5fd" : "#bfd7ff" }}>1</div>
            <div style={{ display: "grid", gap: 2 }}>
              <span style={eyebrow}>Step 1</span>
              <h2 style={heading}>Scan KSSK</h2>
            </div>
          </div>
          <div style={scanBox} aria-label="KSSK scan zone">
            <div style={barcode} />
          </div>
          {allowManual && (
            <button
              type="button"
              style={{ ...hint, alignSelf: "center", background: "transparent", border: 0 }}
              onClick={() => setShowManualFor((s) => ({ ...s, kssk: !s.kssk }))}
            >
              Enter manually
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
          <div style={titleRow}>
            <div style={{ ...stepBadge, background: activeStep === "kfb" ? "#dbeafe" : "#e5f0ff", borderColor: activeStep === "kfb" ? "#93c5fd" : "#bfd7ff" }}>2</div>
            <div style={{ display: "grid", gap: 2 }}>
              <span style={eyebrow}>Step 2</span>
              <h2 style={heading}>Scan KFB Number</h2>
            </div>
          </div>
          <div style={scanBox} aria-label="KFB scan zone">
            <div style={barcode} />
          </div>
          {allowManual && (
            <button
              type="button"
              style={{ ...hint, alignSelf: "center", background: "transparent", border: 0 }}
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
      </div>

      {/* Table cycle banner + swap animation */}
      <div style={{ ...containerWide, marginTop: 8 }}>
        <TableSwap
          cycleKey={tableCycle}
          okMs={OK_DISPLAY_MS}               // align with page timer
          queues={["KFB 83AUDAU40X02-61-001", "KFB 83AUDAU40X02-70-004", "IWO16029"]}
          // XML can be present; TableSwap must not show OK until cycleKey increments
          clsXml={`<krosy><body><visualControl><workingData scanned="2025-08-19T12:41:42"/></visualControl></body></krosy>`}
        />
      </div>

      {/* Per-scan success/error overlay */}
      <ResultOverlay open={overlay.open} kind={overlay.kind} code={overlay.code} onClose={() => setOverlay((o) => ({ ...o, open: false }))} />
    </main>
  );

  // ---------- inner components ----------
  function StatusField({ label, code, state }: { label: string; code: string | null; state: ScanState }) {
    const palette =
      state === "valid"
        ? { border: "#10b981", bg: "#ecfdf5" }
        : state === "invalid"
        ? { border: "#ef4444", bg: "#fef2f2" }
        : { border: "#e2e8f0", bg: "#ffffff" };
    return (
      <div style={{ ...statusCardBase, background: palette.bg, borderColor: palette.border }}>
        <StateIcon state={state} size={52} />
        <div style={{ display: "grid", gap: 2 }}>
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
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.64)",
            backdropFilter: "blur(4px)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
          }}
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
              style={{
                fontSize: 128,
                fontWeight: 900,
                letterSpacing: "0.02em",
                color: kind === "success" ? "#10b981" : "#ef4444",
                textShadow: "0 8px 24px rgba(0,0,0,0.45)",
                fontFamily:
                  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"',
              }}
            >
              {label}
            </m.div>
            {code && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.05 }}
                style={{
                  fontSize: 16,
                  color: "#f1f5f9",
                  opacity: 0.95,
                  wordBreak: "break-all",
                  textAlign: "center",
                  maxWidth: 640,
                }}
              >
                {code}
              </m.div>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

// src/components/Tables/TableSwap.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
/* ---------- helpers ---------- */
function seededRand(seed) {
    // xorshift-ish; deterministic per seed
    let x = seed || 1234567;
    return () => {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        return Math.abs(x) / 0x7fffffff;
    };
}
const springX = { type: "spring", stiffness: 700, damping: 60, mass: 0.7 };
const panelVariants = {
    enter: (d) => ({ x: `${d * 26}%`, opacity: 0, scale: 0.985, rotate: d * 0.2, filter: "blur(2px)" }),
    center: { x: "0%", opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" },
    exit: (d) => ({ x: `${d * -26}%`, opacity: 0, scale: 0.985, rotate: d * -0.1, filter: "blur(2px)" }),
};
function CornerBarcodeHint({ top = 52, widthPx, heightPx, }) {
    const rOuter = 0;
    const inset = 8; // inner slab margin
    const slabH = Math.max(18, Math.round(heightPx * 0.6));
    const rInner = 4;
    return (<div aria-label="Barcode hint" style={{
            position: "absolute",
            right: 24,
            top,
            display: "grid",
            placeItems: "center",
            gap: 8,
            pointerEvents: "none",
        }}>
      {/* outer frame */}
      <div style={{
            position: "relative",
            width: widthPx,
            height: heightPx,
            borderRadius: rOuter,
            background: "#0b1220",
            overflow: "hidden",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.10), inset 0 1px 0 rgba(255,255,255,.10), inset 0 -1px 0 rgba(255,255,255,.06), 0 6px 16px rgba(15,23,42,.15)",
        }}>
        {/* subtle vertical grid like the big box */}
        <div aria-hidden style={{
            position: "absolute",
            inset: 0,
            opacity: 0.22,
            backgroundImage: "repeating-linear-gradient(90deg, rgba(148,163,184,.28) 0 1px, transparent 1px 12px)",
            backgroundSize: "120px 100%",
        }}/>

        {/* centered barcode slab */}
        <div style={{
            position: "absolute",
            left: inset,
            right: inset,
            top: "50%",
            transform: "translateY(-50%)",
            height: slabH,
            borderRadius: rInner,
            background: "repeating-linear-gradient(90deg, rgba(255,255,255,.96) 0 7px, transparent 7px 15px)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 0 rgba(255,255,255,.18)",
        }}/>
        {/* edge fade (matches big slab ends) */}
        <div aria-hidden style={{
            position: "absolute",
            left: inset,
            right: inset,
            top: "50%",
            transform: "translateY(-50%)",
            height: slabH,
            borderRadius: rInner,
            background: "linear-gradient(90deg, rgba(11,18,32,1) 0, rgba(11,18,32,0) 12%, rgba(11,18,32,0) 88%, rgba(11,18,32,1) 100%)",
        }}/>
        {/* corner brackets like big box */}
        {["tl", "tr", "bl", "br"].map((pos) => (<div key={pos} aria-hidden style={{
                position: "absolute",
                width: 18,
                height: 18,
                ...(pos === "tl" && { left: 10, top: 10, borderLeft: "2px solid #e5e7eb", borderTop: "2px solid #e5e7eb" }),
                ...(pos === "tr" && { right: 10, top: 10, borderRight: "2px solid #e5e7eb", borderTop: "2px solid #e5e7eb" }),
                ...(pos === "bl" && { left: 10, bottom: 10, borderLeft: "2px solid #e5e7eb", borderBottom: "2px solid #e5e7eb" }),
                ...(pos === "br" && { right: 10, bottom: 10, borderRight: "2px solid #e5e7eb", borderBottom: "2px solid #e5e7eb" }),
            }}/>))}
      </div>

      {/* tag */}
      <div style={{
            fontFamily: 'Inter, ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial',
            textTransform: "uppercase",
            letterSpacing: 2.5,
            fontWeight: 900,
            fontSize: 12,
            color: "#0f172a",
            opacity: 0.8,
            padding: "3px 8px",
            borderRadius: 999,
        }}>
        BARCODE POSITION
      </div>
    </div>);
}
/* ---------- component ---------- */
export default function TableSwap({ cycleKey, queues, slideMs = 0.45, clsXml, hasBoard = false, ksskCount = 0, ksskTarget = 3, swapDelayMs = 1400, okAppearDelayMs = 350, boardName, boardMap, flashKind, flashSeq, }) {
    /* title from boardName/queues/map */
    const incomingTitle = useMemo(() => {
        const mapped = boardName && boardMap?.[boardName];
        return mapped ?? queues?.[0] ?? boardName ?? "";
    }, [boardName, boardMap, queues]);
    // inside TableSwap()
    const calloutRef = useRef(null);
    const [calloutW, setCalloutW] = useState(0);
    useEffect(() => {
        if (!calloutRef.current)
            return;
        const ro = new ResizeObserver(([e]) => setCalloutW(e.contentRect.width));
        ro.observe(calloutRef.current);
        return () => ro.disconnect();
    }, []);
    /* frame + slide machine */
    const [visibleKey, setVisibleKey] = useState(cycleKey);
    const [visibleTitle, setVisibleTitle] = useState(incomingTitle);
    const [pendingTitle, setPendingTitle] = useState(null);
    const [dir, setDir] = useState(1);
    const prevCycle = useRef(cycleKey);
    const swapTimer = useRef(null);
    const settleTimer = useRef(null);
    useEffect(() => {
        if (cycleKey === prevCycle.current)
            return;
        const nextDir = cycleKey > prevCycle.current ? 1 : -1;
        prevCycle.current = cycleKey;
        setDir(nextDir);
        setPendingTitle(incomingTitle);
        if (swapTimer.current)
            clearTimeout(swapTimer.current);
        if (settleTimer.current)
            clearTimeout(settleTimer.current);
        swapTimer.current = setTimeout(() => {
            setVisibleKey(cycleKey);
            settleTimer.current = setTimeout(() => {
                if (pendingTitle)
                    setVisibleTitle(pendingTitle);
                setPendingTitle(null);
            }, 650);
        }, Math.max(0, swapDelayMs));
        return () => {
            if (swapTimer.current)
                clearTimeout(swapTimer.current);
            if (settleTimer.current)
                clearTimeout(settleTimer.current);
        };
    }, [cycleKey, incomingTitle, swapDelayMs, pendingTitle]);
    // When board is cleared (default state), ensure header title resets immediately
    useEffect(() => {
        if (!hasBoard) {
            setPendingTitle("");
            setVisibleTitle("");
        }
    }, [hasBoard]);
    /* in-table OK/NOT OK overlay */
    const [phase, setPhase] = useState("idle");
    const [okKind, setOkKind] = useState("success");
    const prevFlashSeq = useRef(null);
    const okTimer = useRef(null);
    useEffect(() => {
        if (flashSeq == null)
            return;
        if (prevFlashSeq.current === flashSeq)
            return;
        prevFlashSeq.current = flashSeq;
        setTimeout(() => {
            setOkKind(flashKind === "error" ? "error" : "success");
            setPhase("ok");
            if (okTimer.current)
                clearTimeout(okTimer.current);
            okTimer.current = setTimeout(() => setPhase("idle"), 1000); // visible ~1s
        }, Math.max(0, okAppearDelayMs));
        return () => {
            if (okTimer.current)
                clearTimeout(okTimer.current);
        };
    }, [flashSeq, flashKind, okAppearDelayMs]);
    /* prompt */
    const nextOrdinal = Math.min(ksskCount + 1, ksskTarget);
    const prompt = !hasBoard
        ? "Please scan barcode"
        : ksskCount >= ksskTarget
            ? "Please scan barcode"
            : `Please scan KSK #${nextOrdinal}`;
    const Icon = hasBoard && ksskCount < ksskTarget ? BarsIcon : ScanIcon;
    const showProgress = hasBoard && ksskCount < ksskTarget;
    const showScanHint = !showProgress;
    // 50% of callout, clamped; wide:height ≈ 2.4:1
    const tileWpx = Math.round(Math.max(72, Math.min(calloutW * 0.5, 220)));
    const tileHpx = Math.round(tileWpx * 0.42);
    const hintGutter = showScanHint ? tileWpx + 32 : 0;
    const theme = okKind === "success"
        ? {
            bg: "linear-gradient(180deg, rgba(240,253,244,0.92), rgba(220,252,231,0.92))",
            ring: "0 0 0 10px rgba(16,185,129,0.18)",
            border: "#86efac",
            fg: "#065f46",
            label: "OK",
            accent: "#10b981",
        }
        : {
            bg: "linear-gradient(180deg, rgba(254,242,242,0.92), rgba(254,226,226,0.92))",
            ring: "0 0 0 10px rgba(239,68,68,0.18)",
            border: "#fecaca",
            fg: "#7f1d1d",
            label: "NOT OK",
            accent: "#ef4444",
        };
    return (<div style={{ width: "min(1400px, 100%)", margin: "0 auto" }}>
      <div style={{
            position: "relative",
            height: 420,
            overflow: "hidden",
            borderRadius: 28,
            background: "linear-gradient(180deg,#f8fafc 0%,#eef2f7 100%)",
            boxShadow: "0 1px 0 rgba(0,0,0,0.06) inset",
            padding: 16,
        }}>
        {/* frame */}
        <div style={{
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
        }}>
          {/* header */}
          <Header title={visibleTitle} muted={phase !== "idle"}/>

          {/* sliding body */}
          <div style={{
            position: "relative",
            borderRadius: 18,
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            overflow: "hidden",
        }}>
            <AnimatePresence initial={false} custom={dir} mode="wait">
              <m.div key={visibleKey} custom={dir} variants={panelVariants} initial="enter" animate="center" exit="exit" transition={{
            x: springX,
            opacity: { duration: slideMs * 0.36 },
            scale: { duration: slideMs * 0.44 },
            filter: { duration: slideMs * 0.5 },
        }} style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            paddingRight: 28 + hintGutter, // NEW
            textAlign: "center",
            willChange: "transform",
        }}>
                {phase !== "ok" && (<Body prompt={prompt} reserveRightPx={hintGutter}/> // pass the gutter
        )}
              {phase !== "ok" && showScanHint && (<CornerBarcodeHint top={52} widthPx={tileWpx} heightPx={tileHpx}/>)}

                {/* OK/NOT OK overlay */}
                <AnimatePresence>
                  {phase === "ok" && (<m.div key={`ok-${prevFlashSeq.current ?? 0}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ type: "spring", stiffness: 260, damping: 22 }} role="status" aria-live="assertive" style={{
                position: "absolute",
                inset: 12,
                borderRadius: 16,
                background: theme.bg,
                border: `1px solid ${theme.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 22px 44px rgba(15,23,42,0.25)",
            }}>
                      {/* beveled frame + glow */}
                      <div aria-hidden style={{
                position: "absolute",
                inset: 0,
                borderRadius: 16,
                boxShadow: theme.ring,
            }}/>
                      <CornerPip pos="tl" color={theme.accent}/>
                      <CornerPip pos="tr" color={theme.accent}/>
                      <CornerPip pos="bl" color={theme.accent}/>
                      <CornerPip pos="br" color={theme.accent}/>

                      {/* subtle scan beam */}
                      <m.div aria-hidden initial={{ x: "-120%" }} animate={{ x: "120%" }} transition={{ duration: 1.2, ease: "easeInOut" }} style={{
                position: "absolute",
                top: "22%",
                left: 0,
                right: 0,
                height: 8,
                filter: "blur(8px)",
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)",
            }}/>

                      {/* label */}
                      <div style={{
                fontWeight: 1000,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontSize: "clamp(42px, 7.5vw, 96px)",
                color: theme.fg,
                lineHeight: 1.02,
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                gap: 18,
            }}>
                        {okKind === "success" ? <CheckIcon /> : <CrossIcon />}
                        {theme.label}
                      </div>

                      {/* success confetti / error shake aura */}
                      <Decor kind={okKind} seed={prevFlashSeq.current ?? 1}/>
                    </m.div>)}
                </AnimatePresence>
              </m.div>
            </AnimatePresence>
          </div>
        </div>

        {/* floating callout (hidden during overlay) */}
        <AnimatePresence>
          {phase !== "ok" && (<m.div ref={calloutRef} key="callout" role="status" aria-live="polite" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }} style={{
                position: "absolute",
                right: 8, // was 24
                top: 8, // was 24
                padding: "14px 18px", // a touch larger
                borderRadius: 24,
                border: "1px solid rgba(15,23,42,0.06)",
                background: "rgba(255,255,255,0.78)",
                backdropFilter: "saturate(180%) blur(12px)",
                WebkitBackdropFilter: "saturate(180%) blur(12px)",
                boxShadow: "0 10px 26px rgba(0,0,0,0.14)",
                color: "#0f172a",
                fontWeight: 900,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                gap: 12,
                minWidth: 420, // ensure it’s wider
                maxWidth: "min(920px, 96vw)", // was "70%"
                whiteSpace: "nowrap",
            }}>
              <Icon />
              <span>{prompt}</span>
              {showProgress && (<span style={{
                    marginLeft: 8,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "rgba(15,23,42,0.06)",
                    fontWeight: 700,
                    letterSpacing: 0,
                    textTransform: "none",
                }}>
                  {ksskCount}/{ksskTarget}
                </span>)}
              <m.span aria-hidden animate={{ x: [0, 4, 0] }} transition={{ repeat: Infinity, repeatType: "loop", duration: 1.6 }} style={{ display: "inline-flex", marginLeft: 6 }}>
                <ChevronRight />
              </m.span>
            </m.div>)}
        </AnimatePresence>
      </div>
    </div>);
}
/* ---------- parts ---------- */
function Header({ title, muted }) {
    return (<div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center" }}>
      <div style={{
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: "0.02em",
            color: "#0f172a",
            textTransform: "uppercase",
            lineHeight: 1.1,
            opacity: muted ? 0.85 : 1,
            transition: "opacity .2s ease",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        }} title={title}>
        {title}
      </div>
      <div style={{ width: 124, height: 10, background: "#e5e7eb", borderRadius: 999, opacity: 0.9 }}/>
    </div>);
}
function Body({ prompt, reserveRightPx = 0 }) {
    return (<div style={{
            maxWidth: `calc(92% - ${reserveRightPx}px)`, // reserve space for badge
            fontWeight: 1000,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontSize: "clamp(36px, 6vw, 64px)",
            color: "#0f172a",
            opacity: 0.9,
            lineHeight: 1.05,
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
            textWrap: "balance",
        }}>
      {prompt}
    </div>);
}
/* ---------- overlay decoration ---------- */
function CornerPip({ pos, color }) {
    const base = {
        position: "absolute",
        width: 72,
        height: 72,
        borderRadius: 14,
        pointerEvents: "none",
        boxShadow: `0 10px 28px ${color}33`,
    };
    const edge = 4;
    const style = pos === "tl"
        ? { ...base, left: -edge, top: -edge, borderTop: `${edge}px solid ${color}`, borderLeft: `${edge}px solid ${color}` }
        : pos === "tr"
            ? { ...base, right: -edge, top: -edge, borderTop: `${edge}px solid ${color}`, borderRight: `${edge}px solid ${color}` }
            : pos === "bl"
                ? { ...base, left: -edge, bottom: -edge, borderBottom: `${edge}px solid ${color}`, borderLeft: `${edge}px solid ${color}` }
                : { ...base, right: -edge, bottom: -edge, borderBottom: `${edge}px solid ${color}`, borderRight: `${edge}px solid ${color}` };
    return <div aria-hidden style={style}/>;
}
function Decor({ kind, seed }) {
    if (kind === "error") {
        return (<m.div aria-hidden initial={{ scale: 1 }} animate={{ scale: [1, 1.015, 1], filter: ["drop-shadow(0 0 0 rgba(239,68,68,0))", "drop-shadow(0 0 18px rgba(239,68,68,0.55))", "drop-shadow(0 0 0 rgba(239,68,68,0))"] }} transition={{ duration: 0.55, ease: "easeInOut" }} style={{ position: "absolute", inset: 0 }}/>);
    }
    // success: no confetti; keep it calm
    return null;
}
/* ---------- icons ---------- */
function CheckIcon() {
    return (<svg width="56" height="56" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="32" fill="#10b981"/>
      <path d="M18 34l10 9L46 22" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round"/>
    </svg>);
}
function CrossIcon() {
    return (<svg width="52" height="52" viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="28" fill="#ef4444"/>
      <path d="M18 18l20 20M38 18l-20 20" stroke="white" strokeWidth="6" strokeLinecap="round"/>
    </svg>);
}
function ScanIcon() {
    return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="3" stroke="#64748b" strokeWidth="2"/>
      <path d="M7 6V5a5 5 0 0 1 10 0v1" stroke="#64748b" strokeWidth="2"/>
    </svg>);
}
function BarsIcon() {
    return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      {Array.from({ length: 10 }).map((_, i) => (<rect key={i} x={3 + i * 1.8} y={4 + (i % 2 ? 2 : 0)} width="1.2" height={14 - (i % 2 ? 2 : 0)} rx="0.6" fill="#64748b"/>))}
    </svg>);
}
function ChevronRight() {
    return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>);
}

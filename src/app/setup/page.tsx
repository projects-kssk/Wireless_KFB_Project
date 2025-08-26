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
import type { RefObject, MutableRefObject } from "react";
/* ===== Config ===== */
const OK_DISPLAY_MS = 3000;
const HTTP_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SETUP_HTTP_TIMEOUT_MS ?? "8000");
const KROSY_OFFLINE_URL =
  process.env.NEXT_PUBLIC_KROSY_OFFLINE_CHECKPOINT ?? "/api/krosy-offline";
const STATION_ID = process.env.NEXT_PUBLIC_STATION_ID || window.location.hostname
const ALLOW_NO_ESP =
  (process.env.NEXT_PUBLIC_SETUP_ALLOW_NO_ESP ?? "0") === "1"; // keep lock even if ESP fails
const KEEP_LOCKS_ON_UNLOAD =
  (process.env.NEXT_PUBLIC_KEEP_LOCKS_ON_UNLOAD ?? "0") === "1"; // do not auto-release on tab close
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
  const take = (n: any) => (Array.isArray(n) ? n : n != null ? [n] : []);
  const segRoot =
    data?.response?.krosy?.body?.visualControl?.workingData?.sequencer?.segmentList?.segment ??
    data?.response?.krosy?.body?.visualControl?.loadedData?.sequencer?.segmentList?.segment;

  const segments = take(segRoot);
  const normal: number[] = [];
  const latch: number[] = [];

  const ACCEPT = new Set(["default", "no_check"]); // ← include no_check to see PIN:10

  for (const seg of segments) {
    for (const s of take(seg?.sequenceList?.sequence)) {
      const mt = String(s?.measType ?? "").trim().toLowerCase();
      if (!ACCEPT.has(mt)) continue;

      // OPTIONAL: only take objGroups that look like "...(AA:BB:CC:DD:EE:FF)"
      // const og = String(s?.objGroup ?? "");
      // if (!/\([0-9A-F]{2}(?::[0-9A-F]{2}){5}\)$/i.test(og)) continue;

      const parts = String(s?.objPos ?? "").split(",");
      let isLatch = false;
      if (parts.length && parts[parts.length - 1].trim().toUpperCase() === "C") { isLatch = true; parts.pop(); }
      const last = parts[parts.length - 1] ?? "";
      const pin = Number(String(last).replace(/[^\d]/g, ""));
      if (!Number.isFinite(pin)) continue;
      (isLatch ? latch : normal).push(pin);
    }
  }
  const uniq = (xs: number[]) => Array.from(new Set(xs));
  return { normalPins: uniq(normal), latchPins: uniq(latch) };
}
function extractPinsFromKrosyXML(xml: string) {
  const accept = new Set(["default", "no_check"]);
  const normal: number[] = [];
  const latch: number[] = [];

  // --- helper
  const pushPin = (pos: string) => {
    const parts = String(pos).split(",");
    let isLatch = false;
    if (parts.at(-1)?.trim().toUpperCase() === "C") { isLatch = true; parts.pop(); }
    const pin = Number((parts.at(-1) || "").replace(/\D+/g, ""));
    if (Number.isFinite(pin)) (isLatch ? latch : normal).push(pin);
  };

  // --- try DOM first (namespace-agnostic)
  let usedRegexFallback = false;
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const hasErr = doc.getElementsByTagName("parsererror").length > 0;

    let nodes: Element[] = [];
    // 1) plain name
    nodes = Array.from(doc.getElementsByTagName("sequence"));
    // 2) wildcard namespace
    if (nodes.length === 0 && doc.getElementsByTagNameNS) {
      nodes = Array.from(doc.getElementsByTagNameNS("*", "sequence"));
    }

    if (!hasErr && nodes.length) {
      for (const el of nodes) {
        const mt = (el.getAttribute("measType") || "").toLowerCase();
        if (!accept.has(mt)) continue;
        const pos = el.getElementsByTagName("objPos")[0]?.textContent || "";
        if (pos) pushPin(pos);
      }
    } else {
      usedRegexFallback = true;
    }
  } catch {
    usedRegexFallback = true;
  }

  // --- regex fallback (works even on truncated/pretty-printed XML)
  if (usedRegexFallback) {
    const re = /<sequence\b[^>]*\bmeasType="(default|no_check)"[^>]*>[\s\S]*?<objPos>([^<]+)<\/objPos>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) pushPin(m[2]);
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


function classify(raw: string): { type: "kfb" | "kssk" | null; code: string } {
  const asKssk = digitsOnly(raw);
  if (KSSK_DIGITS_REGEX.test(asKssk)) return { type: "kssk", code: asKssk };
  const mac = canonicalMac(raw);
  if (mac) return { type: "kfb", code: mac };
  return { type: null, code: raw };
}


/* ===== Types ===== */
type ScanState = "idle" | "valid" | "invalid";
type KsskIndex = 0 | 1 | 2;
type KsskPanel = `kssk${KsskIndex}`;
type PanelKey = "kfb" | KsskPanel;
type OfflineResp = { ok: boolean; status: number; data: any | null };
type Ov = {
  open: boolean;
  kind: "success" | "error";
  code: string;
  msg?: string;
  seq: number;
  anchor: "table" | "viewport";
};
/* NEW: hoisted so all module scope can use them */
type PanelTarget = PanelKey | "global";
type FlashEvent = {
  id: number;
  kind: "success" | "error";
  panel: PanelTarget;
  code: string;
  msg?: string;
  ts: number;
};
/* ===== Page ===== */
export default function SetupPage() {
  const allowManual = true;
  const prefersReduced = useReducedMotion();
const tableRef = useRef<HTMLDivElement>(null);
  const [kfb, setKfb] = useState<string | null>(null);
  const [ksskSlots, setKsskSlots] = useState<Array<string | null>>([null, null, null]);

  const [showManualFor, setShowManualFor] = useState<Record<string, boolean>>({});
const [overlay, setOverlay] = useState<Ov>({
  open:false, kind:"success", code:"", seq:0, anchor:"table"
});
  const [flash, setFlash] = useState<FlashEvent | null>(null);
  const [toasts, setToasts] = useState<Array<FlashEvent>>([]);
  const flashSeq = useRef(0);

  const pushToast = useCallback((f: FlashEvent) => {
    setToasts(prev => [...prev, f]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== f.id));
    }, 3500);
  }, []);

  const fireFlash = useCallback(
    (kind: "success" | "error", code: string, panel: PanelTarget, msg?: string) => {
      const id = ++flashSeq.current;
      const f: FlashEvent = { id, kind, panel, code, msg, ts: Date.now() };
      setFlash(f);
      pushToast(f);
      window.setTimeout(() => {
        setFlash(cur => (cur && cur.id === id ? null : cur));
      }, 900);
    },
    [pushToast]
  );

  const [tableCycle, setTableCycle] = useState(0);
  const [kbdBuffer, setKbdBuffer] = useState("");

  const sendBusyRef = useRef(false);



  
const hb = useRef<Map<string, number>>(new Map());

const LS_KEY = `setup.activeKsskLocks::${STATION_ID}`;
const loadLocalLocks = (): Set<string> => {
  try { return new Set<string>(JSON.parse(localStorage.getItem(LS_KEY) ?? "[]")); }
  catch { return new Set(); }
};
const saveLocalLocks = (s: Set<string>) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...s])); } catch {}
};
const activeLocks = useRef<Set<string>>(new Set()); // source of truth on client

const startHeartbeat = (kssk: string) => {
  stopHeartbeat(kssk);
  const id = window.setInterval(() => {
    fetch("/api/kssk-lock", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kssk, stationId: STATION_ID, ttlSec: 1800 }),
    }).catch(() => {});
  }, 60_000);
  hb.current.set(kssk, id);
};

const stopHeartbeat = (kssk?: string) => {
  if (!kssk) { hb.current.forEach(clearInterval); hb.current.clear(); return; }
  const id = hb.current.get(kssk);
  if (id) { clearInterval(id); hb.current.delete(kssk); }
};

const releaseLock = async (kssk: string) => {
  stopHeartbeat(kssk);
  activeLocks.current.delete(kssk);
  saveLocalLocks(activeLocks.current);
  try {
    await fetch("/api/kssk-lock", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kssk, stationId: STATION_ID }),
      keepalive: true,
    });
  } catch {}
};

const releaseAllLocks = async () => {
  const all = [...activeLocks.current];
  stopHeartbeat();
  await Promise.all(all.map(releaseLock));
};

// Rehydrate on mount: server → local fallback
useEffect(() => {
  (async () => {
    let hydrated = false;
    try {
      const r = await fetch(`/api/kssk-lock?stationId=${encodeURIComponent(STATION_ID)}`);
      if (r.ok) {
        const j = await r.json();
        const ks: string[] = (j?.locks ?? []).map((l: any) => String(l.kssk));
        activeLocks.current = new Set(ks);
        saveLocalLocks(activeLocks.current);
        hydrated = true;
      }
    } catch {}
    if (!hydrated) activeLocks.current = loadLocalLocks();

    activeLocks.current.forEach((k) => startHeartbeat(k));
  })();
}, []);

  
  const [lastError, setLastError] = useState<string | null>(null);


const showOk = (code: string, msg?: string, panel: PanelTarget = "global") => {
  const anchor: Ov["anchor"] = panel === "kfb" ? "viewport" : "table";
  setLastError(null);
  fireFlash("success", code, panel, msg);
  setOverlay(o => ({ ...o, open:false }));
  setTimeout(() => {
    setOverlay(o => ({ open:true, kind:"success", code, msg, seq:o.seq+1, anchor }));
  }, 0);
};

const showErr = (code: string, msg?: string, panel: PanelTarget = "global") => {
  const anchor: Ov["anchor"] = panel === "kfb" ? "viewport" : "table";
  fireFlash("error", code, panel, msg);
  setOverlay(o => ({ open:true, kind:"error", code, msg, seq:o.seq+1, anchor }));
};

    //RESETALL
    const resetAll = useCallback(() => {
      //void releaseAllLocks(); THUS AUTO REALASE On reset UI 
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
        headers: {
          "Content-Type": "application/json",
          // Accept both—offline may proxy XML or JSON
          Accept: "application/json, application/xml;q=0.9, */*;q=0.1",
        },
        signal,
        body: JSON.stringify({
          intksk: ksskDigits,
          requestID: "1",
          sourceHostname: typeof window !== "undefined" ? window.location.hostname : undefined,
          targetHostName: process.env.NEXT_PUBLIC_KROSY_XML_TARGET ?? undefined,
        }),
      });

      let data: any = null;
      try {
        const ct = (res.headers.get("content-type") || "").toLowerCase();

        if (ct.includes("json")) {
          const j = await res.json();

          // /api/krosy-offline JSON wrapper -> surface XML or upstream JSON
          if (j?.responseXmlRaw || j?.responseXmlPreview) {
            data = { __xml: j.responseXmlRaw ?? j.responseXmlPreview };
          } else if (j?.response?.krosy) {
            // direct /api/krosy JSON 'latest'
            data = j;
          } else if (j?.responseJsonRaw) {
            // optional passthrough (if server exposes it)
            data = j.responseJsonRaw;
          } else {
            data = j; // best-effort passthrough
          }

        } else if (ct.includes("xml") || ct.includes("text/xml")) {
          // Pure XML from upstream or proxy
          data = { __xml: await res.text() };

        } else {
          // Unknown/opaque: try JSON, then treat as XML/text
          const raw = await res.text();
          try {
            const j2 = JSON.parse(raw);
            if (j2?.responseXmlRaw || j2?.responseXmlPreview) {
              data = { __xml: j2.responseXmlRaw ?? j2.responseXmlPreview };
            } else if (j2?.response?.krosy) {
              data = j2;
            } else if (j2?.responseJsonRaw) {
              data = j2.responseJsonRaw;
            } else {
              data = j2;
            }
          } catch {
            data = { __xml: raw };
          }
        }
      } catch {
        // non-fatal parse failure; fall through with data=null
      }

      return { ok: res.ok, status: res.status, data };
    } catch {
      // network/timeout abort
      return { ok: false, status: 0, data: null };
    }
  });
}, []);


  /* ===== Acceptors ===== */
 const acceptKfb = useCallback((code: string) => {
  setKfb(prev => {
    if (prev !== code) {
      setKsskSlots([null, null, null]);
      setShowManualFor({});
    }
    return code;
  });
  setTableCycle(n => n + 1);
  showOk(code, "BOARD SET", "kfb");   // <-- targeted flash
}, []);

const acceptKsskToIndex = useCallback(
  async (code: string, idx?: number) => {
    const target = typeof idx === "number" ? idx : ksskSlots.findIndex(v => v === null);
    const panel: PanelTarget = target >= 0 ? (`kssk${target}` as PanelKey) : "global";

    if (activeLocks.current.has(code)) { showErr(code, "TESTED on another board — already in production", panel); return; }
    if (!kfb) { showErr(code, "Scan MAC address first", "kfb"); return; }
    if (ksskSlots.some(c => c === code)) { showErr(code, "Duplicate KSSK", panel); return; }
    if (target === -1) { showErr(code, "Batch full (3/3)", "global"); return; }

    setKsskSlots(prev => { const n = [...prev]; n[target] = code; return n; });
    setTableCycle(n => n + 1);

    const lockRes = await fetch("/api/kssk-lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kssk: code, mac: kfb, stationId: STATION_ID, ttlSec: 1800 }),
    });

    if (!lockRes.ok) {
      const j = await lockRes.json().catch(() => ({}));
      const otherMac = j?.existing?.mac ? String(j.existing.mac).toUpperCase() : null;
      const heldBy = j?.existing?.stationId ? ` (held by ${j.existing.stationId})` : "";
      const msg =
        otherMac && otherMac !== kfb?.toUpperCase()
          ? `TESTED on another board — already assigned to BOARD ${otherMac}`
          : `TESTED on another board — already in production${heldBy}`;

      setKsskSlots(prev => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
      showErr(code, msg, panel);
      return;
    }

    activeLocks.current.add(code);
    saveLocalLocks(activeLocks.current);

    if (sendBusyRef.current) {
      await releaseLock(code);
      setKsskSlots(prev => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
      return;
    }

    sendBusyRef.current = true;
    let resp: OfflineResp | null = null;
    try { resp = await sendKsskToOffline(code); } finally { sendBusyRef.current = false; }

    if (!resp?.ok && resp?.status === 0) {
      await releaseLock(code);
      setKsskSlots(prev => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
      showErr(code, "Krosy communication error", panel);
      return;
    }

    if (resp?.ok) {
      const pins = resp.data?.__xml ? extractPinsFromKrosyXML(resp.data.__xml) : extractPinsFromKrosy(resp.data);
      const hasPins = !!pins && ((pins.normalPins?.length ?? 0) + (pins.latchPins?.length ?? 0)) > 0;

      if (!hasPins) {
        await releaseLock(code);
        setKsskSlots(prev => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
        showErr(code, "Krosy configuration error: no PINS", panel);
        return;
      }

      let espOk = true;
      try {
        const r = await fetch("/api/serial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ normalPins: pins.normalPins, latchPins: pins.latchPins, mac: kfb.toUpperCase(), kssk: code }),
        });
        if (!r.ok) {
          espOk = false;
          const t = await r.text().catch(() => "");
          showErr(code, `ESP write failed — ${t || r.status}`, panel);
        }
      } catch (e:any) {
        espOk = false;
        showErr(code, `ESP write failed — ${e?.message ?? "unknown error"}`, panel);
      }

      if (!espOk) {
        if (ALLOW_NO_ESP) {
          showOk(code, "KSSK OK (ESP offline)", panel);
          startHeartbeat(code);
          setTimeout(() => {
            setKsskSlots(prev => {
              const filled = prev.filter(Boolean).length;
              if (filled >= 3) { setKfb(null); return [null, null, null]; }
              return prev;
            });
          }, OK_DISPLAY_MS);
          return;
        } else {
          await releaseLock(code);
          setKsskSlots(prev => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
          showErr(code, "ESP write failed", panel);
          return;
        }
      }

      showOk(code, "KSSK OK", panel);
      startHeartbeat(code);
    } else {
      await releaseLock(code);
      setKsskSlots(prev => { const n = [...prev]; if (n[target] === code) n[target] = null; return n; });
      showErr(code, `KSSK send failed (${resp?.status || "no status"})`, panel);
    }
  },
  [kfb, ksskSlots, sendKsskToOffline]
);

const handleManualSubmit = useCallback(
  (panel: PanelKey, raw: string) => {
    const { type, code } = classify(raw);
    if (!type) { showErr(raw, "Unrecognized code", panel); return; }

    if (panel === "kfb") {
      if (type !== "kfb") { showErr(code, "Expected ESP MAC (AA:BB:CC:DD:EE:FF)", "kfb"); return; }
      acceptKfb(code);
    } else {
      if (type !== "kssk") { showErr(code, "Expected KSSK (12 digits)", panel); return; }
      const idx = Number(panel.slice(-1)) as KsskIndex;
      void acceptKsskToIndex(code, idx);
    }
    setShowManualFor(s => ({ ...s, [panel]: false }));
  },
  [acceptKfb, acceptKsskToIndex]
);

const handleScanned = useCallback((raw: string) => {
  const { type, code } = classify(raw);
  const nextIdx = ksskSlots.findIndex(v => v === null);
  const defaultKsskPanel: PanelKey = (nextIdx >= 0 ? `kssk${nextIdx}` : "kssk0") as PanelKey;
  const defaultPanel: PanelTarget = !kfb ? "kfb" : defaultKsskPanel;

  if (!type) { showErr(code || raw, "Unrecognized code", defaultPanel); return; }
  if (type === "kfb") acceptKfb(code);
  else void acceptKsskToIndex(code);
}, [kfb, ksskSlots, acceptKfb, acceptKsskToIndex]);


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


   useEffect(() => {
    if (KEEP_LOCKS_ON_UNLOAD) return;         // <— skip cleanup in test mode
    const h = () => {
      activeLocks.current.forEach((k) => {
        fetch("/api/kssk-lock", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kssk: k, stationId: STATION_ID }),
          keepalive: true,
        }).catch(()=>{});
      });
    };
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, []);


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

  useEffect(() => {
  if (!kfb) return;
  if (ksskCount === 3) {
    // let the OK overlay finish (900ms), then reset UI to default
    const t = setTimeout(() => {
      setLastError(null);
      setKfb(null);                     // back to Step 1: scan MAC
      setKsskSlots([null, null, null]); // clear slots (locks are kept)
      setShowManualFor({});
      setTableCycle(n => n + 1);        // nudge TableSwap if needed
    }, 950);
    return () => clearTimeout(t);
  }
}, [ksskCount, kfb]);

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
              SETUP WIRELESS KFB
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
                <h2 style={heading}>SCAN BOARD NUMBER (MAC ADDRESS)</h2>
              </div>

              <ScanBoxAnimated
                ariaLabel="KFB scan zone"
                height={160}
                flashKind={flash?.panel === "kfb" ? flash.kind : null}
                flashId={flash?.panel === "kfb" ? flash.id : undefined}
              />


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
              const hit = flash && (flash.panel === "global" || flash.panel === (`kssk${idx}` as PanelKey));
              return (
                <KsskSlotCompact
                  key={idx}
                  index={idx}
                  code={code}
                  onManualToggle={() => setShowManualFor((s) => ({ ...s, [`kssk${idx}`]: !s[`kssk${idx}`] }))}
                  manualOpen={!!showManualFor[`kssk${idx}`]}
                  onSubmit={(v) => handleManualSubmit(`kssk${idx}`, v)}
                  flashKind={hit ? flash!.kind : null}
                  flashId={hit ? flash!.id : undefined}
                />
              );
            })}
            </div>
          </section>
        </section>
      )}

      {/* TableSwap */}
      <div ref={tableRef} style={{ ...containerWide, marginTop: 6 }}>
        <TableSwap
          cycleKey={tableCycle}
          hasBoard={!!kfb}
          ksskCount={ksskCount}
          ksskTarget={3}
          boardName={kfb}
          boardMap={{}}
          okAppearDelayMs={350}
          swapDelayMs={1400}
          flashKind={overlay.kind}   // NEW
          flashSeq={overlay.seq}     // NEW
        />
      </div>


   <ToastStack
        items={toasts}
        onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))}
      />

      {/* Overlay */}
     <ResultOverlay
      open={overlay.open}
      kind={overlay.kind}
      code={overlay.code}
      msg={overlay.msg}
      seq={overlay.seq}
      excludeRef={tableRef}
      onClose={() => setOverlay(o => ({ ...o, open:false }))}
      anchor={overlay.anchor}
    />

    </main>
  );
}

/* ===== Scan visuals (animated only for KFB) ===== */

function ScanBoxAnimated({
  ariaLabel, height = 160, flashKind, flashId,
}: {
  ariaLabel: string;
  height?: number;
  flashKind?: "success" | "error" | null;
  flashId?: number;
}) {
  const isOk  = flashKind === "success";
  const isErr = flashKind === "error";
  const ring  = isOk ? "rgba(16,185,129,.30)" : isErr ? "rgba(239,68,68,.30)" : "transparent";
  const tint  = isOk ? "rgba(16,185,129,.10)" : isErr ? "rgba(239,68,68,.10)" : "transparent";

  return (
    <div
      aria-label={ariaLabel}
      style={{
        position:"relative",
        width:"100%", height, borderRadius:16, overflow:"hidden",
        background:"#0b1220",
        border:"1px solid #1e293b",
        boxShadow:"inset 0 0 0 1px rgba(255,255,255,.06)"
      }}
    >
      {/* static grid only */}
      <div
        style={{
          position:"absolute", inset:0, opacity:.35,
          backgroundSize:"120px 100%",
          backgroundImage:"repeating-linear-gradient(90deg, rgba(148,163,184,.24) 0 1px, transparent 1px 12px)"
        }}
      />

      {/* flash ring */}
      {(isOk || isErr) && (
        <m.div
          key={flashId ?? flashKind}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: .18 }}
          style={{
            position:"absolute", inset:0,
            boxShadow:`0 0 0 6px ${ring} inset`,
            background:tint
          }}
        />
      )}

      {/* centered barcode slab */}
      <div
        style={{
          position:"absolute", left:"50%", top:"50%", transform:"translate(-50%,-50%)",
          width:"min(100%, 1100px)", height:86, borderRadius:10,
          background:"repeating-linear-gradient(90deg, rgba(248,250,252,.9) 0 6px, transparent 6px 14px)"
        }}
      />
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
  flashKind,
  flashId,
}: {
  index: 0 | 1 | 2;
  code: string | null;
  manualOpen: boolean;
  onManualToggle: () => void;
  onSubmit: (v: string) => void;
  flashKind?: "success" | "error" | null;
  flashId?: number;
}) {
  const prefersReduced = useReducedMotion();
  const filled = !!code;
  const isOk = flashKind === "success";
  const isErr = flashKind === "error";

  const cardBg = filled ? "#f0fdf4" : "#fbfdff";
  const ring = isOk ? "0 0 0 6px rgba(16,185,129,0.22)" : isErr ? "0 0 0 6px rgba(239,68,68,0.22)" : "none";
  const border = isOk ? "#a7f3d0" : isErr ? "#fecaca" : "#edf2f7";

  return (
    <m.div
      key={flashId ?? `slot-${index}`}
      initial={false}
      animate={
        isErr && !prefersReduced
          ? { x: [0, -8, 8, -6, 6, -3, 3, 0] }
          : { x: 0 }
      }
      transition={{ duration: 0.5, ease: "easeInOut" }}
      style={{
        border: `1px solid ${border}`,
        borderRadius: 14,
        background: cardBg,
        padding: 14,
        display: "grid",
        gap: 10,
        position: "relative",
        boxShadow: ring,
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
        <StateIcon state={filled ? "valid" : isErr ? "invalid" : "idle"} size={40} />
      </div>

      {/* code pill */}
      <div>
        <CodePill value={code || "—"} highlight={isErr ? "danger" : filled ? "success" : "neutral"} big />
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

      {/* OK/ERROR burst icon */}
      <AnimatePresence>
        {(isOk || isErr) && (
          <m.div
            key={`burst-${flashId ?? flashKind}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            style={{ position: "absolute", top: 10, right: 10 }}
          >
          </m.div>
        )}
      </AnimatePresence>
    </m.div>
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

function ToastStack({ items, onDismiss }: { items: FlashEvent[]; onDismiss:(id:number)=>void }) {
  return (
    <div style={{ position:"fixed", top:12, right:12, display:"grid", gap:10, zIndex:90 }} aria-live="polite" role="status">
      <AnimatePresence initial={false}>
        {items.map(t => {
          const ok = t.kind === "success";
          const big = t.kind === "error"; // ← make errors bigger

          const bg = ok ? "linear-gradient(180deg,#ecfdf5,#d1fae5)" : "linear-gradient(180deg,#fef2f2,#fee2e2)";
          const bd = ok ? "#a7f3d0" : "#fecaca";
          const fg = ok ? "#065f46" : "#7f1d1d";

          return (
            <m.div
              key={t.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: "tween", duration: 0.18 }}
              style={{
                position: "relative",
                minWidth: big ? 480 : 320,     // ↑ wider
                maxWidth: big ? 820 : 520,     // ↑ max width
                background: bg,
                border: `3px solid ${bd}`,     // ↑ thicker border
                borderRadius: big ? 16 : 12,   // ↑ radius
                padding: big ? "16px 20px" : "10px 14px", // ↑ padding
                boxShadow: "0 10px 28px rgba(15,23,42,0.22)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: big ? 14 : 10 }}>
                <span
                  aria-hidden
                  style={{
                    width: big ? 22 : 16,       // ↑ icon size
                    height: big ? 22 : 16,
                    borderRadius: 999,
                    background: ok ? "linear-gradient(180deg,#34d399,#10b981)" : "linear-gradient(180deg,#fb7185,#ef4444)",
                    boxShadow: `0 0 0 2px ${ok ? "rgba(16,185,129,0.22)" : "rgba(239,68,68,0.22)"}`,
                    flex: "0 0 auto",
                  }}
                />
                <strong style={{ color: fg, fontSize: big ? 18 : 14, lineHeight: 1.25 }}>
                  {ok ? "OK" : "ERROR"} — {t.code}{t.msg ? ` — ${t.msg}` : ""}
                </strong>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => onDismiss(t.id)}
                  style={{ marginLeft: "auto", border: 0, background: "transparent", cursor: "pointer", fontSize: big ? 22 : 18, color: fg }}
                >
                  ×
                </button>
              </div>
            </m.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
type SpotlightRect = { top:number; left:number; width:number; height:number };

// 1) Props typing — drop React. and allow null
function ResultOverlay({
  open,
  kind,
  code,
  msg,
  seq,
  onClose,
  excludeRef,
  anchor,
}: {
  open: boolean;
  kind: "success" | "error";
  code: string;
  msg?: string;
  seq: number;
  onClose: () => void;
  // ↓ use the types you already import at top
  excludeRef?: RefObject<HTMLElement | null> | MutableRefObject<HTMLElement | null>;
  anchor: "table" | "viewport";
}) {
  const [hole, setHole] = useState<SpotlightRect | null>(null);
  const [vw, setVw] = useState(0);

  // viewport width (SSR-safe)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setVw(window.innerWidth || 0);
    update();
    window.addEventListener("resize", update, { passive:true });
    return () => window.removeEventListener("resize", update);
  }, []);

  // measure the table only when anchoring to table
  useEffect(() => {
    if (!open || anchor !== "table") return;
    const calc = () => {
      const el = excludeRef?.current || null;
      if (!el) { setHole(null); return; }
      const r = el.getBoundingClientRect();
      setHole({ top:r.top, left:r.left, width:r.width, height:r.height });
    };
    calc();
    const opts = { passive:true } as AddEventListenerOptions;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(calc) : null;
    if (ro && excludeRef?.current) ro.observe(excludeRef.current);
    window.addEventListener("scroll", calc, opts);
    window.addEventListener("resize", calc, opts);
    return () => {
      window.removeEventListener("scroll", calc, opts as any);
      window.removeEventListener("resize", calc, opts as any);
      ro?.disconnect();
    };
  }, [open, excludeRef, seq, anchor]);

  // auto close
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
  }, [open, seq, onClose]);

  if (!open) return null;

  const isOk = kind === "success";
  const CURTAIN = isOk ? "rgba(16,185,129,.45)" : "rgba(239,68,68,.45)";
  const BD      = isOk ? "#a7f3d0" : "#fecaca";
  const FG      = isOk ? "#065f46" : "#7f1d1d";
  const ACCENT  = isOk ? "#10b981" : "#ef4444";
  const ACCENT_SOFT = isOk ? "rgba(16,185,129,.28)" : "rgba(239,68,68,.28)";

  const haveHole = anchor === "table" && hole;
const h = hole ?? { top: 0, left: 0, width: 0, height: 0 };
const useViewport = anchor === "viewport" || !hole;


  const PILL_CLEAR_Y = 12;
// after
const bannerTop = useViewport
  ? 16
  : Math.max(10, h.top + PILL_CLEAR_Y);
const bannerRight = useViewport
  ? 16
  : Math.max(12, vw - (h.left + h.width) + 12);

  // corner accent style (only for table-anchored)
  const CORNER_SIZE = 70, CORNER_THICK = 4;
  const cornerBase: CSSProperties = {
    position:"absolute",
    width:CORNER_SIZE, height:CORNER_SIZE,
    borderRadius:12, pointerEvents:"none",
    boxShadow:`0 10px 28px ${ACCENT_SOFT}`,
  };

  return (
    <AnimatePresence>
      <m.div
        key={seq}
        initial={{ opacity:0 }}
        animate={{ opacity:1 }}
        exit={{ opacity:0 }}
        transition={{ duration:.12 }}
        style={{ position:"fixed", inset:0, zIndex:80, pointerEvents:"none" }}
        aria-live="assertive"
        aria-label={isOk ? "OK" : "ERROR"}
      >
        {/* curtains only when anchoring to table */}
        {haveHole ? (
          <>
            <div style={{ position:"absolute", left:0, right:0, top:0, height:hole!.top, background:CURTAIN }} />
            <div style={{ position:"absolute", left:0, top:hole!.top, width:hole!.left, height:hole!.height, background:CURTAIN }} />
            <div style={{ position:"absolute", left:hole!.left + hole!.width, right:0, top:hole!.top, height:hole!.height, background:CURTAIN }} />
            <div style={{ position:"absolute", left:0, right:0, top:hole!.top + hole!.height, bottom:0, background:CURTAIN }} />

            {/* corner accents */}
            <div style={{ ...cornerBase, left:hole!.left-CORNER_THICK, top:hole!.top-CORNER_THICK, borderTop:`${CORNER_THICK}px solid ${ACCENT}`, borderLeft:`${CORNER_THICK}px solid ${ACCENT}` }} />
            <div style={{ ...cornerBase, left:hole!.left+hole!.width-CORNER_SIZE+CORNER_THICK, top:hole!.top-CORNER_THICK, borderTop:`${CORNER_THICK}px solid ${ACCENT}`, borderRight:`${CORNER_THICK}px solid ${ACCENT}` }} />
            <div style={{ ...cornerBase, left:hole!.left-CORNER_THICK, top:hole!.top+hole!.height-CORNER_SIZE+CORNER_THICK, borderBottom:`${CORNER_THICK}px solid ${ACCENT}`, borderLeft:`${CORNER_THICK}px solid ${ACCENT}` }} />
            <div style={{ ...cornerBase, left:hole!.left+hole!.width-CORNER_SIZE+CORNER_THICK, top:hole!.top+hole!.height-CORNER_SIZE+CORNER_THICK, borderBottom:`${CORNER_THICK}px solid ${ACCENT}`, borderRight:`${CORNER_THICK}px solid ${ACCENT}` }} />
          </>
        ) : anchor === "table" ? (
          // while measuring, keep a soft full curtain; for viewport, no curtain
          <div style={{ position:"absolute", inset:0, background:CURTAIN }} />
        ) : null}

        {/* compact banner */}
      
      </m.div>
    </AnimatePresence>
  );
}

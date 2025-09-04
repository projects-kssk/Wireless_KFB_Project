// src/app/setup/page.tsx
"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  memo,
  useMemo,
  type CSSProperties,
} from "react";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import TableSwap from "@/components/Tables/TableSwap";
import type { RefObject } from "react";
import { useSerialEvents } from "@/components/Header/useSerialEvents";

/* ===== Config ===== */
const HTTP_TIMEOUT_MS = Number(
  process.env.NEXT_PUBLIC_SETUP_HTTP_TIMEOUT_MS ?? "8000"
);
// Krosy IP-based mode selection
const IP_ONLINE = (process.env.NEXT_PUBLIC_KROSY_IP_ONLINE || "").trim();
const IP_OFFLINE = (process.env.NEXT_PUBLIC_KROSY_IP_OFFLINE || "").trim();
const STATION_ID =
  process.env.NEXT_PUBLIC_STATION_ID || window.location.hostname;
const KSK_TTL_SEC = Math.max(
  5,
  Number(process.env.NEXT_PUBLIC_KSK_TTL_SEC ?? "1800")
);
const ALLOW_NO_ESP =
  (process.env.NEXT_PUBLIC_SETUP_ALLOW_NO_ESP ?? "0") === "1"; // keep lock even if ESP fails
const KEEP_LOCKS_ON_UNLOAD =
  (process.env.NEXT_PUBLIC_KEEP_LOCKS_ON_UNLOAD ?? "0") === "1"; // do not auto-release on tab close
const REQUIRE_REDIS_ONLY =
  (process.env.NEXT_PUBLIC_KSK_REQUIRE_REDIS ?? "0") === "1";
// Prefer loading pin aliases/groups from Redis first; allow requiring Redis-only
const PREFER_ALIAS_REDIS =
  (process.env.NEXT_PUBLIC_ALIAS_PREFER_REDIS ?? "1") === "1";
const REQUIRE_ALIAS_REDIS =
  (process.env.NEXT_PUBLIC_ALIAS_REQUIRE_REDIS ?? "0") === "1";

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
// ---- types
type KrosyOpts = {
  macHint?: string;
  includeLatch?: boolean; // default false
  allowedCompTypes?: string[]; // e.g. ["contact"]
  includeLabelPrefixes?: string[]; // e.g. ["CN"]
  allowedMeasTypes?: string[]; // default ["default"]
};

type KrosyNameHints = {
  labels: string[]; // e.g. ["CN_2450", ...]
  byPrefix: Record<string, string[]>; // { CN: ["CN_2450", ...] }
  labelToPin: Record<string, number>; // { "CN_2450": 1 }
  normalPins: number[];
  latchPins: number[];
};

const OBJGROUP_MAC = /\(([0-9A-F:]{17})\)/i;

function parsePos(pos: string) {
  const raw = String(pos || "");
  const parts = raw.split(",").map((s) => s.trim());
  // Policy: do NOT derive a pin if there is no comma
  if (parts.length < 2)
    return {
      pin: NaN,
      label: parts[0] || "",
      labelPrefix: (parts[0] || "").split("_")[0] || "",
      isLatch: false,
    };
  let isLatch = false;
  if (parts.at(-1)?.toUpperCase() === "C") {
    isLatch = true;
    parts.pop();
  }
  // After removing 'C', ensure there is still a numeric segment separate from the label
  if (parts.length < 2)
    return {
      pin: NaN,
      label: parts[0] || "",
      labelPrefix: (parts[0] || "").split("_")[0] || "",
      isLatch,
    };
  const label = (parts[0] || "").trim();
  const labelPrefix = label.split("_")[0] || "";
  const last = parts.at(-1) || "";
  const pinNum = Number(String(last).replace(/\D+/g, ""));
  const pin = Number.isFinite(pinNum) ? pinNum : NaN;
  return { pin, label, labelPrefix, isLatch };
}

// ---------- helpers (put near other small utils) ----------
const getAttr = (el: Element, name: string) =>
  el.getAttribute(name) ?? el.getAttribute(name.toLowerCase()) ?? "";

const parseMarkupSafely = (markup: string) =>
  new DOMParser().parseFromString(markup, "text/html"); // avoids Firefox XML console error

const tag = (el: ParentNode, name: string) =>
  (el as Document).getElementsByTagName
    ? Array.from((el as Document).getElementsByTagName(name))
    : Array.from((el as Element).getElementsByTagName(name));

// ---------- safer XML→DOM readers ----------
function extractNameHintsFromKrosyXML(
  xml: string,
  optsOrMac?: KrosyOpts | string
): KrosyNameHints {
  const opts: KrosyOpts =
    typeof optsOrMac === "string" ? { macHint: optsOrMac } : optsOrMac || {};
  const {
    macHint,
    includeLatch, // optional; when false, exclude latch pins
    allowedCompTypes, // optional; when provided, filter by compType
    includeLabelPrefixes, // optional; when provided, filter by label prefix
    allowedMeasTypes, // optional; when provided, filter by measType
  } = opts;

  const wantMac = String(macHint ?? "").toUpperCase();
  const labels: string[] = [];
  const byPrefix: Record<string, string[]> = {};
  const labelToPin: Record<string, number> = {};
  const normalPins: number[] = [];
  const latchPins: number[] = [];

  const pushFromObjPos = (pos: string) => {
    const { pin, label, labelPrefix, isLatch } = parsePos(pos);
    if (!Number.isFinite(pin)) return;
    if (includeLatch === false && isLatch) return;
    if (
      Array.isArray(includeLabelPrefixes) &&
      includeLabelPrefixes.length > 0 &&
      !includeLabelPrefixes.includes(labelPrefix)
    )
      return;
    if (label) {
      labels.push(label);
      (byPrefix[labelPrefix] ||= []).push(label);
      if (!(label in labelToPin)) labelToPin[label] = pin;
    }
    (isLatch ? latchPins : normalPins).push(pin);
  };

  // Parse as HTML to suppress Firefox XML errors
  let parsedAny = false;
  try {
    const doc = parseMarkupSafely(xml);
    const seqs = Array.from(doc.getElementsByTagName("sequence"));
    for (const el of seqs) {
      const mt = (
        getAttr(el, "measType") ||
        el.getElementsByTagName("measType")[0]?.textContent ||
        ""
      ).toLowerCase();
      // Policy: default-only unless explicitly overridden
      const wantedMeas = (Array.isArray(allowedMeasTypes) && allowedMeasTypes.length > 0
        ? allowedMeasTypes
        : ["default"]) // enforce default by default
        .map((x) => x.toLowerCase());
      if (!wantedMeas.includes(mt)) continue;

      const ct = (
        getAttr(el, "compType") ||
        el.getElementsByTagName("compType")[0]?.textContent ||
        ""
      ).toLowerCase();

      if (
        Array.isArray(allowedCompTypes) &&
        allowedCompTypes.length > 0 &&
        !allowedCompTypes.map((x) => x.toLowerCase()).includes(ct)
      )
        continue;

      const og = String(
        el.getElementsByTagName("objGroup")[0]?.textContent || ""
      );
      const macM = og.match(OBJGROUP_MAC);
      const ogMac = (macM?.[1] || "").toUpperCase();
      const ZERO = "00:00:00:00:00:00";
      // Policy: require a concrete MAC match when macHint is provided
      if (wantMac) {
        if (!ogMac || ogMac === ZERO || ogMac !== wantMac) continue;
      }

      const pos = String(
        el.getElementsByTagName("objPos")[0]?.textContent || ""
      );
      if (pos) pushFromObjPos(pos);
    }
    parsedAny = seqs.length > 0;
  } catch {
    /* noop; fallback next */
  }

  if (!parsedAny) {
    const re = /<sequence\b([^>]*)>([\s\S]*?)<\/sequence>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const attrs = m[1] || "";
      const body = m[2] || "";

      const mt = (
        attrs.match(/\bmeasType="([^"]*)"/i)?.[1] ||
        body.match(/<measType>([^<]*)<\/measType>/i)?.[1] ||
        ""
      ).toLowerCase();
      const wantedMeas = (Array.isArray(allowedMeasTypes) && allowedMeasTypes.length > 0
        ? allowedMeasTypes
        : ["default"]).map((x) => x.toLowerCase());
      if (!wantedMeas.includes(mt)) continue;

      const ct = (
        body.match(/<compType>([^<]*)<\/compType>/i)?.[1] ||
        attrs.match(/\bcompType="([^"]*)"/i)?.[1] ||
        ""
      ).toLowerCase();

      if (
        allowedCompTypes &&
        !allowedCompTypes.map((x) => x.toLowerCase()).includes(ct)
      )
        continue;

      const og = body.match(/<objGroup>([^<]+)<\/objGroup>/i)?.[1] || "";
      const macM = og.match(OBJGROUP_MAC);
      const ogMac = (macM?.[1] || "").toUpperCase();
      const ZERO = "00:00:00:00:00:00";
      if (wantMac) {
        if (!ogMac || ogMac === ZERO || ogMac !== wantMac) continue;
      }

      const pos = body.match(/<objPos>([^<]+)<\/objPos>/i)?.[1] || "";
      if (pos) pushFromObjPos(pos);
    }
  }

  const uniqNum = (xs: number[]) => Array.from(new Set(xs));
  const uniqStr = (xs: string[]) => Array.from(new Set(xs));
  const byPrefixUniq: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(byPrefix)) byPrefixUniq[k] = uniqStr(v);

  return {
    labels: uniqStr(labels),
    byPrefix: byPrefixUniq,
    labelToPin,
    normalPins: uniqNum(normalPins),
    latchPins: uniqNum(latchPins),
  };
}

// ===== JSON extractor
function extractPinsFromKrosy(
  data: any,
  optsOrMac?: KrosyOpts | string
): {
  normalPins: number[];
  latchPins: number[];
  names: Record<number, string>;
} {
  const opts: KrosyOpts =
    typeof optsOrMac === "string" ? { macHint: optsOrMac } : optsOrMac || {};
  const {
    macHint,
    includeLatch, // optional; when false, exclude latch pins
    allowedCompTypes, // optional; when provided, filter by compType
    includeLabelPrefixes, // optional; when provided, filter by label prefix
    allowedMeasTypes, // optional; when provided, filter by measType
  } = opts;

  const take = (n: any) => (Array.isArray(n) ? n : n != null ? [n] : []);
  const segRoot =
    data?.response?.krosy?.body?.visualControl?.workingData?.sequencer
      ?.segmentList?.segment ??
    data?.response?.krosy?.body?.visualControl?.loadedData?.sequencer
      ?.segmentList?.segment;

  const wantMac = String(macHint ?? "").toUpperCase();
  const normal: number[] = [];
  const latch: number[] = [];
  const names: Record<number, string> = {};

  for (const seg of take(segRoot)) {
    for (const s of take(seg?.sequenceList?.sequence)) {
      const mt = String(s?.measType ?? "")
        .trim()
        .toLowerCase();
      // Policy: default-only unless explicitly overridden
      const wantedMeas = (Array.isArray(allowedMeasTypes) && allowedMeasTypes.length > 0
        ? allowedMeasTypes
        : ["default"]).map((x) => x.toLowerCase());
      if (!wantedMeas.includes(mt)) continue;

      const ct = String(s?.compType ?? "")
        .trim()
        .toLowerCase();
      if (
        Array.isArray(allowedCompTypes) &&
        allowedCompTypes.length > 0 &&
        !allowedCompTypes.map((x) => x.toLowerCase()).includes(ct)
      )
        continue;

      const og = String(s?.objGroup ?? "");
      const mm = og.match(OBJGROUP_MAC);
      const ogMac = (mm?.[1] || "").toUpperCase();
      const ZERO = "00:00:00:00:00:00";
      if (wantMac) {
        if (!ogMac || ogMac === ZERO || ogMac !== wantMac) continue;
      }

      const pos = String(s?.objPos ?? "");
      if (!pos) continue;

      const { pin, label, labelPrefix, isLatch } = parsePos(pos);
      if (!Number.isFinite(pin)) continue;
      if (
        Array.isArray(includeLabelPrefixes) &&
        includeLabelPrefixes.length > 0 &&
        !includeLabelPrefixes.includes(labelPrefix)
      )
        continue;
      if (includeLatch === false && isLatch) continue;

      if (label) names[pin] = label;
      (isLatch ? latch : normal).push(pin);
    }
  }

  const uniq = (xs: number[]) => Array.from(new Set(xs));
  return { normalPins: uniq(normal), latchPins: uniq(latch), names };
}

function extractPinsFromKrosyXML(xml: string, optsOrMac?: KrosyOpts | string) {
  const opts: KrosyOpts =
    typeof optsOrMac === "string" ? { macHint: optsOrMac } : optsOrMac || {};
  const {
    macHint,
    includeLatch, // optional; when false, exclude latch pins
    allowedCompTypes, // optional; when provided, filter by compType
    includeLabelPrefixes, // optional; when provided, filter by label prefix
    allowedMeasTypes, // optional; when provided, filter by measType
  } = opts;

  const wantMac = String(macHint ?? "").toUpperCase();
  const normal: number[] = [];
  const latch: number[] = [];
  const names: Record<number, string> = {};

  const pushPin = (pos: string) => {
    const { pin, label, labelPrefix, isLatch } = parsePos(pos);
    if (!Number.isFinite(pin)) return;
    if (
      Array.isArray(includeLabelPrefixes) &&
      includeLabelPrefixes.length > 0 &&
      !includeLabelPrefixes.includes(labelPrefix)
    )
      return;
    if (includeLatch === false && isLatch) return;
    if (label) names[pin] = label;
    (isLatch ? latch : normal).push(pin);
  };

  let parsedOk = false;
  try {
    const doc = parseMarkupSafely(xml);
    const seqs = Array.from(doc.getElementsByTagName("sequence"));
    for (const el of seqs) {
      const mt = (
        getAttr(el, "measType") ||
        el.getElementsByTagName("measType")[0]?.textContent ||
        ""
      ).toLowerCase();
      const wantedMeas = (Array.isArray(allowedMeasTypes) && allowedMeasTypes.length > 0
        ? allowedMeasTypes
        : ["default"]).map((x) => x.toLowerCase());
      if (!wantedMeas.includes(mt)) continue;

      const ct = (
        getAttr(el, "compType") ||
        el.getElementsByTagName("compType")[0]?.textContent ||
        ""
      ).toLowerCase();

      if (
        Array.isArray(allowedCompTypes) &&
        allowedCompTypes.length > 0 &&
        !allowedCompTypes.map((x) => x.toLowerCase()).includes(ct)
      )
        continue;

      const og = String(
        el.getElementsByTagName("objGroup")[0]?.textContent || ""
      );
      const m = og.match(OBJGROUP_MAC);
      const ogMac = (m?.[1] || "").toUpperCase();
      const ZERO = "00:00:00:00:00:00";
      if (wantMac) {
        if (!ogMac || ogMac === ZERO || ogMac !== wantMac) continue;
      }

      const pos = String(
        el.getElementsByTagName("objPos")[0]?.textContent || ""
      );
      if (pos) pushPin(pos);
    }
    parsedOk = seqs.length > 0;
  } catch {
    /* noop; fallback next */
  }

  if (!parsedOk) {
    const re = /<sequence\b([^>]*)>([\s\S]*?)<\/sequence>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const attrs = m[1] || "";
      const body = m[2] || "";
      const mt = (
        attrs.match(/\bmeasType="([^"]*)"/i)?.[1] ||
        body.match(/<measType>([^<]*)<\/measType>/i)?.[1] ||
        ""
      ).toLowerCase();
      const wantedMeas = (Array.isArray(allowedMeasTypes) && allowedMeasTypes.length > 0
        ? allowedMeasTypes
        : ["default"]).map((x) => x.toLowerCase());
      if (!wantedMeas.includes(mt)) continue;
      const ct = (
        body.match(/<compType>([^<]*)<\/compType>/i)?.[1] ||
        attrs.match(/\bcompType="([^"]*)"/i)?.[1] ||
        ""
      ).toLowerCase();

      if (
        Array.isArray(allowedCompTypes) &&
        allowedCompTypes.length > 0 &&
        !allowedCompTypes.map((x) => x.toLowerCase()).includes(ct)
      )
        continue;

      const og = body.match(/<objGroup>([^<]+)<\/objGroup>/i)?.[1] || "";
      const macM = og.match(OBJGROUP_MAC);
      const ogMac = (macM?.[1] || "").toUpperCase();
      const ZERO = "00:00:00:00:00:00";
      if (wantMac) {
        if (!ogMac || ogMac === ZERO || ogMac !== wantMac) continue;
      }

      const pos = body.match(/<objPos>([^<]+)<\/objPos>/i)?.[1] || "";
      if (pos) pushPin(pos);
    }
  }

  const uniq = (xs: number[]) => Array.from(new Set(xs));
  return { normalPins: uniq(normal), latchPins: uniq(latch), names };
}

/* ===== KFB as MAC (AA:BB:CC:DD:EE:FF) ===== */
const MAC_REGEX = compileRegex(
  process.env.NEXT_PUBLIC_KFB_REGEX,
  /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i
);
const KSK_DIGITS_REGEX = /^\d{12}$/;
const digitsOnly = (s: string) => String(s ?? "").replace(/\D+/g, "");
function canonicalMac(raw: string): string | null {
  if (!/[:\-]/.test(raw) && !/[A-Fa-f]/.test(raw)) return null;
  const hex = String(raw ?? "")
    .replace(/[^0-9a-fA-F]/g, "")
    .toUpperCase();
  if (hex.length !== 12) return null;
  const mac = hex.match(/.{2}/g)!.join(":");
  return MAC_REGEX.test(mac) ? mac : null;
}

function classify(raw: string): { type: "kfb" | "kssk" | null; code: string } {
  const asKssk = digitsOnly(raw);
  if (KSK_DIGITS_REGEX.test(asKssk)) return { type: "kssk", code: asKssk };
  const mac = canonicalMac(raw);
  if (mac) return { type: "kfb", code: mac };
  return { type: null, code: raw };
}

/* ===== Types ===== */
type ScanState = "idle" | "valid" | "invalid";
type KskIndex = 0 | 1 | 2;
type KskPanel = `ksk${KskIndex}`;
type PanelKey = "kfb" | KskPanel;
type OfflineResp = { ok: boolean; status: number; data: any | null };
type Ov = {
  open: boolean;
  kind: "success" | "error";
  code: string;
  msg?: string;
  seq: number;
  anchor: "table" | "viewport";
};
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
import ZoomControls from "@/components/Controls/ZoomControls";

export default function SetupPage() {
  const allowManual = true;
  const prefersReduced = useReducedMotion();
  const tableRef = useRef<HTMLDivElement>(null);

  const [kfb, setKfb] = useState<string | null>(null);
  const [ksskSlots, setKsskSlots] = useState<Array<string | null>>([
    null,
    null,
    null,
  ]);
  const [ksskStatus, setKsskStatus] = useState<
    Array<"idle" | "pending" | "ok" | "error">
  >(["idle", "idle", "idle"]);

  const [showManualFor, setShowManualFor] = useState<Record<string, boolean>>(
    {}
  );
  const [overlay, setOverlay] = useState<Ov>({
    open: false,
    kind: "success",
    code: "",
    seq: 0,
    anchor: "table",
  });
  const [flash, setFlash] = useState<FlashEvent | null>(null);
  const [toasts, setToasts] = useState<Array<FlashEvent>>([]);
  const flashSeq = useRef(0);

  const pushToast = useCallback((f: FlashEvent) => {
    setToasts((prev) => {
      const next = [...prev, f];
      return next.slice(-100);
    });
  }, []);

  const fireFlash = useCallback(
    (
      kind: "success" | "error",
      code: string,
      panel: PanelTarget,
      msg?: string
    ) => {
      if (kind !== "error") return;
      const id = ++flashSeq.current;
      const f: FlashEvent = { id, kind, panel, code, msg, ts: Date.now() };
      pushToast(f);
    },
    [pushToast]
  );

  const [tableCycle, setTableCycle] = useState(0);
  const [kbdBuffer, setKbdBuffer] = useState("");
  const [setupName, setSetupName] = useState<string>("");
  const sendBusyRef = useRef(false);

  const hb = useRef<Map<string, number>>(new Map());

  // No localStorage fallback; always rely on Redis for locks
  const saveLocalLocks = (_s: Set<string>) => {};
  const activeLocks = useRef<Set<string>>(new Set());

  // Alias cache policy flags
  const CLEAR_LOCAL_ALIAS =
    String(process.env.NEXT_PUBLIC_ALIAS_CLEAR_ON_READY || "").trim() === "1";
  const MIRROR_ALIAS_WITH_REDIS =
    String(process.env.NEXT_PUBLIC_ALIAS_MIRROR_REDIS || "").trim() === "1";

  // When MAC is set/changed, mirror local alias cache with Redis union result.
  useEffect(() => {
    const mac = (kfb || "").toUpperCase();
    if (!mac || !MIRROR_ALIAS_WITH_REDIS) return;
    let abort = false;
    (async () => {
      try {
        const r = await fetch(`/api/aliases?mac=${encodeURIComponent(mac)}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = await r.json();
        const a =
          j?.aliases && typeof j.aliases === "object"
            ? (j.aliases as Record<string, string>)
            : {};
        if (abort) return;
        // No client alias cache updates
      } catch {}
    })();
    return () => {
      abort = true;
    };
  }, [kfb, MIRROR_ALIAS_WITH_REDIS, CLEAR_LOCAL_ALIAS]);

  const startHeartbeat = (kssk: string) => {
    stopHeartbeat(kssk);
    const id = window.setInterval(() => {
      fetch("/api/ksk-lock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kssk,
          stationId: STATION_ID,
          ttlSec: KSK_TTL_SEC,
        }),
      }).catch(() => {});
    }, 60_000);
    hb.current.set(kssk, id);
  };

  const stopHeartbeat = (kssk?: string) => {
    if (!kssk) {
      hb.current.forEach(clearInterval);
      hb.current.clear();
      return;
    }
    const id = hb.current.get(kssk);
    if (id) {
      clearInterval(id);
      hb.current.delete(kssk);
    }
  };

  const releaseLock = async (kssk: string) => {
    stopHeartbeat(kssk);
    activeLocks.current.delete(kssk);
    saveLocalLocks(activeLocks.current);
    try {
      await fetch("/api/ksk-lock", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kssk, stationId: STATION_ID, force: 1 }),
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
        const r = await fetch(
          `/api/ksk-lock?stationId=${encodeURIComponent(STATION_ID)}`
        );
        if (r.ok) {
          const j = await r.json();
          const ks: string[] = (j?.locks ?? []).map((l: any) => String(l.kssk));
          activeLocks.current = new Set(ks);
          saveLocalLocks(activeLocks.current);
          hydrated = true;
        }
      } catch {}
      // No local fallback when Redis is unavailable
      activeLocks.current.forEach((k) => startHeartbeat(k));
    })();
  }, []);

  // Helper to reconcile just-in-time before decisions
  const reconcileLocksNow = async () => {
    try {
      const stationId = (
        process.env.NEXT_PUBLIC_STATION_ID ||
        process.env.STATION_ID ||
        ""
      ).trim();
      if (!stationId) return;
      const r = await fetch(
        `/api/ksk-lock?stationId=${encodeURIComponent(stationId)}`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const j = await r.json();
      const ks: string[] = (j?.locks ?? []).map((l: any) => String(l.kssk));
      activeLocks.current = new Set(ks);
      saveLocalLocks(activeLocks.current);
    } catch {}
  };

  // Periodically reconcile locks with server so local cache stays fresh
  useEffect(() => {
    let stop = false;
    const stationId = (
      process.env.NEXT_PUBLIC_STATION_ID ||
      process.env.STATION_ID ||
      ""
    ).trim();
    if (!stationId) return;
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/ksk-lock?stationId=${encodeURIComponent(stationId)}`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const j = await r.json();
        const ks: string[] = (j?.locks ?? []).map((l: any) => String(l.kssk));
        if (!stop) {
          activeLocks.current = new Set(ks);
          saveLocalLocks(activeLocks.current);
        }
      } catch {}
    };
    const iv = setInterval(tick, 3000);
    tick();
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, []);

  const [lastError, setLastError] = useState<string | null>(null);
  // Per-window UI zoom (React-only; not Electron)
  const [setupZoom, setSetupZoom] = useState(1)
  const setupZoomStyle = useMemo(() => ({
    transform: `scale(${setupZoom})`,
    transformOrigin: "0 0",
    width: `${100 / setupZoom}%`,
    height: `${100 / setupZoom}%`,
  }), [setupZoom])


  // Ctrl/Cmd + wheel zoom like browser, React-only
  useEffect(() => {
    const clamp = (v: number) => Math.min(2, Math.max(0.5, v))
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || (e as any).metaKey)) return
      try { e.preventDefault() } catch {}
      const step = 0.1
      setSetupZoom((z) => clamp(z + (e.deltaY > 0 ? -step : step)))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  const showOk = (
    code: string,
    msg?: string,
    panel: PanelTarget = "global"
  ) => {
    setLastError(null);
  };

  const showErr = (
    code: string,
    msg?: string,
    panel: PanelTarget = "global"
  ) => {
    setLastError(msg || code || "Error")
    fireFlash("error", code, panel, msg);
  };

  // RESET ALL
  const resetAll = useCallback(() => {
    setKfb(null);
    setKsskSlots([null, null, null]);
    setKsskStatus(["idle", "idle", "idle"]);
    setShowManualFor({});
    setLastError(null);
    setSetupName("");
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

  // Tiny, safe caller for aliases clear: POST with JSON body { mac }
  const clearAliasesForMac = useCallback(
    async (macRaw: string): Promise<{ ok: boolean; status: number }> => {
      const mac = String(macRaw || "")
        .toUpperCase()
        .trim();
      if (!mac) return { ok: false, status: 400 };
      try {
        const res = await fetch("/api/aliases/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac }),
        });
        return { ok: res.ok, status: res.status };
      } catch {
        return { ok: false, status: 0 };
      }
    },
    []
  );

  const [krosyLive, setKrosyLive] = useState<boolean | null>(null);
  const sendKsskToOffline = useCallback(
    async (ksskDigits: string): Promise<OfflineResp> => {
      // Decide endpoint at call time based on detected live flag (state → window → env)
      const live =
        typeof krosyLive === "boolean"
          ? krosyLive
          : typeof window !== "undefined" &&
              (window as any).__krosyLive === true
            ? true
            : process.env.NEXT_PUBLIC_KROSY_ONLINE === "true";
      const url = live
        ? (process.env.NEXT_PUBLIC_KROSY_URL_ONLINE ?? "/api/krosy")
        : (process.env.NEXT_PUBLIC_KROSY_URL_OFFLINE ?? "/api/krosy-offline");
      return withTimeout(async (signal) => {
        try {
          const forward =
            !live && (process.env.NEXT_PUBLIC_KROSY_OFFLINE_TARGET_URL || "");
          try {
            console.log(
              "[SETUP] POST",
              url,
              "live=",
              live,
              forward ? `target=${forward}` : ""
            );
          } catch {}
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, application/xml;q=0.9, */*;q=0.1",
            },
            signal,
            body: JSON.stringify({
              intksk: ksskDigits,
              // unique per scan to ensure distinct .krosy-logs folder
              requestID: String(Date.now()),
              // Use configured source hostname for device + <sourceHost><hostname>
              sourceHostname:
                process.env.NEXT_PUBLIC_KROSY_SOURCE_HOSTNAME ||
                process.env.NEXT_PUBLIC_KROSY_XML_TARGET ||
                (typeof window !== "undefined"
                  ? window.location.hostname
                  : undefined),
              // XML target host for <targetHost><hostname>
              targetHostName:
                process.env.NEXT_PUBLIC_KROSY_XML_TARGET ?? undefined,
              // Hint offline proxy where to forward (same as /krosy)
              ...(!live && forward ? { targetUrl: forward } : {}),
            }),
          });

          let data: any = null;
          try {
            const ct = (res.headers.get("content-type") || "").toLowerCase();
            if (ct.includes("json")) {
              const j = await res.json();
              if (j?.responseXmlRaw || j?.responseXmlPreview) {
                data = { __xml: j.responseXmlRaw ?? j.responseXmlPreview };
              } else if (j?.response?.krosy) {
                data = j;
              } else if (j?.responseJsonRaw) {
                data = j.responseJsonRaw;
              } else {
                data = j;
              }
            } else if (ct.includes("xml") || ct.includes("text/xml")) {
              data = { __xml: await res.text() };
            } else {
              const raw = await res.text();
              try {
                const j2 = JSON.parse(raw);
                if (j2?.responseXmlRaw || j2?.responseXmlPreview)
                  data = { __xml: j2.responseXmlRaw ?? j2.responseXmlPreview };
                else if (j2?.response?.krosy) data = j2;
                else if (j2?.responseJsonRaw) data = j2.responseJsonRaw;
                else data = j2;
              } catch {
                data = { __xml: raw };
              }
            }
          } catch {}
          return { ok: res.ok, status: res.status, data };
        } catch {
          return { ok: false, status: 0, data: null };
        }
      });
    },
    [krosyLive]
  );

  // Detect live/offline by identity IP and expose on window for simple callers
  useEffect(() => {
    (async () => {
      const decide = (ip: string | null | undefined) => {
        const s = String(ip || "").trim();
        if (!s) return undefined;
        if (IP_ONLINE && s === IP_ONLINE) return true;
        if (IP_OFFLINE && s === IP_OFFLINE) return false;
        return undefined;
      };
      try {
        const idUrl =
          process.env.NEXT_PUBLIC_KROSY_IDENTITY_URL || "/api/krosy";
        const urls = Array.from(
          new Set([idUrl, "/api/krosy", "/api/krosy/checkpoint"])
        );
        for (const u of urls) {
          try {
            const r = await fetch(u, {
              headers: { Accept: "application/json" },
              cache: "no-store",
            });
            if (!r.ok) continue;
            const j = await r.json();
            const live = decide(j?.ip);
            if (typeof live === "boolean") {
              (window as any).__krosyLive = live;
              setKrosyLive(live);
              break;
            }
          } catch {
            /* continue */
          }
        }
        // Fallback: if running on localhost and no decision was made, treat as offline
        if (typeof (window as any).__krosyLive !== "boolean") {
          try {
            const host =
              typeof window !== "undefined" ? window.location.hostname : "";
            if (host === "localhost" || host === "127.0.0.1") {
              (window as any).__krosyLive = false;
              setKrosyLive(false);
            }
          } catch {}
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  /* ===== Acceptors ===== */
  const acceptKfb = useCallback((code: string) => {
    setKfb((prev) => {
      if (prev !== code) {
        setKsskSlots([null, null, null]);
        setKsskStatus(["idle", "idle", "idle"]);
        setShowManualFor({});
      }
      return code;
    });
    setTableCycle((n) => n + 1);
    showOk(code, "BOARD SET", "kfb");
  }, []);

  const bump = (
    i: number,
    code: string | null,
    s: "idle" | "pending" | "ok" | "error"
  ) => {
    setKsskSlots((prev) => {
      const n = [...prev];
      n[i] = code;
      return n;
    });
    setKsskStatus((prev) => {
      const n = [...prev];
      n[i] = s;
      return n;
    });
    setTableCycle((n) => n + 1);
  };

  const acceptKsskToIndex = useCallback(
    async (codeRaw: string, idx?: number) => {
      const code = digitsOnly(codeRaw);
      if (sendBusyRef.current) {
        showErr(code, "Busy — finishing previous KSK", "global");
        return;
      }
      sendBusyRef.current = true;

      try {
        // Reconcile locks with server before local duplicate check
        await reconcileLocksNow();
        const target =
          typeof idx === "number"
            ? idx
            : ksskSlots.findIndex((v) => v === null);
        const panel: PanelTarget =
          target >= 0 ? (`ksk${target}` as PanelKey) : "global";

        // 1) server is source of truth
        if (!kfb) {
          showErr(code, "Scan MAC address first", "kfb");
          return;
        }
        // disallow duplicates in current batch or any active lock for this station
        if (ksskSlots.includes(code) || activeLocks.current.has(code)) {
          showErr(code, "Already in production — cannot reuse", panel);
          return;
        }
        if (target === -1) {
          showErr(code, "Batch full (3/3)", "global");
          return;
        }

        // mark pending (no green yet)
        bump(target, code, "pending");

        // 2) acquire server lock
        const lockRes = await fetch("/api/ksk-lock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kssk: code,
            mac: kfb,
            stationId: STATION_ID,
            ttlSec: KSK_TTL_SEC,
          }),
        });

        if (!lockRes.ok) {
          const j = await lockRes.json().catch(() => ({}));
          if (
            lockRes.status === 503 &&
            String(j?.error || "").includes("redis")
          ) {
            bump(target, null, "idle");
            showErr(code, "Lock service unavailable — start Redis", panel);
            return;
          }
          const otherMac = j?.existing?.mac
            ? String(j.existing.mac).toUpperCase()
            : null;
          const heldBy = j?.existing?.stationId
            ? ` (held by ${j.existing.stationId})`
            : "";
          const msg =
            otherMac && otherMac !== String(kfb).toUpperCase()
              ? `Already in production for BOARD ${otherMac}${heldBy}`
              : `Already in production${heldBy}`;
          bump(target, null, "idle");
          showErr(code, msg, panel);
          return;
        }

        // 3) reconcile local after server ok
        activeLocks.current.add(code);
        saveLocalLocks(activeLocks.current);

        // 4) Load pin maps either from Redis (preferred) or Krosy fallback
        const macUp = String(kfb).toUpperCase();
        type Out = {
          names: Record<string, string>;
          normalPins: number[];
          latchPins: number[];
        };
        let out: Out | null = null;
        let xmlRawForName: string | null = null;
        let krosyDiag: { xml?: string; json?: any } | null = null;

        if (PREFER_ALIAS_REDIS || REQUIRE_ALIAS_REDIS) {
          try {
            const rAll = await fetch(
              `/api/aliases?mac=${encodeURIComponent(macUp)}&all=1`,
              { cache: "no-store" }
            );
            if (rAll.ok) {
              const jAll = await rAll.json();
              const items = Array.isArray(jAll?.items)
                ? (jAll.items as Array<{
                    kssk: string;
                    aliases?: Record<string, string>;
                    normalPins?: number[];
                    latchPins?: number[];
                  }>)
                : [];
              const hit = items.find(
                (it) => String(it.kssk || "").trim() === String(code)
              );
              if (hit && hit.aliases && typeof hit.aliases === "object") {
                const hasArrays =
                  Array.isArray(hit.normalPins) &&
                  (hit.normalPins as number[]).length > 0;
                // Only trust Redis when explicit pin arrays are present; do NOT derive from alias keys
                if (hasArrays) {
                  const normal = hit.normalPins as number[];
                  const latch = Array.isArray(hit.latchPins)
                    ? (hit.latchPins as number[])
                    : [];
                  out = {
                    names: hit.aliases,
                    normalPins: normal,
                    latchPins: latch,
                  };
                }
                try {
                  const rXml = await fetch(
                    `/api/aliases/xml?mac=${encodeURIComponent(macUp)}&kssk=${encodeURIComponent(code)}`,
                    { cache: "no-store" }
                  );
                  if (rXml.ok) {
                    xmlRawForName = await rXml.text();
                  }
                } catch {}
              }
            }
          } catch {}
          // Even when Redis is preferred/required, do NOT abort here.
          // We still perform a fresh Krosy call below to create logs and refresh Redis.
        }

        // If Redis had a map, still refresh from Krosy to seed logs and optionally overwrite with fresh pins
        if (out) {
          const resp = await sendKsskToOffline(code);
          if (resp?.ok) {
            const extractOpts: KrosyOpts = {
              macHint: macUp,
              includeLatch: true,
              includeLabelPrefixes: ["CL"],
              allowedMeasTypes: ["default"],
              allowedCompTypes: ["clip", "contact"],
            };
            let tmp = resp.data?.__xml
              ? extractPinsFromKrosyXML(resp.data.__xml, extractOpts)
              : extractPinsFromKrosy(resp.data, extractOpts);
            const got =
              (tmp?.normalPins?.length ?? 0) + (tmp?.latchPins?.length ?? 0) >
              0;
            if (!got) {
              const loose: KrosyOpts = {
                macHint: macUp,
                includeLatch: true,
                allowedMeasTypes: ["default"],
              };
              tmp = resp.data?.__xml
                ? extractPinsFromKrosyXML(resp.data.__xml, loose)
                : extractPinsFromKrosy(resp.data, loose);
            }
            if (
              (tmp?.normalPins?.length ?? 0) + (tmp?.latchPins?.length ?? 0) >
              0
            ) {
              out = {
                names: tmp.names || {},
                normalPins: tmp.normalPins || [],
                latchPins: tmp.latchPins || [],
              } as Out;
              try {
                xmlRawForName = resp.data?.__xml || xmlRawForName;
              } catch {}
            }
          }
        }

        if (!out) {
          const resp = await sendKsskToOffline(code);
          if (!resp?.ok && resp?.status === 0) {
            await releaseLock(code);
            bump(target, null, "idle");
            showErr(code, "Krosy communication error", panel);
            return;
          }
          const extractOpts: KrosyOpts = {
            macHint: macUp,
            includeLatch: true,
            includeLabelPrefixes: ["CL"],
            allowedMeasTypes: ["default"],
            allowedCompTypes: ["clip", "contact"],
          };
          // Primary extraction with strict label prefixes (CN/CL)
          let tmp = resp.data?.__xml
            ? extractPinsFromKrosyXML(resp.data.__xml, extractOpts)
            : extractPinsFromKrosy(resp.data, extractOpts);
          try {
            krosyDiag = resp.data?.__xml
              ? { xml: resp.data.__xml }
              : { json: resp.data };
          } catch {}
          try {
            const n1 = tmp?.normalPins?.length ?? 0,
              l1 = tmp?.latchPins?.length ?? 0;
            console.log("[SETUP] extract pass#1", {
              mac: macUp,
              ksk: code,
              normalPins: n1,
              latchPins: l1,
              opts: extractOpts,
            });
          } catch {}
          // Fallback: if no pins extracted, retry without label-prefix filter to avoid dropping valid data
          try {
            const got =
              (tmp?.normalPins?.length ?? 0) + (tmp?.latchPins?.length ?? 0) >
              0;
            if (!got) {
              const loose: KrosyOpts = {
                macHint: macUp,
                includeLatch: true,
                // accept both clip/contact but do not filter by label prefix this time
                // Keep measType strict to 'default' only per requirement; relax others
                allowedMeasTypes: ["default"],
              };
              tmp = resp.data?.__xml
                ? extractPinsFromKrosyXML(resp.data.__xml, loose)
                : extractPinsFromKrosy(resp.data, loose);
              try {
                const n2 = tmp?.normalPins?.length ?? 0,
                  l2 = tmp?.latchPins?.length ?? 0;
                console.log("[SETUP] extract pass#2 (loose)", {
                  mac: macUp,
                  ksk: code,
                  normalPins: n2,
                  latchPins: l2,
                });
              } catch {}
            }
          } catch {}
          out = {
            names: tmp.names || {},
            normalPins: tmp.normalPins || [],
            latchPins: tmp.latchPins || [],
          } as Out;
          // Log pin map using names keyed by pin
          try {
            const mapStr = Object.entries(out.names || {})
              .map(([k, v]) => [Number(k), String(v)])
              .filter(([p]) => Number.isFinite(p) && (p as number) > 0)
              .sort((a, b) => (a[0] as number) - (b[0] as number))
              .map(([p, l]) => `${p}:${l}`)
              .join(" | ");
            if (mapStr) console.log("[SETUP] pin map (by pin)", mapStr);
          } catch {}
          try {
            xmlRawForName = resp.data?.__xml || null;
          } catch {}
        }

        // Optional: set setup name if XML available
        try {
          const xml = xmlRawForName || "";
          if (xml) {
            const m = String(xml).match(/\bsetup=\"([^\"]+)\"/i);
            if (m && m[1]) setSetupName(m[1]);
          }
        } catch {}

        // No client-side alias cache; rely on Redis via aliases API

        // Also save to Redis so other clients can render after CHECK-only
        try {
          const xmlRaw = xmlRawForName || undefined;
          const hints = xmlRaw
            ? extractNameHintsFromKrosyXML(xmlRaw, macUp)
            : undefined;
          // Group/persist by response INTKSK when available (authoritative)
          let persistKsk = code;
          try {
            if (xmlRaw) {
              const m1 = xmlRaw.match(
                /<workingData\b[^>]*\bintksk=\"([^\"]+)\"/i
              );
              const m2 = xmlRaw.match(/\bksknr=\"(\d{6,})\"/i);
              const x = (m1?.[1] || m2?.[1] || "").trim();
              if (x) persistKsk = x;
            }
          } catch {}
          // If the authoritative response KSK differs from the scanned code, switch lock to the response KSK
          try {
            if (persistKsk && persistKsk !== code) {
              // Acquire lock for persistKsk
              await fetch("/api/ksk-lock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  kssk: persistKsk,
                  mac: macUp,
                  stationId: STATION_ID,
                  ttlSec: KSK_TTL_SEC,
                }),
              }).catch(() => {});
              // Release original scanned lock
              await fetch("/api/ksk-lock", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  kssk: code,
                  stationId: STATION_ID,
                  force: 1,
                }),
              }).catch(() => {});
            }
          } catch {}

          const saveResp = await fetch("/api/aliases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mac: macUp,
              ksk: persistKsk,
              aliases: out.names || {},
              normalPins: out.normalPins || [],
              latchPins: out.latchPins || [],
              xml: xmlRaw,
              hints,
            }),
          });
          if (!saveResp.ok) {
            let reason = "";
            try {
              const j = await saveResp.json();
              reason = String(j?.error || "");
            } catch {}
            // Toast-only (no intrusive overlay): inform operator to rescan
            try {
              const id = ++flashSeq.current;
              pushToast({
                id,
                kind: "error",
                panel,
                code: "SAVE FAILED",
                msg: reason || "Redis unavailable; not saved",
                ts: Date.now(),
              });
            } catch {}
            // Release lock for the response KSK and reset the slot
            try {
              await releaseLock(persistKsk);
            } catch {}
            bump(target, null, "idle");
            return;
          }

          // Toast success summary before verification
          try {
            const id = ++flashSeq.current;
            const n = out.normalPins?.length ?? 0;
            const l = out.latchPins?.length ?? 0;
            pushToast({
              id,
              kind: "success",
              panel,
              code: "Saved",
              msg: `Pins saved: ${n} normal${l ? `, ${l} latch` : ""}`,
              ts: Date.now(),
            });
          } catch {}

          // Verify persistence: ensure per‑KSK arrays were saved; otherwise surface a hard error
          try {
            const rAll = await fetch(
              `/api/aliases?mac=${encodeURIComponent(macUp)}&all=1`,
              { cache: "no-store" }
            );
            if (rAll.ok) {
              const jAll = await rAll.json();
              const items = Array.isArray(jAll?.items)
                ? (jAll.items as Array<{
                    ksk?: string;
                    kssk?: string;
                    normalPins?: number[];
                    latchPins?: number[];
                  }>)
                : [];
              const hit = items.find(
                (it) =>
                  String(((it as any).ksk ?? (it as any).kssk) || "").trim() ===
                  persistKsk
              );
              const nOk =
                Array.isArray(hit?.normalPins) &&
                (hit!.normalPins as number[]).length > 0;
              const lOk =
                Array.isArray(hit?.latchPins) &&
                (hit!.latchPins as number[]).length > 0;
              if (!nOk && !lOk) {
                // Do not proceed silently — release lock and ask user to rescan
                await releaseLock(persistKsk);
                bump(target, null, "idle");
                showErr(
                  persistKsk,
                  "Failed to persist pins in Redis. Please scan again.",
                  panel
                );
                return;
              }
            }
          } catch {}
        } catch {}

        // No local grouping persistence; dashboard derives from Redis

        const hasPins =
          !!out &&
          (out.normalPins?.length ?? 0) + (out.latchPins?.length ?? 0) > 0;
        if (!hasPins) {
          // Optional auto-retry on no pins
          const RETRIES = Math.max(
            0,
            Number(process.env.NEXT_PUBLIC_SETUP_EXTRACT_RETRIES ?? "1")
          );
          const RETRY_DELAY_MS = Math.max(
            100,
            Number(process.env.NEXT_PUBLIC_SETUP_EXTRACT_RETRY_MS ?? "600")
          );
          let retried = 0;
          while (retried < RETRIES) {
            retried++;
            try {
              console.warn("[SETUP] no pins — retry", retried);
            } catch {}
            await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
            const again = await sendKsskToOffline(code);
            if (again?.ok) {
              const strict: KrosyOpts = {
                macHint: macUp,
                includeLatch: true,
                includeLabelPrefixes: ["CL"],
                allowedMeasTypes: ["default"],
                allowedCompTypes: ["clip", "contact"],
              };
              let tmp2 = again.data?.__xml
                ? extractPinsFromKrosyXML(again.data.__xml, strict)
                : extractPinsFromKrosy(again.data, strict);
              if (
                (tmp2?.normalPins?.length ?? 0) +
                  (tmp2?.latchPins?.length ?? 0) ===
                0
              ) {
                const loose2: KrosyOpts = {
                  macHint: macUp,
                  includeLatch: true,
                  allowedMeasTypes: ["default"],
                };
                tmp2 = again.data?.__xml
                  ? extractPinsFromKrosyXML(again.data.__xml, loose2)
                  : extractPinsFromKrosy(again.data, loose2);
              }
              if (
                (tmp2?.normalPins?.length ?? 0) +
                  (tmp2?.latchPins?.length ?? 0) >
                0
              ) {
                out = {
                  names: tmp2.names || {},
                  normalPins: tmp2.normalPins || [],
                  latchPins: tmp2.latchPins || [],
                } as Out;
                try {
                  xmlRawForName = again.data?.__xml || xmlRawForName;
                } catch {}
                break;
              }
            }
          }
          const nowPins =
            !!out &&
            (out.normalPins?.length ?? 0) + (out.latchPins?.length ?? 0) > 0;
          if (!nowPins) {
            try {
              const meta = {
                mac: macUp,
                ksk: code,
                normalPins: out?.normalPins?.length ?? 0,
                latchPins: out?.latchPins?.length ?? 0,
                haveXml: !!xmlRawForName && xmlRawForName.length,
              };
              const summarizeXml = (xml: string) => {
                try {
                  const seqCount = (xml.match(/<sequence\b/gi) || []).length;
                  const meas = Array.from(
                    new Set(
                      (xml.match(/\bmeasType=\"([^\"]*)\"/gi) || []).map((s) =>
                        s.replace(/^.*measType=\"|\"$/g, "")
                      )
                    )
                  );
                  const comp = Array.from(
                    new Set(
                      (xml.match(/<compType>([^<]*)<\/compType>/gi) || []).map(
                        (s) => s.replace(/^.*<compType>|<\/compType>.*$/g, "")
                      )
                    )
                  );
                  const macs = Array.from(
                    new Set(
                      (xml.match(/<objGroup>[^<]*<\/objGroup>/gi) || [])
                        .map((s) =>
                          (
                            s.match(/\(([0-9A-F:]{17})\)/i)?.[1] || ""
                          ).toUpperCase()
                        )
                        .filter(Boolean)
                    )
                  );
                  return { seqCount, measTypes: meas, compTypes: comp, macs };
                } catch {
                  return null;
                }
              };
              const summarizeJson = (j: any) => {
                try {
                  const vc = j?.response?.krosy?.body?.visualControl;
                  const wd = vc?.workingData || vc?.loadedData;
                  const seg = wd?.sequencer?.segmentList?.segment;
                  const take = (n: any) =>
                    Array.isArray(n) ? n : n != null ? [n] : [];
                  const seqs = take(seg).flatMap((s: any) =>
                    take(s?.sequenceList?.sequence)
                  );
                  const meas = Array.from(
                    new Set(
                      seqs
                        .map((s: any) =>
                          String(s?.measType ?? "").toLowerCase()
                        )
                        .filter(Boolean)
                    )
                  );
                  const comp = Array.from(
                    new Set(
                      seqs
                        .map((s: any) =>
                          String(s?.compType ?? "").toLowerCase()
                        )
                        .filter(Boolean)
                    )
                  );
                  const groups = Array.from(
                    new Set(
                      seqs
                        .map((s: any) => String(s?.objGroup ?? ""))
                        .filter(Boolean)
                    )
                  );
                  return {
                    seqCount: seqs.length,
                    measTypes: meas,
                    compTypes: comp,
                    objGroups: groups,
                  };
                } catch {
                  return null;
                }
              };
              const diag = krosyDiag?.xml
                ? summarizeXml(krosyDiag.xml)
                : summarizeJson(krosyDiag?.json);
              console.warn("[SETUP] NO PINS after extraction (final)", {
                ...meta,
                diag,
              });
            } catch {}
            await releaseLock(code);
            bump(target, null, "idle");
            showErr(code, "No pins extracted. Please scan again.", panel);
            return;
          }
        }

        // 5) ESP
        let espOk = true;
        try {
          const r = await fetch("/api/serial", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              normalPins: out.normalPins,
              latchPins: out.latchPins,
              mac: macUp,
              kssk: code,
            }),
          });
          if (!r.ok) {
            espOk = false;
            showErr(
              code,
              `ESP write failed — ${await r.text().catch(() => String(r.status))}`,
              panel
            );
          }
        } catch (e: any) {
          espOk = false;
          showErr(
            code,
            `ESP write failed — ${e?.message ?? "unknown error"}`,
            panel
          );
        }

        if (!espOk && !ALLOW_NO_ESP) {
          await releaseLock(code);
          bump(target, code, "error");
          return;
        }

        // success
        startHeartbeat(code);
        showOk(code, espOk ? "KSK OK" : "KSK OK (ESP offline)", panel);
        bump(target, code, "ok");
      } finally {
        sendBusyRef.current = false;
      }
    },
    [kfb, ksskSlots, sendKsskToOffline]
  );

  const handleManualSubmit = useCallback(
    (panel: PanelKey, raw: string) => {
      const { type, code } = classify(raw);
      if (!type) {
        showErr(raw, "Unrecognized code", panel);
        return;
      }
      if (panel === "kfb") {
        if (type !== "kfb") {
          showErr(code, "Expected ESP MAC (AA:BB:CC:DD:EE:FF)", "kfb");
          return;
        }
        acceptKfb(code);
      } else {
        if (type !== "kssk") {
          showErr(code, "Expected KSK (12 digits)", panel);
          return;
        }
        const idx = Number(panel.slice(-1)) as KskIndex;
        void acceptKsskToIndex(code, idx);
      }
      setShowManualFor((s) => ({ ...s, [panel]: false }));
    },
    [acceptKfb, acceptKsskToIndex]
  );

  const handleScanned = useCallback(
    (raw: string) => {
      const { type, code } = classify(raw);
      const nextIdx = ksskSlots.findIndex((v) => v === null);
      const defaultKskPanel: PanelKey = (
        nextIdx >= 0 ? `ksk${nextIdx}` : "ksk0"
      ) as PanelKey;
      const defaultPanel: PanelTarget = !kfb ? "kfb" : defaultKskPanel;

      if (!type) {
        showErr(code || raw, "Unrecognized code", defaultPanel);
        return;
      }
      if (type === "kfb") acceptKfb(code);
      else void acceptKsskToIndex(code);
    },
    [kfb, ksskSlots, acceptKfb, acceptKsskToIndex]
  );

  // ---- Serial scanner integration (SSE) ----
  const serial = useSerialEvents();
  const SETUP_SCANNER_INDEX = Number(
    process.env.NEXT_PUBLIC_SCANNER_INDEX_SETUP ?? "1"
  );
  const pathsEqual = (a?: string | null, b?: string | null) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const ta = a.split("/").pop() || a;
    const tb = b.split("/").pop() || b;
    if (ta === tb || a.endsWith(tb) || b.endsWith(ta)) return true;
    // Heuristic: match ACM/USB numeric suffix equivalence
    const num = (s: string) => {
      const m = s.match(/(ACM|USB)(\d+)/i);
      return m ? `${m[1].toUpperCase()}${m[2]}` : null;
    };
    const na = num(a) || num(ta);
    const nb = num(b) || num(tb);
    return !!(na && nb && na === nb);
  };
  const resolveDesiredPath = (): string | null => {
    const list = serial.scannerPaths || [];
    if (list[SETUP_SCANNER_INDEX]) return list[SETUP_SCANNER_INDEX] || null;
    // Do not guess a device path; wait until scanner paths are discovered
    return null;
  };
  const desiredPath = resolveDesiredPath();
  const desiredTail = (desiredPath || "").split("/").pop() || desiredPath || "";
  const findPortState = () => {
    const map = serial.scannerPorts || ({} as any);
    const key = Object.keys(map).find((k) => pathsEqual(k, desiredPath || ""));
    return key
      ? ((map as any)[key] as { open: boolean; present: boolean })
      : null;
  };
  const desiredState = findPortState();
  useEffect(() => {
    if (!serial.lastScanTick) return;
    const raw = String(serial.lastScan || "").trim();
    if (!raw) return;
    const want = resolveDesiredPath();
    const seen = serial.lastScanPath;
    if (want && seen && !pathsEqual(seen, want)) return; // ignore other scanner paths
    // Accept scanner input regardless of current focus
    handleScanned(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial.lastScanTick]);

  // ---- Polling fallback when SSE is not connected ----
  useEffect(() => {
    if (serial.sseConnected) return; // rely on SSE when available
    let stopped = false;
    let timer: number | null = null;
    let ctrl: AbortController | null = null;
    const tick = async () => {
      try {
        ctrl = new AbortController();
        const want = resolveDesiredPath();
        const url = want
          ? `/api/serial/scanner?path=${encodeURIComponent(want)}`
          : "/api/serial/scanner";
        const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        if (r.ok) {
          const { code, retryInMs } = await r.json();
          const raw = typeof code === "string" ? code.trim() : "";
          if (raw) handleScanned(raw);
          const next =
            typeof retryInMs === "number" && retryInMs > 0 ? retryInMs : 1500;
          if (!stopped) timer = window.setTimeout(tick, next);
        } else if (!stopped) timer = window.setTimeout(tick, 1800);
      } catch {
        if (!stopped) timer = window.setTimeout(tick, 2000);
      }
    };
    tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      if (ctrl) ctrl.abort();
    };
  }, [serial.sseConnected, handleScanned]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "Enter") {
        if (kbdBuffer.trim()) {
          handleScanned(kbdBuffer.trim());
          setKbdBuffer("");
        }
      } else if (e.key.length === 1)
        setKbdBuffer((s) => (s + e.key).slice(-128));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kbdBuffer, handleScanned]);

  useEffect(() => {
    if (KEEP_LOCKS_ON_UNLOAD) return;
    const h = () => {
      activeLocks.current.forEach((k) => {
        fetch("/api/ksk-lock", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kssk: k, stationId: STATION_ID }),
          keepalive: true,
        }).catch(() => {});
      });
    };
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, []);

  /* ===== Styles ===== */
  const fontStack =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"';

  const page: CSSProperties = {
    minHeight: "100vh",
    display: "grid",
    gap: 16,
    alignContent: "start",
    background: "#ffffff",
    padding: "18px 16px 40px",
    fontFamily: fontStack,
  };
  const containerWide: CSSProperties = {
    width: "min(1280px, 100%)",
    margin: "0 auto",
  };

  const hero: CSSProperties = {
    ...containerWide,
    border: "1px solid #edf2f7",
    background: "#fff",
    borderRadius: 16,
    padding: 16,
    display: "grid",
    gap: 6,
  };
  const heroTopRow: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  };
  const heroLeft: CSSProperties = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  };
  const heroBoard: CSSProperties = {
    fontSize: 44,
    fontWeight: 1000,
    letterSpacing: "0.01em",
    color: "#0f172a",
    textTransform: "uppercase",
  };
  const modeBadgeBase =
    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold";

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
  const scannerPillBase: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 999,
    border: "2px solid transparent",
    fontSize: 14,
    fontWeight: 1000,
  };
  const scannerPillGreen: CSSProperties = {
    ...scannerPillBase,
    border: "2px solid #86efac", // green-300
    background: "rgba(16,185,129,0.10)", // emerald-500 @ 10%
    color: "#065f46", // emerald-900
  };
  const scannerPillRed: CSSProperties = {
    ...scannerPillBase,
    border: "2px solid #fca5a5", // red-300
    background: "rgba(239,68,68,0.10)", // red-500 @ 10%
    color: "#7f1d1d", // red-900
  };

  const section: CSSProperties = { ...containerWide, display: "grid", gap: 10 };
  const card: CSSProperties = {
    border: "1px solid #edf2f7",
    borderRadius: 16,
    background: "#fff",
    padding: 18,
    display: "grid",
    gap: 12,
  };
  const eyebrow: CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.08em",
    color: "#64748b",
    textTransform: "uppercase",
    fontWeight: 800,
  };
  const heading: CSSProperties = {
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: "0.01em",
    color: "#0f172a",
  };

  const slotsGrid: CSSProperties = {
    display: "grid",
    gap: 14,
    gridTemplateColumns: "repeat(3, minmax(220px, 1fr))",
  };

  const hint: CSSProperties = {
    fontSize: 12,
    color: "#2563eb",
    textDecoration: "underline",
    cursor: "pointer",
    fontWeight: 700,
  };
  const input: CSSProperties = {
    width: "100%",
    height: 46,
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    padding: "0 12px",
    fontSize: 18,
    outline: "none",
    background: "#fff",
    color: "#0f172a",
    caretColor: "#0f172a",
  };

  // ✅ progress counts only OK slots
  const ksskOkCount = ksskStatus.filter((s) => s === "ok").length;

  // auto-reset after 3 OK (wait a bit so highlight is visible)
  useEffect(() => {
    if (!kfb) return;
    if (ksskOkCount === 3) {
      const t = setTimeout(() => {
        setLastError(null);
        setKfb(null);
        setKsskSlots([null, null, null]);
        setKsskStatus(["idle", "idle", "idle"]);
        setShowManualFor({});
        setTableCycle((n) => n + 1);
        setSetupName("");
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [ksskOkCount, kfb]);

  return (
    <main style={page}>
      <ZoomControls label="Setup" position="br" value={setupZoom} onChange={setSetupZoom} applyToBody />
      {/* HERO */}
      <m.section layout style={hero} aria-live="polite">
        {!kfb ? (
          <>
            <m.div layout style={heroLeft}>
              <m.div
                layout
                initial={{ y: prefersReduced ? 0 : 6, opacity: 0.0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 520,
                  damping: 30,
                  mass: 0.7,
                }}
                style={heroBoard}
              >
                {setupName ? `SETUP: ${setupName}` : ""}
              </m.div>
              <span
                className={`${modeBadgeBase} ${(krosyLive ?? (typeof window !== "undefined" && (window as any).__krosyLive === true)) ? "border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200" : "border border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200"}`}
              >
                {(krosyLive ??
                (typeof window !== "undefined" &&
                  (window as any).__krosyLive === true))
                  ? "ONLINE"
                  : "OFFLINE"}
              </span>
            </m.div>
            {desiredTail && (
              <div className="mt-2 flex flex-wrap gap-2">
                {desiredTail &&
                  (() => {
                    const present = !!desiredState?.present;
                    const badgeBase =
                      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold";
                    const badgeColor = present
                      ? "border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
                      : "border border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200";
                    return (
                      <span
                        className={`${badgeBase} ${badgeColor}`}
                        title={desiredPath || undefined}
                      >
                        Scanner: {desiredTail}
                        <span
                          className={
                            present ? "text-emerald-700" : "text-red-700"
                          }
                        >
                          {present ? "detected" : "not detected"}
                        </span>
                      </span>
                    );
                  })()}
                {(() => {
                  const ready = !!serial.redisReady;
                  const badgeBase =
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] md:text-[13px] font-extrabold";
                  const badgeColor = ready
                    ? "border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
                    : "border border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200";
                  return (
                    <span
                      className={`${badgeBase} ${badgeColor}`}
                      title={ready ? "Redis connected" : "Redis offline"}
                    >
                      Redis:
                      <span
                        className={ready ? "text-emerald-700" : "text-red-700"}
                      >
                        {ready ? "connected" : "offline"}
                      </span>
                    </span>
                  );
                })()}
              </div>
            )}
          </>
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
                {ksskOkCount}/3 KSK
              </m.div>
              {/* Scanner pill requested under SETUP title; omit here to reduce noise */}
            </m.div>

            {ksskOkCount >= 1 && (
              <m.div layout>
                <StepBadge
                  label="SCAN NEW BOARD TO START OVER"
                  onClick={resetAll}
                />
              </m.div>
            )}
          </m.div>
        )}
      </m.section>

      {/* Step 1: KFB */}
      <AnimatePresence initial={false}>
        {!kfb && (
          <m.section
            key="kfb-stage"
            style={section}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: prefersReduced ? 0 : 0.14,
              ease: "easeOut",
            }}
          >
            <m.section layout style={card}>
              {/* {allowManual && (
                <button
                  type="button"
                  style={{
                    ...hint,
                    justifySelf: "start",
                    background: "transparent",
                    border: 0,
                  }}
                  onClick={() =>
                    setShowManualFor((s) => ({ ...s, kfb: !s.kfb }))
                  }
                >
                  Enter manually
                </button>
              )} */}

              <AnimatePresence initial={false}>
                {showManualFor.kfb && allowManual && (
                  <m.div
                    key="kfb-manual"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: prefersReduced ? 0 : 0.14 }}
                  >
                    <ManualInput
                      placeholder="Type ESP MAC e.g. 08:3A:8D:15:27:54"
                      onSubmit={(v) => handleManualSubmit("kfb", v)}
                      inputStyle={input}
                    />
                  </m.div>
                )}
              </AnimatePresence>
            </m.section>
          </m.section>
        )}
      </AnimatePresence>

      {/* Step 2: KSK */}
      {kfb && (
        <section style={section}>
          <section style={card}>
            <div style={{ display: "grid", gap: 4 }}>
              <span style={eyebrow}>Step 2</span>
              <h2 style={heading}>KSK</h2>
            </div>

            <div style={slotsGrid}>
              {([0, 1, 2] as const).map((idx) => {
                const code = ksskSlots[idx];
                const status = ksskStatus[idx];
                // only light the slot that matches, not "global"
                const hit = flash && flash.panel === (`ksk${idx}` as PanelKey);
                return (
                  <KsskSlotCompact
                    key={idx}
                    index={idx}
                    code={code}
                    status={status}
                    onManualToggle={() =>
                      setShowManualFor((s) => ({
                        ...s,
                        [`ksk${idx}`]: !s[`ksk${idx}`],
                      }))
                    }
                    manualOpen={!!(showManualFor as any)[`ksk${idx}`]}
                    onSubmit={(v) => handleManualSubmit(`ksk${idx}`, v)}
                    onForceClear={async () => {
                      const kssk = ksskSlots[idx];
                      const macUp = (kfb || "").toUpperCase();
                      if (!kssk || !macUp) return;
                      try {
                        await fetch("/api/aliases/clear", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ mac: macUp, ksk: kssk }),
                        }).catch(() => {});
                      } catch {}
                      try {
                        await releaseLock(kssk);
                      } catch {}
                      activeLocks.current.delete(kssk);
                      setKsskSlots((prev) => {
                        const n = [...prev];
                        n[idx] = null;
                        return n;
                      });
                      setKsskStatus((prev) => {
                        const n = [...prev] as Array<(typeof prev)[number]>;
                        n[idx] = "idle";
                        return n;
                      });
                      fireFlash(
                        "success",
                        kssk,
                        `ksk${idx}` as PanelKey,
                        "Cleared"
                      );
                    }}
                    flashKind={undefined}
                    flashId={undefined}
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
          ksskCount={ksskOkCount}
          ksskTarget={3}
          boardName={kfb}
          boardMap={{}}
          okAppearDelayMs={350}
          swapDelayMs={1400}
          flashSeq={0}
        />
      </div>

      <ToastStack
        items={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />

      {/* Overlay */}
      <ResultOverlay
        open={overlay.open}
        kind={overlay.kind}
        code={overlay.code}
        msg={overlay.msg}
        seq={overlay.seq}
        excludeRef={tableRef}
        onClose={() => setOverlay((o) => ({ ...o, open: false }))}
        anchor={overlay.anchor}
      />
    </main>
  );
}

/* ================= Components ================= */

type Props = {
  ariaLabel: string;
  height?: number;
  flashKind?: "success" | "error" | null;
  flashId?: number;
};

function ScanBoxAnimated({
  ariaLabel,
  height = 176,
  flashKind,
  flashId,
}: Props) {
  const isOk = flashKind === "success";
  const isErr = flashKind === "error";
  const ring = isOk
    ? "rgba(34,197,94,.30)"
    : isErr
      ? "rgba(239,68,68,.30)"
      : "transparent";
  const tint = isOk
    ? "rgba(34,197,94,.08)"
    : isErr
      ? "rgba(239,68,68,.08)"
      : "transparent";
  const slabH = Math.max(104, Math.min(Math.round(height * 0.6), 128));

  return (
    <div aria-label={ariaLabel}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height,
          borderRadius: 16,
          overflow: "hidden",
          background: "#0b1220",
          border: "1px solid #1f2937",
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,.06), 0 10px 24px rgba(0,0,0,.25)",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.22,
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(148,163,184,.28) 0 1px, transparent 1px 12px)",
            backgroundSize: "120px 100%",
          }}
        />
        {(isOk || isErr) && (
          <m.div
            key={flashId ?? flashKind}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              position: "absolute",
              inset: 0,
              boxShadow: `0 0 0 6px ${ring} inset`,
              background: tint,
            }}
          />
        )}
        {(["tl", "tr", "bl", "br"] as const).map((pos) => (
          <div
            key={pos}
            aria-hidden
            style={{
              position: "absolute",
              width: 18,
              height: 18,
              ...(pos === "tl" && {
                left: 10,
                top: 10,
                borderLeft: "2px solid #e5e7eb",
                borderTop: "2px solid #e5e7eb",
              }),
              ...(pos === "tr" && {
                right: 10,
                top: 10,
                borderRight: "2px solid #e5e7eb",
                borderTop: "2px solid #e5e7eb",
              }),
              ...(pos === "bl" && {
                left: 10,
                bottom: 10,
                borderLeft: "2px solid #e5e7eb",
                borderBottom: "2px solid #e5e7eb",
              }),
              ...(pos === "br" && {
                right: 10,
                bottom: 10,
                borderRight: "2px solid #e5e7eb",
                borderBottom: "2px solid #e5e7eb",
              }),
              opacity: 0.7,
              borderRadius: 2,
            }}
          />
        ))}

        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            width: "min(100%, 1100px)",
            height: slabH,
            borderRadius: 12,
            background:
              "repeating-linear-gradient(90deg, rgba(255,255,255,.96) 0 7px, transparent 7px 15px)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 0 rgba(255,255,255,.18)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 12,
              background:
                "linear-gradient(90deg, rgba(11,18,32,1) 0, rgba(11,18,32,0) 8%, rgba(11,18,32,0) 92%, rgba(11,18,32,1) 100%)",
              pointerEvents: "none",
            }}
          />
        </div>

        <div
          aria-label="KFB WIRELESS"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: 6,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily:
                'Inter, ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial',
              textTransform: "uppercase",
              letterSpacing: 3,
              fontWeight: 700,
              fontSize: 12,
              color: "#ffffff",
              opacity: 0.6,
              textShadow: "0 1px 0 rgba(0,0,0,.35)",
              userSelect: "none",
            }}
          >
            KFB WIRELESS
          </span>
        </div>
      </div>
    </div>
  );
}

/* ===== KSK slots ===== */
const KsskSlotCompact = memo(function KsskSlotCompact({
  index,
  code,
  status,
  manualOpen,
  onManualToggle,
  onSubmit,
  onForceClear,
  flashKind,
  flashId,
}: {
  index: 0 | 1 | 2;
  code: string | null;
  status: "idle" | "pending" | "ok" | "error";
  manualOpen: boolean;
  onManualToggle: () => void;
  onSubmit: (v: string) => void;
  onForceClear?: () => void;
  flashKind?: "success" | "error" | null;
  flashId?: number;
}) {
  const prefersReduced = useReducedMotion();

  const isOk = status === "ok";
  const isErr = status === "error";
  const isPending = status === "pending";

  const cardBg = isOk ? "#f0fdf4" : isErr ? "#fef2f2" : "#fbfdff";
  const ring = isOk
    ? "0 0 0 6px rgba(16,185,129,0.22)"
    : isErr
      ? "0 0 0 6px rgba(239,68,68,0.22)"
      : isPending
        ? "0 0 0 6px rgba(37,99,235,0.18)"
        : "none";
  const border = isOk ? "#a7f3d0" : isErr ? "#fecaca" : "#edf2f7";

  return (
    <m.div
      key={flashId ?? `slot-${index}`}
      initial={false}
      animate={
        isErr && !prefersReduced ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#eef6ff",
            border: "1px solid #d9e7ff",
            display: "grid",
            placeItems: "center",
          }}
        >
          <span style={{ fontSize: 24, fontWeight: 1000, color: "#0b1220" }}>
            {index + 1}
          </span>
        </div>
        <StateIcon
          state={isOk ? "valid" : isErr ? "invalid" : "idle"}
          size={40}
        />
      </div>

      {/* code pill */}
      <div>
        <CodePill
          value={code || "—"}
          highlight={isErr ? "danger" : isOk ? "success" : "neutral"}
          big
        />
      </div>

      {/* pending hint */}
      {isPending && (
        <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.7 }}>
          Processing…
        </div>
      )}

      {/* static scan stripes */}
      <div
        aria-label={`KSK scan zone ${index + 1}`}
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
            background:
              "repeating-linear-gradient(90deg,#8aa0b8 0 6px,transparent 6px 14px)",
            opacity: 0.9,
          }}
        />
      </div>

      {/* <button
        type="button"
        onClick={onManualToggle}
        style={{
          fontSize: 12,
          color: "#2563eb",
          textDecoration: "underline",
          cursor: "pointer",
          fontWeight: 700,
          background: "transparent",
          border: 0,
          justifySelf: "start",
        }}
      >
        Enter manually
      </button> */}

      {/* {code && (
        <button
          type="button"
          onClick={onForceClear}
          style={{
            fontSize: 12,
            color: "#b91c1c",
            textDecoration: "underline",
            cursor: "pointer",
            fontWeight: 800,
            background: "transparent",
            border: 0,
            justifySelf: "start",
          }}
          aria-label={`Force clear KSK ${code}`}
          title="Force-clear this KSK (lock + aliases)"
        >
          Force clear
        </button>
      )} */}

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
              placeholder={`Type KSK for slot ${index + 1}`}
              onSubmit={onSubmit}
              inputStyle={{
                width: "100%",
                height: 46,
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                padding: "0 12px",
                fontSize: 18,
                outline: "none",
                background: "#fff",
                color: "#0f172a",
                caretColor: "#0f172a",
              }}
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
          />
        )}
      </AnimatePresence>
    </m.div>
  );
});

/* ===== Shared bits ===== */

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
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 3}
          fill="#ffffff"
          stroke="#d1d9e6"
          strokeWidth="3"
        />
      </svg>
    );
  if (state === "valid")
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="32" fill="#10b981" />
        <path
          d="M18 34l10 9L46 22"
          fill="none"
          stroke="white"
          strokeWidth="7"
          strokeLinecap="round"
        />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="28" fill="#ef4444" />
      <path
        d="M18 18l20 20M38 18l-20 20"
        stroke="white"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
    gap: 10,
    padding: "10px 14px",
    borderRadius: 999,
    background: "#fff",
    border: "1px solid #e6eef7",
    boxShadow: "0 2px 6px rgba(15,23,42,0.04)",
    cursor: onClick ? "pointer" : "default",
    userSelect: "none",
  };
  const text: CSSProperties = {
    fontSize: 14,
    fontWeight: 900,
    color: "#0f172a",
    whiteSpace: "nowrap",
    letterSpacing: "0.02em",
  };
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
      <circle
        cx="24"
        cy="24"
        r="22"
        fill="#e6f6ff"
        stroke="#c7e2ff"
        strokeWidth="2"
      />
      <path
        d="M18 16 L30 24 L18 32"
        fill="none"
        stroke="#0f172a"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
      ? {
          bg: "rgba(16,185,129,0.08)",
          bd: "#a7f3d0",
          fg: "#065f46",
          dot: "linear-gradient(180deg,#34d399,#10b981)",
          ring: "rgba(16,185,129,0.18)",
        }
      : highlight === "danger"
        ? {
            bg: "rgba(239,68,68,0.08)",
            bd: "#fecaca",
            fg: "#7f1d1d",
            dot: "linear-gradient(180deg,#fb7185,#ef4444)",
            ring: "rgba(239,68,68,0.18)",
          }
        : {
            bg: "rgba(2,6,23,0.04)",
            bd: "#dbe3ee",
            fg: "#0f172a",
            dot: "linear-gradient(180deg,#cbd5e1,#94a3b8)",
            ring: "rgba(2,6,23,0.06)",
          };

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

function ToastStack({
  items,
  onDismiss,
}: {
  items: FlashEvent[];
  onDismiss: (id: number) => void;
}) {
  const [hover, setHover] = useState(false);
  const latest = items[items.length - 1] ?? null;
  if (!latest) return null;

  const errors = items.filter((t) => t.kind === "error");
  const isLatestErr = latest.kind === "error";
  const hiddenErrCount = Math.max(0, errors.length - (isLatestErr ? 1 : 0));
  const history = errors
    .filter((e) => !(isLatestErr && e.id === latest.id))
    .slice(-10)
    .reverse();

  const ok = latest.kind === "success";
  const fg = ok ? "#065f46" : "#7f1d1d";
  const bg = ok
    ? "linear-gradient(180deg,#ecfdf5,#d1fae5)"
    : "linear-gradient(180deg,#fef2f2,#fee2e2)";
  const bd = ok ? "#a7f3d0" : "#fecaca";

  const cardW = 520;
  const reserveH = 72;
  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour12: false });
  const isOpen = hover && history.length > 0;

  const clearAll = () => {
    items.forEach((t) => onDismiss(t.id));
    setHover(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 90,
        pointerEvents: "auto",
      }}
      aria-live="polite"
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          position: "relative",
          width: cardW,
          height: reserveH,
          paddingBottom: isOpen ? 8 : 0,
        }}
      >
        <AnimatePresence initial={false}>
          <m.div
            key={latest.id}
            initial={{ opacity: 0, x: 8, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{
              position: "absolute",
              inset: 0,
              background: bg,
              border: `3px solid ${bd}`,
              borderRadius: 14,
              padding: "16px 20px",
              boxShadow: "0 10px 28px rgba(15,23,42,0.22)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: ok
                  ? "linear-gradient(180deg,#34d399,#10b981)"
                  : "linear-gradient(180deg,#fb7185,#ef4444)",
                boxShadow: `0 0 0 2px ${ok ? "rgba(16,185,129,0.22)" : "rgba(239,68,68,0.22)"}`,
              }}
            />
            <div
              style={{
                color: fg,
                fontSize: 16,
                fontWeight: 900,
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {ok ? "OK" : "ERROR"} — {latest.code}
              {latest.msg ? ` — ${latest.msg}` : ""}
            </div>
            <time
              dateTime={new Date(latest.ts).toISOString()}
              style={{
                marginLeft: 8,
                color: fg,
                opacity: 0.75,
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {fmtTime(latest.ts)}
            </time>
            {isLatestErr && hiddenErrCount > 0 && (
              <span
                title={`${hiddenErrCount} more errors`}
                style={{
                  marginLeft: 8,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "linear-gradient(180deg,#fecaca,#fca5a5)",
                  border: "1px solid #fecaca",
                  color: "#7f1d1d",
                  fontWeight: 900,
                  fontSize: 12,
                }}
              >
                +{hiddenErrCount}
              </span>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => onDismiss(latest.id)}
              style={{
                marginLeft: "auto",
                border: 0,
                background: "transparent",
                cursor: "pointer",
                fontSize: 20,
                color: fg,
              }}
            >
              ×
            </button>
          </m.div>
        </AnimatePresence>

        <AnimatePresence>
          {isOpen && (
            <m.div
              key="toast-history"
              initial={{ height: 0, opacity: 0, y: 0 }}
              animate={{ height: "auto", opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                width: "100%",
                overflow: "hidden",
                borderRadius: 16,
                border: "2px solid #fecaca",
                background: "linear-gradient(180deg,#fff5f5,#fee2e2)",
                boxShadow: "0 16px 36px rgba(15,23,42,0.18)",
              }}
            >
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.65)",
                  backdropFilter: "saturate(160%) blur(8px)",
                  WebkitBackdropFilter: "saturate(160%) blur(8px)",
                  borderBottom: "1px solid #ffdada",
                  color: "#7f1d1d",
                  fontWeight: 900,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: "linear-gradient(180deg,#fb7185,#ef4444)",
                      boxShadow: "0 0 0 2px rgba(239,68,68,.22)",
                    }}
                  />
                  Recent errors
                  <span
                    style={{
                      marginLeft: 8,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "#ffe4e6",
                      border: "1px solid #fecaca",
                      fontSize: 12,
                      fontWeight: 900,
                    }}
                  >
                    {history.length} shown
                  </span>
                </span>
                <button
                  type="button"
                  onClick={clearAll}
                  style={{
                    marginLeft: "auto",
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid #fecaca",
                    background: "linear-gradient(180deg,#ffe4e6,#ffd7db)",
                    color: "#7f1d1d",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Clear all
                </button>
              </div>

              <div
                style={{
                  maxHeight: 340,
                  overflowY: "auto",
                  padding: "10px 12px 12px",
                }}
              >
                {history.map((t, i) => (
                  <m.div
                    key={t.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.025, duration: 0.16 }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      background:
                        "linear-gradient(180deg,#ffffff,rgba(255,255,255,0.75))",
                      border: "1px solid #ffe1e1",
                      borderRadius: 12,
                      color: "#7f1d1d",
                      fontWeight: 800,
                      boxShadow: "0 1px 0 rgba(255,255,255,0.65) inset",
                      marginBottom: 8,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 999,
                        background: "linear-gradient(180deg,#fb7185,#ef4444)",
                        boxShadow: "0 0 0 2px rgba(239,68,68,.18)",
                      }}
                    />
                    <div
                      style={{
                        minWidth: 0,
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ERROR — {t.code}
                      {t.msg ? ` — ${t.msg}` : ""}
                    </div>
                    <time
                      dateTime={new Date(t.ts).toISOString()}
                      style={{
                        fontSize: 12,
                        fontWeight: 900,
                        opacity: 0.75,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "#ffe8ea",
                        border: "1px solid #ffd2d6",
                      }}
                    >
                      {fmtTime(t.ts)}
                    </time>
                  </m.div>
                ))}
              </div>

              <div
                aria-hidden
                style={{
                  position: "sticky",
                  bottom: 0,
                  height: 18,
                  pointerEvents: "none",
                  background:
                    "linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.55))",
                  borderTop: "1px solid rgba(255,255,255,.4)",
                }}
              />
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

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
  excludeRef?: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>;
  anchor: "table" | "viewport";
}) {
  const [hole, setHole] = useState<SpotlightRect | null>(null);
  const [vw, setVw] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setVw(window.innerWidth || 0);
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!open || anchor !== "table") return;
    const calc = () => {
      const el = excludeRef?.current || null;
      if (!el) {
        setHole(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setHole({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    calc();
    const opts = { passive: true } as AddEventListenerOptions;
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(calc) : null;
    if (ro && excludeRef?.current) ro.observe(excludeRef.current);
    window.addEventListener("scroll", calc, opts);
    window.addEventListener("resize", calc, opts);
    return () => {
      window.removeEventListener("scroll", calc, opts as any);
      window.removeEventListener("resize", calc, opts as any);
      ro?.disconnect();
    };
  }, [open, excludeRef, seq, anchor]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
  }, [open, seq, onClose]);

  if (!open) return null;

  const isOk = kind === "success";
  const CURTAIN = isOk ? "rgba(16,185,129,.45)" : "rgba(239,68,68,.45)";
  const ACCENT_SOFT = isOk ? "rgba(16,185,129,.28)" : "rgba(239,68,68,.28)";

  const haveHole = anchor === "table" && hole;
  return (
    <AnimatePresence>
      <m.div
        key={seq}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 80,
          pointerEvents: "none",
        }}
        aria-live="assertive"
        aria-label={isOk ? "OK" : "ERROR"}
      >
        {haveHole ? (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                height: hole!.top,
                background: CURTAIN,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: hole!.top,
                width: hole!.left,
                height: hole!.height,
                background: CURTAIN,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: hole!.left + hole!.width,
                right: 0,
                top: hole!.top,
                height: hole!.height,
                background: CURTAIN,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: hole!.top + hole!.height,
                bottom: 0,
                background: CURTAIN,
              }}
            />
          </>
        ) : anchor === "table" ? (
          <div
            style={{ position: "absolute", inset: 0, background: CURTAIN }}
          />
        ) : null}
      </m.div>
    </AnimatePresence>
  );
}

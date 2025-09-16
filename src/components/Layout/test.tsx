"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  FormEvent,
  startTransition,
} from "react";
import { BranchDisplayData, KfbInfo, TestStatus } from "@/types/types";
import { Header } from "@/components/Header/Header";
import BranchDashboardMainContent from "@/components/Program/BranchDashboardMainContent";
import { useSerialEvents } from "@/components/Header/useSerialEvents";

/* =============================================================================
 * Constants & tiny utilities
 * ========================================================================== */

const DEBUG = String(process.env.NEXT_PUBLIC_DEBUG_LIVE || "").trim() === "1";

const ZERO_MAC = "00:00:00:00:00:00" as const;

// Accept bare "KFB" (default) or custom regex via env, like `/^KFB\d+$/i`
function compileRegex(src: string | undefined, fallback: RegExp): RegExp {
  if (!src) return fallback;
  try {
    if (src.startsWith("/") && src.lastIndexOf("/") > 0) {
      const i = src.lastIndexOf("/");
      return new RegExp(src.slice(1, i), src.slice(i + 1));
    }
    return new RegExp(src);
  } catch {
    console.warn("Invalid NEXT_PUBLIC_KFB_REGEX. Using fallback.");
    return fallback;
  }
}
const KFB_REGEX = compileRegex(process.env.NEXT_PUBLIC_KFB_REGEX, /^KFB$/);

const MAC_ONLY_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

const canonicalMac = (raw: string): string | null => {
  const s = String(raw || "").trim();
  if (!s) return null;
  const hex = s.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) return null;
  const mac = hex.match(/.{1,2}/g)?.join(":") || "";
  return MAC_ONLY_REGEX.test(mac) ? mac : null;
};

const extractMac = (raw: string): string | null => {
  const s = String(raw || "").toUpperCase();
  const m1 = s.match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/);
  if (m1 && m1[1]) return m1[1];
  const m2 = s.match(/\b([0-9A-F]{12})\b/);
  if (m2 && m2[1]) {
    const parts = m2[1].match(/.{1,2}/g) || [];
    const mac = parts.join(":");
    return MAC_ONLY_REGEX.test(mac) ? mac : null;
  }
  return null;
};

// Merge aliases across items
function mergeAliasesFromItems(
  items?: Array<{ aliases?: Record<string, string> }> | null
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    const a = (it && typeof it.aliases === "object" && it.aliases) || {};
    for (const [pin, name] of Object.entries(a)) {
      out[pin] = out[pin] && out[pin] !== name ? `${out[pin]} / ${name}` : name;
    }
  }
  return out;
}

function uniqSortedNums(list: number[]): number[] {
  return Array.from(
    new Set(list.filter((n) => Number.isFinite(n) && n > 0))
  ).sort((a, b) => a - b);
}

/* =============================================================================
 * Types (local)
 * ========================================================================== */

type HudMode = "idle" | "scanning" | "info" | "error";
type FlowStatus =
  | "idle"
  | "scanning"
  | "checking"
  | "live" // failed result; keep live updates visible
  | "finalizing" // success; clearing + checkpoint
  | "success"; // brief OK flash before reset

type ScanKind = "sse" | "manual";

/* =============================================================================
 * Main Component
 * ========================================================================== */

const MainApplicationUI: React.FC = () => {
  /* --------------------------------------------
   * UI: layout + view
   * ------------------------------------------ */
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false);
  const [mainView, setMainView] = useState<
    "dashboard" | "settingsConfiguration" | "settingsBranches"
  >("dashboard");

  /* --------------------------------------------
   * Core flow state (single-flight guard)
   * ------------------------------------------ */
  const [status, setStatus] = useState<FlowStatus>("idle");
  const flowActiveRef = useRef<boolean>(false); // hard guard against concurrent runs
  const watchdogRef = useRef<number | null>(null); // simple check watchdog
  const lastScanTokenRef = useRef<string>(""); // drop near-duplicate scanner events
  const lastScanCodeRef = useRef<string>("");

  /* --------------------------------------------
   * Data shown in UI
   * ------------------------------------------ */
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([]);
  const [groupedBranches, setGroupedBranches] = useState<
    Array<{ ksk: string; branches: BranchDisplayData[] }>
  >([]);
  const [nameHints, setNameHints] = useState<
    Record<string, string> | undefined
  >(undefined);
  const [normalPins, setNormalPins] = useState<number[] | undefined>(undefined);
  const [latchPins, setLatchPins] = useState<number[] | undefined>(undefined);
  const [checkFailures, setCheckFailures] = useState<number[] | null>(null);

  const [kfbNumber, setKfbNumber] = useState("");
  const [kfbInfo, setKfbInfo] = useState<KfbInfo | null>(null);
  const [macAddress, setMacAddress] = useState("");

  // Rarely used in this simplified flow; kept for component compatibility
  const [activeKssks, setActiveKssks] = useState<string[]>([]);

  // Inline lightweight HUD / toast
  const [scanResult, setScanResult] = useState<{
    text: string;
    kind: "info" | "error";
  } | null>(null);

  // OK flash / finalize notes
  const [okFlashTick, setOkFlashTick] = useState(0);
  const [okSystemNote, setOkSystemNote] = useState<string | null>(null);
  const [disableOkAnimation, setDisableOkAnimation] = useState(false);

  /* --------------------------------------------
   * Serial (SSE) — limited + predictable usage
   *  - We enable live only when a MAC is bound AND status is checking/live
   *  - We read scanner events ONLY when idle
   * ------------------------------------------ */
  const liveEnabled = useMemo(
    () => !!macAddress && (status === "checking" || status === "live"),
    [macAddress, status]
  );
  const serial = useSerialEvents(
    liveEnabled ? (macAddress || "").toUpperCase() : undefined,
    { disabled: !liveEnabled, base: true }
  );

  /* --------------------------------------------
   * Derived booleans / HUD
   * ------------------------------------------ */
  const isScanning = status === "scanning" || status === "checking";
  const isChecking = status === "checking";

  const hudMode: HudMode | null = useMemo(() => {
    if (mainView !== "dashboard") return null;
    if (status === "scanning") return "scanning";
    if (scanResult) return scanResult.kind;
    if (status === "idle") return "idle";
    return null;
  }, [status, scanResult, mainView]);

  const hudMessage = useMemo(() => {
    switch (hudMode) {
      case "scanning":
        return "Scanning…";
      case "info":
        return scanResult?.text || "Notice";
      case "error":
        return scanResult?.text || "Error";
      case "idle":
        return "Scan a barcode to begin";
      default:
        return undefined;
    }
  }, [hudMode, scanResult]);

  const hudSubMessage = useMemo(() => {
    if (hudMode === "scanning") return "Hold steady for a moment";
    if (hudMode === "idle") {
      const connected =
        ((serial as any)?.scannersDetected ?? 0) > 0 ||
        !!(serial as any)?.sseConnected;
      return connected ? "" : "Scanner not detected.";
    }
    return undefined;
  }, [
    hudMode,
    (serial as any)?.scannersDetected,
    (serial as any)?.sseConnected,
  ]);

  /* --------------------------------------------
   * Helpers for building UI rows/groups from results
   * ------------------------------------------ */

  const buildFlatFromAliases = useCallback(
    (
      aliases: Record<string, string>,
      failures: number[],
      latch: number[]
    ): BranchDisplayData[] => {
      const pins = Object.keys(aliases)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n));
      pins.sort((a, b) => a - b);
      const latchSet = new Set<number>(latch || []);
      const failSet = new Set<number>(failures || []);
      return pins.map((pin) => ({
        id: String(pin),
        branchName: aliases[String(pin)] || `PIN ${pin}`,
        testStatus: failSet.has(pin)
          ? ("nok" as TestStatus)
          : latchSet.has(pin)
            ? ("not_tested" as TestStatus)
            : ("ok" as TestStatus),
        pinNumber: pin,
        kfbInfoValue: undefined,
        isLatch: latchSet.has(pin),
      }));
    },
    []
  );

  const buildGroupsFromItems = useCallback(
    (
      items: Array<{
        ksk?: string;
        kssk?: string;
        aliases?: Record<string, string>;
        normalPins?: number[];
        latchPins?: number[];
      }>,
      fallbackAliases: Record<string, string>,
      failures: number[],
      latch: number[]
    ): Array<{ ksk: string; branches: BranchDisplayData[] }> => {
      const byId = new Map<string, BranchDisplayData[]>();
      const failSet = new Set<number>(failures || []);
      const latchSet = new Set<number>(latch || []);

      for (const it of items || []) {
        const id = String(((it as any)?.ksk ?? (it as any)?.kssk) || "").trim();
        if (!id) continue;

        const a = it.aliases || {};
        const pinSet = new Set<number>();
        if (Array.isArray(it.normalPins))
          it.normalPins.forEach(
            (p) => Number.isFinite(p) && p > 0 && pinSet.add(Number(p))
          );
        if (Array.isArray(it.latchPins))
          it.latchPins.forEach(
            (p) => Number.isFinite(p) && p > 0 && pinSet.add(Number(p))
          );

        // Fallback to union/fallbackAliases if item lacks aliases
        const pins = pinSet.size
          ? Array.from(pinSet).sort((x, y) => x - y)
          : Object.keys(a)
              .map((n) => Number(n))
              .filter((n) => Number.isFinite(n))
              .sort((x, y) => x - y);

        const rows: BranchDisplayData[] = pins.map((pin) => {
          const nameRaw = a[String(pin)] || fallbackAliases[String(pin)] || "";
          const name = nameRaw ? String(nameRaw) : `PIN ${pin}`;
          return {
            id: `${id}:${pin}`,
            branchName: name,
            testStatus: failSet.has(pin)
              ? ("nok" as TestStatus)
              : latchSet.has(pin)
                ? ("not_tested" as TestStatus)
                : ("ok" as TestStatus),
            pinNumber: pin,
            kfbInfoValue: undefined,
            isLatch: latchSet.has(pin),
          };
        });

        const prev = byId.get(id) || [];
        // Deduplicate by pin
        const seen = new Set<number>();
        const merged = [...prev, ...rows].filter((b) => {
          const p = Number(b.pinNumber);
          if (!Number.isFinite(p)) return true;
          if (seen.has(p)) return false;
          seen.add(p);
          return true;
        });
        byId.set(id, merged);
      }

      return Array.from(byId.entries())
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([ksk, branches]) => ({ ksk, branches }));
    },
    []
  );

  /* --------------------------------------------
   * Reset
   * ------------------------------------------ */
  const handleReset = useCallback(() => {
    flowActiveRef.current = false;

    setStatus("idle");
    setKfbNumber("");
    setKfbInfo(null);
    setMacAddress("");
    setScanResult(null);

    setBranchesData([]);
    setGroupedBranches([]);
    setActiveKssks([]);
    setNameHints(undefined);
    setNormalPins(undefined);
    setLatchPins(undefined);
    setCheckFailures(null);

    setOkSystemNote(null);
    setDisableOkAnimation(false);

    // Clear watchdog
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  /* --------------------------------------------
   * Finalize success: clear aliases/locks and reset to idle
   * ------------------------------------------ */
  const finalizeOkForMac = useCallback(
    async (rawMac: string) => {
      const mac = String(rawMac || "")
        .trim()
        .toUpperCase();
      if (!mac) {
        handleReset();
        return;
      }

      setStatus("finalizing");

      try {
        if (DEBUG) console.log("[FINALIZE] clearing aliases + locks", mac);

        // Clear aliases snapshot
        await fetch("/api/aliases/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac }),
        }).catch(() => {});

        // Best-effort lock clear (server decides semantics)
        await fetch("/api/ksk-lock", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac, force: 1 }),
        }).catch(() => {});

        setOkSystemNote("Cache cleared");
        setOkFlashTick((t) => t + 1);

        // Small pause so OK flash is visible, then reset to idle
        setTimeout(
          () => {
            setStatus("success");
            setTimeout(() => {
              handleReset();
            }, 400);
          },
          Math.max(150, Number(process.env.NEXT_PUBLIC_OK_OVERLAY_MS ?? 600))
        );
      } catch (e) {
        console.error("[FINALIZE] error", e);
        // Even if finalize had an error, return to idle to unblock next scan
        setDisableOkAnimation(true);
        setTimeout(() => handleReset(), 600);
      }
    },
    [handleReset]
  );

  /* --------------------------------------------
   * Run check
   * ------------------------------------------ */
  const runCheck = useCallback(
    async (mac: string, pins?: number[]) => {
      setStatus("checking");
      setCheckFailures(null);

      // Watchdog: if server never returns, drop to LIVE with a toast
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(
        () => {
          if (status === "checking") {
            setStatus("live");
            setScanResult({ text: "Check timed out", kind: "error" });
            setTimeout(() => setScanResult(null), 1800);
          }
        },
        Math.max(
          3000,
          Number(process.env.NEXT_PUBLIC_CHECK_CLIENT_TIMEOUT_MS ?? 5000)
        )
      );

      try {
        const res = await fetch("/api/serial/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pins && pins.length ? { mac, pins } : { mac }),
        });

        let result: any = {};
        try {
          const ct = res.headers.get("content-type") || "";
          result = ct.includes("application/json") ? await res.json() : {};
        } catch {}

        if (!res.ok) {
          // Non-OK: go to live (no re-tries here; single-flow only)
          console.warn("[CHECK] non-OK status", res.status, result);
          setDisableOkAnimation(true);
          setStatus("live");
          setScanResult({ text: "Check failed to start", kind: "error" });
          setTimeout(() => setScanResult(null), 1800);
          return;
        }

        // Parse response
        const failures: number[] = Array.isArray(result?.failures)
          ? result.failures
          : [];
        const unknown = result?.unknownFailure === true;

        // Name/pin hints and union-like lists from the server
        if (result?.nameHints && typeof result.nameHints === "object") {
          setNameHints(result.nameHints as Record<string, string>);
        }
        if (Array.isArray(result?.normalPins))
          setNormalPins(result.normalPins as number[]);
        if (Array.isArray(result?.latchPins))
          setLatchPins(result.latchPins as number[]);

        // Build aliases map from preference: itemsActive -> items -> aliases
        const itemsActive = Array.isArray(result?.itemsActive)
          ? result.itemsActive
          : [];
        const itemsAll = Array.isArray(result?.items) ? result.items : [];
        let aliases: Record<string, string> = {};
        if (itemsActive.length) {
          aliases = mergeAliasesFromItems(itemsActive);
        } else if (itemsAll.length) {
          aliases = mergeAliasesFromItems(itemsAll);
        } else if (result?.aliases && typeof result.aliases === "object") {
          aliases = result.aliases as Record<string, string>;
        }

        // Compute latch pins array for rendering
        const latch = Array.isArray(result?.latchPins) ? result.latchPins : [];

        // Groups for per‑KSK breakdown if items present
        if (itemsActive.length || itemsAll.length) {
          const src = itemsActive.length ? itemsActive : itemsAll;
          const groups = buildGroupsFromItems(src, aliases, failures, latch);
          setGroupedBranches(groups);
          setActiveKssks(groups.map((g) => g.ksk));
        } else {
          setGroupedBranches([]);
          setActiveKssks([]);
        }

        // Flat list (union)
        const flat = buildFlatFromAliases(aliases, failures, latch);
        // Append any failure pins not present in aliases so they still show
        const known = new Set(flat.map((b) => Number(b.pinNumber)));
        const extras = failures.filter((p) => !known.has(p));
        const flatWithExtras = extras.length
          ? [
              ...flat,
              ...extras.map(
                (pin) =>
                  ({
                    id: String(pin),
                    branchName: `PIN ${pin}`,
                    testStatus: "nok" as TestStatus,
                    pinNumber: pin,
                    kfbInfoValue: undefined,
                  }) as BranchDisplayData
              ),
            ]
          : flat;

        startTransition(() => setBranchesData(flatWithExtras));
        setCheckFailures(failures);

        // Decide success / failure
        if (!unknown && failures.length === 0) {
          // Success → finalize and reset to idle; show OK flash after clearing
          if (DEBUG) console.log("[CHECK] success; finalizing OK for", mac);
          setScanResult(null);
          await finalizeOkForMac(mac);
        } else {
          // Failure → enter live mode and wait for next scan
          setStatus("live");
          const text = unknown
            ? "CHECK ERROR (no pin list)"
            : `${failures.length} failure${failures.length === 1 ? "" : "s"}`;
          setScanResult({ text, kind: unknown ? "error" : "info" });
          setTimeout(() => setScanResult(null), 2000);
        }
      } catch (err) {
        console.error("[CHECK] error", err);
        setDisableOkAnimation(true);
        setStatus("live");
        setScanResult({ text: "Check error", kind: "error" });
        setTimeout(() => setScanResult(null), 1800);
      } finally {
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        // Flow can accept a new scan now (even if we're in live/failure view)
        flowActiveRef.current = false;
      }
    },
    [buildFlatFromAliases, buildGroupsFromItems, finalizeOkForMac]
  );

  /* --------------------------------------------
   * Load pre-check data + start check
   * ------------------------------------------ */
  const loadAndCheck = useCallback(
    async (normalizedCode: string, kind: ScanKind) => {
      // Resolve MAC or accept special "KFB"
      const macCanon =
        canonicalMac(normalizedCode) || extractMac(normalizedCode);
      const isMac = !!macCanon;
      const mac = isMac ? (macCanon as string) : "KFB";

      // Bind UI
      setKfbNumber(normalizedCode);
      setMacAddress(mac);
      setKfbInfo(null);
      setScanResult(null);

      setStatus("scanning");
      setBranchesData([]);
      setGroupedBranches([]);
      setActiveKssks([]);
      setNameHints(undefined);
      setNormalPins(undefined);
      setLatchPins(undefined);
      setCheckFailures(null);

      if (DEBUG)
        console.log("[FLOW] accepted scan", {
          code: normalizedCode,
          mac,
          kind,
        });

      // Optional: fetch aliases snapshot to pre-populate pins (non-blocking)
      try {
        const r = await fetch(
          `/api/aliases?mac=${encodeURIComponent(mac)}&all=1`,
          { cache: "no-store" }
        );
        if (r.ok) {
          const j = await r.json();
          const items: Array<{
            aliases?: Record<string, string>;
            normalPins?: number[];
            latchPins?: number[];
            ksk?: string;
            kssk?: string;
          }> = Array.isArray(j?.items) ? j.items : [];

          // Build a quick grouped preview as "not_tested" (helps UI feel immediate)
          if (items.length) {
            const aliasesPreview = mergeAliasesFromItems(items);
            const latchPreview = uniqSortedNums(
              items.flatMap((it) =>
                Array.isArray(it.latchPins) ? it.latchPins : []
              )
            );
            const groupsPreview = buildGroupsFromItems(
              items,
              aliasesPreview,
              [],
              latchPreview
            );
            setGroupedBranches(groupsPreview);
            setActiveKssks(groupsPreview.map((g) => g.ksk));

            const flatPreview = buildFlatFromAliases(
              aliasesPreview,
              [],
              latchPreview
            );
            setBranchesData(flatPreview);

            // Preload pin sets for "pins" hint to the server (optional)
            const hintPins = uniqSortedNums(
              items.flatMap((it) => [
                ...(Array.isArray(it.normalPins) ? it.normalPins : []),
                ...(Array.isArray(it.latchPins) ? it.latchPins : []),
              ])
            );
            if (hintPins.length) {
              await runCheck(mac, hintPins);
              return;
            }
          }
        }
      } catch {
        // Snapshot is best-effort; ignore errors and proceed
      }

      // Proceed without pin hints
      await runCheck(mac);
    },
    [buildFlatFromAliases, buildGroupsFromItems, runCheck]
  );

  /* --------------------------------------------
   * Scan handling (manual + SSE scanner)
   * ------------------------------------------ */
  const beginScanIfIdle = useCallback(
    async (raw: string, kind: ScanKind) => {
      if (status !== "idle" && status !== "live") {
        // Strict single-flow: ignore scans while a run is in flight
        if (DEBUG) console.log("[SCAN] ignored (flow busy)", { raw, status });
        return;
      }

      const code = String(raw || "").trim();
      if (!code) return;

      // Accept MAC-like or KFB-like codes only
      const macFromAny = extractMac(code);
      const okCode =
        macFromAny ||
        canonicalMac(code) ||
        (KFB_REGEX.test(code) ? code.toUpperCase() : null);
      if (!okCode) {
        setScanResult({
          text: "Invalid code. Use MAC (AA:BB:CC:DD:EE:FF) or 'KFB'.",
          kind: "error",
        });
        setTimeout(() => setScanResult(null), 2200);
        return;
      }

      // Debounce near-duplicates from SSE
      if (kind === "sse") {
        const token = `${okCode}:${Math.floor(Date.now() / 1200)}`;
        if (lastScanTokenRef.current === token) return;
        lastScanTokenRef.current = token;
      }

      // Guard single-flight
      if (flowActiveRef.current) {
        if (DEBUG)
          console.log("[SCAN] ignored (single-flight guard)", { code: okCode });
        return;
      }
      flowActiveRef.current = true;

      lastScanCodeRef.current = okCode;
      await loadAndCheck(okCode, kind);
    },
    [status, loadAndCheck]
  );

  // Manual form (hidden form kept for compatibility)
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!kfbNumber.trim()) return;
    void beginScanIfIdle(kfbNumber.trim(), "manual");
  };

  // Manual input provided by child (used by "Enter MAC/KFB" UI)
  const handleManualSubmit = (submitted: string) => {
    const val = String(submitted || "").trim();
    if (!val) return;
    void beginScanIfIdle(val, "manual");
  };

  // Allow child to request "scan again" programmatically (we keep it strict)
  const handleScanAgainRequest = (value?: string) => {
    const next = String(value || lastScanCodeRef.current || "").trim();
    if (!next) return;
    void beginScanIfIdle(next, "manual");
  };

  /* --------------------------------------------
   * SSE: start flows on scanner events ONLY when idle
   * ------------------------------------------ */
  useEffect(() => {
    if (mainView !== "dashboard") return;
    // Only when idle or showing a failed/live state (explicit requirement: one flow per scan)
    if (!(status === "idle" || status === "live")) return;

    const tick = (serial as any)?.lastScanTick;
    if (!tick) return;

    const code = String((serial as any)?.lastScan || "").trim();
    if (!code) return;

    // Respect single-flight (guarded inside)
    void beginScanIfIdle(code, "sse");
  }, [(serial as any)?.lastScanTick, status, mainView, beginScanIfIdle]);

  /* --------------------------------------------
   * SSE: union/live updates (only while flow active for current MAC)
   * ------------------------------------------ */
  useEffect(() => {
    if (!liveEnabled) return;

    const u = (serial as any)?.lastUnion as {
      mac?: string;
      normalPins?: number[];
      latchPins?: number[];
      names?: Record<string, string>;
    } | null;
    if (!u) return;

    const cur = (macAddress || "").toUpperCase();
    const uMac = String(u.mac || "").toUpperCase();
    if (!cur || (uMac && uMac !== cur && uMac !== ZERO_MAC)) return;

    if (Array.isArray(u.normalPins))
      setNormalPins(uniqSortedNums(u.normalPins));
    if (Array.isArray(u.latchPins)) setLatchPins(uniqSortedNums(u.latchPins));
    if (u.names && typeof u.names === "object")
      setNameHints(u.names as Record<string, string>);
  }, [liveEnabled, (serial as any)?.lastUnion, macAddress]);

  /* --------------------------------------------
   * Optionally consume DONE/RESULT OK from device (safety)
   * If the device emits an OK result asynchronously while we're in live/checking,
   * finalize it (idempotent to our earlier client-side success handling).
   * ------------------------------------------ */
  useEffect(() => {
    if (!liveEnabled) return;

    const ev = (serial as any)?.lastEv as {
      kind?: string;
      mac?: string | null;
      line?: string;
      raw?: string;
      ok?: any;
    } | null;
    if (!ev) return;

    const raw = String(ev.line ?? ev.raw ?? "");
    const kind = String(ev.kind || "").toUpperCase();
    const ok =
      (/\bRESULT\b/i.test(raw) && /\b(SUCCESS|OK)\b/i.test(raw)) ||
      String(ev.ok).toLowerCase() === "true";

    const cur = (macAddress || "").toUpperCase();

    let evMac = String(ev.mac || "").toUpperCase();
    if (!evMac || evMac === ZERO_MAC) {
      const macs =
        raw.toUpperCase().match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/g) || [];
      evMac = macs.find((m) => m !== ZERO_MAC) || cur;
    }
    if (!cur || evMac !== cur) return;

    if ((kind === "RESULT" || kind === "DONE") && ok) {
      // Device claims success → finalize cleanly
      void finalizeOkForMac(cur);
    }
  }, [liveEnabled, (serial as any)?.lastEvTick, macAddress, finalizeOkForMac]);

  /* --------------------------------------------
   * Layout helpers
   * ------------------------------------------ */
  const actualHeaderHeight = mainView === "dashboard" ? "4rem" : "0rem";
  const leftOffset = "0";
  const appCurrentViewType =
    mainView === "settingsConfiguration" || mainView === "settingsBranches"
      ? "settings"
      : "main";

  const toggleLeftSidebar = () => setIsLeftSidebarOpen((v) => !v);
  const handleHeaderClick = () => {
    if (appCurrentViewType === "settings") {
      setMainView("dashboard");
      setIsSettingsSidebarOpen(false);
    } else {
      setIsSettingsSidebarOpen((v) => !v);
    }
  };

  /* --------------------------------------------
   * Stable empty derivations for child props
   * ------------------------------------------ */
  const EMPTY_BRANCHES: ReadonlyArray<BranchDisplayData> = useMemo(
    () => Object.freeze([] as BranchDisplayData[]),
    []
  );
  const EMPTY_GROUPS: ReadonlyArray<{
    ksk: string;
    branches: BranchDisplayData[];
  }> = useMemo(
    () =>
      Object.freeze(
        [] as Array<{ ksk: string; branches: BranchDisplayData[] }>
      ),
    []
  );
  const EMPTY_IDS: ReadonlyArray<string> = useMemo(
    () => Object.freeze([] as string[]),
    []
  );

  const derived = useMemo(() => {
    const hasMac = !!(macAddress && macAddress.trim());
    return {
      effBranches: hasMac
        ? branchesData
        : (EMPTY_BRANCHES as BranchDisplayData[]),
      effGroups: hasMac
        ? groupedBranches
        : (EMPTY_GROUPS as Array<{
            ksk: string;
            branches: BranchDisplayData[];
          }>),
      effFailures: hasMac ? checkFailures : null,
      effActiveKssks: hasMac ? activeKssks : (EMPTY_IDS as string[]),
      effNormalPins: hasMac ? normalPins : undefined,
      effLatchPins: hasMac ? latchPins : undefined,
    };
  }, [
    macAddress,
    branchesData,
    groupedBranches,
    checkFailures,
    activeKssks,
    normalPins,
    latchPins,
    EMPTY_BRANCHES,
    EMPTY_GROUPS,
    EMPTY_IDS,
  ]);

  /* --------------------------------------------
   * Render
   * ------------------------------------------ */
  return (
    <div className="relative flex min-h-screen bg-white">
      <div
        className="flex flex-1 flex-col transition-all"
        style={{ marginLeft: leftOffset }}
      >
        {mainView === "dashboard" && (
          <Header
            serial={serial}
            onSettingsClick={handleHeaderClick}
            currentView={appCurrentViewType}
            isSidebarOpen={isLeftSidebarOpen}
            onToggleSidebar={toggleLeftSidebar}
          />
        )}

        <main className="flex-1 overflow-auto bg-white">
          {mainView === "dashboard" ? (
            <>
              <BranchDashboardMainContent
                appHeaderHeight={actualHeaderHeight}
                onManualSubmit={handleManualSubmit}
                onScanAgainRequest={handleScanAgainRequest}
                hudMode={hudMode}
                hudMessage={hudMessage}
                hudSubMessage={hudSubMessage}
                onHudDismiss={
                  scanResult ? () => setScanResult(null) : undefined
                }
                branchesData={derived.effBranches}
                groupedBranches={derived.effGroups}
                checkFailures={derived.effFailures}
                nameHints={nameHints}
                kfbNumber={kfbNumber}
                kfbInfo={kfbInfo}
                isScanning={isScanning}
                macAddress={macAddress}
                activeKssks={derived.effActiveKssks}
                // Always pass EVs for UI that may show log snippets
                lastEv={(serial as any)?.lastEv}
                lastEvTick={(serial as any)?.lastEvTick}
                // Live pins only while flow is active
                normalPins={liveEnabled ? derived.effNormalPins : undefined}
                latchPins={liveEnabled ? derived.effLatchPins : undefined}
                onResetKfb={handleReset}
                onFinalizeOk={finalizeOkForMac}
                flashOkTick={okFlashTick}
                okSystemNote={okSystemNote}
                disableOkAnimation={disableOkAnimation}
                scanResult={scanResult}
              />

              {/* Hidden form (kept for keyboard-enter compatibility) */}
              <form onSubmit={handleKfbSubmit} className="hidden" />
            </>
          ) : (
            <div className="p-6 text-slate-600">Settings view is disabled.</div>
          )}
        </main>
      </div>

      {/* Lightweight, self-contained styles for HUD affordances */}
      <style>{`
        .hud-enter {
          transform: translateY(-6px);
          opacity: 0;
          animation: hudIn 220ms ease-out forwards;
        }
        @keyframes hudIn {
          to { transform: translateY(0); opacity: 1; }
        }

        .hud-pulse-circle {
          position: relative;
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border-radius: 9999px;
          background: radial-gradient(closest-side, white 75%, transparent 76%);
          overflow: visible;
        }
        .hud-pulse-circle::before, .hud-pulse-circle::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 2px solid rgba(15, 23, 42, 0.15);
          transform: scale(1);
          opacity: 1;
          animation: hudPulse 1500ms ease-out infinite;
        }
        .hud-pulse-circle::after { animation-delay: 300ms; }
        .hud-pulse-blue::before,
        .hud-pulse-blue::after { border-color: rgba(29, 78, 216, 0.25); }

        @media (prefers-reduced-motion: reduce) {
          .hud-pulse-circle::before, .hud-pulse-circle::after { animation: none; opacity: .6; }
        }
        @keyframes hudPulse {
          from { transform: scale(1); opacity: .9; }
          to   { transform: scale(1.5); opacity: 0; }
        }

        .hud-shimmer {
          background: linear-gradient(90deg, rgba(59,130,246,.0) 0%, rgba(59,130,246,.35) 50%, rgba(59,130,246,.0) 100%);
          background-size: 200% 100%;
          animation: hudShimmer 1.25s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) { .hud-shimmer { animation: none; } }
        @keyframes hudShimmer {
          from { background-position: -200% 0; }
          to   { background-position: 200% 0; }
        }

        .hud-icon-wrap {
          width: 40px; height: 40px; display: grid; place-items: center;
          border-radius: 9999px; background: white;
        }

        .hud-dot {
          display: inline-block; width: 6px; height: 6px; margin-right: 6px;
          border-radius: 9999px; background: currentColor; opacity: .75;
          animation: hudDots 900ms ease-in-out infinite;
        }
        .hud-dot:nth-child(2) { animation-delay: 150ms; }
        .hud-dot:nth-child(3) { animation-delay: 300ms; }
        @keyframes hudDots {
          0%, 100% { transform: translateY(0); opacity: .6; }
          50% { transform: translateY(-2px); opacity: 1; }
        }

        .plug-wiggle { animation: wiggle 1s ease-in-out infinite; }
        @keyframes wiggle { 0%,100% { transform: translateX(0) } 50% { transform: translateX(8px) } }
      `}</style>
    </div>
  );
};

export default MainApplicationUI;

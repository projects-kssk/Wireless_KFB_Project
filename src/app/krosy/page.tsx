// src/app/krosy/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { AnimatePresence, m } from "framer-motion";

type RunMode = "json" | "xml";
type ViewTab = "body" | "xmlPreview";
type ApiMode = "online" | "offline";

const DEFAULT_API_MODE: ApiMode =
  process.env.NEXT_PUBLIC_KROSY_ONLINE === "true" ? "online" : "offline";

const ENDPOINT_ONLINE =
  process.env.NEXT_PUBLIC_KROSY_URL_ONLINE ?? "/api/krosy";
const ENDPOINT_OFFLINE =
  process.env.NEXT_PUBLIC_KROSY_URL_OFFLINE ?? "/api/krosy-offline";

// Checkpoint endpoints
const ENDPOINT_CHECKPOINT_ONLINE =
  process.env.NEXT_PUBLIC_KROSY_URL_CHECKPOINT_ONLINE ??
  "/api/krosy/checkpoint";

const ENDPOINT_CHECKPOINT_OFFLINE =
  process.env.NEXT_PUBLIC_KROSY_URL_CHECKPOINT_OFFLINE ??
  "/api/krosy-offline/checkpoint";

// Identity bootstrap (GET returns hostname/ip/mac from the offline checkpoint route)
const IDENTITY_ENDPOINT =
  process.env.NEXT_PUBLIC_KROSY_IDENTITY_URL ??
  "/api/krosy-offline/checkpoint";

const HTTP_TIMEOUT = Number(process.env.NEXT_PUBLIC_KROSY_HTTP_TIMEOUT_MS ?? "15000");
const DEFAULT_TARGET_HOST = process.env.NEXT_PUBLIC_KROSY_XML_TARGET ?? "ksskkfb01";
const DEFAULT_SOURCE_HOST = process.env.NEXT_PUBLIC_KROSY_SOURCE_HOSTNAME ?? DEFAULT_TARGET_HOST;

/* ===== utils ===== */
function formatXml(xml: string) {
  try {
    const reg = /(>)(<)(\/*)/g;
    let out = xml.replace(/\r?\n|\r/g, "").replace(reg, "$1\n$2$3");
    let pad = 0;
    return out
      .split("\n")
      .map((ln) => {
        let indent = 0;
        if (ln.match(/^<\/\w/) || ln.match(/^<\w[^>]*\/>/)) indent = -1;
        const line = `${"  ".repeat(Math.max(pad + indent, 0))}${ln}`;
        if (ln.match(/^<\w[^>]*[^/]>/) && !ln.startsWith("<?")) pad += 1;
        if (ln.match(/^<\/\w/)) pad = Math.max(pad - 1, 0);
        return line;
      })
      .join("\n");
  } catch {
    return xml;
  }
}
// after — tolerate optional XML declaration
const isCompleteKrosy = (xml: string) =>
  /^\s*(?:<\?xml[^>]*\?>\s*)?<krosy[\s>][\s\S]*<\/krosy>\s*$/i.test(xml);
/* ===== component ===== */
export default function KrosyPage() {
  const [mode, setMode] = useState<RunMode>("json");
  const [apiMode, setApiMode] = useState<ApiMode>(DEFAULT_API_MODE);
  const [tab, setTab] = useState<ViewTab>("body");
  const [status, setStatus] = useState<"idle" | "ok" | "err" | "run">("idle");
  const [http, setHttp] = useState<string>("");
  const [duration, setDuration] = useState<number | null>(null);

  // per-button busy flags
  const [busyReq, setBusyReq] = useState(false);
  const [busyChk, setBusyChk] = useState(false);
  const busyAny = busyReq || busyChk;

  // inputs
  const [requestID, setRequestID] = useState<string>("1");
  const [intksk, setIntksk] = useState("830577899396");
  const [targetHostName, setTargetHostName] = useState(DEFAULT_TARGET_HOST);

  // auto from backend
  const [sourceHostname, setSourceHostname] = useState(DEFAULT_SOURCE_HOST);
  const [sourceIp, setSourceIp] = useState("");
  const [sourceMac, setSourceMac] = useState("");

  // display
  const [logs, setLogs] = useState<string[]>([]);
  const [respBody, setRespBody] = useState<string>("Run the test to see response payload…");
  const [xmlPreview, setXmlPreview] = useState<string>("");
  const termRef = useRef<HTMLDivElement | null>(null);

  // checkpoint gate
  const [hasWorkingData, setHasWorkingData] = useState(false);
  const [workingDataXml, setWorkingDataXml] = useState<string | null>(null);

  // allow checkpoint for both ONLINE and OFFLINE if XML is complete
  const [checkpointEligible, setCheckpointEligible] = useState(false);

  // concurrency lock
  const inFlightRef = useRef(false);

  const endpoint = apiMode === "offline" ? ENDPOINT_OFFLINE : ENDPOINT_ONLINE;
  const endpointCheckpoint =
    apiMode === "offline" ? ENDPOINT_CHECKPOINT_OFFLINE : ENDPOINT_CHECKPOINT_ONLINE;

  const accept = useMemo(
    () => (mode === "json" ? "application/json" : "application/xml"),
    [mode],
  );

  const withTimeout = async (input: RequestInfo, init?: RequestInit) => {
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), HTTP_TIMEOUT);
    try {
      return await fetch(input, { ...init, signal: c.signal });
    } finally {
      clearTimeout(id);
    }
  };

  const append = useCallback((line: string) => {
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    setLogs((p) => [...p, `[${t}] ${line}`].slice(-800));
    queueMicrotask(() => {
      const el = termRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /* identity bootstrap */
  useEffect(() => {
    (async () => {
      try {
        append(`bootstrap: GET ${IDENTITY_ENDPOINT}`);
        const r = await withTimeout(IDENTITY_ENDPOINT, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`bootstrap GET ${r.status}`);
        const j = await r.json();
        // Prefer configured source hostname; fall back to identity endpoint
        const cfg = DEFAULT_SOURCE_HOST;
        setSourceHostname(cfg || j.hostname || "");
        setSourceIp(j.ip || "");
        setSourceMac(j.mac || "");
        append(`bootstrap ok (IDENTITY)`);
      } catch (e: any) {
        append(
          `bootstrap failed (IDENTITY): ${
            e?.name === "AbortError" ? `timeout ${HTTP_TIMEOUT}ms` : e?.message || e
          }`,
        );
      }
    })();
  }, [append]);

  const extractXmlFromResponse = (ct: string, payload: any) => {
    if ((ct || "").includes("json")) {
      const j = payload as any;
      return String(
        j.responseXmlRaw ||
          j.responseXml ||
          j.responseXmlPreview ||
          j.responsePreview ||
          j.sentXmlPreview ||
          "",
      );
    }
    return String(payload || "");
  };

  // If server says preview and we are ONLINE, re-fetch full XML once.
  const refetchFullXmlIfNeeded = useCallback(
    async (payload: any): Promise<string | null> => {
      if (apiMode !== "online") return null;
      try {
        append("server returned preview → requesting full XML (ONLINE)");
        const r = await withTimeout(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/xml" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          append(`full XML request failed: HTTP ${r.status}`);
          return null;
        }
        const txt = await r.text();
        return (txt || "").trim() ? txt : null;
      } catch (e: any) {
        append(`full XML request error: ${e?.message || e}`);
        return null;
      }
    },
    [append, endpoint, apiMode],
  );

  /* RUN */
  const run = useCallback(async () => {
    if (inFlightRef.current || busyAny) return;
    inFlightRef.current = true;
    setBusyReq(true);
    setStatus("run");
    setHttp("");
    setDuration(null);
    setRespBody("");
    setXmlPreview("");
    setTab("body");
    // reset gates
    setHasWorkingData(false);
    setWorkingDataXml(null);
    setCheckpointEligible(false);

    const payload = {
      action: "working",
      requestID,
      intksk,
      targetHostName,
      sourceHostname,
    };

    append(`POST ${endpoint} [visualControl: working] (${apiMode.toUpperCase()})`);

    const started = performance.now();
    try {
      const res = await withTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: accept },
        body: JSON.stringify(payload),
      });

      const ms = Math.round(performance.now() - started);
      setDuration(ms);
      setHttp(`HTTP ${res.status}`);
      append(`→ HTTP ${res.status} in ${ms} ms`);

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const j = await res.json();
        setRespBody(JSON.stringify(j, null, 2));
        let xml = extractXmlFromResponse(ct, j);

        const srvHasWD = Boolean(j.hasWorkingData);
        const srvIsComplete: boolean =
          typeof j.isComplete === "boolean" ? j.isComplete : isCompleteKrosy(xml);
        const srvIsPreview: boolean =
          typeof j.isPreview === "boolean" ? j.isPreview : (!srvIsComplete && !!xml);

        if (srvIsPreview && apiMode === "online") {
          const full = await refetchFullXmlIfNeeded(payload);
          if (full && full.trim().startsWith("<")) {
            xml = full;
            append("full XML received → using upgraded payload");
          } else {
            append("full XML unavailable → staying on preview");
          }
        }

        if (xml.trim().startsWith("<")) setXmlPreview(formatXml(xml));

        const hasWD = srvHasWD || /<workingData[\s>]/i.test(xml);
        setHasWorkingData(hasWD);

        const complete = isCompleteKrosy(xml);
        const eligible = hasWD && complete; // allow both ONLINE and OFFLINE
        setCheckpointEligible(eligible);
        if (eligible) setWorkingDataXml(xml);

        if (hasWD && eligible) {
          append(`workingData detected (complete XML, ${apiMode.toUpperCase()}) → checkpoint enabled, send disabled`);
        } else if (hasWD && !complete) {
          append("workingData detected but response incomplete");
        } else {
          append("no <workingData> in response → checkpoint disabled");
        }
      } else {
        const t = await res.text();
        const pretty = formatXml(t);
        setRespBody(pretty);
        if ((t || "").trim().startsWith("<")) setXmlPreview(pretty);

        const hasWD = /<workingData[\s>]/i.test(t);
        setHasWorkingData(hasWD);

        const complete = isCompleteKrosy(t);
        const eligible = hasWD && complete; // allow both ONLINE and OFFLINE
        setCheckpointEligible(eligible);
        if (eligible) setWorkingDataXml(t);

        if (hasWD && eligible) {
          append(`workingData detected (complete XML, ${apiMode.toUpperCase()}) → checkpoint enabled, send disabled`);
        } else if (hasWD && !complete) {
          append("workingData detected but response incomplete");
        } else {
          append("no <workingData> in response → checkpoint disabled");
        }
      }

      setStatus(res.ok ? "ok" : "err");
    } catch (e: any) {
      setRespBody(e?.message || "network error");
      setStatus("err");
    } finally {
      setBusyReq(false);
      inFlightRef.current = false;
    }
  }, [
    accept,
    append,
    endpoint,
    apiMode,
    requestID,
    intksk,
    targetHostName,
    sourceHostname,
    busyAny,
    refetchFullXmlIfNeeded,
  ]);

  /* RUN CHECKPOINT */
  const runCheckpoint = useCallback(async () => {
    if (inFlightRef.current || busyAny) return;
    if (!hasWorkingData || !workingDataXml || !isCompleteKrosy(workingDataXml) || !checkpointEligible) {
      append("checkpoint aborted: need complete <krosy>…</krosy> with <workingData>");
      return;
    }
    inFlightRef.current = true;
    setBusyChk(true);
    setStatus("run");
    setHttp("");
    setDuration(null);
    setRespBody("");
    setTab("body");

    const payload = { workingDataXml, requestID };

    append(`POST ${endpointCheckpoint} [visualControl: workingResult] (${apiMode.toUpperCase()})`);

    const started = performance.now();
    try {
      const res = await withTimeout(endpointCheckpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: accept },
        body: JSON.stringify(payload),
      });

      const ms = Math.round(performance.now() - started);
      setDuration(ms);
      setHttp(`HTTP ${res.status}`);
      append(`→ HTTP ${res.status} in ${ms} ms`);

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const j = await res.json();
        setRespBody(JSON.stringify(j, null, 2));
        const xml = extractXmlFromResponse(ct, j);
        if (xml.trim()) setXmlPreview(formatXml(xml));
      } else {
        const t = await res.text();
        setRespBody(formatXml(t));
      }

      setStatus(res.ok ? "ok" : "err");
    } catch (e: any) {
      setRespBody(e?.message || "network error");
      setStatus("err");
    } finally {
      setBusyChk(false);
      inFlightRef.current = false;
    }
  }, [accept, append, apiMode, endpointCheckpoint, hasWorkingData, workingDataXml, requestID, busyAny, checkpointEligible]);

  const resetFlow = () => {
    setHasWorkingData(false);
    setWorkingDataXml(null);
    setCheckpointEligible(false);
    setXmlPreview("");
    setRespBody("Ready");
    setStatus("idle");
    setHttp("");
    setDuration(null);
  };

  const canCheckpoint = useMemo(
    () => hasWorkingData && !!workingDataXml && isCompleteKrosy(workingDataXml) && checkpointEligible,
    [hasWorkingData, workingDataXml, checkpointEligible],
  );

  const endpointLabel = apiMode === "offline" ? ENDPOINT_OFFLINE : ENDPOINT_ONLINE;
  const checkpointLabel =
    apiMode === "offline" ? ENDPOINT_CHECKPOINT_OFFLINE : ENDPOINT_CHECKPOINT_ONLINE;

  return (
    <div
      className="mx-auto max-w-6xl px-4 sm:px-6"
      style={{ paddingTop: "max(env(safe-area-inset-top),1rem)", paddingBottom: "max(env(safe-area-inset-bottom),1rem)" }}
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-[20px] sm:text-2xl font-semibold text-gray-900 dark:text-gray-100">Krosy Test Console</h1>
          <ConnectivityPill apiMode={apiMode} endpoint={endpointLabel} />
        </div>
        <StatusPill status={status} http={http} duration={duration} />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="rounded-3xl border border-black/5 bg-white/95 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] p-5">
          {/* Segmented controls */}
          <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
            <Segmented value={mode} options={[{ id: "json", label: "JSON" }, { id: "xml", label: "XML" }]} onChange={(v) => setMode(v as RunMode)} />
            <Segmented value={apiMode} options={[{ id: "online", label: "ONLINE" }, { id: "offline", label: "OFFLINE" }]} onChange={(v) => setApiMode(v as ApiMode)} intentById={{ online: "success", offline: "danger" }} />
          </div>

          {/* Inputs */}
          <div className="space-y-3">
            <Field label="requestID"><Input value={requestID} onValueChange={setRequestID} /></Field>
            <Field label="targetHostName"><Input value={targetHostName} onValueChange={setTargetHostName} /></Field>
            <Field label="intksk"><Input value={intksk} onValueChange={setIntksk} /></Field>

            {/* Host identity */}
            <div className="space-y-3 pt-2">
              <Field label="sourceHostname"><Input value={sourceHostname} onValueChange={setSourceHostname} /></Field>
              <Field label="ip"><Input value={sourceIp} disabled /></Field>
              <Field label="mac"><Input value={sourceMac} disabled className="font-mono tracking-wider w-full" /></Field>
            </div>

            <div className="flex gap-3 pt-2 flex-wrap">
              <m.button
                onClick={run}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                disabled={busyAny || canCheckpoint}
                className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 shadow"
                aria-label="Send request"
              >
                <Spinner visible={busyReq} />
                {busyReq ? "Sending…" : "Send"}
              </m.button>

              <m.button
                onClick={runCheckpoint}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                disabled={busyAny || !canCheckpoint}
                className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 shadow"
                aria-label="Send checkpoint from response XML"
                title={canCheckpoint ? "Build and send workingResult from workingData XML" : "Run request and ensure full XML"}
              >
                <Spinner visible={busyChk} />
                {busyChk ? "Processing…" : "Send Checkpoint"}
              </m.button>

              <m.button onClick={resetFlow} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} className="rounded-2xl px-4 py-3 text-sm font-medium bg-white text-gray-800 dark:bg-gray-900 border border-black/10" aria-label="Reset flow">
                Reset
              </m.button>

              <m.button onClick={() => setLogs([])} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} className="rounded-2xl px-4 py-3 text-sm font-medium bg-white text-gray-800 dark:bg-gray-900 border border-black/10" aria-label="Clear logs">
                Clear logs
              </m.button>
            </div>
          </div>
        </m.div>

        <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.05 }} className="rounded-3xl border border-black/5 bg-white/95 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <div className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 border-b border-black/5 flex items-center justify-between">
            <span>Terminal</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              POST → {endpointLabel} · POST(checkpoint) → {checkpointLabel} · GET(identity) → {IDENTITY_ENDPOINT}
            </span>
          </div>
          <div ref={termRef} className="h-[320px] overflow-auto p-4 text-[11px] sm:text-xs font-mono text-gray-900 dark:text-gray-100 leading-5">
            {logs.length === 0 ? <p className="opacity-60">Logs will appear here.</p> : logs.map((l, i) => (<div key={i} className="select-text whitespace-pre-wrap">{l}</div>))}
          </div>
        </m.div>
      </div>

      {/* Response */}
      <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }} className="mt-6 rounded-3xl border border-black/5 bg-white/95 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-600 dark:text-gray-300 border-b border-black/5">
          <div className="flex items-center gap-2">
            <span>Response ({mode.toUpperCase()})</span>
            {xmlPreview && mode === "json" ? (
              <div className="ml-3 inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5">
                {(["body", "xmlPreview"] as ViewTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={[
                      "px-2.5 py-1 rounded-lg text-[11px] transition",
                      tab === t ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow" : "text-gray-600 dark:text-gray-300",
                    ].join(" ")}
                  >
                    {t === "body" ? "BODY" : "XML PREVIEW"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <SmallButton
            onClick={() =>
              navigator.clipboard.writeText(tab === "xmlPreview" && xmlPreview ? xmlPreview : respBody)
            }
            label="Copy"
          />
        </div>
        <CodeBlock text={tab === "xmlPreview" && xmlPreview ? xmlPreview : respBody} />
      </m.div>
    </div>
  );
}

/* UI bits */
function Segmented<T extends string>({ value, options, onChange, intentById }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; intentById?: Partial<Record<T, "neutral" | "success" | "danger">>; }) {
  return (
    <div className="inline-flex rounded-2xl bg-gray-100 dark:bg-gray-800 p-1 shadow-inner" role="tablist" aria-label="segmented control">
      {options.map((opt) => {
        const active = value === opt.id;
        const intent = intentById?.[opt.id] ?? "neutral";
        const activeCls =
          intent === "success"
            ? "bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-400"
            : intent === "danger"
            ? "bg-white dark:bg-gray-900 text-red-700 dark:text-red-400"
            : "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
        return (
          <m.button
            key={opt.id}
            whileTap={{ scale: 0.98 }}
            onClick={() => onChange(opt.id)}
            className={["px-3.5 py-2 text-sm font-medium rounded-xl min-w-[84px] transition", active ? `${activeCls} shadow` : "text-gray-600 dark:text-gray-300"].join(" ")}
            aria-pressed={active}
            role="tab"
          >
            {opt.label}
          </m.button>
        );
      })}
    </div>
  );
}
function ConnectivityPill({ apiMode, endpoint }: { apiMode: ApiMode; endpoint: string }) {
  const online = apiMode === "online";
  return (
    <div className={["inline-flex items-center gap-2 rounded-2xl px-2.5 py-1.5 text-xs font-medium", online ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"].join(" ")} title={endpoint}>
      <span className={["inline-block h-2.5 w-2.5 rounded-full", online ? "bg-emerald-500" : "bg-red-500"].join(" ")} aria-hidden />
      <span className="tracking-wide">{online ? "ONLINE" : "OFFLINE"}</span>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-32 text-sm text-gray-700 dark:text-gray-300 select-none">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}
type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { onValueChange?: (v: string) => void; className?: string; };
function Input({ onValueChange, className = "", disabled, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
      className={[
        "w-full rounded-2xl px-3 py-3 text-sm",
        "bg-white dark:bg-gray-800",
        "text-gray-900 dark:text-gray-100",
        "placeholder:text-gray-400 dark:placeholder:text-gray-500",
        "border border-black/10 dark:border-white/10",
        "shadow-inner outline-none caret-indigo-600",
        "focus:ring-4 focus:ring-indigo-200/60 dark:focus:ring-indigo-500/30",
        "disabled:bg-gray-100 dark:disabled:bg-gray-800/60",
        "disabled:text-gray-500",
        "disabled:border-black/5",
        "disabled:shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]",
        "cursor-auto hover:cursor-text",
        "disabled:cursor-not-allowed hover:disabled:cursor-not-allowed",
        className,
      ].join(" ")}
    />
  );
}
function SmallButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button onClick={onClick} className="rounded-xl px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-black/10 hover:bg-gray-200 dark:hover:bg-gray-700">{label}</button>;
}
function Spinner({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <m.span className="inline-block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent" style={{ borderRightColor: "transparent" }} animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: "linear", duration: 0.8 }} />
      ) : null}
    </AnimatePresence>
  );
}
function StatusPill({ status, http, duration }: { status: "idle" | "ok" | "err" | "run"; http: string; duration: number | null; }) {
  const map: Record<typeof status, { label: string; cls: string }> = {
    idle: { label: "Idle", cls: "bg-gray-100 text-gray-700" },
    run: { label: "Running", cls: "bg-blue-100 text-blue-700" },
    ok: { label: "OK", cls: "bg-green-100 text-green-700" },
    err: { label: "Error", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status];
  return (
    <m.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className={`inline-flex items-center gap-2 rounded-2xl px-3 py-1.5 text-sm ${s.cls}`}>
      <span>{s.label}</span>
      {http && <span className="text-xs opacity-70">{http}</span>}
      {duration != null && <span className="text-xs opacity-70">{duration} ms</span>}
    </m.div>
  );
}
function CodeBlock({ text }: { text: string }) {
  return (
    <div className="p-0">
      <pre className="max-h-[420px] overflow-auto px-4 py-3 text-[11px] sm:text-xs font-mono leading-5 text-gray-900 dark:text-gray-100 bg-transparent" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {text}
      </pre>
    </div>
  );
}

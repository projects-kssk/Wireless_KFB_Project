// src/app/krosy/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type RunMode = "json" | "xml";
type ViewTab = "body" | "xmlPreview";

const ENDPOINT_PROXY =
  process.env.NEXT_PUBLIC_KROSY_ENDPOINT ?? "http://localhost:3001/api/krosy";
const ENDPOINT_DIRECT =
  process.env.NEXT_PUBLIC_KROSY_DIRECT ?? "http://localhost:3001/api/krosy-direct";
const PROXY_VC =
  process.env.NEXT_PUBLIC_KROSY_FALLBACK ?? "http://localhost:3001/api/visualcontrol";

function isoNoMs(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}
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

export default function KrosyPage() {
  const [mode, setMode] = useState<RunMode>("json");
  const [tab, setTab] = useState<ViewTab>("body");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err" | "run">("idle");
  const [http, setHttp] = useState<string>("");
  const [duration, setDuration] = useState<number | null>(null);

  // inputs
  const [requestID, setRequestID] = useState<string>("1");
  const [intksk, setIntksk] = useState("950023158903");
  const [targetHostName, setTargetHostName] = useState("kssksun01");
  const [onlineDevice, setOnlineDevice] = useState(true);
  const [deviceUrl, setDeviceUrl] = useState("http://172.26.202.248/visualcontrol");

  // auto (disabled)
  const [sourceHostname, setSourceHostname] = useState("");
  const [sourceIp, setSourceIp] = useState("");
  const [sourceMac, setSourceMac] = useState("");

  // display
  const [logs, setLogs] = useState<string[]>([]);
  const [respBody, setRespBody] = useState<string>("Run the test to see response payload…");
  const [xmlPreview, setXmlPreview] = useState<string>("");
  const termRef = useRef<HTMLDivElement | null>(null);

  const accept = useMemo(
    () => (mode === "json" ? "application/json" : "application/xml"),
    [mode],
  );

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

  // pull hostname/ip/mac (ensures MAC visible)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(ENDPOINT_DIRECT, { headers: { Accept: "application/json" } });
        const j = await r.json();
        setSourceHostname(j.hostname || "");
        setSourceIp(j.ip || "");
        setSourceMac(j.mac || "");
        if (j.defaultDeviceUrl) setDeviceUrl(j.defaultDeviceUrl);
      } catch {}
    })();
  }, []);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus("run");
    setHttp("");
    setDuration(null);
    setRespBody("");
    setXmlPreview("");
    setTab("body");

    const started = performance.now();
    try {
      let res: Response;

      if (onlineDevice) {
        append(`POST ${ENDPOINT_DIRECT} (direct)`);
        res = await fetch(ENDPOINT_DIRECT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: accept },
          body: JSON.stringify({
            requestID,
            intksk,
            targetHostName,
            deviceUrl,
            sourceHostname,
          }),
        });
      } else {
        append(`POST ${ENDPOINT_PROXY} (proxy fallback)`);
        res = await fetch(ENDPOINT_PROXY, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: accept },
          body: JSON.stringify({
            intksk,
            device: sourceHostname,
            scanned: isoNoMs(),
            targetUrl: PROXY_VC, // no UI field; internal default
          }),
        });
      }

      const ms = Math.round(performance.now() - started);
      setDuration(ms);
      setHttp(`HTTP ${res.status}`);
      append(`→ HTTP ${res.status} in ${ms} ms`);

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const j = await res.json();
        setRespBody(JSON.stringify(j, null, 2));
        if (j.responseXmlPreview) setXmlPreview(formatXml(String(j.responseXmlPreview)));
        if (j.sentXmlPreview) append("sent XML preview captured.");
        if (j.usedUrl) append(`used: ${j.usedUrl}`);
      } else {
        const t = await res.text();
        setRespBody(formatXml(t));
        const used = res.headers.get("x-krosy-used-url");
        if (used) append(`used: ${used}`);
      }

      setStatus(res.ok ? "ok" : "err");
    } catch (e: any) {
      setRespBody(e?.message || "network error");
      setStatus("err");
    } finally {
      setBusy(false);
    }
  }, [accept, append, busy, requestID, intksk, targetHostName, deviceUrl, onlineDevice, sourceHostname]);

  const clearLogs = () => setLogs([]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6" style={{ paddingTop: "max(env(safe-area-inset-top),1rem)", paddingBottom: "max(env(safe-area-inset-bottom),1rem)" }}>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[20px] sm:text-2xl font-semibold text-gray-900 dark:text-gray-100">Krosy Test Console</h1>
        <StatusPill status={status} http={http} duration={duration} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
          className="rounded-3xl border border-black/5 bg-white/90 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] p-5">

          <div className="mb-4 inline-flex rounded-2xl bg-gray-100 dark:bg-gray-800 p-1">
            {(["json", "xml"] as RunMode[]).map((m) => (
              <motion.button key={m} onClick={() => setMode(m)} whileTap={{ scale: 0.98 }}
                className={["px-4 py-2 text-sm font-medium rounded-xl min-w-[72px]",
                  mode === m ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow" : "text-gray-600 dark:text-gray-300",
                ].join(" ")}>{m.toUpperCase()}</motion.button>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 p-3 mb-2">
            <div className="text-sm">
              <div className="font-medium text-gray-900 dark:text-gray-100">Online device (direct)</div>
              <div className="text-gray-600 dark:text-gray-400 text-xs">If ON, send XML straight to device and skip localhost.</div>
            </div>
            <button onClick={() => setOnlineDevice((v) => !v)}
              className={["relative h-7 w-12 rounded-full transition", onlineDevice ? "bg-green-500" : "bg-gray-300 dark:bg-gray-700"].join(" ")} aria-pressed={onlineDevice}>
              <span className={["absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white transition", onlineDevice ? "translate-x-5" : "translate-x-0"].join(" ")} />
            </button>
          </div>

          <div className="space-y-3">
            <Field label="requestID"><Input value={requestID} onChange={setRequestID} /></Field>
            <Field label="intksk"><Input value={intksk} onChange={setIntksk} /></Field>
            <Field label="targetHostName"><Input value={targetHostName} onChange={setTargetHostName} /></Field>
            <Field label="deviceUrl"><Input value={deviceUrl} onChange={setDeviceUrl} inputMode="url" /></Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="sourceHostname"><Input value={sourceHostname} onChange={setSourceHostname} /></Field>
              <Field label="ip"><Input value={sourceIp} onChange={setSourceIp} disabled /></Field>
              <Field label="mac"><Input value={sourceMac} onChange={setSourceMac} disabled /></Field>
            </div>

            <div className="flex gap-3 pt-2">
              <motion.button onClick={run} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} disabled={busy}
                className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 shadow">
                <Spinner visible={busy} />{busy ? "Sending…" : "Send"}
              </motion.button>
              <motion.button onClick={clearLogs} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}
                className="rounded-2xl px-4 py-3 text-sm font-medium bg-white text-gray-800 dark:bg-gray-900 border border-black/10">Clear logs</motion.button>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.05 }}
          className="rounded-3xl border border-black/5 bg-white/90 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <div className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 border-b border-black/5">Terminal</div>
          <div ref={termRef} className="h-[320px] overflow-auto p-4 text-[11px] sm:text-xs font-mono text-gray-900 dark:text-gray-100 leading-5">
            {logs.length === 0 ? <p className="opacity-60">Logs will appear here.</p> :
              logs.map((l, i) => (<div key={i} className="select-text whitespace-pre-wrap">{l}</div>))}
          </div>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.1 }}
        className="mt-6 rounded-3xl border border-black/5 bg-white/90 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-600 dark:text-gray-300 border-b border-black/5">
          <div className="flex items-center gap-2">
            <span>Response ({mode.toUpperCase()})</span>
            {xmlPreview && mode === "json" ? (
              <div className="ml-3 inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5">
                {(["body", "xmlPreview"] as ViewTab[]).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={["px-2.5 py-1 rounded-lg text-[11px]", tab === t ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow" : "text-gray-600 dark:text-gray-300"].join(" ")}>
                    {t === "body" ? "BODY" : "XML PREVIEW"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <SmallButton onClick={() => navigator.clipboard.writeText(tab === "xmlPreview" && xmlPreview ? xmlPreview : respBody)} label="Copy" />
        </div>
        <CodeBlock text={tab === "xmlPreview" && xmlPreview ? xmlPreview : respBody} />
      </motion.div>
    </div>
  );
}

/* UI bits */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-32 text-sm text-gray-700 dark:text-gray-300 select-none">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { onChange?: (v: string) => void }) {
  const { onChange, ...rest } = props;
  return (
    <input {...rest}
      onChange={(e) => onChange?.(e.target.value)}
      className={[
        "w-full rounded-2xl px-3 py-3 text-sm",
        "bg-white dark:bg-gray-800",
        "text-gray-900 dark:text-gray-100",
        "placeholder:text-gray-400 dark:placeholder:text-gray-500",
        "border border-black/10 dark:border-white/10",
        "shadow-inner outline-none caret-indigo-600",
        "focus:ring-4 focus:ring-indigo-200/60 dark:focus:ring-indigo-500/30",
      ].join(" ")}
    />
  );
}
function SmallButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className="rounded-xl px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-black/10 hover:bg-gray-200 dark:hover:bg-gray-700">
      {label}
    </button>
  );
}
function Spinner({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.span className="inline-block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent"
          style={{ borderRightColor: "transparent" }} animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, ease: "linear", duration: 0.8 }} />
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
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className={`inline-flex items-center gap-2 rounded-2xl px-3 py-1.5 text-sm ${s.cls}`}>
      <span>{s.label}</span>
      {http && <span className="text-xs opacity-70">{http}</span>}
      {duration != null && <span className="text-xs opacity-70">{duration} ms</span>}
    </motion.div>
  );
}
function CodeBlock({ text }: { text: string }) {
  return (
    <div className="p-0">
      <pre className="max-h-[420px] overflow-auto px-4 py-3 text-[11px] sm:text-xs font-mono leading-5 text-gray-900 dark:text-gray-100 bg-transparent"
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</pre>
    </div>
  );
}

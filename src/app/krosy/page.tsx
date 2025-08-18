// src/app/krosy/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type RunMode = "json" | "xml";
type ViewTab = "body" | "xmlPreview";
type Plugin = "visualcontrol" | "kroscada";
type KrosAction = "request" | "io" | "nio" | "cancel";

const ENDPOINT_PROXY =
  process.env.NEXT_PUBLIC_KROSY_ENDPOINT ?? "http://localhost:3002/api/krosy-offline";
const ENDPOINT_DIRECT =
  process.env.NEXT_PUBLIC_KROSY_DIRECT ?? "http://localhost:3002/api/krosy";

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

  // plugin + action
  const [plugin, setPlugin] = useState<Plugin>("visualcontrol");
  const [krosAction, setKrosAction] = useState<KrosAction>("request");

  // inputs common
  const [requestID, setRequestID] = useState<string>("1");
  const [intksk, setIntksk] = useState("830577899396"); // VC only
  const [targetHostName, setTargetHostName] = useState("kssksun01");

  // kroscada fields
  const [scancode, setScancode] = useState("830569527900");
  const [tident, setTident] = useState("P8378691");
  const [sdistance, setSdistance] = useState("20");

  // auto
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

  // bootstrap IP + MAC + hostname
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(ENDPOINT_DIRECT, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`bootstrap GET ${r.status}`);
        const j = await r.json();
        setSourceHostname(j.hostname || "");
        setSourceIp(j.ip || "");
        setSourceMac(j.mac || "");
      } catch (e: any) {
        append(`bootstrap failed: ${e?.message || e}`);
      }
    })();
  }, [append]);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus("run");
    setHttp("");
    setDuration(null);
    setRespBody("");
    setXmlPreview("");
    setTab("body");

    const payload =
      plugin === "visualcontrol"
        ? {
            action: "working",
            requestID,
            intksk,
            targetHostName,
            sourceHostname,
          }
        : {
            action: krosAction,
            requestID,
            scancode,
            tident,
            sdistance,
            targetHostName,
            sourceHostname,
          };

    append(
      `POST ${ENDPOINT_DIRECT} ${plugin === "visualcontrol" ? "[visualControl: working]" : `[kroscada: ${krosAction}]`}`,
    );

    const started = performance.now();
    try {
      const res = await fetch(ENDPOINT_DIRECT, {
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
  }, [accept, append, busy, plugin, krosAction, requestID, intksk, targetHostName, sourceHostname, scancode, tident, sdistance]);

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

          {/* Mode + Plugin pickers */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="inline-flex rounded-2xl bg-gray-100 dark:bg-gray-800 p-1">
              {(["json", "xml"] as RunMode[]).map((m) => (
                <motion.button key={m} onClick={() => setMode(m)} whileTap={{ scale: 0.98 }}
                  className={["px-4 py-2 text-sm font-medium rounded-xl min-w-[72px]",
                    mode === m ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow" : "text-gray-600 dark:text-gray-300",
                  ].join(" ")}>{m.toUpperCase()}</motion.button>
              ))}
            </div>

            <div className="inline-flex rounded-2xl bg-gray-100 dark:bg-gray-800 p-1">
              {(["visualcontrol", "kroscada"] as Plugin[]).map((p) => (
                <motion.button key={p} onClick={() => setPlugin(p)} whileTap={{ scale: 0.98 }}
                  className={["px-3 py-2 text-sm font-medium rounded-xl",
                    plugin === p ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow" : "text-gray-600 dark:text-gray-300",
                  ].join(" ")}>
                  {p === "visualcontrol" ? "VISUALCONTROL" : "KROSCADA"}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Common inputs */}
          <div className="space-y-3">
            <Field label="requestID"><Input value={requestID} onValueChange={setRequestID} /></Field>
            <Field label="targetHostName"><Input value={targetHostName} onValueChange={setTargetHostName} /></Field>

            {/* VisualControl-only */}
            {plugin === "visualcontrol" && (
              <Field label="intksk"><Input value={intksk} onValueChange={setIntksk} /></Field>
            )}

            {/* KROSCADA-only */}
            {plugin === "kroscada" && (
              <>
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Action</label>
                  <div className="inline-flex rounded-2xl bg-gray-100 dark:bg-gray-800 p-1">
                    {(["request", "io", "nio", "cancel"] as KrosAction[]).map((act) => (
                      <motion.button key={act} onClick={() => setKrosAction(act)} whileTap={{ scale: 0.98 }}
                        className={["px-3 py-2 text-xs font-medium rounded-xl",
                          krosAction === act ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow" : "text-gray-600 dark:text-gray-300",
                        ].join(" ")}>
                        {act.toUpperCase()}
                      </motion.button>
                    ))}
                  </div>
                </div>
                <Field label="scancode"><Input value={scancode} onValueChange={setScancode} /></Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="tident"><Input value={tident} onValueChange={setTident} /></Field>
                  <Field label="sdistance"><Input value={sdistance} onValueChange={setSdistance} /></Field>
                </div>
              </>
            )}

            {/* Host identity stacked */}
            <div className="space-y-3 pt-2">
              <Field label="sourceHostname">
                <Input value={sourceHostname} onValueChange={setSourceHostname} />
              </Field>

              <Field label="ip">
                <Input value={sourceIp} disabled />
              </Field>

              <Field label="mac">
                <Input value={sourceMac} disabled className="font-mono tracking-wider w-full" />
              </Field>
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
type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  onValueChange?: (v: string) => void;
  className?: string;
};
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
        // disabled look + cursor behavior
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

// src/app/krosy/page.tsx
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type RunMode = "json" | "xml";

const ENDPOINT = "http://localhost:3001/krosy";

function isoNoMs(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

export default function KrosyPage() {
  const [mode, setMode] = useState<RunMode>("json");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err" | "run">("idle");
  const [http, setHttp] = useState<string>("");
  const [duration, setDuration] = useState<number | null>(null);

  const [intksk, setIntksk] = useState("950023158903");
  const [device, setDevice] = useState("ksmiwct07");
  const [scanned, setScanned] = useState(isoNoMs());
  const [targetUrl, setTargetUrl] = useState("http://localhost:3000/visualcontrol");

  const [logs, setLogs] = useState<string[]>([]);
  const [respBody, setRespBody] = useState<string>("Run the test to see response payload…");
  const termRef = useRef<HTMLDivElement | null>(null);

  const accept = useMemo(
    () => (mode === "json" ? "application/json" : "application/xml"),
    [mode]
  );

  const append = useCallback((line: string) => {
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    setLogs((prev) => [...prev, `[${t}] ${line}`].slice(-800));
    queueMicrotask(() => {
      const el = termRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus("run");
    setHttp("");
    setDuration(null);
    setRespBody("");

    append(`POST ${ENDPOINT} Accept=${accept}`);
    const started = performance.now();

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: accept },
        body: JSON.stringify({ intksk, device, scanned, targetUrl }),
      });
      const ms = Math.round(performance.now() - started);
      setDuration(ms);
      setHttp(`HTTP ${res.status}`);
      append(`→ HTTP ${res.status} in ${ms} ms`);

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const j = await res.json();
        setRespBody(JSON.stringify(j, null, 2));
        if (j.requestXmlPath) append(`log: ${j.requestXmlPath}`);
        if (j.responseXmlPath) append(`log: ${j.responseXmlPath}`);
        if (j.metaPath) append(`log: ${j.metaPath}`);
      } else {
        const t = await res.text();
        setRespBody(t);
        append(`content-type: ${ct || "(unknown)"} | ${t.length} bytes`);
      }

      setStatus(res.ok ? "ok" : "err");
    } catch (e: any) {
      const msg = e?.message || "network error";
      setRespBody(msg);
      setStatus("err");
      append(`ERROR: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [accept, append, busy, device, intksk, scanned, targetUrl]);

  const resetNow = () => setScanned(isoNoMs());
  const clearLogs = () => setLogs([]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Krosy Test Console</h1>

        <StatusPill status={status} http={http} duration={duration} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Control Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="rounded-3xl border border-black/5 bg-white/80 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] p-5"
        >
          {/* Mode segmented control (iOS style) */}
          <div className="mb-4">
            <div className="inline-flex rounded-2xl bg-gray-100 dark:bg-gray-800 p-1">
              {(["json", "xml"] as RunMode[]).map((m) => (
                <motion.button
                  key={m}
                  onClick={() => setMode(m)}
                  whileTap={{ scale: 0.98 }}
                  className={[
                    "px-4 py-1.5 text-sm font-medium rounded-xl transition",
                    mode === m
                      ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow"
                      : "text-gray-600 dark:text-gray-300",
                  ].join(" ")}
                >
                  {m.toUpperCase()}
                </motion.button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Field label="intksk">
              <Input value={intksk} onChange={setIntksk} />
            </Field>
            <Field label="device">
              <Input value={device} onChange={setDevice} />
            </Field>
            <Field label="scanned" rightAddon={<SmallButton onClick={resetNow} label="now" />}>
              <Input value={scanned} onChange={setScanned} />
            </Field>
            <Field label="targetUrl">
              <Input value={targetUrl} onChange={setTargetUrl} />
            </Field>

            <div className="flex gap-3 pt-2">
              <motion.button
                onClick={run}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 shadow"
              >
                <Spinner visible={busy} />
                {busy ? "Running" : "Run test (api/krosy)"}
              </motion.button>

              <motion.button
                onClick={clearLogs}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className="rounded-2xl px-4 py-2 text-sm font-medium bg-white dark:bg-gray-900 border border-black/10"
              >
                Clear logs
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Terminal */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.05 }}
          className="rounded-3xl border border-black/5 bg-white/80 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.06)]"
        >
          <div className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 border-b border-black/5">
            Terminal
          </div>
          <div
            ref={termRef}
            className="h-[300px] overflow-auto p-4 text-xs font-mono text-gray-900 dark:text-gray-100"
          >
            {logs.length === 0 ? (
              <p className="opacity-60">Logs will appear here.</p>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="select-text">
                  {l}
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      {/* Response Viewer */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.1 }}
        className="mt-6 rounded-3xl border border-black/5 bg-white/80 dark:bg-gray-900/70 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.06)]"
      >
        <div className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 border-b border-black/5">
          Response ({mode.toUpperCase()})
        </div>
        <textarea
          value={respBody}
          onChange={(e) => setRespBody(e.target.value)}
          rows={16}
          className="w-full resize-y bg-transparent outline-none p-4 text-xs font-mono text-gray-900 dark:text-gray-100"
        />
      </motion.div>

      <p className="mt-4 text-xs text-gray-500">
        Flow: client → <code>/krosy</code> on 3001 → <code>/test-visualcontrol</code> →{" "}
        <code>http://localhost:3000/visualcontrol</code>.
      </p>
    </div>
  );
}

/* ---------- UI atoms ---------- */

function Field({
  label,
  children,
  rightAddon,
}: {
  label: string;
  children: React.ReactNode;
  rightAddon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 text-sm text-gray-700 dark:text-gray-300">{label}</label>
      <div className="flex-1 relative">
        {children}
        {rightAddon && <div className="absolute right-1.5 top-1.5">{rightAddon}</div>}
      </div>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={[
        "w-full rounded-2xl px-3 py-2 text-sm",
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
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 border border-black/10"
    >
      {label}
    </button>
  );
}

function Spinner({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.span
          key="spn"
          className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/70 border-t-transparent"
          style={{ borderRightColor: "transparent" }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, ease: "linear", duration: 0.8 }}
        />
      ) : null}
    </AnimatePresence>
  );
}

function StatusPill({
  status,
  http,
  duration,
}: {
  status: "idle" | "ok" | "err" | "run";
  http: string;
  duration: number | null;
}) {
  const map: Record<typeof status, { label: string; cls: string }> = {
    idle: { label: "Idle", cls: "bg-gray-100 text-gray-700" },
    run: { label: "Running", cls: "bg-blue-100 text-blue-700" },
    ok: { label: "OK", cls: "bg-green-100 text-green-700" },
    err: { label: "Error", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status];
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`inline-flex items-center gap-2 rounded-2xl px-3 py-1 text-sm ${s.cls}`}
    >
      <span>{s.label}</span>
      {http && <span className="text-xs opacity-70">{http}</span>}
      {duration != null && <span className="text-xs opacity-70">{duration} ms</span>}
    </motion.div>
  );
}

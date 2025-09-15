// src/lib/logger.ts
import fs from "node:fs";
import path from "node:path";

type Level = "debug" | "info" | "warn" | "error";
const levels: Level[] = ["debug","info","warn","error"];

// Global enable: honor either LOG_ENABLE or LOG_VERBOSE (single switch requested)
const ENABLED = ((process.env.LOG_ENABLE ?? "0") === "1") || ((process.env.LOG_VERBOSE ?? "0") === "1");
const DIR     = process.env.LOG_DIR || "./logs";
const BASE    = process.env.LOG_FILE_BASENAME || "app";
const MIN     = (process.env.LOG_LEVEL || "info").toLowerCase() as Level;

// Monitor-only mode: show only tag=="monitor" (except allow errors always)
const MONITOR_ONLY = (process.env.LOG_MONITOR_ONLY ?? "0") === "1";

// Per-tag minimum overrides: e.g. "redis=warn,ksk-lock=warn,api:krosy-offline=warn"
const TAG_LEVELS_RAW = process.env.LOG_TAG_LEVELS || "";
const TAG_MIN: Record<string, Level> = {};
for (const pair of TAG_LEVELS_RAW.split(",")) {
  const [k, v] = pair.split("=").map(s => (s || "").trim());
  if (!k || !v) continue;
  const lv = v.toLowerCase();
  if ((levels as any).includes(lv)) TAG_MIN[k] = lv as Level;
}

// Sensible defaults for noisy tags unless explicitly overridden (and not in DEBUG mode)
if ((process.env.DEBUG ?? "0") !== "1") {
  if (!("redis" in TAG_MIN))             TAG_MIN["redis"] = "warn";
  if (!("ksk-lock" in TAG_MIN))          TAG_MIN["ksk-lock"] = "warn";
  if (!("api:krosy-offline" in TAG_MIN)) TAG_MIN["api:krosy-offline"] = "warn";
  if (!("api:serial/check" in TAG_MIN))  TAG_MIN["api:serial/check"] = "warn";
  if (!("api:serial" in TAG_MIN))        TAG_MIN["api:serial"] = "warn";
}

function levelIdx(l: Level) { return levels.indexOf(l); }
function minFor(tag?: string): Level {
  if (tag && TAG_MIN[tag] ) return TAG_MIN[tag];
  return MIN;
}

let day = ""; let stream: fs.WriteStream | null = null;
let errorStream: fs.WriteStream | null = null;

function pruneOldAppLogs(dir: string, base: string, maxAgeDays = 31) {
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    for (const ent of files) {
      if (!ent.isFile()) continue;
      const name = ent.name;
      // match base-YYYY-MM-DD.log
      const m = name.match(new RegExp(`^${base}-\\d{4}-\\d{2}-\\d{2}\\.log$`));
      if (!m) continue;
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        const ts = st.mtimeMs || st.ctimeMs || 0;
        if (now - ts > maxAgeMs) fs.rmSync(p, { force: true });
      } catch {}
    }
  } catch {}
}

function ensureStream() {
  if (!ENABLED) return null;
  const d = new Date().toISOString().slice(0,10);
  if (d !== day || !stream) {
    try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
    try { stream?.end(); } catch {}
    stream = fs.createWriteStream(path.join(DIR, `${BASE}-${d}.log`), { flags: "a" });
    day = d;
    // prune older than ~1 month
    pruneOldAppLogs(DIR, BASE, 31);
  }
  return stream;
}

// Always-on error sink, independent of LOG_ENABLE
function ensureErrorStream() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
  if (!errorStream) {
    try { errorStream = fs.createWriteStream(path.join(DIR, `errors.log`), { flags: "a" }); } catch {}
  }
  return errorStream;
}

function write(level: Level, tag: string | undefined, msg: string, extra?: any) {
  // Global filter: only monitor unless it's an error
  if (MONITOR_ONLY && tag !== "monitor" && level !== "error") return;
  // Per-tag & global min
  const effMin = minFor(tag);
  const allow = ENABLED && levelIdx(level) >= levelIdx(effMin);
  const line = JSON.stringify({ ts: new Date().toISOString(), level, tag, msg, ...(extra?{extra}: {}) });
  // console
  (level === "debug" ? console.log : (console as any)[level])(`[${tag ?? "app"}] ${msg}`);
  // primary app file (honors LOG_ENABLE / LOG_VERBOSE and min levels)
  if (allow) {
    try { ensureStream()?.write(line + "\n"); } catch {}
  }
  // error-only sink (always on; ignores LOG_ENABLE)
  if (level === "error") {
    try { ensureErrorStream()?.write(line + "\n"); } catch {}
  }
}

export const LOG = {
  tag(t: string) {
    return {
      debug: (m: string, e?: any) => write("debug", t, m, e),
      info:  (m: string, e?: any) => write("info",  t, m, e),
      warn:  (m: string, e?: any) => write("warn",  t, m, e),
      error: (m: string, e?: any) => write("error", t, m, e),
    };
  },
  debug: (m: string, e?: any) => write("debug", undefined, m, e),
  info:  (m: string, e?: any) => write("info",  undefined, m, e),
  warn:  (m: string, e?: any) => write("warn",  undefined, m, e),
  error: (m: string, e?: any) => write("error", undefined, m, e),
};

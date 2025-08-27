// src/lib/logger.ts
import fs from "node:fs";
import path from "node:path";

type Level = "debug" | "info" | "warn" | "error";
const levels: Level[] = ["debug","info","warn","error"];

const ENABLED = (process.env.LOG_ENABLE ?? "0") === "1";
const DIR     = process.env.LOG_DIR || "./logs";
const BASE    = process.env.LOG_FILE_BASENAME || "app";
const MIN     = (process.env.LOG_LEVEL || "info").toLowerCase() as Level;

let day = ""; let stream: fs.WriteStream | null = null;

function ensureStream() {
  if (!ENABLED) return null;
  const d = new Date().toISOString().slice(0,10);
  if (d !== day || !stream) {
    try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
    try { stream?.end(); } catch {}
    stream = fs.createWriteStream(path.join(DIR, `${BASE}-${d}.log`), { flags: "a" });
    day = d;
  }
  return stream;
}

function write(level: Level, tag: string | undefined, msg: string, extra?: any) {
  if (!ENABLED || levels.indexOf(level) < levels.indexOf(MIN)) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, tag, msg, ...(extra?{extra}: {}) });
  // console
  (level === "debug" ? console.log : (console as any)[level])(`[${tag ?? "app"}] ${msg}`);
  // file
  try { ensureStream()?.write(line + "\n"); } catch {}
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

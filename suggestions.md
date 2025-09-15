# Suggestions: Main Flow and Logging

This document highlights concrete, incremental improvements for the app’s main flow (Setup → Check → OK + Cleanup) and the logging pipeline. Each item is actionable and scoped to minimize risk while improving robustness, debuggability, and maintainability.

## 1) Main Flow (UI + API)

- Extract MainApplicationUI logic into focused hooks/components
  - Problem: `src/components/Layout/MainApplicationUI.tsx` is very large and mixes UI with orchestration (serial, Redis, Krosy, cleanup), making it hard to reason about lifecycle and side‑effects.
  - Action:
    - Create hooks: `useCheckpoint()`, `useCleanup()`, `useRehydrate()`, `useScanFlow()` and move corresponding logic.
    - Keep the component <300–500 lines; co-locate types next to hooks.

- Concurrency guard for checkpoint sends (explicit)
  - Current: `checkpointMacPendingRef` prevents overlapping sends; good. Make it explicit per‑KSK too to avoid rare duplicates after hot refresh.
  - Action: Track `pendingByKskRef: Map<string,boolean>` and check before each POST.

- Ensure intksk is always present in checkpoint payloads
  - Fixed in UI (include `intksk` even in XML mode). Mirror on API: validate `intksk` extracted when `workingDataXml` provided and add if omitted.
  - Files: `src/app/api/krosy/checkpoint/route.ts` (after XML parse), `src/app/api/krosy-offline/checkpoint/route.ts`.

- Backoff with jitter for checkpoint errors
  - Current: fixed 60–120s blocks.
  - Action: use exponential backoff with jitter to smooth contention (e.g., base 20s → max 2m).

- Finalize ordering guards
  - Current: Post‑reset cleanup now waits while checkpoint is pending; great.
  - Action: Move `setMacAddress("")` until after `sendCheckpointForMac` resolves for slightly simpler effect order and fewer “no mac bound” branches in logs.

- XML read “ensure” policy
  - Current: UI may hit `/api/aliases/xml/ensure` (retry once) when `404`.
  - Action: Add small, per‑KSK cooldown so ensure doesn’t get spammed on repeated scans (e.g., 5s per KSK).

- Simplify settings state in MainApplicationUI
  - Current: Settings view is disabled in the main shell; vestigial state remains.
  - Action: Remove unused `settingsConfiguration`/`settingsBranches` states and helper functions.

## 2) Serial / CHECK path

- Correlate CHECK requests with rid
  - Current: Some responses add `X-Req-Id`. Ensure `POST /api/serial/check` and `POST /api/serial` set and echo rid so client logs can match server entries.
  - Files: `src/app/api/serial/route.ts`, `src/lib/rid.ts` usage.

- Tighten pin extraction from sequence
  - Current: Ignores when no comma in `objPos` (correct) and handles latch with trailing `,C`.
  - Action: Add small schema validation to reject pins out of allowable range and log a warning when silently dropped.

## 3) Logging Pipeline

- Single toggle + always‑on errors
  - Done: `LOG_VERBOSE=1` enables app/monitor/aliases‑XML logs; `errors.log` always on.
  - Action: Add a size/age rotation for `logs/errors.log` (e.g., rollover at 10MB, keep 3 files) to avoid unbounded growth.

- Standardize correlation across logs
  - Current: `rid` added in several places; monitor logs include `rid` for POST /api/serial, Krosy routes include `requestID`.
  - Action: Ensure every API route attaches `X-Req-Id` and includes it in JSON lines (app log, monitor log, krosy logs meta). Consider a helper: `withReqId(res, rid)`.

- Consistent tag taxonomy
  - Current tags: `monitor`, `api:serial`, `api:serial/check`, `api:krosy(-offline)`, `aliases:xml`, `ksk-lock`, `redis`.
  - Action: Document tags and recommended levels in `docs/LOGGING.md` with examples; add a constants file for tag names to avoid typos.

- JSON schema for file logs
  - Action: Define minimal fields (`ts`, `level`, `tag`, `rid`, `mac`, `kssk`, `event`, `msg`) and update writers to always include when available.

- Sampling for verbose monitors
  - Action: Optional `LOG_MONITOR_SAMPLE=0.0..1.0` to keep 100% in dev and sample in prod if needed.

- Redaction
  - Action: If future payloads may include sensitive data, add a redaction step in logger (e.g., mask IPs or XML segments) based on `LOG_REDACT=1`.

## 4) API: Krosy routes

- Ensure `intksk` labeling for all logs
  - Action: After parsing `workingDataXml`, inject `intksk` into response headers/meta if missing so folder names never fall back to `no-intksk`.

- Unify online/offline request builders
  - Action: Factor shared XML build into `src/lib/krosyXml.ts` to avoid drift between online/offline endpoints.

- Explicit timeouts + surfaces
  - Current: timeouts exist; ensure each await has a bounded timeout and logs a structured error entry to `errors.log` with `phase`.

## 5) Redis interactions

- Pipeline alias clear + verify
  - Action: Wrap clear/verify in a server endpoint that uses a single pipeline/transaction to reduce flapping between reads and writes.

- TTLs and indices
  - Action: Reconfirm TTL policies for keys written during monitor/check; document in `docs/PROCESS-FLOW.md` (e.g., `kfb:lastpins:*`).

## 6) Developer Experience

- Type safety for env
  - Action: Add a lightweight `src/lib/env.ts` to parse envs once with defaults and types. Import from it instead of `process.env` scattered across files.

- Lint rules for large files and console
  - Action: Add an ESLint rule to flag files > 800 lines and non‑tagged `console.*` calls (encourage `LOG.tag(...).info()` instead).

- Docs
  - Action: Add `docs/LOGGING.md` with examples for enabling logs, locating files, and reading entries, including the new `errors.log`.

## 7) Observability (optional stretch)

- HTTP access log (dev only)
  - Action: Add a simple middleware to log method, path, status, rid to app log when `LOG_VERBOSE=1`.

- Health snapshot endpoint for Redis and ESP
  - Action: `GET /api/health` that aggregates `ESP STATUS`, Redis `PING`, and returns a compact JSON; useful for station dashboards.

---

If you want, I can start by extracting `useCheckpoint()` and adding error log rotation. Those two changes are self‑contained and reduce risk while paying dividends immediately.


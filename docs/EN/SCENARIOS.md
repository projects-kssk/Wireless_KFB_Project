# Operational Scenarios, Gaps, and Suggestions

This document enumerates key scenarios across Setup, Check, Electron, Scanners, and Logging; flags known gaps or non‑goals; and proposes improvements.

## Setup Scenarios (Scan MAC → scan up to 3 KSKs)
- Happy path (online):
  - Acquire lock → fetch Krosy XML via `/api/krosy` → persist aliases via `/api/aliases` → program ESP (`/api/serial`) → heartbeat → OK.
- Happy path (offline):
  - Acquire lock → fetch via `/api/krosy-offline` (proxy HTTP) → persist aliases → program ESP → OK.
- Redis unavailable or required by policy:
  - `/api/ksk-lock` returns 503; Setup stops. Suggest: offline UI hint + retry button.
- Lock conflict:
  - `/api/ksk-lock` returns 409; surface conflict info (owner station if known).
- Krosy request returns no XML/WorkingData:
  - Pins extracted = []; Setup shows "Krosy configuration error: no PINS". Suggest: show link to saved XML log path.
- Alias persistence fails mid‑flight:
  - Setup can continue to ESP; union may be incomplete. Suggest: retry background persist + indicator.
- ESP write fails:
  - If `NEXT_PUBLIC_SETUP_ALLOW_NO_ESP=0` → release lock and reset; else → allow success. Suggest: show port/baud info and last health line.
- Heartbeat TTL expires during work:
  - Lock disappears from station list; heartbeat next PATCH will re‑assert if owned. Suggest: visible TTL countdown per slot.

## Check (Dashboard) Scenarios
- Rehydrated and union available:
  - `/api/aliases?mac&all=1` returns items; Check builds groups and flat view; OK shows.
- Sparse/empty union:
  - Check in `merge` mode (default) may still succeed with client pins; UI shows fewer names. Suggest: nudge to rescan Setup.
- RESULT success path (live):
  - OK overlay + optional checkpoint → Redis cleanup (aliases + locks). Works even if checkpoint fails.
- RESULT failure path:
  - Failures highlighted; lock remains until exit/cleanup. Suggest: a "Release locks" utility on error.
- SSE not connected:
  - OK overlay may rely on UI force‑OK; polling still drives scanning. Suggest: UI indicator for SSE health.

## Scanners
- Single scanner on non‑default index:
  - Indices configurable; path resolution by tail; polling fallback available.
- Two scanners (dashboard + setup):
  - Distinct indices supported. Suggest: UI selection when mismatch is detected.
- Device unplug / permissions issue:
  - SSE shows `scanner/error`; dashboard setup shows “not detected” badge. Suggest: one‑click diagnostics (list serial ports).

## Electron (two windows)
- Dual window flow (`/` and `/setup`) opens after server ready.
- Single monitor: windows maximize; dual monitor: both go full screen.
- Server failure/port busy:
  - Electron waits; if timeout, no windows appear. Suggest: detect and prompt to retry/change port.

## Logging & Retention
- App logs: daily, pruned ~31 days.
- Monitor logs: daily under monthly folders, pruned ~31 days.
- Krosy logs (request/checkpoint): monthly folders with per‑request subfolders, pruned ~31 days.
- Suggest:
  - Add optional gzip for logs older than N days.
  - Expose retention days as env.

## Environment & Config Scenarios
- Station identity missing:
  - Some features (locks) won’t work. Suggest: startup check and banner if `NEXT_PUBLIC_STATION_ID` unset.
- Online/offline mismatch:
  - Krosy can error; saved logs help. Suggest: connectivity probe button on Setup.
- Redis URL wrong:
  - Locks and aliases fail; UI shows errors. Suggest: health endpoint `/api/health` that checks Redis + Krosy + Serial.

## Known Gaps / Not Implemented
- Testing:
  - No automated test suite; only type‑check and lint. Suggest: add minimal Jest for helpers + API smoke in CI.
- Lint config:
  - ESLint v9 requires new config; script `npm run lint` warns. Suggest: migrate to eslint.config.js.
- UI naming:
  - Setup code still uses `kssk` in some variable names/panel IDs (cosmetic). Suggest: rename to `ksk` for consistency.
- Legacy folder:
  - Empty `src/app/api/kssk-lock/` remains. Suggest: delete directory in repo.
- Operational UI tools:
  - No UI for lock management or aliases inspection; only endpoints. Suggest: admin page with lock list and clear actions.
- Observability:
  - No metrics/health endpoint; logs only. Suggest: `/api/health` and `/api/metrics` with counters (locks, scans, checks, failures).
- Log noise control:
  - Per‑tag levels supported; no live toggle. Suggest: expose in Settings.
- Security:
  - No auth; assumed local operator. Suggest: role‑gated endpoints if network‑exposed.
- Packaging:
  - No macOS/Windows packaging defined. Suggest: extend electron‑builder targets if needed.
- Config editability:
  - Env‑driven; no UI to edit/preview. Suggest: a read‑only config page to reduce drift.

## Quick Suggestions (High Value)
- Add `/api/health` with:
  - Redis ping, Krosy TCP probe (online mode), Serial presence, SSE status, and current station locks count.
- Create Admin page (dev‑only), with:
  - Locks table (clear/force), Aliases list per MAC, SSE status, recent monitor lines.
- Make retention days configurable:
  - `APP_LOG_RETENTION_DAYS`, `MONITOR_LOG_RETENTION_DAYS`, `KROSY_LOG_RETENTION_DAYS`.
- Add minimal Jest tests:
  - XML pretty‑printer, pin extractor, alias union builder, serial objPos parser.
- Finalize KSK variable names in Setup code for clarity and reduce confusion.

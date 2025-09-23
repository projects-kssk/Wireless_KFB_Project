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
  - Locks and aliases fail; UI shows errors. Note: `/api/health` already reports Redis + Krosy + Serial status; consider surfacing it in the UI.

## Known Gaps / Not Implemented
- Testing:
  - Still no automated smoke tests; `npm run type-check` currently prints "Skipping type-check". Suggest: re-enable strict type checks and cover core helpers with Jest.
- UI naming:
  - Setup code continues to use `kssk` in several variable names/panel IDs. Suggest: rename to `ksk` for consistency.
- Operational UI tools:
  - No UI for lock management or aliases inspection; only endpoints. Suggest: admin page with lock list and clear actions.
- Log noise control:
  - Per-tag levels exist, but there is no runtime toggle. Suggest: surface switches in Settings.
- Security:
  - No auth; assumed local operator. Suggest: role-gated endpoints if the app is network-exposed.
- Packaging:
  - Only Linux AppImage build target is configured. Suggest: add macOS/Windows targets in electron-builder if required.
- Config visibility:
  - Env-driven; no read-only config view for operators. Suggest: add a configuration summary page to reduce drift.

## Quick Suggestions (High Value)
- Surface `/api/health` results in the UI:
  - Redis ping, Krosy TCP probe (online mode), Serial presence, SSE status, and current station locks count are already reported.
- Create Admin page (dev‑only), with:
  - Locks table (clear/force), Aliases list per MAC, SSE status, recent monitor lines.
- Make retention days configurable:
  - `APP_LOG_RETENTION_DAYS`, `MONITOR_LOG_RETENTION_DAYS`, `KROSY_LOG_RETENTION_DAYS`.
- Add minimal Jest tests:
  - XML pretty‑printer, pin extractor, alias union builder, serial objPos parser.
- Finalize KSK variable names in Setup code for clarity and reduce confusion.

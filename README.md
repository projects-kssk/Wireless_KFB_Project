<div align="center">

# Wireless KFB GUI

Desktop app for scanning KFB codes, monitoring ESP devices via serial, and coordinating production with Redis locks. Built with Next.js (App Router) and packaged for Electron.

<br/>

![badge-node](https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white)
![badge-next](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![badge-electron](https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white)
![badge-typescript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![badge-license](https://img.shields.io/badge/License-MIT-informational)

<br/>

</div>

This README explains features, architecture, APIs, configuration, and how to run and debug the app.

## Overview
- UI: React + Tailwind driven dashboard (Next.js App Router) packaged inside Electron.
- Serial: Communicates with an ESP over a configured TTY for MONITOR/CHECK flows.
- Scanners: Listens to barcode scanners on `/dev/ttyACM*` and consumes the scanned KFB.
- Locks: Uses Redis for station-scoped KSK locks with an in-memory fallback.
- Setup derives pin → branch names from Krosy XML and stores them for CHECK-only flows.
- State: No localStorage usage; all persisted state lives in Redis and server memory.

Flow summary
- Scan KFB → fetch branches/config → send MONITOR to ESP (pins + MAC) → run CHECK → overlay OK/ERROR + failures.
- Locks endpoints manage station ownership of KSK during work.

## Run & Build
- Dev (starts server, Next, and Electron): `npm run dev`
- Only the monitor/console view: `npm run logs:monitor`
- Full debug logging: `npm run logs:full`
- Package Electron (AppImage): `npm run build`
- ARM64 AppImage: `npm run build:arm64`

Prerequisites
- Node 20+
- Docker (for Redis helper script) or an accessible Redis instance
- Redis reachable; Postgres no longer required for the production flow.

## Key Environment Variables
- Serial/ESP
  - `ESP_TTY_PATH=/dev/ttyUSB0` (or `ESP_TTY`), `ESP_BAUD` (default 115200)
  - `ESP_PING_CMD` (optional; supports `{payload}` placeholder; `{mac}` is ignored if present)
  - `ESP_HEALTH_PROBE` = `never|if-stale|always` (health policy)
- Scanners
  - `SCANNER_TTY_PATHS=/dev/ttyACM0,/dev/ttyACM1` (plus optional `SCANNER2_TTY_PATH`)
- Redis
  - `REDIS_URL=redis://127.0.0.1:6379`
  - `KSK_REQUIRE_REDIS=1` (require Redis; otherwise memory fallback is used)
  - `KSK_DEFAULT_TTL_SEC=172800` (server default TTL for locks; 2 days)
  - `NEXT_PUBLIC_KSK_TTL_SEC=172800` (client TTL used by Setup page; 2 days)
// Postgres is no longer required for this flow.
- UI behavior
  - `NEXT_PUBLIC_KFB_REGEX` (accept pattern for KFB input)
  - `NEXT_PUBLIC_STATION_ID` (used for lock ownership)
- Logging (defaults set in `.env`)
  - `LOG_VERBOSE=1` – enable verbose logging (app file logs, monitor logs, aliases‑XML reads)
  - `LOG_ENABLE=1`, `LOG_DIR=./logs`, `LOG_LEVEL=info`
  - `LOG_MONITOR_ONLY=1` (print only monitor-tag info/warn)
  - `LOG_MONITOR_START_ONLY=1` (show only MONITOR start lines; failures still appear)
  - `LOG_TAG_LEVELS=redis=warn,ksk-lock=warn` (optional per-tag overrides)

<div align="center">

# KFB Wireless Clip Tester

Reliable station app for scanning a KFB board (MAC), programming pins, and confirming success — with optional Krosy checkpoint and automatic cleanup.

<p>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-desktop-blue" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-App%20Router-black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-blue" />
  <img alt="Redis" src="https://img.shields.io/badge/Redis-required-red" />
</p>

</div>

— Simple for operators. Powerful for engineers.

## What it does (non‑technical)
- Scan a device’s MAC address and run tests on its pins.
- Show a clear “OK” when everything passes.
- Optionally send a “checkpoint” to a Krosy server for record keeping.
- Clean up temporary data automatically after success.

## Who uses this
- Operators on the production line (scan, see status, move on).
- Technicians who need quick feedback and basic diagnostics.

## Quick start (operators)
1) Power the station and plug in the USB devices. Make sure the green status lights for the scanners and server appear in the header.
2) Scan the QR/barcode on the device (or type in the MAC address).
3) Wait for the app to show the results. A big “OK” means you’re done.
4) If there’s a problem, the app shows which pins failed. Re‑test or ask a technician.

Tip: If you see a message about “locks” or “Redis”, call support — it’s a server connection issue, not your fault.

## Daily use
- One device at a time. Scan clearly, wait for the result, then proceed.
- The app removes old data automatically after a success.
- The “Settings” panels are hidden in this build to keep things simple.

## Need help?
- Troubleshooting guide: docs/ERRORS.md
- Full process (what happens behind the scenes): docs/PROCESS-FLOW.md
- Application behavior (UI flow): docs/MAINAPPLICATION.md

---

## For programmers and technicians
- Read the detailed Programmer’s Guide: PROGRAMMERS.md
- Quick links to internal docs:
  - AGENTS.md – repo conventions and agent notes
  - docs/SETUP.md – how the Setup/Krosy side works
  - docs/PROCESS-FLOW.md – end‑to‑end behavior
  - docs/ERRORS.md – practical checks and where to look
  - suggestions.md – backlog of proposed improvements

Repo Structure (developer overview)
- src/app/ – Next.js App Router pages and API routes
- src/components/ – React components (PascalCase .tsx)
- src/lib/ – Shared utilities (serial, redis, logger, rid)
- main/ – Electron main process (main.ts, preload.ts, menu.ts)
- server.ts and dist-server/ – Node server entry and build output
- public/ and assets/ – Static assets
- scripts/ – Dev helpers (Redis/locks)
- logs/, monitor.logs/, .krosy-logs/

## Logging Cheat‑Sheet
- Console (concise):
  - `MONITOR start mac=… kssk=… normal(N)=[…] contactless(M)=[…]`
  - `MONITOR ok …` (suppressed when start-only is enabled)
  - `CHECK fail mac=… failures=[…]` (always printed)
  - Errors from any tag always show
- Files (structured JSON):
  - App logs: `./logs/app-YYYY-MM-DD.log` (when `LOG_ENABLE=1` or `LOG_VERBOSE=1`).
  - Errors: `./logs/errors.log` (error‑level only; always on, independent of LOG_ENABLE).
  - Monitor logs: `./monitor.logs/YYYY-MM/monitor-YYYY-MM-DD.log` (enabled by LOG_VERBOSE=1).
  - Aliases XML reads: `./logs/aliases-xml-reads-YYYY-MM-DD.log` (enabled by LOG_VERBOSE=1).

---

## More documentation
- PROGRAMMERS.md – development guide (build, run, code structure)
- AGENTS.md – repository rules and conventions
- docs/SETUP.md – Setup page and Krosy extraction
- docs/MAINAPPLICATION.md – Main application (dashboard) behavior
- docs/PROCESS-FLOW.md – End‑to‑end process
- docs/ERRORS.md – Troubleshooting and checks

## API Reference

Base URL in dev: `http://localhost:3003`

Serial/Monitor
- `GET /api/serial?probe=1`
  - Probes ESP health (policy via `ESP_HEALTH_PROBE`)
  - Returns: `{ ok: boolean, raw: string }`
- `POST /api/serial`
  - Body A: `{ normalPins?: number[], latchPins?: number[], mac: "AA:BB:..." , kssk?: string }`
  - Body B: `{ sequence: [...krosy items...], mac: "AA:...", kssk?: string }` (extracts pins)
  - Sends `MONITOR` to ESP and returns `{ success, cmd, normalPins, latchPins, mac }`
  - Also writes a concise monitor line and a detailed JSON entry to `monitor.logs`
- `POST /api/serial/check`
  - Body: `{ pins: number[], mac: string }`
  - Sends `CHECK`, waits briefly for RESULT, returns `{ failures: number[] }`
  - Emits concise monitor line on failure (or suppressed ok when start-only)

Scanners
- `GET /api/serial/scanner`
  - Poll endpoint returning last scan `{ code, path, error, retryInMs }` (peek/consume)
- `GET /api/serial/events`
  - Server-Sent Events stream with snapshots and updates:
    - device list, scanner paths, scanner open/close/errors, scans, net iface info, ESP health

KSK Locks (Redis; in-memory fallback when Redis is unavailable)
- `POST /api/ksk-lock`
  - Body: `{ kssk: string, mac?: string, stationId: string, ttlSec?: number }`
  - Creates a lock with TTL; returns `{ ok: true }` or `409 locked`
- `GET /api/ksk-lock?kssk=...`
  - Returns `{ locked: boolean, existing: {..., expiresAt} | null }`
- `GET /api/ksk-lock?stationId=JETSON-01`
  - Lists active locks for station: `{ locks: LockRow[] }`
- `PATCH /api/ksk-lock`
  - Body: `{ kssk, stationId, ttlSec }` → touch TTL if you’re the owner
- `DELETE /api/ksk-lock?kssk=...&stationId=...`
  - Deletes if called by owner (or `force=1`)

Note: Legacy Postgres-backed branches/config endpoints were removed in favor of using Krosy XML data from Setup.

## CLI Helpers
- Start Redis (Docker): `npm run redis:up` (and `npm run redis:logs`)
- Print locks (station-scoped): `npm run locks:station -- --id=JETSON-01`
- Watch with regex filter: `npm run locks:station:watch -- --id=JETSON-01 --match=/^8305779/`

## Development Notes
- Electron waits for `PORT` (default 3003) then opens the app.
- `next.config.ts` externalizes `serialport` on server and disables it for browser builds.
- SSE wiring (`/api/serial/events`) keeps the UI updated without polling, and the UI also polls `/api/serial/scanner` to consume scans.
- Client storage: The app does not use `localStorage` for caching; aliases, pins and locks are managed server‑side (Redis) and fetched on demand.

## Process Flow

See `docs/PROCESS-FLOW.md` for the end-to-end Setup → Check → OK + Cleanup flow, API calls, and data persistence.

## Troubleshooting
- No monitor logs:
  - Check `ESP_TTY_PATH` and device permissions; set `ESP_DEBUG=1` to see serial lines.
- No scans:
  - Verify scanner path in env; watch `/api/serial/events` output; check `getScannerStatus()` via `/api/serial/scanner` response.
- Locks not visible:
  - Ensure `REDIS_URL` is the same for the app and script; use `npm run locks:station -- --id=...`.

More detailed checks are in `docs/ERRORS.md` (Krosy connectivity, local server, scanners, ESP, Redis).

bash scripts/update-appimage.sh --from-dist

      - `sudo bash scripts/install-systemd.sh --workdir /opt/wireless-kfb --envfile /etc/wireless-kfb.env --port 3000 --service wireless-kfb`

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
- Locks: Uses Redis for station-scoped KSSK locks with an in-memory fallback.
- Setup derives pin → branch names from Krosy XML and stores them for CHECK-only flows.

Flow summary
- Scan KFB → fetch branches/config → send MONITOR to ESP (pins + MAC) → run CHECK → overlay OK/ERROR + failures.
- Locks endpoints manage station ownership of KSSK during work.

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
  - `ESP_PING_CMD` (e.g. `PING {mac}`), `ESP_MAC` target MAC
  - `ESP_HEALTH_PROBE` = `never|if-stale|always` (health policy)
- Scanners
  - `SCANNER_TTY_PATHS=/dev/ttyACM0,/dev/ttyACM1` (plus optional `SCANNER2_TTY_PATH`)
  - `SCANNER_BAUD=9600` (baud rate for all scanners; defaults to 115200 if unset)
  - `SCANNER_ALLOW_ASCII_NO_NL=1` (enable if your scanner does not send newlines; parses ASCII bursts using an idle timer)
  - `SCANNER_ACCEPT_ANY=1` (broadcast full printable line as a scan; by default only MAC-like payloads are accepted)
- Redis
  - `REDIS_URL=redis://127.0.0.1:6379`
  - `KSSK_REQUIRE_REDIS=1` (require Redis; otherwise memory fallback is used)
  - `KSSK_DEFAULT_TTL_SEC=172800` (server default TTL for locks; 2 days)
  - `NEXT_PUBLIC_KSSK_TTL_SEC=172800` (client TTL used by Setup page; 2 days)
// Postgres is no longer required for this flow.
- UI behavior
  - `NEXT_PUBLIC_KFB_REGEX` (accept pattern for scan input on the client)
  - `NEXT_PUBLIC_STATION_ID` (used for lock ownership)
- Logging (defaults set in `.env`)
  - `LOG_ENABLE=1`, `LOG_DIR=./logs`, `LOG_LEVEL=info`
  - `LOG_MONITOR_ONLY=1` (print only monitor-tag info/warn)
  - `LOG_MONITOR_START_ONLY=1` (show only MONITOR start lines; failures still appear)
  - `LOG_TAG_LEVELS=redis=warn,kssk-lock=warn` (optional per-tag overrides)

## Logging Cheat‑Sheet
- Console (concise):
  - `MONITOR start mac=… kssk=… normal(N)=[…] contactless(M)=[…]`
  - `MONITOR ok …` (suppressed when start-only is enabled)
  - `CHECK fail mac=… failures=[…]` (always printed)
  - Errors from any tag always show
- Files (structured JSON):
  - App logs in `./logs/app-YYYY-MM-DD.log` (when `LOG_ENABLE=1`)
  - Detailed monitor events in `./monitor.logs/monitor-YYYY-MM-DD.log`

## Repo Structure (selected)
- `server.ts` – Next server + WS bridge for serial events (dev-prod compatible)
- `main/` – Electron main process (starts Next or uses packaged server)
- `src/lib/serial.ts` – ESP + scanner orchestration, ring buffer, cooldowns
- `src/lib/logger.ts` – Structured logger with env-driven filtering
- `src/app/api/*` – API routes (see below)
- `scripts/print-locks-redis.mjs` – Inspect KSSK locks (supports station filter, watch, regex)

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

KSSK Locks (Redis; in-memory fallback when Redis is unavailable)
- `POST /api/kssk-lock`
  - Body: `{ kssk: string, mac?: string, stationId: string, ttlSec?: number }`
  - Creates a lock with TTL; returns `{ ok: true }` or `409 locked`
- `GET /api/kssk-lock?kssk=...`
  - Returns `{ locked: boolean, existing: {..., expiresAt} | null }`
- `GET /api/kssk-lock?stationId=JETSON-01`
  - Lists active locks for station: `{ locks: LockRow[] }`
- `PATCH /api/kssk-lock`
  - Body: `{ kssk, stationId, ttlSec }` → touch TTL if you’re the owner
- `DELETE /api/kssk-lock?kssk=...&stationId=...`
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

## Troubleshooting
- No monitor logs:
  - Check `ESP_TTY_PATH` and device permissions; set `ESP_DEBUG=1` to see serial lines.
- No scans:
  - Verify scanner path in env; watch `/api/serial/events` output; check `getScannerStatus()` via `/api/serial/scanner` response.
- Locks not visible:
  - Ensure `REDIS_URL` is the same for the app and script; use `npm run locks:station -- --id=...`.

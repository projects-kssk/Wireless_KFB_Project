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
  - `LOG_ENABLE=1`, `LOG_DIR=./logs`, `LOG_LEVEL=info`
  - `LOG_MONITOR_ONLY=1` (print only monitor-tag info/warn)
  - `LOG_MONITOR_START_ONLY=1` (show only MONITOR start lines; failures still appear)
  - `LOG_TAG_LEVELS=redis=warn,ksk-lock=warn` (optional per-tag overrides)

## Logging Cheat‑Sheet
- Console (concise):
  - `MONITOR start mac=… kssk=… normal(N)=[…] contactless(M)=[…]`
  - `MONITOR ok …` (suppressed when start-only is enabled)
  - `CHECK fail mac=… failures=[…]` (always printed)
  - Errors from any tag always show
- Files (structured JSON):
  - App logs in `./logs/app-YYYY-MM-DD.log` (when `LOG_ENABLE=1`)
  - Detailed monitor events in `./monitor.logs/YYYY-MM/monitor-YYYY-MM-DD.log`

## Repo Structure (selected)
- `server.ts` – Next server + WS bridge for serial events (dev-prod compatible)
- `main/` – Electron main process (starts Next or uses packaged server)
- `src/lib/serial.ts` – ESP + scanner orchestration, ring buffer, cooldowns
- `src/lib/logger.ts` – Structured logger with env-driven filtering
- `src/app/api/*` – API routes (see below)
- `scripts/print-locks-redis.mjs` – Inspect KSK locks (supports station filter, watch, regex)

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



      - `sudo bash scripts/install-systemd.sh --workdir /opt/wireless-kfb --envfile /etc/wireless-kfb.env --port 3000 --service wireless-kfb`

# ======================== Station Identity ========================
# Station ID used for lock ownership and UI display
NEXT_PUBLIC_STATION_ID=JETSON-01
# Server-side station identity (fallback when NEXT_PUBLIC_* unavailable)
STATION_ID=JETSON-01

# =============================== Mode =============================
# Select Krosy path: true=online, false=offline
NEXT_PUBLIC_KROSY_ONLINE=true

# =========================== Krosy URLs ===========================
# Main Krosy endpoints used by Setup for pin/alias extraction
NEXT_PUBLIC_KROSY_URL_ONLINE=http://172.26.202.248:3000/api/krosy
NEXT_PUBLIC_KROSY_URL_OFFLINE=http://localhost:3000/api/krosy-offline
# Checkpoint endpoints (send workingDataXml or intksk)
NEXT_PUBLIC_KROSY_URL_CHECKPOINT_ONLINE=/api/krosy/checkpoint
NEXT_PUBLIC_KROSY_URL_CHECKPOINT_OFFLINE=/api/krosy-offline/checkpoint
# Identity URL (GET) returning hostname/ip/mac for UI
NEXT_PUBLIC_KROSY_IDENTITY_URL=/api/krosy
# Target/source identifiers placed into payloads
NEXT_PUBLIC_KROSY_XML_TARGET=ksskkfb01
NEXT_PUBLIC_KROSY_SOURCE_HOSTNAME=ksskkfb01
# Network hints used to infer online/offline mode
NEXT_PUBLIC_KROSY_IP_ONLINE=172.26.202.248
NEXT_PUBLIC_KROSY_IP_OFFLINE=192.168.1.164
# Offline forward target (proxy)
NEXT_PUBLIC_KROSY_OFFLINE_TARGET_URL=http://localhost:3001/api/visualcontrol
NEXT_PUBLIC_KROSY_HTTP_TIMEOUT_MS=30000   # client HTTP timeout for Krosy
KROSY_XML_TARGET=ksskkfb01           
# CORS (server-side only; declare once)
KROSY_CLIENT_ORIGINS=http://172.26.202.248:3000,http://localhost:3000,http://localhost:3001,http://192.168.1.164:3001

# Optional VisualControl page (debug)
NEXT_PUBLIC_KROSY_VISUALCONTROL_URL=http://localhost:3001/visualcontrol


ESP_TTY_PATH=/dev/ttyUSB0

ESP_PING_CMD=PING {payload}
KROSY_TRANSPORT=tcp
KROSY_TCP_PORT=10080
KROSY_TCP_TIMEOUT_MS=10000
KROSY_LOG_DIR=.krosy-logs
KROSY_CONNECT_HOST=172.26.192.1
KROSY_TCP_TERMINATOR=newline

# ====================== ESP / Serial & Scanners ======================
SCANNER_TTY_PATHS=/dev/ttyACM0,/dev/ttyACM1
NET_IFACE=eth0

NEXT_PUBLIC_HIDE_SETTINGS=true
KROSY_OGLIEN_URL=http://localhost:3001/api/visualcontrol
KROSY_OFFLINE_PORT=3001
KROSY_OFFLINE_PATH=/api/visualcontrol
NEXT_PUBLIC_KFB_REGEX=/^([0-9A-F]{2}([:\-]?)){5}[0-9A-F]{2}$/i
# ============================ UI Behavior ============================
NEXT_PUBLIC_SETUP_ALLOW_NO_ESP=0
NEXT_PUBLIC_KEEP_LOCKS_ON_UNLOAD=1
REDIS_URL=redis://127.0.0.1:6379

LOG_ENABLE=1
LOG_DIR=./logs
LOG_FILE_BASENAME=app
LOG_LEVEL=debug   # console log level (debug|info|warn|error)
LOG_MONITOR_ONLY=0
LOG_MONITOR_START_ONLY=0
# Optional per-tag overrides (e.g., redis=warn,ksk-lock=warn)
# LOG_TAG_LEVELS=
# Ensure scanner + APIs are visible
LOG_TAG_LEVELS=scanner=debug,scan:sink=info,scan:mem=info,api:serial/scanner=info,api:serial/events=info
# Verbose scan diagnostics
SCAN_LOG=1
NEXT_PUBLIC_SCAN_LOG=1
SCAN_MEM_LOG=1

SCANNER_OPEN_TIMEOUT_MS=4000  # open watchdog (ms)

KSK_REQUIRE_REDIS=1
KSK_DEFAULT_TTL_SEC=172800
NEXT_PUBLIC_KSK_TTL_SEC=172800

CHECK_RESULT_TIMEOUT_MS=4000
CHECK_HANDSHAKE_TIMEOUT_MS=400
NEXT_PUBLIC_CHECK_CLIENT_TIMEOUT_MS=2500
NEXT_PUBLIC_CHECK_RETRY_COUNT=1

# Scanner routing (dashboard uses scanner 0, setup uses scanner 1)
NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD=0
NEXT_PUBLIC_SCANNER_INDEX_SETUP=1

# Explicit ESP TTY path (prefer /dev/ttyUSB*)
ESP_TTY=/dev/ttyUSB0

# Prefer merged pin list (client + Redis) for CHECK
CHECK_SEND_MODE=merge   # mac|union|client|merge

# Treat Redis as required on Setup page as well (client-side policy)
NEXT_PUBLIC_KSK_REQUIRE_REDIS=1

# Extra terminal logging for /api/ksk-lock GET list
KSK_LOCK_LOG_DETAIL=1

SCANNER_BAUD=9600
LOG_SCANNER_POLL_VERBOSE=1
SCANNER_ALLOW_RAW_MAC=1
SCANNER_PRINTABLE_ONLY=0

KROSY_FORCE_CHECKPOINT_RESULT=ok   # or true / 1 (testing)
NEXT_PUBLIC_KROSY_IP_ONLINE=172.26.202.248
NEXT_PUBLIC_KROSY_IP_OFFLINE=192.168.1.164
REQUIRE_ALIAS_REDIS=1
NEXT_PUBLIC_ALIAS_REQUIRE_REDIS=0
NEXT_PUBLIC_ALIAS_PREFER_REDIS=0

# Krosy checkpoint reporting target (IP-only; scheme/port inferred)
KROSY_RESULT_IP=172.26.202.248

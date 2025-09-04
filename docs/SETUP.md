# Setup Page (SETUP)

Purpose: acquire a station-scoped KSK lock, extract pins/aliases from Krosy (online/offline), persist aliases to Redis, and program the ESP so a unit can be validated.

## Flow Overview

1) Identify Station
- Uses `NEXT_PUBLIC_STATION_ID` (fallback: `STATION_ID` or browser hostname).

2) Acquire Lock (Redis)
- `POST /api/ksk-lock` with `{ kssk, stationId, mac?, ttlSec? }`
- `PATCH /api/ksk-lock` heartbeat while working
- `GET /api/ksk-lock?stationId=<id>` list locks for the current station

3) Extract Pins and Aliases (Krosy)
- Mode selection: `NEXT_PUBLIC_KROSY_ONLINE=true|false`
- Online: `POST /api/krosy`
- Offline: `POST /api/krosy-offline` (forwards to VisualControl via `NEXT_PUBLIC_KROSY_OFFLINE_TARGET_URL`)
- Identity: `GET /api/krosy` (hostname/ip/mac for UI)
- Extracts: pins (normal/latch), branch names, optional XML/JSON payloads

4) Persist Aliases (Redis)
- `POST /api/aliases` body example:
  `{ mac, ksk, aliases, normalPins, latchPins, xml?, hints? }`
- Server rebuilds union for the MAC and stores all items by KSK.

5) Program ESP (Monitor)
- `POST /api/serial` with `{ normalPins, latchPins, mac, kssk? }`
- On success, UI indicates “KSK OK”, enabling CHECK-only flows later.

6) Optional Checkpoint
- When online, the app can checkpoint Krosy data later from the Dashboard using the stored XML per KSK (see Main Application docs).

7) Cleanup
- Clear aliases: `POST /api/aliases/clear` with `{ mac }`
- Release station lock: `DELETE /api/ksk-lock?kssk=...&stationId=...&force=1`

## Key Environment Variables

Identity & Mode
- `NEXT_PUBLIC_STATION_ID` / `STATION_ID`: station identity used in locks and UI
- `NEXT_PUBLIC_KROSY_ONLINE`: `true` for online Krosy; `false` to use offline route

Krosy Endpoints (client)
- `NEXT_PUBLIC_KROSY_URL_ONLINE=/api/krosy`
- `NEXT_PUBLIC_KROSY_URL_OFFLINE=/api/krosy-offline`
- `NEXT_PUBLIC_KROSY_URL_CHECKPOINT_ONLINE=/api/krosy/checkpoint`
- `NEXT_PUBLIC_KROSY_URL_CHECKPOINT_OFFLINE=/api/krosy-offline/checkpoint`
- `NEXT_PUBLIC_KROSY_IDENTITY_URL=/api/krosy`
- `NEXT_PUBLIC_KROSY_OFFLINE_TARGET_URL=http://localhost:3001/api/visualcontrol` (server forwards offline)
- `NEXT_PUBLIC_KROSY_HTTP_TIMEOUT_MS=30000`
- Online/offline hints: `NEXT_PUBLIC_KROSY_IP_ONLINE`, `NEXT_PUBLIC_KROSY_IP_OFFLINE`
- Hostname fields added into requests: `NEXT_PUBLIC_KROSY_SOURCE_HOSTNAME`, `NEXT_PUBLIC_KROSY_XML_TARGET`

Redis / Locks
- `REDIS_URL=redis://127.0.0.1:6379`
- `KSK_REQUIRE_REDIS=1` (server policy; locks require Redis)
- `KSK_DEFAULT_TTL_SEC=172800` (server default lock TTL)
- `NEXT_PUBLIC_KSK_TTL_SEC=172800` (client heartbeat TTL)
- `KSK_LOCK_LOG_DETAIL=1` (extra detail in GET list)

ESP / Serial & Scanners
- ESP path: `ESP_TTY=/dev/ttyUSB0`, `ESP_TTY_PATH=/dev/ttyUSB0`
- ESP ping: `ESP_PING_CMD=PING {payload}`
- Scanner paths: `SCANNER_TTY_PATHS=/dev/ttyACM0,/dev/ttyACM1`
- Scanner index (Setup page): `NEXT_PUBLIC_SCANNER_INDEX_SETUP=1`
- Scanner tuning: `SCANNER_BAUD`, `SCANNER_OPEN_TIMEOUT_MS`

Setup UX & Timeouts
- Hide settings link: `NEXT_PUBLIC_HIDE_SETTINGS=true`
- Allow proceeding without ESP: `NEXT_PUBLIC_SETUP_ALLOW_NO_ESP=0`
- Keep locks after tab close: `NEXT_PUBLIC_KEEP_LOCKS_ON_UNLOAD=0`
- Redis policies on client: `NEXT_PUBLIC_KSK_REQUIRE_REDIS=1`
- Extraction retries/timeouts: `NEXT_PUBLIC_SETUP_HTTP_TIMEOUT_MS`, `NEXT_PUBLIC_SETUP_EXTRACT_RETRIES`, `NEXT_PUBLIC_SETUP_EXTRACT_RETRY_MS`
- KFB pattern: `NEXT_PUBLIC_KFB_REGEX=/^([0-9A-F]{2}([:\-]?)){5}[0-9A-F]{2}$/i`

Logging
- `LOG_ENABLE=1`, `LOG_LEVEL=debug`, `LOG_DIR=./logs`, `LOG_FILE_BASENAME=app`
- Tag overrides: `LOG_TAG_LEVELS=scanner=debug,scan:sink=info,scan:mem=info,api:serial/scanner=info,api:serial/events=info`
- Verbose scan diagnostics: `SCAN_LOG=1`, `NEXT_PUBLIC_SCAN_LOG=1`, `SCAN_MEM_LOG=1`, `LOG_SCANNER_POLL_VERBOSE=1`

## Online vs Offline

- Online mode posts directly to the app’s `/api/krosy` route which reaches the Krosy service according to deployment config.
- Offline mode calls `/api/krosy-offline`, which forwards to VisualControl or another local adapter at `NEXT_PUBLIC_KROSY_OFFLINE_TARGET_URL`.
- The UI can infer mode using `NEXT_PUBLIC_KROSY_ONLINE` and the optional IP hints.

## Error Handling & Retries

- Lock conflicts return HTTP 409 from `/api/ksk-lock` with the existing owner. The UI surfaces station ID and expiry.
- Krosy extraction respects retry knobs and timeouts. Inspect logs under `.krosy-logs/` and app logs under `./logs/` when issues occur.
- ESP communication problems are visible on `/api/serial/events` SSE and in `scan:*`/`esp` log tags. Use `ESP_DEBUG=1` for raw lines (server-side).

## Developer Notes

- No localStorage is used; aliases and locks are persisted in Redis and fetched on demand.
- Aliases POST payloads should include both pin arrays and any extracted names; the server composes a union per MAC for fast CHECK flows.
- When done, always clear aliases and release locks to avoid station contention.


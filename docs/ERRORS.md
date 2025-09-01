# Error Checks & Troubleshooting

This guide lists practical checks for common failure points: Krosy connectivity, local server, scanners, ESP, and Redis. Use it to quickly isolate issues and find the right logs.

## Krosy Server
- Mode: Confirm `NEXT_PUBLIC_KROSY_ONLINE=true|false` matches your environment.
- Online endpoint: `NEXT_PUBLIC_KROSY_URL_ONLINE` should be reachable from the server host (TCP for krosy/route, HTTP for identity).
- Offline forwarding: `NEXT_PUBLIC_KROSY_OFFLINE_TARGET_URL` should point to the local proxy target.
- Identity: `GET /api/krosy` returns `{ hostname, ip, mac }`.
- Logs: `.krosy-logs/YYYY-MM/<stamp>_<requestID>/` contains request/response XML and meta.
- Timeouts: `KROSY_TCP_TIMEOUT_MS` (route) or `KROSY_TIMEOUT_MS` (offline). Increase if your device responds slowly.

## Local Server (Next + Node)
- Health: Server starts at `PORT` (default `3003`). Electron waits for it.
- Start: `npm run electron:dev` (server + Electron) or `npm run dev` (server + Next + Electron).
- API sanity:
  - `GET /api/serial?probe=1` for ESP health snapshot.
  - `GET /api/serial/devices` to list serial ports.
  - `GET /api/serial/events` (SSE) for scanner and ESP events.
- Logs: App logs in `./logs/app-YYYY-MM-DD.log` (when `LOG_ENABLE=1`), pruned monthly.

## Scanners (1 & 2)
- Device paths: `SCANNER_TTY_PATHS=/dev/ttyACM0,/dev/ttyACM1`.
- UI indices: `NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD=0`, `NEXT_PUBLIC_SCANNER_INDEX_SETUP=1`.
- Open policy: If `ALLOW_USB_SCANNER` is not set, the code avoids opening scanners on USB paths that collide with the ESP path.
- Events: `GET /api/serial/events` – watch `scanner/open`, `scanner/error`, `scan` with `path` and `code`.
- Poll fallback: `GET /api/serial/scanner` accepts `?path=` to target a specific device.
- Logs: monitor logs in `./monitor.logs/YYYY-MM/monitor-YYYY-MM-DD.log`.

## ESP
- Port: `ESP_TTY` or `ESP_TTY_PATH` (prefer `/dev/ttyUSB*`).
- Baud: `ESP_BAUD` (default `115200`).
- Health policy: `ESP_HEALTH_PROBE=never|if-stale|always`.
- Ping command: `ESP_PING_CMD` is optional; supports `{payload}`. `{mac}` is ignored.
- Debug: `ESP_DEBUG=1` to print serial lines.

## Redis
- URL: `REDIS_URL=redis://127.0.0.1:6379`.
- Locks policy: `KSK_REQUIRE_REDIS=1` requires Redis for lock endpoints.
- Client behavior: `NEXT_PUBLIC_KSK_REQUIRE_REDIS=1` requires Redis on the Setup page.
- Inspect locks: `npm run locks:station -- --id=<STATION>`; `npm run locks:station:watch -- --id=<STATION>`.
- Aliases: `GET /api/aliases?mac=<MAC>&all=1` returns per-KSK items; `GET /api/aliases?mac=<MAC>` returns union.

## Common Symptoms
- No scanner input: Check `GET /api/serial/events` for `scanner/open` and correct device `path`; verify indices match.
- No Krosy response: Confirm network route to `KROSY_CONNECT_HOST` (TCP) or offline target URL; inspect `.krosy-logs`.
- CHECK misses pins: Ensure aliases exist in Redis; try `POST /api/aliases/rehydrate` then `GET /api/aliases?mac=<MAC>&all=1`.
- Locks stuck: `DELETE /api/ksk-lock` with `{ mac, [stationId], force: 1 }`.

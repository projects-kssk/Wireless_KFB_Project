# Main Application (Dashboard)

Purpose: run day-to-day scanning and validation. It listens to serial/scanner events, merges pins from client input and Redis, performs CHECK, and renders success/error overlays. It also exposes settings to adjust scanners and view configuration.

## Views

- Dashboard: default view for scanning and checking devices.
- Settings panels are currently disabled in the main application shell.

## Data Sources

- SSE: `/api/serial/events` for live device/scanner/ESP status and scan events.
- Poll: `/api/serial/scanner` to peek/consume last scan.
- Aliases: `/api/aliases?mac=<MAC>` (union) and `...&all=1` (per-KSK items).
- Locks: `/api/ksk-lock?stationId=<id>` to display current station locks when relevant.

## CHECK Flow

1) Input MAC (scanned or typed)
- MAC is canonicalized and validated using `NEXT_PUBLIC_KFB_REGEX`.

2) Build Pins
- Source controlled by `CHECK_SEND_MODE` (server env):
  - `mac`: use pins stored explicitly for this MAC only
  - `union`: use the union built from aliased items
  - `client`: use pins provided by the current client only
  - `merge` (default): union + client pins merged, deduped

3) Execute
- `POST /api/serial/check` with `{ mac }` (or `{ pins, mac }` for explicit pins)
- Waits for RESULT via short timeout; failures returned as `{ failures: number[] }`.
- UI shows overlay; merges failures + alias names for display.

4) Result + Optional Checkpoint
- On `RESULT/DONE` success for the current MAC (via SSE), shows OK overlay.
- When online and Redis has XML per KSK, the app may send a checkpoint: `GET /api/aliases/xml?mac=<MAC>&kssk=<ksk>` then `POST /api/krosy/checkpoint`.

## Environment Variables

Identity & UI
- `NEXT_PUBLIC_STATION_ID`: station name in UI and lock ownership
- `NEXT_PUBLIC_HIDE_SETTINGS`: hides settings link when `true`
- `NEXT_PUBLIC_KFB_REGEX`: accepted KFB/MAC pattern (default allows `AA:BB:…`)
- Overlays & polling:
  - `NEXT_PUBLIC_OK_OVERLAY_MS` (OK overlay duration)
  - `NEXT_PUBLIC_SCAN_OVERLAY_MS` (scan overlay duration)
  - `NEXT_PUBLIC_REDIS_DROP_DEBOUNCE_MS` (UI debounce for dropped Redis)
  - `NEXT_PUBLIC_SCANNER_POLL_IF_STALE_MS` (poll fallback interval)

Scanners
- `SCANNER_TTY_PATHS`: comma list of device paths
- Index routing:
  - `NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD=0`
  - `NEXT_PUBLIC_SCANNER_INDEX_SETUP=1` (used by Setup view; here for reference)
- Force dashboard to a specific port: `NEXT_PUBLIC_SCANNER_PATH_DASHBOARD=/dev/ttyACM1`

Krosy (for checkpoint and identity)
- `NEXT_PUBLIC_KROSY_ONLINE=true|false`
- URLs (relative, app-routed):
  - `NEXT_PUBLIC_KROSY_URL_CHECKPOINT_ONLINE=/api/krosy/checkpoint`
  - `NEXT_PUBLIC_KROSY_URL_CHECKPOINT_OFFLINE=/api/krosy-offline/checkpoint`
  - `NEXT_PUBLIC_KROSY_IDENTITY_URL=/api/krosy`
  - Host hints: `NEXT_PUBLIC_KROSY_IP_ONLINE`, `NEXT_PUBLIC_KROSY_IP_OFFLINE`

Logging
- `LOG_VERBOSE=1` – enable verbose logging (app file log with monitor events, aliases‑XML read logs)
- `LOG_ENABLE=1` – enable the app file log without extra verbose data
- Errors always append to `logs/errors.log` (independent of flags)

Repo Structure (base overview)
- `src/app/` – App Router pages and API routes.
- `src/components/` – UI components.
- `src/lib/` – Shared utilities.
- `main/` – Electron main process.
- `server.ts` + `dist-server/` – Node server and build output.
- Logs: `logs/` (includes `app.log`, `errors.log`), `.krosy-logs/`.

Redis
- `REDIS_URL`
- TTLs and policy mirrored from Setup: `NEXT_PUBLIC_KSK_TTL_SEC`, `NEXT_PUBLIC_KSK_REQUIRE_REDIS`

CHECK Behavior (server-side)
- `CHECK_SEND_MODE=mac|union|client|merge`
- Timeouts: `CHECK_RESULT_TIMEOUT_MS`, `CHECK_HANDSHAKE_TIMEOUT_MS`, `NEXT_PUBLIC_CHECK_CLIENT_TIMEOUT_MS`, `NEXT_PUBLIC_CHECK_RETRY_COUNT`

Logging
- `LOG_ENABLE`, `LOG_LEVEL`, `LOG_DIR`, `LOG_FILE_BASENAME`
- Tag overrides: `LOG_TAG_LEVELS=...`
- Verbose flags: `SCAN_LOG`, `NEXT_PUBLIC_SCAN_LOG`, `SCAN_MEM_LOG`, `LOG_SCANNER_POLL_VERBOSE`

## Event Stream (SSE)

- Endpoint: `GET /api/serial/events`
- Emits snapshots and updates for:
  - Device list and open/close states
  - Scanner paths and last scans
  - ESP health
  - Network interface info (`NET_IFACE` or `KROSY_NET_IFACE`)
- The UI reconciles SSE updates and falls back to polling scanner state when stale.

## Troubleshooting

- No scans: confirm `SCANNER_TTY_PATHS` and indices, watch `/api/serial/events`; verify device permissions.
- No CHECK response: check `ESP_TTY_PATH` and ESP cabling; raise `CHECK_*_TIMEOUT_MS` temporarily for diagnosis.
- Missing aliases: ensure Setup saved aliases in Redis; use `GET /api/aliases?mac=<MAC>&all=1` to confirm.
- Locks not visible: verify station ID and Redis connectivity; use CLI scripts to inspect locks.

## Notes

- The app avoids localStorage entirely; all persistent data flows through server APIs with Redis backing.
- Main Application view is optimized for quick scans → CHECK, while Setup handles extraction/programming and persistence.

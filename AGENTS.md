# Repository Guidelines

## Project Structure & Module Organization
- `src/app`: Next.js App Router pages and API routes (e.g., `src/app/api/.../route.ts`).
- `src/components`: Reusable React components (PascalCase `.tsx`).
- `src/lib`: Shared utilities (e.g., `serial.ts`, `redis.ts`, `logger.ts`).
- `main/`: Electron main process (`main.ts`, `preload.ts`, `menu.ts`).
- `server.ts` + `dist-server/`: Node server entry and its build output.
- `public/` and `assets/`: Static assets; `assets/icon.png` used for packaging.
- `scripts/`: Dev helpers (Redis/locks). Env files: `.env`, `.env.production`, `.env.example`.
- Logs: `logs/` (e.g. `app.log`, `errors.log`), `.krosy-logs/` (Krosy XML/result).

## Build, Test, and Development Commands
- `npm run predev`: Start Redis container and wait for it (required for locks).
- `npm run dev`: Run server, Next.js, and Electron together for local development.
- `npm start`: Launch Electron against the current build/
  dev env (assumes assets are present).
- `npm run build`: Build renderer, server, Electron, then package AppImage.
- `npm run build:arm64`: Build/package for Linux ARM64.
- `npm run type-check`: TypeScript checks with `strict` mode.
- `npm run lint` / `npm run format`: ESLint (Next rules) and Prettier.
- Useful: `npm run redis:up`, `npm run redis:logs`, `npm run locks[:watch]`.

## Coding Style & Naming Conventions
- Language: TypeScript with `strict` enabled; 2-space indentation.
- React: Components in PascalCase; hooks prefixed with `use*`.
- Files: Components `PascalCase.tsx`; libs `camelCase.ts`.
- API routes follow Next’s App Router (`src/app/api/<route>/route.ts`).
- Tools: ESLint extends `next/core-web-vitals`; Prettier for formatting.

## State & Persistence
- Do not use `localStorage` for caching or persistence.
- Persist aliases, pins, and locks in Redis via server APIs.
- Components should fetch from server endpoints (or subscribe via SSE) rather than reading any browser storage.

## Testing Guidelines
- No formal test runner is configured yet. Always run:
  - `npm run type-check` and `npm run lint` before PRs.
  - Manual smoke tests via `npm run dev` (key flows, serial/Redis if used).
- When adding tests, place them near code or under `src/**/__tests__` with `*.test.ts`.

## Commit & Pull Request Guidelines
- Commits: Use clear, imperative messages. Prefer Conventional Commits, e.g.:
  - `feat(api): add serial scanner endpoint`
  - `fix(ui): prevent double connect click`
- PRs: Include description, rationale, and screenshots/screencasts for UI changes.
- Link issues (e.g., `Closes #123`). Ensure CI basics pass: type-check, lint, build.

## Security & Configuration Tips
- Never commit secrets; use `.env` locally and `.env.production` for packaging.
- Redis must be reachable for lock/monitor features; see `scripts/redis-up.sh`.
- Serial access may require OS permissions; document steps in your PR if relevant.

## Process Flow (Setup → Check → OK + Cleanup)

- Setup (scan MAC, then up to 3 KSKs)
  - Locks: `POST /api/ksk-lock` acquires; `PATCH /api/ksk-lock` heartbeats; `GET /api/ksk-lock?stationId=` lists.
  - Krosy: online `POST /api/krosy` or offline `POST /api/krosy-offline` using `intksk` to obtain XML/JSON; extract pins and names.
  - Persist: `POST /api/aliases` with `{ mac, ksk, aliases, normalPins, latchPins, [xml], [hints] }`; server rebuilds union for MAC.
  - Program ESP: `POST /api/serial` with `{ normalPins, latchPins, mac, kssk: ksk }`; on success, show “KSK OK”.
  - Policy: no localStorage; aliases and locks are always stored in Redis.

- Check (dashboard)
  - Rehydrate: `POST /api/aliases/rehydrate` (best effort), `GET /api/aliases?mac=<MAC>&all=1` (items), `GET /api/aliases?mac=<MAC>` (union).
  - Run: `POST /api/serial/check` with `{ mac }`; `CHECK_SEND_MODE` decides pins: `mac|union|client|merge` (default: merge).
  - UI merges failures, alias names, and grouped items (ksk ID) into flat and grouped views.

- Live OK + Cleanup
  - On serial SSE `RESULT/DONE` success for current MAC: show OK overlay and reset.
  - Optional checkpoint (when online and Redis has data):
    - `GET /api/aliases?mac=<MAC>&all=1` → for each item: try `GET /api/aliases/xml?mac=<MAC>&kssk=<ksk>`; send `POST /api/krosy/checkpoint` (or offline version).
  - Cleanup:
    - Clear aliases: `POST /api/aliases/clear` with `{ mac }`.
    - Clear station locks: `DELETE /api/ksk-lock` with `{ mac, [stationId], force: 1 }`.

- Station locks (Redis)
  - Lock value keys: `ksk:<ksk>` → `{ kssk, mac, stationId, ts }` with TTL.
  - Station index sets: `ksk:station:<stationId>` → members are KSK IDs.
  - API accepts `ksk` (preferred) and legacy `kssk` fields for compatibility.

- Logging & retention
  - App log: `logs/app.log`, pruned/rotated manually as needed. Controlled by `LOG_ENABLE=1` or `LOG_VERBOSE=1`.
  - Errors: `logs/errors.log` (error-level only; always on, independent of `LOG_ENABLE`).
  - Monitor events share the app log and are tagged `monitor` (respect `LOG_VERBOSE=1`).
  - Aliases XML reads: `logs/aliases-xml-reads-YYYY-MM-DD.log` (guarded by `LOG_VERBOSE=1`).
  - Krosy logs (request/response and checkpoint): `.krosy-logs/YYYY-MM/<stamp>_<requestId>/...`, pruned after ~31 days.

Environment quick refs for logging
- `LOG_VERBOSE=1` enables app file logging (including monitor events) and aliases-XML read logs.
- `LOG_ENABLE=1` also enables app file logging (used if you want app logs without monitor/XML extras).
- `LOG_MONITOR_ONLY=1` restricts console/file to the monitor tag (errors still always print).


See also: `docs/EN/3-PROCESS-FLOW.md` (full details) and `docs/EN/4-ERRORS.md` (detailed checks & troubleshooting).

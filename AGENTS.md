# Repository Guidelines

## Project Structure & Module Organization
- `src/app`: Next.js App Router pages and API routes (e.g., `src/app/api/.../route.ts`).
- `src/components`: Reusable React components (PascalCase `.tsx`).
- `src/lib`: Shared utilities (e.g., `serial.ts`, `redis.ts`, `logger.ts`).
- `main`: Electron main process (`main.ts`, `preload.ts`, `menu.ts`).
- `server.ts` + `dist-server`: Node server entry and its build output.
- `public` and `assets`: Static assets; `assets/icon.png` used for packaging.
- `scripts`: Dev helpers (Redis/locks). Env files: `.env`, `.env.production`.

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

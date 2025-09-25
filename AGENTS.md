# Repository Guidelines

## Project Structure & Module Organization
The codebase uses Next.js App Router alongside an Electron shell. Keep renderer pages and API routes in `src/app`, shared React UI in `src/components`, and utilities under `src/lib`. Electron entry points live in `main/`, while the Node server entry is `server.ts` with its bundle in `dist-server/`. Static assets belong in `public/` or `assets/` (`assets/icon.png` is required for packaging). Logs are written to `logs/` and `.krosy-logs/`; avoid editing generated files there.

## Build, Test, and Development Commands
Run `npm run predev` to start Redis before any local session. `npm run dev` launches Next.js, the Node bridge, and Electron together. Use `npm start` to run the packaged Electron app against the current build artifacts. `npm run build` produces the full desktop bundle (AppImage) and `npm run build:arm64` targets Linux ARM64. Validate code quality with `npm run type-check`, `npm run lint`, and `npm run format` before submitting changes.

## Coding Style & Naming Conventions
All code is TypeScript with strict mode enabled and 2-space indentation. Components use PascalCase filenames (`src/components/DeviceStatus.tsx`), shared libs use camelCase (`src/lib/logger.ts`), and hooks start with `use`. Follow ESLint (Next.js core web vitals config) and Prettier; never bypass them unless documented.

## Testing Guidelines
No automated test runner is shipping yet, so rely on targeted scripts. Always execute `npm run type-check` and `npm run lint`. When adding tests, colocate them under `src/**/__tests__` using `*.test.ts`. Perform manual smoke checks via `npm run dev`, verifying Redis-backed flows, serial communication, and UI happy paths.

## Commit & Pull Request Guidelines
Write imperative, descriptive commits (prefer Conventional Commits like `fix(ui): prevent double connect click`). PRs must describe the change, rationale, and any follow-up steps. Include screenshots or screencasts for UI adjustments and link relevant issues (e.g., `Closes #123`). Confirm type-check, lint, and build scripts before requesting review.

## Security & Configuration Tips
Never commit secrets; rely on `.env` or `.env.production`. Ensure Redis is reachable before features that require locks or alias persistence. Keep serial access permissions documented for your OS. Enable `LOG_ENABLE=1` or `LOG_VERBOSE=1` only when diagnosing issues, and tidy large logs before merging.

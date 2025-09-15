# Programmers Guide

This guide is for developers working on the app. It links out to the most relevant internal docs and summarizes how the project is structured, built, and debugged.

## Quick Links
- Main flow overview: docs/PROCESS-FLOW.md
- Main application UI: docs/MAINAPPLICATION.md
- Setup/Extraction (Krosy): docs/SETUP.md
- Troubleshooting & checks: docs/ERRORS.md
- Agent tips and repo conventions: AGENTS.md
- Suggestions and improvements backlog: suggestions.md

## Repo Structure (developer view)
- src/app/ – Next.js App Router pages and API routes
- src/components/ – React components (PascalCase .tsx)
- src/lib/ – Shared utilities (serial, redis, logger, rid)
- main/ – Electron main process (main.ts, preload.ts, menu.ts)
- server.ts + dist-server/ – Node server entry + build output
- public/ and assets/ – Static assets
- scripts/ – Dev helpers (Redis/locks)
- logs/ (app logs + errors.log), monitor.logs/, .krosy-logs/

## Build, Run, Lint
- npm run predev – start Redis container and wait (required for locks)
- npm run dev – Next.js + server + Electron (local dev)
- npm start – Electron against current build
- npm run build – Build renderer, server, Electron; package AppImage
- npm run type-check – TypeScript strict checks
- npm run lint / npm run format – ESLint and Prettier

## Logging (dev essentials)
- LOG_VERBOSE=1 – enables app file logs, monitor logs, aliases‑XML read logs
- LOG_ENABLE=1 – enables app file logs (without monitor/XML extras)
- errors.log – always on at logs/errors.log (independent of flags)

## Notes for Contributions
- Keep changes focused and cohesive; prefer small PRs.
- Follow TypeScript strict mode; keep components small and hook-driven.
- Document any new env vars and update README.md and .env.example.
- Respect AGENTS.md guidance (component naming, file layout, and coding style).


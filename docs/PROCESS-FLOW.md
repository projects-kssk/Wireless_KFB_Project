# Current Production Flow (Setup → Check → OK + Cleanup)

This document describes the current, end‑to‑end behavior of the app: how Setup collects pin maps for a board (KFB/MAC) and up to 3 KSKs, how Check runs, and what happens on success (checkpoint + Redis cleanup).

## Terminology
- KFB: The board MAC address (scanned first).
- KSK: A 12‑digit identifier for a specific configuration group (up to 3 per board in Setup).
- Union Aliases: The merged pin→name map for a MAC across all KSKs.

## Environment Highlights
- Mode
  - `NEXT_PUBLIC_KROSY_ONLINE=true|false` – Selects online vs offline Krosy path.
- Krosy URLs
  - `NEXT_PUBLIC_KROSY_URL_ONLINE`, `NEXT_PUBLIC_KROSY_URL_OFFLINE`
  - `NEXT_PUBLIC_KROSY_URL_CHECKPOINT_ONLINE`, `NEXT_PUBLIC_KROSY_URL_CHECKPOINT_OFFLINE`
  - `NEXT_PUBLIC_KROSY_SOURCE_HOSTNAME`, `NEXT_PUBLIC_KROSY_XML_TARGET`
- Locks
  - `NEXT_PUBLIC_KSK_TTL_SEC` – Client heartbeat TTL for KSK locks (Setup).
  - `KSK_DEFAULT_TTL_SEC`, `KSK_REQUIRE_REDIS` – Server defaults and policy.
- Check behavior
  - `CHECK_SEND_MODE=mac|union|client|merge` – How `/api/serial/check` builds the pin set to send.

## 1) Setup Flow (Scan MAC, then up to 3 KSKs)
1. Scan KFB (MAC) on the Setup page (top banner shows MAC when ready).
2. For each KSK (up to 3 slots):
   - Acquire lock
     - `POST /api/ksk-lock`
       - Body: `{ ksk: string, mac?: string, stationId: string, ttlSec?: number }`
       - On success, Setup starts a 60s heartbeat:
         - `PATCH /api/ksk-lock` (same `ksk`, `stationId`, `ttlSec`)
   - Fetch Krosy config for the KSK
     - Online: `POST /api/krosy`
     - Offline: `POST /api/krosy-offline`
     - Body (simplified): `{ requestID: "1", intksk: "<ksk>", sourceHostname, targetHostName, [targetUrl] }`
     - Response: XML or JSON; pins extracted from either (prefers names when available).
   - Persist aliases/pins in Redis
     - `POST /api/aliases`
       - Body: `{ mac, ksk, aliases: Record<pin,name>, normalPins: number[], latchPins: number[], xml?: string, hints?: Record<pin,name> }`
       - Side‑effect: server rebuilds the MAC union (`kfb:aliases:<MAC>`) from all known KSKs.
   - Program ESP (Monitor)
     - `POST /api/serial`
       - Body: `{ normalPins, latchPins, mac, kssk: "<ksk>" }` (field name `kssk` kept for compatibility)
       - If successful, Setup displays “KSK OK”. If ESP fails and `NEXT_PUBLIC_SETUP_ALLOW_NO_ESP=0`, the lock is released and the slot is reset.
3. Setup continuously reconciles active station locks:
   - `GET /api/ksk-lock?stationId=<id>&include=aliases`
   - Shows any active KSKs for the station; keeps heartbeats alive for owned locks.

Notes
- No client storage: aliases, union, and locks are managed in Redis (localStorage removed).
- Heartbeat TTL is controlled by `NEXT_PUBLIC_KSK_TTL_SEC` (client) and `KSK_DEFAULT_TTL_SEC` (server fallback).

## 2) Dashboard Check Flow (MAC)
1. Scan KFB (MAC) on the Dashboard.
2. Rehydrate aliases for this MAC (ensures union and per‑KSK entries are indexed):
   - `POST /api/aliases/rehydrate` with `{ mac }` (best‑effort)
   - `GET /api/aliases?mac=<MAC>&all=1` – returns items with both `ksk` and `kssk` for compatibility
   - `GET /api/aliases?mac=<MAC>` – returns the union alias map for the MAC
3. Run CHECK
   - `POST /api/serial/check` with `{ mac }` (server decides pin set using `CHECK_SEND_MODE`):
     - `mac`: no pins
     - `union`: union of station‑active and indexed KSKs for MAC
     - `client`: use client pins (not used in current dashboard flow)
     - `merge` (default): superset of client + union
   - Response: `{ failures: number[], [items], [itemsActive], [aliases], [normalPins], [latchPins] }`
   - UI merges failures with alias/union to display grouped and flat views.

## 3) Live‑Mode “OK” and Cleanup
On terminal success (from serial SSE: `RESULT`/`DONE` with OK) for the current MAC:
- UI updates
  - Marks all non‑latch pins as OK and shows an OK overlay/animation.
- Optional Krosy checkpoint (when data exists in Redis and online mode is enabled)
  - `GET /api/aliases?mac=<MAC>&all=1` → for each item:
    - Try `GET /api/aliases/xml?mac=<MAC>&kssk=<ksk>` to load stored XML
    - Send checkpoint:
      - Online: `POST /api/krosy/checkpoint`
      - Offline: `POST /api/krosy-offline/checkpoint`
      - Body: `{ requestID: "1", workingDataXml }` or fallback `{ requestID: "1", intksk: "<ksk>", sourceHostname, targetHostName }`
- Redis cleanup (always)
  - Clear aliases for this MAC: `POST /api/aliases/clear` with `{ mac }`
  - Clear station locks for this MAC across all stations (force):
    - `DELETE /api/ksk-lock` with `{ mac, [stationId], force: 1 }`

## 4) Station Locks (Redis Keys)
- Lock values: `ksk:<ksk>` → JSON `{ kssk, mac, stationId, ts }` with TTL
- Station index sets: `ksk:station:<stationId>` → members are KSK IDs (strings)
- API provides compatibility for incoming `{ ksk }` and legacy `{ kssk }` fields; responses include both where relevant.

## 5) Compatibility Notes
- API accepts and often returns both `ksk` (preferred) and `kssk` (legacy) fields so older callers continue to work.
- Client‑side persistence has been removed; the UI fetches from Redis on demand and relies on SSE/live events for updates.
- Station set keys are now `ksk:station:*` (a migration script exists: `scripts/migrate-station-sets.mjs`).

<div align="center">

# Wireless KFB GUI

Kompakt állomásalkalmazás KFB panelek (MAC) szkenneléséhez, KSK előkészítéshez és CHECK ellenőrzésekhez. Next.js App Router + Electron, Redis háttértárral.

![badge-node](https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white)
![badge-next](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![badge-electron](https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white)
![badge-typescript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![badge-redis](https://img.shields.io/badge/Redis-required-red?logo=redis&logoColor=white)

</div>

> **Nyelvválasztó**  
> 🇬🇧 Angol dokumentáció: [1. Setup](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/1-SETUP.md) → [2. Main Application](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/2-MAINAPPLICATION.md) → [3. Process Flow](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/3-PROCESS-FLOW.md) → [4. Troubleshooting](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/4-ERRORS.md) → [5. Scenarios](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/5-SCENARIOS.md) → [6. ESP firmware](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/6-ESP-PLATFORMIO.md)  
> 🇭🇺 Magyar összefoglalók: [1. Setup](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/1-Setup-HU.md) → [2. MainApplicationUI](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/2-MainApplication-HU.md) → [3. Folyamat összefoglaló](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/3-Process-Flow-HU.md) → [4. Hibakeresés](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/4-Errors-HU.md) → [5. Forgatókönyvek](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/5-Scenarios-HU.md) → [6. ESP firmware](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/6-ESP-PLATFORMIO-HU.md)

---

## Fő funkciók

- Vonalkód olvasás: külön porton a Dashboard (ACM0) és a Setup (ACM1).
- ESP kommunikáció: CHECK/MONITOR és ESP programozás automatikus visszajelzéssel.
- Redis integráció: aliasok, pinek, KSK lockok és Krosy checkpoint tárolása.
- Krosy XML feldolgozás: Setup oldalon pin → alias megfeleltetés és opcionális checkpoint.
- Teljesen kliensmentes állapotkezelés (nincs localStorage).

## Gyors indulás

1. Telepítsd a függőségeket: `npm install`
2. Indíts Redis-t (`npm run redis:up` vagy külső szerver).
3. `npm run dev` – Next.js + Node szerver + Electron együtt indul.
4. Setup: `http://localhost:3000/setup` · Dashboard: `http://localhost:3000/`

### Hasznos parancsok

- `npm run predev` – Redis konténer felhúzása és readiness várakozás
- `npm run dev` – teljes fejlesztői stack
- `npm run build` – AppImage build (x86_64)
- `npm run build:arm64` – AppImage ARM64
- `npm run lint` · `npm run type-check` – kódellenőrzés

## Contributor Onboarding

Új fejlesztőknek ajánlott áttekinteni a [AGENTS.md](./AGENTS.md) "Repository Guidelines" dokumentumot.
Összefoglalja a könyvtárstruktúrát, fő parancsokat, kódstílust és PR elvárásokat, így gyorsítja a belépést és az ellenőrzési folyamatot.

## MainApplicationUI Scan Scenarios

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 90, 'rankSpacing': 140}, 'themeVariables': {'fontSize': '18px'}}}%%
flowchart LR
    A[IDLE: Scan Prompt] --> S[Scanner ACM0 event]
    S -->|Run check may retrigger| B{Setup data present?}
    B -- No --> B1[Show no setup data banner\nClear scanned code\nReady for immediate retry] --> A

    B -- Yes --> C{Failures or unknown pins?}

    C -- Yes --> LM0
    subgraph Live_Mode [LIVE MODE]
        direction TB
        LM0[Enter live view]
        LM1[Render status pill]
        LM2[Display branch cards]
        LM3[Highlight pending failures]
        LM4[Stream serial edges]
        LM0 --> LM1 --> LM2 --> LM3 --> LM4
        LM4 -->|Pins still failing| LM2
    end
    LM4 -->|All pins recovered| F0

    C -- No --> F0

    subgraph Finalize_Cleanup [FINALIZE & CLEANUP]
        direction LR
        F0[Begin finalize sequence] --> F1[Send checkpoints for active KSKs]
        F1 --> F2[Clear Redis alias cache]
        F2 --> F3[Clear KSK locks]
        F3 --> F4[Flash OK SVG]
        F4 --> F5[Reset UI to IDLE]
    end
    F5 --> A

    %% Error path
    A -.->|Errors 429 504 Pending during scan| R0[Auto-retry loop]
    R0 -->|Retry success| R1[Re-run check]
    R1 --> C
    R0 -->|Retries exhausted| R2[Reset KFB context\nClear branch data\nShow retry prompt]
    R2 --> A
```

1. INPUT: Scan or run check for a MAC/KFB without any setup aliases/pins -> OUTPUT: UI shows `No setup data available for this MAC`, clears the scanned code, and returns to IDLE so the operator can retry immediately.
2. INPUT: Scan or run check returns failures/unknown pin data -> OUTPUT: Live mode stays active, streaming real-time pin edges with contact labels and a pending-failures list until all errors clear; once recovered it falls through to the finalize sequence.
   2.1 INPUT: BranchDashboardMainContent enters live mode with active MAC -> OUTPUT: Renders status pill (`SCANNING`/`CHECKING`), builds branch cards with OK/NOK/Not Tested badges, highlights pending pins, flashes a large OK SVG once the pins recover, pushes checkpoints for active KSKs, clears Redis aliases and locks, shows the cleanup note, then returns to the scan prompt.
3. INPUT: Scan or run check finishes with no failures and setup data present -> OUTPUT: Finalize sequence runs (checkpoints → alias purge → lock clear), flashes the OK SVG, surfaces the cleanup note, and resets the UI for the next device.
4. INPUT: Scan or run check hits errors like 429/504/pending -> OUTPUT: Scheduler queues bounded retries (default 350 ms backoff); any successful retry drops back into the normal live/finalize branch, while exhausting the retry budget disables the OK flash, clears branch/alias state, resets the KFB context to IDLE, and surfaces a retry prompt so the operator must rescan.

### Setup Page Flow (ACM1)

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 85, 'rankSpacing': 130}, 'themeVariables': {'fontSize': '17px'}}}%%
flowchart LR
    S0[Setup idle] --> S1[Acquire scan scope setup]
    S1 --> S2[Scanner ACM1 event or manual input]
    S2 --> T{Classify code}

    T -- KFB MAC --> K0[Set board MAC and setup name]
    K0 --> K1[Reset KSK slots to idle]
    K1 --> K2[Start 60s countdown update TableSwap header]
    K2 --> S0

    T -- KSK serial --> P0[Pre checks board scanned duplicates capacity]
    P0 -- fail --> PF[Show panel error keep slot idle] --> S0
    P0 -- ok --> P1[Mark slot pending]
    P1 --> P2[POST ksk lock]
    P2 -- failure --> P3[Revert slot show error] --> S0
    P2 -- success --> P4[Add lock start heartbeat]
    P4 --> P5[Load aliases prefer Redis fallback Krosy]
    P5 -- failure --> P6[Mark slot error toast message] --> S0
    P5 -- success --> P7[Persist pin map update slot OK]
    P7 --> P8[Trigger TableSwap flash increment cycle]
    P8 --> P9[If three OK schedule auto reset]
    P9 --> S0

    T -- Unknown --> U0[Show unrecognized code error] --> S0
```

### LIVE Mode Internals (Scenario 2.1)

```mermaid
flowchart TB
    L0[Live mode enter with active MAC] --> L1[Render status pill SCANNING or CHECKING]
    L1 --> L2[Build branch cards with OK or NOK or Not Tested]
    L2 --> L3[Show contact label names and pin states in real time]
    L3 --> L4[Highlight pending failures list and pin numbers]
    L4 --> L5[Stream live edges from serial events]
    L5 -->|Pins still failing| L3
    L5 -->|All pins recover| L6[Flash large OK SVG]
    L6 --> L7[Push checkpoints for active KSKs]
    L7 --> L8[Bulk delete Redis alias cache for MAC]
    L8 --> L9[Clear KSK locks from Redis]
    L9 --> L10[Display cleanup note checkpoint cache locks]
    L10 --> L11[Return to scan prompt IDLE]
```

### Error and Retry Handling (Scenario 4)

```mermaid
flowchart TB
    R0[Scan or run check] --> R1{HTTP response}
    R1 -- 200 OK --> R3[Process result payload]
    R1 -- 429 Too Many Requests --> R2[Schedule retry 350ms]
    R1 -- 504 Gateway Timeout --> R2
    R1 -- Pending or No Result --> R2
    R2 -->|Attempts remaining| R0
    R2 -->|Attempts exhausted| R4[Disable OK animation & reset KFB]
    R4 --> R5[Clear branch data and name hints]
    R5 --> R6[Prompt operator to rescan] --> R7[IDLE]
```

### TableSwap Flow

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 80, 'rankSpacing': 120}, 'themeVariables': {'fontSize': '16px'}}}%%
flowchart TB
    T0[TableSwap prompt idle] -->|Board MAC scanned| T1[Set board context title]
    T1 -->|Cycle key bump| T2[Animate slide to new header]
    T2 --> T3[Show progress prompt]
    T3 -->|Slot pending| T4[Highlight slot pending]
    T4 --> T5{Lock and alias success}
    T5 -- no --> T6[Flash error overlay keep slot retry]
    T6 --> T3
    T5 -- yes --> T7[Flash success overlay]
    T7 --> T8[Slot marked OK heartbeat running]
    T8 -->|All slots cleared or auto reset| T0
```

### TableSwap Flow

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 80, 'rankSpacing': 120}, 'themeVariables': {'fontSize': '16px'}}}%%
flowchart TB
    T0[TableSwap prompt idle] -->|Board MAC scanned| T1[Set board context title]
    T1 -->|cycle key bump| T2[Animate slide to new header]
    T2 --> T3[Show progress prompt]
    T3 -->|Slot pending| T4[Highlight slot pending]
    T4 --> T5{Lock and alias success}
    T5 -- no --> T6[Flash error overlay keep slot retry]
    T6 --> T3
    T5 -- yes --> T7[Flash success overlay]
    T7 --> T8[Slot marked OK heartbeat running]
    T8 -->|All slots cleared or auto reset| T0
```

## Kulcs környezeti változók (részletek a doksiban)

| Téma               | Példa változók                                                                                     | Részletes leírás                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ESP**            | `ESP_TTY_PATH`, `ESP_BAUD`, `ESP_HEALTH_PROBE`, `ESP_PING_CMD`                                     | [EN](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/2-MAINAPPLICATION.md) · [HU](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/2-MainApplication-HU.md) |
| **Scannerek**      | `SCANNER_TTY_PATHS`, `NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD`, `NEXT_PUBLIC_SCANNER_INDEX_SETUP`      | [EN](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/2-MAINAPPLICATION.md) · [HU](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/2-MainApplication-HU.md) |
| **Setup/Krosy**    | `NEXT_PUBLIC_KROSY_ONLINE`, `NEXT_PUBLIC_KROSY_URL_ONLINE`, `NEXT_PUBLIC_KSK_TTL_SEC`              | [EN](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/1-SETUP.md) · [HU](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/1-Setup-HU.md)                     |
| **Redis / Lockok** | `REDIS_URL`, `KSK_REQUIRE_REDIS`, `KSK_DEFAULT_TTL_SEC`, `NEXT_PUBLIC_KSK_REQUIRE_REDIS`           | [EN](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/1-SETUP.md)                                                                                                                   |
| **Workflow**       | `CHECK_SEND_MODE`, `NEXT_PUBLIC_SCANNER_POLL_IF_STALE_MS`, `NEXT_PUBLIC_FINALIZED_RESCAN_BLOCK_MS` | [EN](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/3-PROCESS-FLOW.md)                                                                                                            |
| **Naplózás**       | `LOG_VERBOSE`, `LOG_ENABLE`, `LOG_TAG_LEVELS`, `LOG_MONITOR_ONLY`                                  | [EN](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/4-ERRORS.md)                                                                                                                  |
| **ESP firmware**   | `ESPNOW_CHANNEL`, MCP címek, debounce konstansok                                                   | [EN](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/6-ESP-PLATFORMIO.md) · [HU](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/6-ESP-PLATFORMIO-HU.md)   |

## Ajánlott olvasási sorrend

1. **Setup / Előkészítés**
   - 🇬🇧 [docs/EN/1-SETUP.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/1-SETUP.md)
   - 🇭🇺 [docs/HU/1-Setup-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/1-Setup-HU.md)
2. **Main Application / Dashboard**
   - 🇬🇧 [docs/EN/2-MAINAPPLICATION.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/2-MAINAPPLICATION.md)
   - 🇭🇺 [docs/HU/2-MainApplication-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/2-MainApplication-HU.md)
3. **Teljes folyamat leírása**
   - 🇬🇧 [docs/EN/3-PROCESS-FLOW.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/3-PROCESS-FLOW.md)
   - 🇭🇺 [docs/HU/3-Process-Flow-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/3-Process-Flow-HU.md)
4. **Hibakeresés**
   - 🇬🇧 [docs/EN/4-ERRORS.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/4-ERRORS.md)
   - 🇭🇺 [docs/HU/4-Errors-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/4-Errors-HU.md)
5. **További forgatókönyvek / javaslatok**
   - 🇬🇧 [docs/EN/5-SCENARIOS.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/5-SCENARIOS.md)
   - 🇭🇺 [docs/HU/5-Scenarios-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/5-Scenarios-HU.md)
6. **ESP firmware (PlatformIO projektek)**
   - 🇬🇧 [docs/EN/6-ESP-PLATFORMIO.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/6-ESP-PLATFORMIO.md)
   - 🇭🇺 [docs/HU/6-ESP-PLATFORMIO-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/6-ESP-PLATFORMIO-HU.md)

## Naplózás és ellenőrzés

- `LOG_VERBOSE=1` → fájl naplók (`logs/app.log`, `.krosy-logs/...`).
- Hibák mindig bekerülnek a `logs/errors.log` fájlba.
- Konzol üzenetek: `MONITOR start/ok`, `CHECK fail`, Redis figyelmeztetések.

## Gyakori hibák

- **Nem indul a scan**: ellenőrizd a scanner portot az SSE streamben (`/api/serial/events`).
- **CHECK timeout**: vizsgáld meg az ESP kábelt, `ESP_TTY_PATH` értéket, próbáld `ESP_DEBUG=1`-gyel.
- **Lock beragad**: `DELETE /api/ksk-lock?mac=...&force=1`, majd frissítsd a Setup oldalt.
- **Alias hiányzik**: futtasd `POST /api/aliases/rehydrate`, ellenőrizd `GET /api/aliases?mac=...&all=1` választ.

---

## Projekt felépítése (röviden)

- `src/app/` – Next.js oldalak és API route-ok (App Router)
- `src/components/` – UI komponensek (PascalCase)
- `src/lib/` – osztott segédfüggvények (serial, redis, logger)
- `main/` – Electron főfolyamat
- `server.ts`, `dist-server/` – Node szerver belépési pont + build
- `logs/` (pl. `app.log`, `errors.log`), `.krosy-logs/` – naplók

## Támogatás

Kérdés esetén nézd át a [docs/EN/4-ERRORS.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/4-ERRORS.md) útmutatót, vagy jelezd a csapatnak a konkrét hibát/napló részlettel.
Telefonos elérhetőség: 621.
The project was made by Nagy Viktor.

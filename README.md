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
> 🇬🇧 Angol dokumentáció: [Main Application](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/MAINAPPLICATION.md) · [Setup](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/SETUP.md)  
> 🇭🇺 Magyar összefoglalók: [MainApplicationUI folyamat](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/MainApplicationUI-HU.md) · [Setup folyamat](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/SetupPage-HU.md)

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

## Kulcs környezeti változók

| Téma | Változók |
|------|----------|
| **ESP** | `ESP_TTY_PATH=/dev/ttyUSB0`, `ESP_BAUD=115200`, `ESP_HEALTH_PROBE` |
| **Scannerek** | `SCANNER_TTY_PATHS=/dev/ttyACM0,/dev/ttyACM1`, `NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD=0`, `NEXT_PUBLIC_SCANNER_INDEX_SETUP=1` |
| **Setup/Krosy** | `NEXT_PUBLIC_KROSY_ONLINE`, `NEXT_PUBLIC_KROSY_IP_ONLINE`, `NEXT_PUBLIC_KROSY_URL_ONLINE`, `NEXT_PUBLIC_KSK_TTL_SEC` |
| **Dashboard** | `NEXT_PUBLIC_KFB_REGEX`, `NEXT_PUBLIC_CHECK_RETRY_COUNT`, `NEXT_PUBLIC_OK_OVERLAY_MS`, `CHECK_SEND_MODE` |
| **Redis** | `REDIS_URL`, `KSK_REQUIRE_REDIS`, `KSK_DEFAULT_TTL_SEC`, `NEXT_PUBLIC_ALIAS_REQUIRE_REDIS` |
| **Naplózás** | `LOG_VERBOSE`, `LOG_ENABLE`, `LOG_TAG_LEVELS`, `LOG_MONITOR_ONLY` |

Részletes lista: [docs/EN/SETUP.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/SETUP.md), [docs/EN/MAINAPPLICATION.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/MAINAPPLICATION.md).

## Dokumentációs rövidítés
- **Angol**
  - [docs/EN/MAINAPPLICATION.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/MAINAPPLICATION.md) – Dashboard viselkedés
  - [docs/EN/SETUP.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/SETUP.md) – Setup részletek
  - [docs/EN/PROCESS-FLOW.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/PROCESS-FLOW.md) – teljes folyamat
  - [docs/EN/ERRORS.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/ERRORS.md) – hibaelhárítás
  - [docs/EN/SCENARIOS.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/SCENARIOS.md) – tipikus forgatókönyvek
- **Magyar**
  - [docs/HU/MainApplicationUI-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/MainApplicationUI-HU.md) – Dashboard folyamat
  - [docs/HU/SetupPage-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/SetupPage-HU.md) – Setup folyamat
  - [docs/HU/PROCESS-FLOW-HU.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/PROCESS-FLOW-HU.md) – összefoglaló a fő lépésekről
  - [docs/HU/ERRORS.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/ERRORS.md) – hibakeresés
  - [docs/HU/SCENARIOS.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/HU/SCENARIOS.md) – forgatókönyvek és javaslatok

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
Kérdés esetén nézd át a [docs/EN/ERRORS.md](https://github.com/projects-kssk/Wireless_KFB_Project/blob/main/docs/EN/ERRORS.md) útmutatót, vagy jelezd a csapatnak a konkrét hibát/napló részlettel.

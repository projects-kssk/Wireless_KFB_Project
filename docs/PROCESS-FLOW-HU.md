# KFB Wireless Clip Tester – Fő folyamatok (HU)

Ez a dokumentum magyar nyelven foglalja össze a **Setup** és a **Main Application (Dashboard)** modulok működését. A cél, hogy a csapat könnyen átlássa, milyen bemenetekre építünk, milyen API-kon kommunikálunk, mi történik a háttérben, és hogyan zárul le a folyamat.

---

## Architektúra áttekintése

- **Két külön felhasználói felület**: a Setup felel a KSK előkészítésért és az ESP programozásáért, míg a Main Application a napi ellenőrzéseket (CHECK) futtatja.
- **Külön vonalkódolvasók**: Setup → `/dev/ttyACM1`, Dashboard → `/dev/ttyACM0`. Ez fizikailag is szétválasztja a folyamatokat.
- **Redis a tartós állapothoz**: aliasok, pinek, krosy XML-ek és lockok minden esetben Redisben élnek; a kliens soha nem használ localStorage-t.
- **SSE + REST**: a gyors visszajelzéshez SSE (`/api/serial/events`), míg az állapotmódosító műveletek REST (pl. `/api/aliases`, `/api/serial`).
- **Design elv**: Setup állítja elő az ellenőrzéshez szükséges adatokat, Main Application csak fogyasztja és visszajelzést ad.

---

## Setup folyamat

### Inputs
- Operátor megnyitja a Setup oldalt (`/setup`).
- Állomás azonosító: `NEXT_PUBLIC_STATION_ID` (fallback: böngésző host neve).
- Vonalkód: MAC (KFB) és max. 3 KSK; az olvasó alapból a `/dev/ttyACM1` portra csatlakozik.
- Környezeti mód: `NEXT_PUBLIC_KROSY_ONLINE=true/false` – online vagy offline Krosy backend.
- Redis elérhető (`REDIS_URL`), különben a folyamat hibára fut.

### API hívások
1. **Lock szerzés** – `POST /api/ksk-lock`
   - Törzs: `{ ksk, mac?, stationId, ttlSec? }`
   - Siker esetén 60 mp-es heartbeat: `PATCH /api/ksk-lock` ugyanazzal az azonosítóval.
2. **Krosy adat lekérés**
   - Online: `POST /api/krosy`
   - Offline: `POST /api/krosy-offline`
   - Válasz: XML vagy JSON, ebből jönnek a pin‑ és alias információk.
3. **Aliasok mentése** – `POST /api/aliases`
   - `{ mac, ksk, aliases, normalPins, latchPins, xml?, hints? }`
   - A szerver frissíti a MAC union aliasait.
4. **ESP programozás** – `POST /api/serial`
   - `{ mac, normalPins, latchPins, kssk }` (a mező neve kompatibilitásból `kssk`).
5. **Lock monitorozás** – `GET /api/ksk-lock?stationId=<id>`
   - A Setup folyamatosan összeveti az aktív lockokat.

### Mi történik
- Setup lefoglalja a „setup” scan scope-ot, így az ACM1 olvasó jelei csak itt érvényesek.
- MAC összekapcsolása KSK-kkal: a Krosy válasz alapján normál és latch pinek, aliasok és opcionális XML kerül elmentésre.
- ESP programozása után a kliens „KSK OK” jelzést ad.
- Redis nélkül (`NEXT_PUBLIC_KSK_REQUIRE_REDIS=1`) a folyamat nem megy tovább, ezzel védve a tartós adatok integritását.

### Finalize
- Sikeres programozás → vizuális OK visszajelzés, lock heartbeat fut tovább.
- Kilépéskor javasolt:
  - `DELETE /api/ksk-lock` (force=1) – lock felszabadítása.
  - `POST /api/aliases/clear` – ha a MAC-et törölni kell a Redisből.
- Opcionális checkpoint export: `POST /api/krosy/checkpoint` (amikor a Redis tárol XML-t).

### Fontos beállítások (Setup)
- `NEXT_PUBLIC_SCANNER_PATH_SETUP` – explicit scanner útvonal, ha nem ACM1.
- `NEXT_PUBLIC_KSK_TTL_SEC` – lock heartbeat intervallum.
- `NEXT_PUBLIC_SETUP_ALLOW_NO_ESP` – engedélyezi-e a lock megtartását ESP hiba után.
- `NEXT_PUBLIC_ALIAS_PREFER_REDIS`, `NEXT_PUBLIC_ALIAS_REQUIRE_REDIS` – alias betöltési politika.
- Krosy célok: `NEXT_PUBLIC_KROSY_URL_ONLINE`, `NEXT_PUBLIC_KROSY_URL_OFFLINE`, `NEXT_PUBLIC_KROSY_OFFLINE_TARGET_URL`.

---

## Main Application (Dashboard) folyamat

### Inputs
- Felhasználó megnyitja a fő alkalmazást (`/`).
- Vonalkóddal vagy kézi bevitel: MAC cím – az ACM0 olvasóhoz kötve.
- Redis adat (aliases, XML) a Setup-ból.
- SSE kapcsolat az ESP és a vonalkódolvasó állapotához.

### API hívások
1. **SSE kapcsolat** – `GET /api/serial/events`
   - Path param: `?mac=AA:BB:...` opcionális szűrés.
2. **Alias töltés**
   - MAC union: `GET /api/aliases?mac=<MAC>`
   - Teljes lista: `GET /api/aliases?mac=<MAC>&all=1`
   - Rehydrate (best-effort): `POST /api/aliases/rehydrate`
3. **CHECK indítás** – `POST /api/serial/check`
   - `{ mac }` vagy pin lista; server `CHECK_SEND_MODE` szerint határozza meg a küldendő pineket.
4. **Checkpoint (opcionális)** – `POST /api/krosy/checkpoint`
5. **Cleanup**
   - `POST /api/aliases/clear`
   - `DELETE /api/ksk-lock`

### Mi történik
- Dashboard csak az ACM0 jeleit dolgozza fel (fallback akkor, ha a beállított index útvonala „0”-ra végződik).
- Új MAC → alias/pin unió letöltése → CHECK futtatása.
- SSE események (`ev`, `scan`, `aliases/union`) valós időben mozgatják a UI-t.
- Hibás CHECK esetén a UI kiemeli a hiányzó/téves pin eket, és rögzíti a legutóbbi mac-et a cooldown listában.

### Finalize
- `RESULT SUCCESS` (SSE) → `finalizeOkForMac` automatikusan:
  - Mac blokkolása rövid időre (dupla olvasás ellen).
  - Aliasok törlése, lock oldása (API hívások a háttérben).
  - Checkpoint küldés, ha elérhető XML.
  - UI visszaáll „idle” állapotba.
- Sikertelen CHECK → vizuális hiba, manuális beavatkozás szükséges (újraszkennelés, Setup ellenőrzés).

### Fontos beállítások (Dashboard)
- Scanner routing: `SCANNER_TTY_PATHS`, `NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD`, `NEXT_PUBLIC_SCANNER_PATH_DASHBOARD`.
- CHECK viselkedés: `CHECK_SEND_MODE`, `CHECK_RESULT_TIMEOUT_MS`, `NEXT_PUBLIC_CHECK_CLIENT_TIMEOUT_MS`, `NEXT_PUBLIC_CHECK_RETRY_COUNT`.
- UI időzítések: `NEXT_PUBLIC_OK_OVERLAY_MS`, `NEXT_PUBLIC_SCAN_OVERLAY_MS`, `NEXT_PUBLIC_RETRY_COOLDOWN_MS`.
- SSE opciók: `NEXT_PUBLIC_BASE_SSE_ENABLED`, `NEXT_PUBLIC_EV_LOG`.
- Redis monitorozás: `NEXT_PUBLIC_REDIS_DROP_DEBOUNCE_MS`, `NEXT_PUBLIC_ASSUME_REDIS_READY`.

---

## Routes & szolgáltatások összefoglaló

| Útvonal | Metódus | Modul | Leírás |
|---------|---------|-------|--------|
| `/api/serial/events` | GET (SSE) | közös | ESP, scanner, Redis, alias események streamje |
| `/api/serial` | POST | Setup | ESP programozása pin listával |
| `/api/serial/check` | POST | Dashboard | CHECK futtatása egy MAC-re |
| `/api/serial/scanner` | GET | Dashboard | Poll fallback a legutóbbi scanre |
| `/api/aliases` | GET/POST | közös | Aliasok mentése és olvasása (union + elemek) |
| `/api/aliases/clear` | POST | közös | MAC-hez tartozó aliasok törlése |
| `/api/aliases/rehydrate` | POST | Dashboard | Redis újbóli indexelése, ha hiányos |
| `/api/krosy` / `/api/krosy-offline` | POST | Setup | Krosy adat lekérés online/offline módon |
| `/api/krosy/checkpoint` | POST | mindkettő | Krosy checkpoint elküldése |
| `/api/ksk-lock` | POST/PATCH/DELETE | Setup | KSK lock szerzés, heartbeat, felszabadítás |

---

## Design megfontolások

- **Fizikai szeparáció**: külön USB portokra kötött olvasók minimalizálják a téves folyamatindítás esélyét.
- **Stateless kliens**: minden kritikus adat (alias, pin, lock) a szerveren/Redisben tárolódik, így több kliens vagy böngészőfül is biztonságosan használható.
- **Graceful degrade**: SSE kiesés esetén a dashboard HTTP pollra vált (`/api/serial/scanner`).
- **Karbantarthatóság**: API-k mindenhol a `ksk` mezőt preferálják, de a régi `kssk` mező még elfogadott, amíg minden kliens át nem áll.
- **Audit & naplózás**: `LOG_VERBOSE` engedélyezi a `.krosy-logs/`, `monitor.logs/` és `logs/app-YYYY-MM-DD.log` naplókat, hibák mindig a `logs/errors.log` fájlba kerülnek.

---

## Hibakeresési tippek

- **Nincs scan a Setupban**: ellenőrizd, hogy az ACM1 valóban jelen van (`/api/serial/events` → `scanner/paths`).
- **CHECK nem ad visszajelzést**: vizsgáld meg az ESP kábelt, `ESP_TTY_PATH` beállítást, és a logokat (`LOG_VERBOSE=1`).
- **Alias hiányzik a Dashboardon**: futtasd újra a Setup folyamatot vagy `POST /api/aliases/rehydrate` + `GET /api/aliases?mac=...&all=1`.
- **Lock beragad**: `DELETE /api/ksk-lock?mac=<MAC>&force=1`, majd ellenőrizd a `ksk:station:<id>` Redis kulcsokat.

---

## Kapcsolódó dokumentumok

- `docs/SETUP.md` – részletes Setup konfiguráció
- `docs/MAINAPPLICATION.md` – Dashboard viselkedés és env változók
- `docs/PROCESS-FLOW.md` – angol nyelvű end-to-end leírás
- `docs/ERRORS.md` – hibakódok és diagnosztika


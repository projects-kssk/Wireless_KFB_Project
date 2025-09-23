# Hibakeresés és Gyakori Ellenőrzések (HU)

Ez a dokumentum a leggyakoribb hibaforrások gyors ellenőrzéséhez ad segítséget. A fő fókusz a Krosy kapcsolat, a helyi szerver, a vonalkódolvasók, az ESP és a Redis elérés.

---

## Krosy szerver
- **Mód**: Ellenőrizd, hogy a `NEXT_PUBLIC_KROSY_ONLINE=true|false` megfelel-e a tényleges környezetnek.
- **Online végpont**: A `NEXT_PUBLIC_KROSY_URL_ONLINE` legyen elérhető a szerver gépről (TCP a route felé, HTTP az identity végponthoz).
- **Offline továbbítás**: A `NEXT_PUBLIC_KROSY_OFFLINE_TARGET_URL` mutasson a helyi proxy céljára.
- **Identity teszt**: `GET /api/krosy` → `{ hostname, ip, mac }` választ kell adjon.
- **Logok**: `.krosy-logs/YYYY-MM/<bélyeg>_<requestID>/` – itt találhatók a kérés/válasz XML-ek.
- **Időtúllépés**: `KROSY_TCP_TIMEOUT_MS` (online) vagy `KROSY_TIMEOUT_MS` (offline). Lassabb kapcsolatnál emeld az értéket.

## Helyi szerver (Next.js + Node)
- **Elérés**: A szerver a `PORT` (alapértelmezetten `3003`) porton indul; az Electron megvárja.
- **Indítás**: `npm run dev` (Next + Node + Electron) vagy `npm run electron:dev`.
- **API tesztek**:
  - `GET /api/serial?probe=1` – ESP egészség.
  - `GET /api/serial/devices` – elérhető soros eszközök.
  - `GET /api/serial/events` – SSE stream a scanner/ESP eseményekkel.
- **Logok**:
  - Alkalmazás: `logs/app.log` (`LOG_ENABLE=1` vagy `LOG_VERBOSE=1`).
  - Hibák: `logs/errors.log` (mindig gyűjti a hiba szintű sorokat).
  - Monitor események: az `app.log` fájlban (`monitor` taggel, `LOG_VERBOSE=1`).
  - Alias XML olvasások: `logs/aliases-xml-reads-YYYY-MM-DD.log` (`LOG_VERBOSE=1`).

## Vonalkódolvasók
- **Eszközútvonalak**: `SCANNER_TTY_PATHS=/dev/ttyACM0,/dev/ttyACM1`.
- **UI indexek**: `NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD=0`, `NEXT_PUBLIC_SCANNER_INDEX_SETUP=1`.
- **Megnyitási szabály**: Ha `ALLOW_USB_SCANNER` nincs beállítva, a kód nem nyit USB-s eszközt, ami ütközhet az ESP-vel.
- **Események figyelése**: `GET /api/serial/events` → `scanner/open`, `scanner/error`, `scan` (path + code).
- **Poll fallback**: `GET /api/serial/scanner?path=<eszköz>` – adott port legutóbbi olvasata.
- **Logok**: monitor események az `app.log` fájlban (`monitor` taggel).

## ESP
- **Port**: `ESP_TTY` vagy `ESP_TTY_PATH` (általában `/dev/ttyUSB*`).
- **Baud**: `ESP_BAUD` (alap 115200).
- **Egészség monitor**: `ESP_HEALTH_PROBE=never|if-stale|always`.
- **Ping parancs**: `ESP_PING_CMD` opcionális, támogatja a `{payload}` helyőrzőt (a `{mac}` jelenleg figyelmen kívül marad).
- **Debug**: `ESP_DEBUG=1` – soros olvasási sorok kiírása a konzolra.

## Redis
- **URL**: `REDIS_URL=redis://127.0.0.1:6379`.
- **Lock policy**: `KSK_REQUIRE_REDIS=1` → a szerver oldali lock végpontok csak Redis mellett működnek.
- **Kliens policy**: `NEXT_PUBLIC_KSK_REQUIRE_REDIS=1` → a Setup oldal is igényli a Redis-t.
- **Lockok vizsgálata**: `npm run locks:station -- --id=<STATION>` vagy `npm run locks:station:watch -- --id=<STATION>`.
- **Alias lekérés**: `GET /api/aliases?mac=<MAC>&all=1` (per-KSK adatok), `GET /api/aliases?mac=<MAC>` (union).

## Gyakori tünetek
- **Nincs scan**: figyeld az SSE-t (`scanner/open`), ellenőrizd a `path` mezőt és az indexeket.
- **Nincs Krosy válasz**: hálózati útvonal ellenőrzése `KROSY_CONNECT_HOST` felé vagy az offline cél URL; nézd meg a `.krosy-logs` könyvtárat.
- **Hiányzó pinek CHECK közben**: ellenőrizd, hogy az aliasok léteznek-e a Redisben; futtasd `POST /api/aliases/rehydrate`, majd `GET /api/aliases?mac=<MAC>&all=1`.
- **Beragadt lockok**: `DELETE /api/ksk-lock` `{ mac, [stationId], force: 1 }` törzssel.

---

További tippekért lásd az angol változatot: [`docs/EN/4-ERRORS.md`](../EN/4-ERRORS.md).

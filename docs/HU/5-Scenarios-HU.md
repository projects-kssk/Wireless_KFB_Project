# Üzemeltetési Forgatókönyvek és Javaslatok (HU)

A dokumentum összegyűjti a legfontosabb Setup, Dashboard, Scanner, Electron és naplózási forgatókönyveket. Minden pontnál jelezzük a főbb hiányosságokat és a lehetséges fejlesztési ötleteket.

---

## Setup forgatókönyvek (MAC → legfeljebb 3 KSK)
- **Boldog út (online)**: lock szerzés → Krosy XML (`POST /api/krosy`) → alias mentés (`POST /api/aliases`) → ESP programozás (`POST /api/serial`) → heartbeat → OK visszajelzés.
- **Boldog út (offline)**: lock szerzés → `POST /api/krosy-offline` (helyi proxy) → alias mentés → ESP programozás → OK.
- **Redis nem elérhető / kötelező**: `POST /api/ksk-lock` 503-at ad → Setup leáll. Javaslat: UI értesítés + Retry gomb.
- **Lock ütközés**: `POST /api/ksk-lock` 409, mutasd a tulajdonos állomást (ha ismert).
- **Nincs Krosy XML/pin**: Setup "Krosy configuration error: no PINS" üzenetet jelez. Javaslat: link a mentett XML loghoz.
- **Alias mentés hibás**: ESP program mehet tovább, de union hiányos maradhat. Javaslat: háttérben ismételt mentés + vizuális figyelmeztetés.
- **ESP írás sikertelen**: ha `NEXT_PUBLIC_SETUP_ALLOW_NO_ESP=0`, lock felszabadítás + reset; különben OK maradhat. Javaslat: port/baud infó és utolsó health sor mutatása.
- **Heartbeat TTL lejár**: lock eltűnik a listából; a következő PATCH újra beállítja. Javaslat: vizuális TTL visszaszámláló slotonként.

## Dashboard (Check) forgatókönyvek
- **Teljes adat (rehydrated + union)**: `GET /api/aliases?mac&all=1` visszatér → csoportosított + lapos nézet OK → siker.
- **Hiányos union**: merge mód (alap) a kliens pinekkel is működik, de kevesebb név látszik. Javaslat: figyelmeztetés Setup újrafuttatására.
- **RESULT success (live)**: OK overlay + opcionális checkpoint → Redis takarítás (aliases + lock). Még sikertelen checkpoint esetén is működik.
- **RESULT failure**: hibás pinek kijelölése; lock marad. Javaslat: "Release locks" gomb sikertelen futásnál.
- **SSE kapcsolat hiányzik**: polling továbbra is hoz scanneket, de OK overlay manuális. Javaslat: SSE egészség kijelzés.

## Vonalkódolvasók
- **Egy scanner nem alap indexen**: indexek konfigurálhatók; tail alapú útválasztás; polling fallback elérhető.
- **Két scanner (dashboard + setup)**: külön indexek támogatottak. Javaslat: UI választó, ha mismatch érzékelhető.
- **Eszköz kihúzva / jogosultság hiba**: SSE `scanner/error`; UI "not detected" badge. Javaslat: diagnosztikai lista a soros portokról.

## Electron (két ablak)
- **Dual window**: `/` és `/setup` automatikusan nyílik, ha a szerver kész.
- **Monitor kezelés**: egy kijelzőn fullscreen, két kijelzőn mindkettő maximalizál.
- **Szerver hiba / port foglalt**: Electron vár, ha timeout, nem nyílik ablak. Javaslat: prompt port váltásra vagy retry-ra.

## Naplózás és megőrzés
- App logok: napi fájlok, ~31 nap után törlődnek.
- Monitor logok: havi mappák alatt napi fájlok, ~31 napos retention.
- Krosy logok: havi mappa, kérésenként almappa, ~31 napos retention.
- Javaslatok:
  - Opcionális gzip az X napnál idősebb logokra.
  - Retenciós napok env-ben konfigurálhatók legyenek.

## Környezeti / konfigurációs forgatókönyvek
- **Hiányzó állomás azonosító**: lock funkciók nem működnek. Javaslat: induláskor ellenőrzés + banner, ha `NEXT_PUBLIC_STATION_ID` nincs beállítva.
- **Online/offline mód eltérés**: Krosy hibát dobhat; a logok segítenek. Javaslat: Setup oldalon kapcsolódási teszt gomb.
- **Hibás Redis URL**: lock/alias funkciók hibáznak. Megjegyzés: a `/api/health` végpont már elérhető, Redis + Krosy + Serial állapotot ad vissza; érdemes a Dashboardon is jelezni.

## Ismert hiányosságok / Nem implementált
- **Tesztelés**: nincs automatizált smoke teszt; az `npm run type-check` jelenleg csak egy "Skipping" üzenetet ad. Javaslat: reaktiválni a type-checket és hozzáadni minimális Jest teszteket.
- **Elnevezések**: a Setup kód számos helyen továbbra is `kssk` változónevet használ (`ksk` helyett). Javaslat: egységesítés.
- **Operátori admin eszközök**: nincs UI a lock/alias kezelésre. Javaslat: admin panel a Redis műveletekhez.
- **Log zaj kezelése**: per-tag szint létezik, de nincs runtime váltás. Javaslat: Settings-ből vezérelni.
- **Biztonság**: nincs auth; lokális használatra készült. Javaslat: szerep alapú védelem, ha hálózaton fut.
- **Packaging**: jelenleg csak Linux AppImage build készül. Javaslat: electron-builder targetek bővítése macOS/Windows irányba.
- **Konfiguráció UI**: env alapú; nincs vizuális nézet vagy read-only config oldal a drift csökkentéséhez.

## Rövid javaslatlista (high value)
- `/api/health` végpont: már elérhető; Redis/Krosy/Serial állapotot ad, ezt érdemes a Dashboardon is vizuálisan jelezni.
- Admin oldal (csak dev): lock lista (force clear), alias lista MAC szerint, SSE egészség, friss monitor sorok.
- Retenció paraméterezése: `APP_LOG_RETENTION_DAYS`, `MONITOR_LOG_RETENTION_DAYS`, `KROSY_LOG_RETENTION_DAYS`.
- Minimális Jest tesztek: XML feldolgozás, pin extractor, alias union builder, serial objPos parser.
- KSK elnevezések véglegesítése Setup kódban (szemantikai egyértelműség).

---

Az angol eredeti a [`docs/EN/5-SCENARIOS.md`](../EN/5-SCENARIOS.md) fájlban érhető el.

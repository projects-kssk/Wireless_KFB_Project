# setup/page.tsx – Folyamatleírás (HU)

Magyar összefoglaló a `src/app/setup/page.tsx` komponensről. A Setup modul végzi a KSK előkészítését: lockolás, Krosy adatkinyerés, alias/pin mentés és ESP programozás. Az alábbiakban részletesen bemutatjuk a bemeneteket, az API kommunikációt, a lépéseket és a lezárás módját.

> Angol részletekhoz lásd: [`docs/EN/SETUP.md`](../EN/SETUP.md)

---

## Tartalomjegyzék
1. [Inputs](#inputs)
2. [API hívások](#api-hívások)
3. [Folyamat](#folyamat)
4. [Finalize](#finalize)
5. [Segédfüggvények](#fontos-helper-függvények)
6. [Hibakezelés](#hibakezelés-és-tippek)
7. [Kapcsolódó referenciák](#kapcsolódó-referenciák)

---

## Inputs

- **Oldal betöltése**: `/setup` App Router oldal, kliens oldali komponens.
- **Vonalkód olvasó**: alapértelmezett útvonal `/dev/ttyACM1` (vagy `NEXT_PUBLIC_SCANNER_PATH_SETUP`).
- **Állomás azonosító**: `NEXT_PUBLIC_STATION_ID`, fallback a böngésző hostname.
- **Környezeti módok**:
  - `NEXT_PUBLIC_KROSY_ONLINE` – online/offline elérés.
  - `NEXT_PUBLIC_SETUP_ALLOW_NO_ESP` – tartható-e lock ESP hiba esetén.
  - `NEXT_PUBLIC_KSK_REQUIRE_REDIS`, `NEXT_PUBLIC_ALIAS_REQUIRE_REDIS` – kötelező-e Redis.
- **Felhasználói interakciók**: MAC (KFB) scannelése → KSK scannelés → gombnyomások (pl. „Extract + Program”).
- **SSE**: `useSerialEvents(undefined, { base: true })` – scanner/ESP állapot monitor.

---

## API hívások

1. **Lock kezelés**
   - `POST /api/ksk-lock` – lock megszerzése (body: `{ ksk, mac?, stationId, ttlSec? }`).
   - `PATCH /api/ksk-lock` – heartbeat (azonos paraméterekkel).
   - `DELETE /api/ksk-lock` – lock felszabadítása (pl. `force:1`).
   - `GET /api/ksk-lock?stationId=<id>` – állomás lockjainak listázása.
2. **Krosy kommunikáció**
   - Online: `POST /api/krosy`
   - Offline: `POST /api/krosy-offline`
   - Body: `{ intksk, mac?, mode, includeLatch?, opts }` – a komponens állítja össze.
3. **Alias mentés** – `POST /api/aliases`
   - `{ mac, ksk, aliases, normalPins, latchPins, xml?, hints? }`.
4. **ESP programozás** – `POST /api/serial`
   - `{ mac, normalPins, latchPins, kssk }` (kompatibilis mező).
5. **Checkpoint (opcionális)**
   - `POST /api/krosy/checkpoint` vagy offline megfelelője.
6. **Simuláció / állapot**
   - `GET /api/simulate` – SIMULATE mód jelzése a UI-nak.

---

## Folyamat

### 1. Inicializálás és state-ek
- `useSerialEvents` beköti az SSE-t; `resolveDesiredPath` itt már az ACM1 portot keresi.
- `acquireScanScope("setup")` → Setup saját scope-ot foglal, így a dashboard nem zavar bele.
- `useEffect`-ek kezelik a `beforeunload`, `pagehide` eseményeket és a scope felszabadítását.
- `fetch("/api/simulate")`-tel lekérdezi, aktív-e a szimulációs mód (diagnosztika).

### 2. Scan feldolgozás
- MAC / KSK scannelés a `handleScanned` függvényen keresztül → módosítja a lokális állapotot (`mac`, `kskSlots`).
- `setupScanActive` jelzi, ha épp feldolgozik valamit (SSE + scope).
- `pathsEqual` biztosítja, hogy csak az ACM1-ről jövő kódokat fogadja el.

### 3. Lock szerzés
- Felhasználói akció (pl. „Start Setup”) → `ensureLockForKsk`
  - `POST /api/ksk-lock`
  - `startLockHeartbeat` 60 mp-enként `PATCH`-et küld.
  - Hibánál visszajelzés a HUD-on.

### 4. Krosy adat lekérése
- `extractKrosyData` hívódik minden KSK-ra:
  - Szinkronizálja az IP / mód beállításokat (`NEXT_PUBLIC_KROSY_IP_*`).
  - `POST /api/krosy` / `...-offline`
  - Válaszból `extractNameHintsFromKrosyXML` kiszedi a pineket, aliasokat, label-eket.
  - Állapot frissítés: `setNameHints`, `setNormalPins`, `setLatchPins`.

### 5. Alias tárolás
- Sikeres krosy után: `persistAliases`
  - `POST /api/aliases`
  - Lokális KSK slot frissítése (kijelzés: ready, pins count).

### 6. ESP programozás
- `programEsp` → cikluson belül `POST /api/serial`
  - A pin listát a frissen kinyert adatokból állítja össze.
  - Siker esetén "KSK OK" overlay + log.
  - Hiba esetén figyelmeztetés, environment flag dönt arról, marad-e lock.

### 7. KSK slot menedzsment
- Max. 3 slot (state tömb), mindegyikben: `ksk`, `nameHints`, `normalPins`, `latchPins`, `state` (idle/extracted/programmed).
- A UI táblázat (`TableSwap`) innen kapja a megjelenítendő adatokat.

### 8. Cleanup / kilépés
- Felhasználó „Clear” vagy OK után: `clearStationState`
  - `POST /api/aliases/clear`
  - `DELETE /api/ksk-lock` (force)
  - Lokális state nullázása (MAC, KSK-k, pinek).
- Oldal elhagyásakor `releaseScanScope` és lock heartbeat leállítás.

---

## Finalize

- Minden KSK „KSK OK” státuszba kerül → vizuális megerősítés.
- Lock heartbeat aktív marad, amíg az operátor nem zárja le (vagy amíg a TTL le nem jár).
- Opcionális checkpoint létrejöhet a Setup oldalon is (ha online mód és XML rendelkezésre áll).
- Kilépés előtt ajánlott a lock + alias takarítás, hogy ne terhelje a Redis-t.

---

## Fontos helper függvények

- `acquireScanScope` / `releaseScanScope` – Setup és Dashboard kizárólagos scanner használata.
- `resolveDesiredPath` – scanner kiválasztása (ACM1 prioritás).
- `startLockHeartbeat` – `PATCH /api/ksk-lock` időzített küldése.
- `extractNameHintsFromKrosyXML` – XML feldolgozó (pin + alias logika).
- `programEsp` – ESP kommunikáció, hiba- és retry kezelés.

---

## Hibakezelés és tippek

- **Lock ütközés**: 409-es válasz → UI jelzi, ki foglalja a KSK-t.
- **Redis hiányában**: ha `NEXT_PUBLIC_KSK_REQUIRE_REDIS=1`, a folyamat leáll (figyelmeztetés a HUD-on).
- **ESP hiba**: `NEXT_PUBLIC_SETUP_ALLOW_NO_ESP` dönt, megtartjuk-e a lockot; logok a konzolban és `LOG_VERBOSE` fájlokban.
- **Vonalkód olvasó hiánya**: `useSerialEvents` `scanner/paths` eseményei mutatják, hogy detektált-e eszközt.

---

## Kapcsolódó referenciák

- `docs/SETUP.md` – részletes env lista és konfigurációs tippek.
- `docs/PROCESS-FLOW.md` – angol nyelvű, end-to-end folyamat.
- `@/lib/scanScope` – scope kezelés.
- `@/lib/serial` – szerveroldali scanner + ESP logika (kliensként indirekt használat).

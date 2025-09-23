# MainApplicationUI.tsx – Folyamatleírás (HU)

Ez a dokumentum a `src/components/Layout/MainApplicationUI.tsx` komponens működését írja le magyarul. A cél, hogy a fejlesztők és az üzemeltetés pontosan lássa, honnan érkeznek a bemenetek, milyen API-kat hívunk, mi történik a felületen, és hogyan zárul le egy ellenőrzési ciklus.

---

## Áttekintés

MainApplicationUI a dashboard nézet teljes vezérlése:
- figyeli az ACM0 (default) olvasó jeleit,
- kezeli a MAC → alias/pin betöltést Redisből,
- elindítja a CHECK folyamatot az ESP felé,
- valós időben reagál SSE eseményekre,
- siker esetén lekezeli a checkpoint + takarítás lépéseit.

---

## Inputs

- **Vonalkód olvasó**: alapértelmezetten `/dev/ttyACM0` (a `resolveDesiredPath` logika választja ki).
- **MAC bevitel**: scannelés (SSE `scan`) vagy manuális űrlap.
- **SSE stream**: `useSerialEvents(mac?)` → `/api/serial/events`.
- **Környezeti változók** (részlet):
  - `NEXT_PUBLIC_SCANNER_INDEX_DASHBOARD`, `SCANNER_TTY_PATHS` (scanner routing)
  - `NEXT_PUBLIC_SCAN_OVERLAY_MS`, `NEXT_PUBLIC_OK_OVERLAY_MS` (UI timing)
  - `CHECK_SEND_MODE`, `NEXT_PUBLIC_CHECK_RETRY_COUNT` (CHECK viselkedés)
  - `NEXT_PUBLIC_REDIS_DROP_DEBOUNCE_MS`, `NEXT_PUBLIC_ASSUME_REDIS_READY` (Redis kezelése)

---

## API hívások

1. **SSE kapcsolat** – `GET /api/serial/events`
   - MAC filtert kap, ha van aktív MAC és nincs setup-scan.
2. **Alias lekérés**
   - `GET /api/aliases?mac=<MAC>` (union)
   - `GET /api/aliases?mac=<MAC>&all=1` (KSK elemek)
   - `POST /api/aliases/rehydrate` (best-effort újraindexelés)
3. **CHECK** – `POST /api/serial/check`
   - Body pl. `{ mac, pins?, retry }` a `runCheck` függvényből.
4. **Checkpoint** – `POST /api/krosy/checkpoint` / `...-offline`
   - Előtte `GET /api/aliases/xml?mac=<MAC>&kssk=<id>`.
5. **Cleanup**
   - `POST /api/aliases/clear`
   - `DELETE /api/ksk-lock` `force=1`

---

## Folyamat (lépésről lépésre)

### 1. Inicializálás
- React state-ek előkészítése (hud, pins, aliasok).
- `useSerialEvents` beköti az SSE-t és karbantartja a `serial` objektumot (paths, lastScan, redisReady, EV-k).
- `subscribeScanScope("setup")` figyeli, hogy a Setup oldal használja-e a scannert (ilyenkor a dashboard nem hallgat).

### 2. Scanner kiválasztás
- `resolveDesiredPath` preferálja az ACM0 → USB0 → index fallback (csak akkor, ha “0”-ra végződik).
- `pathsEqual` segít az SSE path + fallback összehasonlításában.

### 3. Scan kezelése
- `useEffect` figyeli `(serial as any).lastScanTick`-et.
- Csak akkor reagál, ha nem folyik ellenőrzés (`isCheckingRef`, `isScanningRef`), nincs blokklistán, és a scan ugyanarról az eszközről jött.
- `handleScan(norm, "sse")` normalizálja a MAC-et, beállítja a UI-t, és elindítja a `loadBranchesData` + `runCheck` folyamatot.

### 4. Alias + pin betöltés
- `loadBranchesData` hívja a `/api/aliases` végpontokat (union + per-KSK), majd:
  - `mergeAliasesFromItems` (szöveges alias összerakás),
  - `setBranchesData`, `setGroupedBranches`, `setActiveKssks`.
- Feldolgozott nézet: a program panel (`BranchDashboardMainContent`) megkapja a `derived` objektumot.

### 5. CHECK lefuttatása
- `runCheck(mac, attempt, currentPins)`:
  - Összeállítja a pin listát (alias + manual + union).
  - `fetch("/api/serial/check", {...})` – várja a választ vagy a SSE `RESULT`-ot.
  - Hibánál retry (config alapján), vagy hiba overlay.
  - `lastRunHadFailuresRef` jelzi, hogy volt-e sikertelen kimenet.

### 6. SSE események feldolgozása
- `serial.lastEv` tartalmazza az EV típust (`START`, `P`, `DONE`).
- `useEffect` frissíti a live HUD-ot, `setIsScanning`, `setIsChecking`, illetve a pin státuszokat.
- Redis státusz (`redisReady`) változásnál degrade mód.

### 7. Finalize / OK
- `finalizeOkForMac(mac)` hívódik a `RESULT SUCCESS` eseménynél:
  - MAC blocklista (dupla scan ellen).
  - Checkpoint küldés (ha van XML).
  - Alias + lock tisztítás (`clearAliasesVerify`, `clearKskLocksFully`).
  - UI reset (`handleResetKfb`).
- `okFlashTick`, `okSystemNote` irányítja az overlay animációt.

### 8. Cleanup
- Kilépés vagy Setup fül aktiválása esetén `suppressLive` igaz lesz → SSE csak alap állapotot figyel.
- `useEffect` `beforeunload` eseményre törli a timereket, ha kell.

---

## Finalize / kimenet

- Sikeres OK után a képernyő visszaáll „Idle” módba, MAC mező törlődik.
- Logok (`console`, `LOG_VERBOSE`) jelzik a REST hívások eredményét.
- A dashboard készen áll a következő MAC-re.

---

## Fontos belső segédfüggvények

- `handleResetKfb` – teljes UI állapot nullázása sikertelen/sikeres futás után.
- `clearAliasesVerify` – POST `/api/aliases/clear` + ellenőrző GET.
- `schedule` / `cancel` – `useScheduler` hook alapú időzítő menedzsment.
- `subscribeScanScope` – Setup és Dashboard együttélésének biztosítása.

---

## Hibakezelés

- **Scan ütközés**: `blockedMacRef` + `finalizeOkGuardRef` megakadályozza a gyors dupla feldolgozást.
- **Redis kiesés**: `redisDegraded` jelzés, UI figyelmeztetés.
- **ESP timeout**: `runCheck` retry mechanizmus, log figyelmeztetésekkel.
- **Kézi reset**: `handleResetKfb` hívással az operátor lenullázhatja a nézetet.

---

## Kapcsolódó fájlok / komponensek

- `@/components/Header/useSerialEvents` – SSE kliens és scanner állapot.
- `@/components/Program/BranchDashboardMainContent` – megjelenített fő panel.
- `@/lib/scanScope` – Setup/Dashboard scanner exkluzivitás.
- `@/lib/serial` – szerver oldali scanner/ESP kezelés (közvetett).


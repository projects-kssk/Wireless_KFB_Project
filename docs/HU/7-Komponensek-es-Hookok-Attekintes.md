# Komponensek és hook-ok áttekintése

Ez a jegyzet röviden összefoglalja, hogy a főbb React-komponensek, hook-ok és segédfájlok mit csinálnak a KFB GUI-ban. Célunk, hogy közös nyelvet teremtsünk a MainApplicationUI folyamataival kapcsolatos beszélgetésekhez.

## Fő komponensek

- `src/components/App/MainApplicationUI.tsx`
  - A teljes asztali felület konténer komponense. Itt vannak a globális állapotok (oldalsávok, aktuális nézet, scan állapotok) és innen hívjuk a legtöbb hook-ot/hatás komponenst.
- `src/components/Header/Header.tsx`
  - Felső státusz/vezérlő sáv. A jelenlegi állapotot (`hudMode`, soros kapcsolat, Redis státusz) jeleníti meg.
- `src/components/Program/BranchDashboardMainContent.tsx`
  - A fő tartalom a dashboard nézethez: mutatja az ágakat, csatornákat, aliasokat, vizuális visszajelzést.

## Hatás-komponensek (Effect components)

- `UnionEffect`
  - Élő soros eseményekből érkező „union” snapshotokat dolgoz fel, és frissíti a `normalPins`, `latchPins`, valamint a név támpontokat, ha a MAC aktív.
- `AutoFinalizeEffect`
  - Figyeli a lezárási feltételeket és automatikusan meghívja a `finalizeOkForMac` logikát, ha szükséges.
- `DeviceEventsEffect`
  - A soros eszköz eseményeit (kapcsolódás, hibák) dolgozza fel, visszajelzést ad a HUD-nak.
- `PollingEffect`
  - Időzített lekérdezéseket (poll) végez bizonyos REST végpontokra, hogy a UI mindig naprakész legyen.
- `PostResetSanityEffect`
  - Reset műveletek után ellenőrzi, hogy minden alapállapotba került-e (pl. törli az időzítőket, tisztítja az aliasokat).
- `RedisHealthEffect`
  - Figyeli a Redis kapcsolat állapotát, és `redisDegraded` jelzést állít be, ami több helyen döntési pont.
- `ScannerEffect`
  - A vonalkód-olvasó bejövő eseményeit kezeli, és a `handleScan` logikába továbbítja.

## Hook-ok

- `useConfig`
  - Betölti és `CFG`/`FLAGS` formában szolgáltatja a konfigurációs értékeket (timeoutok, próbálkozás-szám, feature flag-ek).
- `useTimers`
  - Kap kulcs szerinti ütemezőt (`schedule`, `cancel`), amely egységesen kezeli a `setTimeout`-okat és automatikusan tisztít, ha a komponens unmount-olódik.
- `useHud`
  - A HUD állapotgép: kiválasztja, hogy „idle”, „scanning”, „info” vagy „error” üzenetet mutassunk, és visszadja a feliratokat.
- `useSerialLive`
  - Előfizet a soros eseményekre (`useSerialEvents`), és egy `redisReadyRef`-ben jelzi, ha a Redis már stabil.
- `useFinalize`
  - A lezárási (finalize) lépések sorozatát valósítja meg: aliasok törlése/ellenőrzése, KSK lock-ok oldása, checkpoint küldése.
- `useScanFlow`
  - A fő folyamat-vezérlő: kezel minden `runCheck`, `loadBranchesData`, `handleScan` hívást, retry szabályokat, cooldown-okat. Nagyon sok ref-et és settert kap a MainApplicationUI-tól.

## Segédfájlok

- `src/components/App/utils/mac.ts`
  - MAC cím normalizálás (`canonicalMac`), regexek, kulcs generátorok.
- `src/components/App/utils/paths.ts`
  - Eszköz csatlakozási útvonalak összehasonlítása és kiválasztása (ACM path logika).
- `src/components/App/utils/merge.ts`
  - Alias listákból számolja, mely pinek aktívak (`computeActivePins`).
- `src/lib/scanScope.ts`
  - Globális állapot a setup módhoz (`readScanScope`, `subscribeScanScope`).

## Adat- és vezérlési áramlás (röviden)

1. A `MainApplicationUI` inicializálja a UI állapotokat, betölti a konfigurációt, majd meghívja a nagyobb hook-okat (`useFinalize`, `useScanFlow`, `useHud`, `useSerialLive`).
2. A `ScannerEffect` és a `useSerialLive` együtt szállítják az élő eseményeket (`handleScan`, `serial.lastUnion`).
3. A `useScanFlow` szabályozza, mikor indul check, mikor kell REST API-hoz nyúlni, és milyen visszajelzést kap a HUD.
4. A `useFinalize` akkor fut le, ha sikeres scan után cache-t/lock-ot kell takarítani és checkpointot küldeni.
5. A hatás-komponensek (`UnionEffect`, `RedisHealthEffect`, stb.) a fenti hook-ok által szolgáltatott ref-eket és settereket figyelik, és így frissítik a UI-t.

Ez az áttekintés remélhetőleg segít a MainApplicationUI folyamatairól szóló beszélgetésekhez és a problémás pontok azonosításához.

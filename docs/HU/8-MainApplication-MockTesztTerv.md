# MainApplicationUI – mock teszt terv

Ez a dokumentum összefoglalja, hogyan tudunk mock-okkal lefedni a MainApplicationUI által használt főbb REST-hívásokat és eseményeket. A cél az, hogy reprodukálni tudjuk a tipikus válaszokat, és ellenőrizzük, milyen UI állapotok, mellékhatások jelennek meg.

## Ajánlott eszközök

- **Teszt futtató:** Vitest vagy Jest.
- **Komponens renderelés:** `@testing-library/react` a felhasználói viselkedés szimulálásához.
- **Fetch mockolás:** MSW (Mock Service Worker) vagy `whatwg-fetch` + kézi stub-ok.
- **Időzítők:** `vi.useFakeTimers()` / `jest.useFakeTimers()` a `setTimeout` kampókhoz.

## Alap setup (pszeudokód)

```ts
import { render, screen, act } from "@testing-library/react";
import { setupServer } from "msw/node";
import MainApplicationUI from "@/components/App/MainApplicationUI";

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderApp() {
  return render(<MainApplicationUI />);
}
```

## Mockolt REST-válaszok és elvárt kimenetek

| Végpont | Szenárió | Elvárt UI/állapot | Megjegyzés |
| --- | --- | --- | --- |
| `POST /api/serial/check` | 200 OK, `failures: []` | HUD „Checkpoint sent; cache cleared” + `finalizeOkForMac` lefut | Generáljunk `scan` eseményt, majd hagyjuk időzítőket lefutni. |
| `POST /api/serial/check` | 500 hiba | HUD hibaüzenet, `lastRunHadFailuresRef.current === true`, nincs finalize | MSW handler dobjon 500-at; ellenőrizzük, hogy `setScanResult({kind: "error"})`. |
| `GET /api/aliases?mac=...` | Aliasok vannak | `itemsAllFromAliasesRef` feltöltődik, `hasSetupForCurrentMac()` igaz | Ellenőrizzük, hogy a táblázatban megjelennek a branchek. |
| `GET /api/aliases?mac=...` | Üres lista | HUD „Nothing to clear”, `noSetupCooldownRef` beáll | Szükséges `advanceTimersByTime` a cooldown-hoz. |
| `POST /api/aliases/clear` | 200 + verify success | `clearAliasesVerify` maximum 3 próbát tesz, `finalizeOkForMac` siker | Állítsuk be MSW-ben, hogy második kérésre térjen vissza üres listával. |
| `DELETE /api/ksk-lock` | 200 OK | `clearKskLocksFully` true-t ad, `shouldClearLocks` ágon megy | Mockoljuk, hogy a `GET` válasz is üres `locks`-ot adjon. |
| `DELETE /api/ksk-lock` | még maradt lock | 3. próbálkozás után false, HUD figyelmeztetés | A teszt figyelje, hogy a retry ciklus legalább 3 hívást generál. |
| `POST /api/krosy/checkpoint` | 200 OK | `checkpointSentRef` tartalmazza az ID-t, HUD success | Ellenőrzés: `expect(checkpointSentRef.current.has(id)).toBe(true)`. |
| `POST /api/krosy/checkpoint` | 503 hiba | `checkpointBlockUntilTsRef` jövőbeli időre ugrik, HUD warning | A test nézze meg, hogy a blokk idő >= `Date.now() + 120000`. |
| `GET /api/aliases/xml` | 404 elsőre, 200 másodikra | XML letöltés fallback branch fut | Mock: első handler 404, második 200. |

## Soros/szimulált események mockolása

- **Scan esemény:** állítsuk be a `ScannerEffect` által figyelt eseményt egy egyedi segédfüggvénnyel. Például msw websocket vagy egyszerűen `act(() => scannerCallback("MAC"))`.
- **`serial.lastUnion` frissítés:** rendezzünk be egy segéd `setSerialState`-et, ami a `UnionEffect`-et triggereli, hogy lássuk a pin frissítéseket.

## Példa teszt – sikeres scan

```ts
test("sikeres scan esetén finalize megtörténik", async () => {
  server.use(
    rest.post("/api/serial/check", (_req, res, ctx) =>
      res(ctx.json({ failures: [] }))
    ),
    rest.get("/api/aliases", (_req, res, ctx) =>
      res(ctx.json({ items: [{ mac: "AA:BB", ksk: "123" }] }))
    ),
    rest.post("/api/aliases/clear", (_req, res, ctx) => res(ctx.status(200))),
    rest.get("/api/aliases", (_req, res, ctx) => res(ctx.json({ items: [] })))
  );

  renderApp();

  await act(async () => {
    fakeScanner.emit("123456");
  });

  expect(await screen.findByText(/Checkpoint sent/)).toBeInTheDocument();
});
```

## Következő lépések

1. Válasszuk ki a teszt keretrendszert (Vitest/Jest) és tegyük be a `devDependencies` közé.
2. Hozzunk létre `setupTests.ts`-t, ahol a fake timer és MSW server konfiguráció történik.
3. Írjuk meg a fenti táblázat szerinti teszteket `src/__tests__/MainApplicationUI.mock.test.tsx` fájlban.
4. Integráljuk a futtatást a CI-be (`npm run test:ui`).

Ez a terv biztosítja, hogy minden kritikus REST válaszra legyen fedezet, mielőtt tovább boncolgatjuk a MainApplicationUI átalakítását.

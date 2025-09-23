# ESP-PLATFORMIO firmware (HU)

Rövid ismertető a `src/cpp codes/` alatt található PlatformIO skiccekről. Ezek az ESP32 alapú hub/station firmware-ek, amelyek a desktop alkalmazással ESP-NOW kapcsolaton kommunikálnak.

## Projekt felépítés
```
src/
└── cpp codes/
    ├── hub.cpp       # fixtúrához kötött hub firmware (MCP olvasás + LED vezérlés)
    └── station.cpp   # munkaállomáson futó station firmware (parancs továbbítás)
```

Mindkét sketch **Arduino-ESP32 v3.x (ESP-IDF 5)** környezetet vár PlatformIO alatt; a `platformio.ini`-t helyben kell létrehozni.

## hub.cpp
- Útvonal: [`src/cpp codes/hub.cpp`](../src/cpp%20codes/hub.cpp)
- Főbb funkciók:
  - Öt MCP23X17 (`0x20`–`0x24`) expanderrel 40 csatornát kezel (gomb + LED).
  - ESP-NOW csatorna 1, utolsó küldő MAC követése.
  - Csatornánkénti debounce + 5×50 ms mintavételezés.
  - Élő `EV P`, `EV L`, `RESULT` események a GUI felé.
  - Blink/chase/baseline parancsok háttérben végrehajtva.

## station.cpp
- Útvonal: [`src/cpp codes/station.cpp`](../src/cpp%20codes/station.cpp)
- Főbb funkciók:
  - Állapotgép (`IDLE`, `WAIT_HELLO`, `WAIT_RESULT`).
  - ACK keretezés `ID=123` azonosítóval.
  - CHECK pin lista validáció (1..40).
  - Egyező ESP-NOW csatorna + retry (4 retry, 220 ms timeout).
  - ESP-IDF v4/v5 callback kompatibilitás.

## Gyors kezdés (PlatformIO)
1. Telepítsd a PlatformIO-t.
2. `platformio.ini` példa:
   ```ini
   [env:esp32]
   platform = espressif32
   board = esp32dev
   framework = arduino
   monitor_speed = 115200
   build_flags = -DESP32
   ```
3. Másold a `hub.cpp` / `station.cpp` fájlokat a PlatformIO projekt `src/` mappájába.
4. Fordítás + feltöltés: `pio run -t upload`, `pio device monitor`.
5. Ellenőrizd, hogy az `ESPNOW_CHANNEL` megegyezzen mindkét oldalon.
6. Igény szerint módosítsd az MCP cím listát, debounce időket.

## Kapcsolódó dokumentáció
- Main Application: [`2-MainApplication-HU.md`](2-MainApplication-HU.md)
- Hibakeresés: [`4-Errors-HU.md`](4-Errors-HU.md)

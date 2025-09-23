# ESP-PLATFORMIO Firmware Overview

This guide documents the PlatformIO sketches under `src/cpp codes/`. They implement the ESP32 firmware for the hub (fixture) and station (workbench) units that communicate with the desktop GUI.

## Project layout
```
src/
└── cpp codes/
    ├── hub.cpp       # hub firmware attached to the fixture (reads MCPs, drives LEDs)
    └── station.cpp   # station firmware that relays GUI commands to the hub
```

Both sketches expect **Arduino-ESP32 v3.x (ESP-IDF 5)** via PlatformIO. Provide your own `platformio.ini` with board/upload settings.

## hub.cpp
- Path: [`src/cpp codes/hub.cpp`](../src/cpp%20codes/hub.cpp)
- Highlights:
  - Configures up to five MCP23X17 expanders (`0x20`–`0x24`) for 40 channels (switch + LED).
  - Maintains ESP-NOW channel 1 link, tracking the sender MAC for directed replies.
  - Implements per-channel debounce and sampling (5×50 ms) with optional majority voting.
  - Streams `EV P`, `EV L`, `RESULT`, `DONE` messages back to the GUI.
  - Offers background commands (blink, chase, baseline) via a pending queue.
- Build notes: requires Arduino-ESP32 v3 and FreeRTOS primitives for I²C safety.

## station.cpp
- Path: [`src/cpp codes/station.cpp`](../src/cpp%20codes/station.cpp)
- Highlights:
  - Lightweight state machine (`IDLE`, `WAIT_HELLO`, `WAIT_RESULT`).
  - ACK framing with `ID=123` tokens to match commands/responses.
  - Validates CHECK payload pins (1..40) before forwarding to the hub.
  - Shares the same ESP-NOW channel and retry policy (4 retries, 220 ms timeout).
  - Compatible with ESP-IDF v4/v5 callbacks.

## Quick start (PlatformIO)
1. Install PlatformIO.
2. Create `platformio.ini`, e.g.
   ```ini
   [env:esp32]
   platform = espressif32
   board = esp32dev
   framework = arduino
   monitor_speed = 115200
   build_flags = -DESP32
   ```
3. Copy `hub.cpp` and/or `station.cpp` into the PlatformIO project `src/` folder.
4. Build & upload: `pio run -t upload`, monitor with `pio device monitor`.
5. Ensure `ESPNOW_CHANNEL` matches on both hub and station.
6. Adjust MCP address lists, debounce timing, or thresholds as needed for production.

## Related docs
- Dashboard behaviour: [`2-MAINAPPLICATION.md`](2-MAINAPPLICATION.md)
- Troubleshooting: [`4-ERRORS.md`](4-ERRORS.md)

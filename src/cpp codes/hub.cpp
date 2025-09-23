#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <Adafruit_MCP23X17.h>
#include <Wire.h>
#include <esp_wifi.h>
#if ESP_ARDUINO_VERSION_MAJOR < 3
#error "This sketch requires Arduino-ESP32 v3.x (ESP-IDF 5) for esp_now_recv_info_t."
#endif
#include "esp_err.h"
#include <cstring>
#include <cctype>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/portmacro.h"
#include "freertos/semphr.h"
// ==== Config ====
static constexpr uint8_t MCP_I2C_ADDR[] = {0x20, 0x21, 0x22, 0x23, 0x24};
static constexpr int CHANNEL_COUNT = 40;
static constexpr size_t MAX_MSG_LEN = 128;
static constexpr uint8_t ESPNOW_CHANNEL = 1;
static constexpr unsigned long BLINK_INTERVAL_MS = 100;

const int BTN_PIN = 16;
const unsigned long DEBOUNCE_MS = 40;

// Timing
static constexpr int FINAL_CHECK_SAMPLES = 5; // 5×50ms = 250ms
static constexpr int SAMPLE_DELAY_MS = 50;
static constexpr unsigned long CH_DEBOUNCE_MS = 25;

// Tuning knobs
static constexpr bool MAJORITY_OK = false; // set true → 3/5 majority pass
static constexpr int PASS_THRESHOLD =
    MAJORITY_OK ? (FINAL_CHECK_SAMPLES / 2 + 1) : FINAL_CHECK_SAMPLES;
static_assert(SAMPLE_DELAY_MS >= CH_DEBOUNCE_MS,
              "SAMPLE_DELAY_MS must be >= CH_DEBOUNCE_MS for stable voting");

// Optional pre-check settle. Set to 0 to disable.
static constexpr unsigned long FINAL_CHECK_SETTLE_MS = 0;

// IO mapping
struct ChannelPins { uint8_t mcpIndex, ledPin, swPin; };
static constexpr size_t EXPANDER_COUNT = sizeof(MCP_I2C_ADDR) / sizeof(MCP_I2C_ADDR[0]);
static_assert(CHANNEL_COUNT * 2 <= EXPANDER_COUNT * 16, "Not enough MCP pins for CHANNEL_COUNT*2");
static_assert(ESPNOW_CHANNEL >= 1 && ESPNOW_CHANNEL <= 13, "Bad ESPNOW channel");
Adafruit_MCP23X17 mcp[EXPANDER_COUNT];
ChannelPins pinsMap[CHANNEL_COUNT];
// Guard MCP/Wire calls across tasks/cores
static SemaphoreHandle_t i2cMutex = nullptr;
static inline void i2cLock()   { if (i2cMutex) xSemaphoreTake(i2cMutex, portMAX_DELAY); }
static inline void i2cUnlock() { if (i2cMutex) xSemaphoreGive(i2cMutex); }

// State
enum class State { SELF_CHECK, WAIT_FOR_TARGET, MONITORING, FINAL_CHECK, WELCOME };
static volatile State state = State::SELF_CHECK;

// Model
static bool monNormal[CHANNEL_COUNT];
static bool monLatch[CHANNEL_COUNT];
static bool latched[CHANNEL_COUNT];
static bool ignoredCh[CHANNEL_COUNT];
static unsigned long liveOkSince = 0;
static constexpr unsigned long AUTO_FINAL_HOLD_MS = 200; // hold time before auto-final

// Debounce
static bool lastPressed[CHANNEL_COUNT];
static bool rawPrev[CHANNEL_COUNT];
static unsigned long rawChangedAt[CHANNEL_COUNT];

// Streaming telemetry
static bool streamActive = false;
static bool prevPressed[CHANNEL_COUNT];
static bool prevLatchedState[CHANNEL_COUNT];

static constexpr unsigned long MIN_EVENT_GAP_MS = 10; // small throttle to avoid floods

static unsigned long lastEventSentP[CHANNEL_COUNT] = {0};  // per-channel for "P"
static unsigned long lastEventSentL[CHANNEL_COUNT] = {0};  // per-channel for "L"
// Link ctx
static uint8_t lastSender[6];
static volatile bool haveSender = false;
static portMUX_TYPE g_senderMux = portMUX_INITIALIZER_UNLOCKED;

static inline bool isZeroMac(const uint8_t *addr);
static bool resolveTarget(const uint8_t *dest, uint8_t out[6]);

static inline bool getTarget(uint8_t out[6]) {
  bool ok;
  portENTER_CRITICAL(&g_senderMux);
  ok = haveSender && !isZeroMac(lastSender);
  if (ok) memcpy(out, lastSender, 6);
  portEXIT_CRITICAL(&g_senderMux);
  return ok;
}

// HELLO debounce
static bool btnStable = HIGH, btnLastRead = HIGH;
static unsigned long lastDebounce = 0;

// Blink clock
static unsigned long lastBlinkTick = 0;
static bool blinkState = false;

// FAILURE buffers
static char missingBuf[MAX_MSG_LEN];
static char extraBuf[MAX_MSG_LEN];
static size_t missingLen = 0, extraLen = 0;
static inline bool hasWorkToCheck(bool restrictToSelection);
// helper
// (removed unused allNormalsHeldNow)


// CHECK selection
static bool checkSelect[CHANNEL_COUNT];
static bool checkActive = false;

// WELCOME
static int welcomeEdgeCount = 0;

// Release gate post-MONITOR
static bool needReleaseGate = false;
// Board MAC (string)
static char BOARD_MAC[18] = {0};
static void goDarkAndIdle();  // add
// ==== Fwd decls ====
static inline void setLed(int ch, bool on);
static inline bool readSwRaw(int ch);
static inline bool isPressedRaw(int ch);
static void buildPins();
static bool ensurePeer(const uint8_t *addr);
static bool sendCmd(const char *msg, const uint8_t *dest = nullptr);
static bool sendCmdRaw(const char *msg, const uint8_t *dest = nullptr);
static void serviceAckTx();
static bool extractIdToken(const char* msg, int len, uint32_t &outId);
static void triggerHello();
static void allLeds(bool on);
static void appendCsv(char *buf, size_t &len, int oneBased);
static void resetBuffers();
static inline void trimBuffers();
static bool checkAll(bool restrictToSelection, unsigned long now);
static void parseMonitorPayload(const char *data, int len);
static void parseCheckSelection(const char *payload, int len);
static void doSelfCheck();
static void doMonitoring();
static void doFinalCheck();
static void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len);
static void cleanAll();

// Pending work (offloaded from RX callback)
struct PendingCmd {
  enum Kind { None, Blink, Chase, MonitorBaseline } kind;
  int n;
  bool hasMac;
  uint8_t mac[6];
};
static volatile bool havePending = false;
static PendingCmd pending = {PendingCmd::None, 0, false, {0}};
static portMUX_TYPE pendingMux = portMUX_INITIALIZER_UNLOCKED;

// ==== Helpers ====
static inline void setLed(int ch, bool on) {
  static bool ledState[CHANNEL_COUNT];
  if (ledState[ch] == on) return;
  ledState[ch] = on;
  auto &p = pinsMap[ch];
  i2cLock();
  mcp[p.mcpIndex].digitalWrite(p.ledPin, on ? HIGH : LOW);
  i2cUnlock();
}

static inline bool readSwRaw(int ch) {
  auto &p = pinsMap[ch];
  i2cLock();
  int v = mcp[p.mcpIndex].digitalRead(p.swPin);
  i2cUnlock();
  return v == HIGH; // pull-up
}
static inline bool isPressedRaw(int ch) { return !readSwRaw(ch); }

static inline bool isZeroMac(const uint8_t *addr) {
  static const uint8_t zero[6] = {0,0,0,0,0,0};
  return !addr || memcmp(addr, zero, sizeof(zero)) == 0;
}

static bool resolveTarget(const uint8_t *dest, uint8_t out[6]) {
  if (dest) {
    if (isZeroMac(dest)) return false;
    memcpy(out, dest, 6);
    return true;
  }
  if (!getTarget(out)) return false;
  return true;
}

static void buildPins() {
  for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
    uint16_t base = uint16_t(ch * 2);
    uint8_t idx = uint8_t(base / 16);
    uint8_t a = uint8_t(base % 16);
    uint8_t b = uint8_t((base + 1) % 16);
    // Swap low/high nibble so LED/SW are grouped on this PCB
    auto remap = [](uint8_t p) -> uint8_t { return p < 8 ? uint8_t(p + 8) : uint8_t(p - 8); };
    pinsMap[ch] = {idx, remap(a), remap(b)};
  }
}

static inline void sendEvent(const char* kind, int ch, bool val) {
  if (!streamActive) return;
  unsigned long now = millis();

  if (kind[0] == 'P') {
    if (now - lastEventSentP[ch] < MIN_EVENT_GAP_MS) return;
    lastEventSentP[ch] = now;
  } else { // 'L'
    if (now - lastEventSentL[ch] < MIN_EVENT_GAP_MS) return;
    lastEventSentL[ch] = now;
  }

  char pkt[48];
  snprintf(pkt, sizeof(pkt), "EV %s %d %d %s", kind, ch + 1, val ? 1 : 0, BOARD_MAC);
  uint8_t target[6]; bool ok = getTarget(target);
  // Only send EVs when we have an explicit session peer (no broadcast)
  if (!ok) return;
  // Live telemetry uses RAW to avoid occupying the global ACK slot
  sendCmdRaw(pkt, target);
}


static inline void startStreaming(bool rebaseline = true) {
  if (streamActive && !rebaseline) return;
  streamActive = true;
  if (rebaseline) {
    for (int i = 0; i < CHANNEL_COUNT; ++i) {
      prevPressed[i]      = lastPressed[i];
      prevLatchedState[i] = latched[i];
      lastEventSentP[i]   = 0;
      lastEventSentL[i]   = 0;
    }
  }
}


static inline void stopStreaming() { streamActive = false; }


static void goDarkAndIdle() {
   stopStreaming(); 
  cleanAll();
  allLeds(false);
  needReleaseGate = false;
  // Clear session sender atomically
  portENTER_CRITICAL(&g_senderMux);
  haveSender = false;
  memset(lastSender, 0, sizeof(lastSender));
  portEXIT_CRITICAL(&g_senderMux);
  state = State::WAIT_FOR_TARGET;
  Serial.println(">> WAIT_FOR_TARGET");
}

static inline void sendSuccessAndIdle() {
  char out[64];
  snprintf(out, sizeof(out), "RESULT SUCCESS %s", BOARD_MAC);
  uint8_t dest[6]; bool ok = getTarget(dest);
  if (ok) sendCmd(out, dest);
  else Serial.println("WARN: success without session target");
  goDarkAndIdle();   // goDarkAndIdle already stops streaming
}

static inline bool isBroadcastAddr(const uint8_t* a) {
  static const uint8_t b[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
  return a && memcmp(a, b, 6) == 0;
}

static bool ensurePeer(const uint8_t *addr) {
  if (isBroadcastAddr(addr)) return true; // broadcast does not require a peer
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, addr, 6);
  peer.ifidx = WIFI_IF_STA;
  peer.channel = ESPNOW_CHANNEL;
  peer.encrypt = false;
  esp_err_t e = esp_now_add_peer(&peer);
  if (e != ESP_OK && e != ESP_ERR_ESPNOW_EXIST) {
    Serial.printf("Add peer failed: %s (0x%04X)\n", esp_err_to_name(e), e);
    return false;
  }
  return true;
}

// ===== Simple ACK/ID support =====
static volatile bool hubAckActive = false;
static volatile uint32_t hubAckId = 0;
static uint8_t hubAckMac[6] = {0};
static unsigned long hubAckLastSend = 0;
static int hubAckRetriesLeft = 0;
static char hubAckMsg[256];
static unsigned hubAckTimeoutMs = 240; // retry spacing; reset on new TX or completion

static uint32_t nextSeqId() {
  static uint32_t seq = 1000;
  return seq++;
}

static bool extractIdToken(const char* msg, int len, uint32_t &outId) {
  if (!msg || len <= 0) return false;
  const char* p = strstr(msg, " ID=");
  if (!p) return false;
  p += 4;
  uint32_t v = 0; bool any=false;
  while (*p && isdigit((unsigned char)*p)) { any=true; v = v*10 + (*p - '0'); ++p; }
  if (!any) return false;
  outId = v; return true;
}

static void serviceAckTx() {
  if (!hubAckActive) return;
  // stop retrying if we are no longer in an active session
  if (state == State::SELF_CHECK) {
    hubAckActive = false;
    hubAckTimeoutMs = 240; // reset spacing
    return;
  }
  unsigned long now = millis();
  if (hubAckLastSend == 0 || now - hubAckLastSend >= hubAckTimeoutMs) {
    if (!ensurePeer(hubAckMac)) {
      Serial.println("ACK peer ensure failed");
    } else {
      esp_now_send(hubAckMac, reinterpret_cast<const uint8_t*>(hubAckMsg), strlen(hubAckMsg)+1);
      Serial.printf("→ (ACKed) Sent '%s' to %02X:%02X:%02X:%02X:%02X:%02X\n",
        hubAckMsg, hubAckMac[0],hubAckMac[1],hubAckMac[2],hubAckMac[3],hubAckMac[4],hubAckMac[5]);
    }
    hubAckLastSend = now;
    if (hubAckRetriesLeft > 0) {
      hubAckRetriesLeft--;
      // linear backoff with clamp
      unsigned next = hubAckTimeoutMs + 80;
      hubAckTimeoutMs = (next > 640u) ? 640u : next;
    } else {
      Serial.printf("WARN: no ACK for ID=%lu, giving up\n", (unsigned long)hubAckId);
      hubAckActive = false;
      hubAckTimeoutMs = 240; // reset for next session
    }
  }
}

static void triggerHello() {
  haveSender = false;
  // Broadcast HELLO (optional)
  static const uint8_t bcast[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
  ensurePeer(bcast);
  esp_now_send(bcast, (const uint8_t*)"HELLO", 6);
  Serial.printf("HELLO %s\n", BOARD_MAC);
}

static void allLeds(bool on) { for (int ch = 0; ch < CHANNEL_COUNT; ++ch) setLed(ch, on); }

static void appendCsv(char *buf, size_t &len, int oneBased) {
  if (len >= MAX_MSG_LEN - 2) return;               // need at least space for "N,"
  int avail = int(MAX_MSG_LEN - 1 - len);           // keep space for NUL
  int wrote = snprintf(buf + len, avail, "%d,", oneBased);
  if (wrote < 0) return;
  if (wrote >= avail) {                             // truncated
    len = MAX_MSG_LEN - 1;
    buf[len] = '\0';
  } else {
    len += size_t(wrote);
  }
}

static void resetBuffers() {
  missingLen = extraLen = 0;
  missingBuf[0] = '\0';
  extraBuf[0] = '\0';
}
static inline void trimBuffers() {
  if (missingLen && missingBuf[missingLen - 1] == ',') missingBuf[--missingLen] = '\0';
  if (extraLen   && extraBuf[extraLen   - 1] == ',')   extraBuf[--extraLen]   = '\0';
}

static inline bool isMacToken(const char* tok) {
  // crude MAC check: 17 chars with ':' every 2 chars, hex pairs
  if (!tok) return false;
  size_t L = strlen(tok);
  if (L != 17) return false;
  for (int i=0;i<17;i++) {
    if ((i%3)==2) { if (tok[i] != ':') return false; }
    else {
      char c = tok[i];
      if (!((c>='0'&&c<='9') || (c>='A'&&c<='F') || (c>='a'&&c<='f'))) return false;
    }
  }
  return true;
}

static inline bool parsePureInt(const char* tok, int& out /*1-based*/) {
  if (!tok || !*tok) return false;
  if (isMacToken(tok)) return false;
  char* end=nullptr;
  long v = strtol(tok, &end, 10);
  if (!end || *end!='\0') return false;   // must be pure number
  if (v < 1 || v > CHANNEL_COUNT) return false;
  out = int(v);
  return true;
}

// Debounce + edge
static inline bool debouncedPressed(int ch, unsigned long now, bool &pressedEdge) {
  bool raw = isPressedRaw(ch);
  if (raw != rawPrev[ch]) {               // raw just toggled -> start (re)timing
    rawPrev[ch] = raw;
    rawChangedAt[ch] = now;
  }
  pressedEdge = false;
  // accept only after raw stayed stable for CH_DEBOUNCE_MS
  if (now - rawChangedAt[ch] >= CH_DEBOUNCE_MS && lastPressed[ch] != raw) {
    lastPressed[ch] = raw;
    pressedEdge = raw;                   // rising edge = press
  }
  return lastPressed[ch];
}

// === Parse MONITOR ===
// === Parse MONITOR ===
static void parseMonitorPayload(const char *data, int len) {
  char buf[200];
  int c = min(len, (int)sizeof(buf) - 1);
  memcpy(buf, data, c);
  buf[c] = '\0';

  char *p = strstr(buf, "MONITOR");
  if (!p) return;
  p += 7;
  while (*p == ' ') ++p;

  // Uppercase for simpler parsing
  for (char *q = p; *q; ++q) *q = toupper((unsigned char)*q);

  bool latchMode = false;
  bool skipCount = false;         // skip the "(N)" right after NORMAL/LATCH
  const unsigned long now = millis();

  // Tokenize; allow forms like: "MONITOR normal(2)=[1,2] contactless(1)=[3]"
  char *save = nullptr;
  for (char *tok = strtok_r(p, " ,[]=()", &save);
       tok;
       tok = strtok_r(nullptr, " ,[]=()", &save)) {

    if (!strcmp(tok, "NORMAL")) {
      latchMode = false;
      skipCount = true;           // next number is a count -> skip
      continue;
    }
    if (!strcmp(tok, "CONTACTLESS") || !strcmp(tok, "LATCH")) {
      latchMode = true;
      skipCount = true;           // next number is a count -> skip
      continue;
    }

    // Skip the count token that follows NORMAL/LATCH
    if (skipCount) { skipCount = false; continue; }

    // Channel number
    int oneBased = 0;
    if (!parsePureInt(tok, oneBased)) continue;
    const int ch = oneBased - 1;
    const bool had = (monNormal[ch] || monLatch[ch]);   // already tracked?

    if (latchMode) {
      if (monNormal[ch]) { // reclassify NORMAL -> LATCH
        latched[ch] = false;
        ignoredCh[ch] = false;
        rawPrev[ch] = isPressedRaw(ch);
        rawChangedAt[ch] = now;
        lastPressed[ch] = rawPrev[ch];
      }
      monLatch[ch] = true; monNormal[ch] = false;
      if (!had) {
        ignoredCh[ch]   = false;
        latched[ch]     = false;
        rawPrev[ch]     = isPressedRaw(ch);
        rawChangedAt[ch]= now;
        lastPressed[ch] = rawPrev[ch];
      }
      setLed(ch, !latched[ch]);
    } else {
      if (monLatch[ch]) { // reclassify LATCH -> NORMAL
        latched[ch] = false;
        ignoredCh[ch] = false;
        rawPrev[ch] = isPressedRaw(ch);
        rawChangedAt[ch] = now;
        lastPressed[ch] = rawPrev[ch];
      }
      monNormal[ch] = true; monLatch[ch]  = false;
      if (!had) {
        ignoredCh[ch]   = false;
        latched[ch]     = false;
        rawPrev[ch]     = isPressedRaw(ch);
        rawChangedAt[ch]= now;
        lastPressed[ch] = rawPrev[ch];
      }
      setLed(ch, true);
    }
  }

  // If we were idle, require release once before edges start counting
  if (state != State::MONITORING) needReleaseGate = true;
}

// === Parse CHECK ===
static void parseCheckSelection(const char *payload, int len) {
  memset(checkSelect, 0, sizeof(checkSelect));
  checkActive = false;

  char buf[160];
  int c = min(len, int(sizeof(buf) - 1));
  memcpy(buf, payload, c); buf[c] = '\0';

  char *p = strstr(buf, "CHECK");
  if (!p) return;
  p += 5;
  while (*p == ' ') ++p;

  bool any = false;
  char *save = nullptr;
  for (char *tok = strtok_r(p, " ,", &save); tok; tok = strtok_r(nullptr, " ,", &save)) {
    int oneBased=0;
    if (!parsePureInt(tok, oneBased)) continue;  // ignore MAC or non-numeric
    int ch = oneBased - 1;
    checkSelect[ch] = true;
    any = true;
  }
  checkActive = any; // if false → evaluate tracked pins
}

// === Determine if all contactless are latched ===
static inline bool allContactlessLatched() {
  for (int ch = 0; ch < CHANNEL_COUNT; ++ch)
    if (monLatch[ch] && !latched[ch]) return false;
  return true;
}

// === LED + status for CHECK (strict) ===
static bool checkAll(bool restrictToSelection, unsigned long now) {
  bool ok = true;
  resetBuffers();

  bool pressed[CHANNEL_COUNT];
  for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
    bool e = false;
    pressed[ch] = debouncedPressed(ch, now, e);

    // Latch handling
    if (monLatch[ch] && e) {
      latched[ch] = true; ignoredCh[ch] = true;
      if (streamActive && !prevLatchedState[ch]) {
        sendEvent("L", ch, true);
        prevLatchedState[ch] = true;
      }
    }

    // Pressed state delta
    if (streamActive && (monNormal[ch] || monLatch[ch]) && pressed[ch] != prevPressed[ch]) {
      sendEvent("P", ch, pressed[ch]);      // Pressed changed
      prevPressed[ch] = pressed[ch];
    }
  }


  for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
    const bool tracked = (monNormal[ch] || monLatch[ch]) && !ignoredCh[ch];
    const bool selected = restrictToSelection ? (checkActive && checkSelect[ch] && !ignoredCh[ch])
                                              : tracked;

    if (ignoredCh[ch]) { setLed(ch, false); continue; }

    if (monNormal[ch]) {
      if (selected && !pressed[ch]) { ok = false; appendCsv(missingBuf, missingLen, ch + 1); }
      setLed(ch, !pressed[ch]);
    } else if (monLatch[ch]) {
      if (selected && !latched[ch]) { ok = false; appendCsv(missingBuf, missingLen, ch + 1); }
      setLed(ch, !latched[ch]);
    } else {
      if (pressed[ch]) { ok = false; appendCsv(extraBuf, extraLen, ch + 1); setLed(ch, blinkState); }
      else setLed(ch, false);
    }
  }
  return ok;
}

// === SELF_CHECK ===
static void doSelfCheck() {
  bool anyBad = false;
  for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
    bool raw = isPressedRaw(ch);
    setLed(ch, blinkState && raw);
    if (raw) anyBad = true;
  }
  if (!anyBad) {
    state = State::WAIT_FOR_TARGET;
    Serial.println(">> SELF_CHECK OK, waiting for MONITOR");
  }
}

static void doMonitoring() {
  // Auto-finalization hold time and timer

  if (needReleaseGate) {
    needReleaseGate = false;
    unsigned long now = millis();
    for (int i = 0; i < CHANNEL_COUNT; ++i) {
      bool r = isPressedRaw(i);
      rawPrev[i]      = r;
      rawChangedAt[i] = now;
      lastPressed[i]  = r;
      if (streamActive) prevPressed[i] = r;
    }
  }

  unsigned long now = millis();
  bool pressed[CHANNEL_COUNT];

  for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
    bool e = false;
    pressed[ch] = debouncedPressed(ch, now, e);

    // latch edges (contactless)
    if (monLatch[ch] && e) {
      latched[ch] = true;
      ignoredCh[ch] = true;
    }

    // live stream telemetry while monitoring
    if (streamActive) {
      if (monLatch[ch] && e && !prevLatchedState[ch]) {
        sendEvent("L", ch, true);
        prevLatchedState[ch] = true;
      }
      if ((monNormal[ch] || monLatch[ch]) && pressed[ch] != prevPressed[ch]) {
        sendEvent("P", ch, pressed[ch]);
        prevPressed[ch] = pressed[ch];
      }
    }
  }

  const bool finalReady = allContactlessLatched();

  // LED policy
  if (finalReady) {
    for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
      if (ignoredCh[ch]) { setLed(ch, false); continue; }
      const bool held = (monNormal[ch] || monLatch[ch]) && pressed[ch];
      if (monNormal[ch])      setLed(ch, held ? false : true);
      else if (monLatch[ch])  setLed(ch, latched[ch]);
      else                    setLed(ch, pressed[ch] ? blinkState : false);
    }
  } else {
    for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
      if (ignoredCh[ch]) { setLed(ch, false); continue; }
      if (monNormal[ch])      setLed(ch, !pressed[ch]);
      else if (monLatch[ch])  setLed(ch, !latched[ch]);
      else                    setLed(ch, pressed[ch] ? blinkState : false);
    }
  }

  // All latch channels latched (finalReady) AND all normal channels currently held
  bool normalsHeld = true;
  for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
    if (monNormal[ch] && !ignoredCh[ch] && !pressed[ch]) { normalsHeld = false; break; }
  }

  if (finalReady && normalsHeld && hasWorkToCheck(false)) {
    if (!liveOkSince) liveOkSince = now;
    if (now - liveOkSince >= AUTO_FINAL_HOLD_MS) {
      // emit AUTO-FINAL as RAW to avoid competing with RESULT ACK state
      { uint8_t dest[6]; if (getTarget(dest)) sendCmdRaw("AUTO-FINAL", dest); }
      sendSuccessAndIdle();   // RESULT SUCCESS + stopStreaming + goDarkAndIdle()
      return;
    }
  } else {
    liveOkSince = 0;
  }

}


// === FINAL_CHECK ===
// helper
static inline bool hasWorkToCheck(bool restrictToSelection) {
  if (restrictToSelection) {
    for (int ch = 0; ch < CHANNEL_COUNT; ++ch)
      if (checkSelect[ch] && !ignoredCh[ch]) return true;
    return false;
  } else {
    for (int ch = 0; ch < CHANNEL_COUNT; ++ch)
      if ((monNormal[ch] || monLatch[ch]) && !ignoredCh[ch]) return true;
    return false;
  }
}

// === FINAL_CHECK ===
static void doFinalCheck() {
  const bool restrict = checkActive ? true : false;

  if (!hasWorkToCheck(restrict)) {
    Serial.println(">> SUCCESS (no-work)");
    char out[64];
    snprintf(out, sizeof(out), "RESULT SUCCESS %s", BOARD_MAC);
    { uint8_t dest[6]; if (getTarget(dest)) sendCmd(out, dest); }
    stopStreaming();
    goDarkAndIdle();            // <<< was: state = State::SELF_CHECK;
    return;
  }

  // We were already streaming since MONITOR; don't rebaseline here
  startStreaming(false);

  if (FINAL_CHECK_SETTLE_MS) vTaskDelay(pdMS_TO_TICKS(FINAL_CHECK_SETTLE_MS));

  int ok = 0, fail = 0;
  for (int i = 0; i < FINAL_CHECK_SAMPLES; ++i) {
    if (checkAll(restrict, millis())) ok++; else fail++;
    if (ok >= PASS_THRESHOLD) break;
    if ((FINAL_CHECK_SAMPLES - i - 1) + ok < PASS_THRESHOLD) break;
    vTaskDelay(pdMS_TO_TICKS(SAMPLE_DELAY_MS));
  }

  (void)checkAll(restrict, millis());
  // tiny yield so RAW EVs can TX before RESULT claims the ACK slot
  vTaskDelay(1);
  trimBuffers();

  if (ok >= PASS_THRESHOLD) {
    Serial.println(">> SUCCESS");
    char out[64];
    snprintf(out, sizeof(out), "RESULT SUCCESS %s", BOARD_MAC);
    { uint8_t dest[6]; if (getTarget(dest)) sendCmd(out, dest); }
    stopStreaming();
    goDarkAndIdle();            // <<< was: state = State::SELF_CHECK;
  } else {
    char core[MAX_MSG_LEN * 2]; size_t pos = 0;
    auto app = [&](const char* s){
      int a = snprintf(core + pos, sizeof(core) - pos, "%s", s);
      if (a > 0) {
        size_t newPos = pos + (size_t)a;
        size_t cap = sizeof(core) - 1;
        pos = (newPos < cap) ? newPos : cap;
      }
    };
    app("FAILURE");
    if (missingLen) { app(" MISSING "); app(missingBuf); }
    if (extraLen)   { app(missingLen ? ";EXTRA " : " EXTRA "); app(extraBuf); }
    char pkt[MAX_MSG_LEN * 2 + 16];
    snprintf(pkt, sizeof(pkt), "RESULT %s %s", core, BOARD_MAC);
    { uint8_t dest[6]; if (getTarget(dest)) sendCmd(pkt, dest); }
    state = State::MONITORING;
  }
}



// === RX ===
static void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (!info || !data || len <= 0) return;
  if (isZeroMac(info->src_addr)) {
    Serial.println("WARN: ignoring frame from zero-MAC sender");
    return;
  }
  // update sender atomically
  portENTER_CRITICAL(&g_senderMux);
  memcpy(lastSender, info->src_addr, 6);
  haveSender = true;
  portEXIT_CRITICAL(&g_senderMux);

  // Safe copy of RX for parsing
  char rxb[256];
  int n = min(len, (int)sizeof(rxb) - 1);
  memcpy(rxb, data, n); rxb[n] = '\0';
  // Trim simple trailing/leading spaces in-place (basic)
  auto ltrim = [](char* s){ while (*s==' '||*s=='\t' || *s=='\r') ++s; return s; };
  auto rtrim = [](char* s){ size_t L=strlen(s); while(L&& (s[L-1]==' '||s[L-1]=='\t'||s[L-1]=='\r')) s[--L]='\0'; return s; };
  char* rx = ltrim(rxb); rtrim(rx);
  Serial.printf("Recv: %s\n", rx);

  // Process ACK replies
  if (strncmp(rx, "ACK ", 4) == 0) {
    uint32_t id = strtoul(rx + 4, nullptr, 10);
    if (hubAckActive && id == hubAckId && memcmp(info->src_addr, hubAckMac, 6) == 0) {
      hubAckActive = false; // mark complete
    }
    return; // ACKs carry no content
  }

  // Auto-ACK any frame that contains an ID token — only for the active session peer
  uint32_t incomingId = 0;
  if (extractIdToken(rxb, n, incomingId)) {
    bool ok; uint8_t sess[6];
    portENTER_CRITICAL(&g_senderMux);
    ok = haveSender; if (ok) memcpy(sess, lastSender, 6);
    portEXIT_CRITICAL(&g_senderMux);
    if (ok && memcmp(info->src_addr, sess, 6) == 0) {
      char ackBuf[24];
      int m = snprintf(ackBuf, sizeof(ackBuf), "ACK %lu", (unsigned long)incomingId);
      if (m > 0 && m < (int)sizeof(ackBuf)) {
        // Send ACK without adding our own ID, reply to src directly
        sendCmdRaw(ackBuf, info->src_addr);
      }
    }
  }

  if (strncmp(rx, "WELCOME", 7) == 0) {
    { uint8_t dest[6]; bool ok = getTarget(dest); if (ok) sendCmdRaw("WELCOME", dest); }
    { uint8_t dest[6]; bool ok = getTarget(dest); if (ok) sendCmd("READY", dest); }
    state = State::WELCOME;
    welcomeEdgeCount = 0;
    return;
  }

  if (strncmp(rx, "PING", 4) == 0) {
    // One-shot reply; keep it simple and avoid competing with other ACKs
    { uint8_t dest[6]; bool ok = getTarget(dest); if (ok) sendCmdRaw("PING-OK", dest); }
    return;
  }

  if (strncmp(rx, "BLINK", 5) == 0) {
    int times = 3;
    const char* sp = strchr(rx, ' ');
    if (sp && *(sp+1)) times = max(1, atoi(sp+1));
    uint8_t dest[6]; bool haveDest = getTarget(dest);
    portENTER_CRITICAL(&pendingMux);
    pending.kind = PendingCmd::Blink;
    pending.n = times;
    pending.hasMac = haveDest;
    if (haveDest) memcpy(pending.mac, dest, 6); else memset(pending.mac, 0, sizeof(pending.mac));
    havePending = true;
    portEXIT_CRITICAL(&pendingMux);
    { uint8_t dest[6]; bool ok = getTarget(dest); if (ok) sendCmd("BLINK-OK", dest); }
    return;
  }

  if (strncmp(rx, "CHASE", 5) == 0) {
    int rounds = 1;
    const char* sp = strchr(rx, ' ');
    if (sp && *(sp+1)) rounds = max(1, atoi(sp+1));
    uint8_t dest[6]; bool haveDest = getTarget(dest);
    portENTER_CRITICAL(&pendingMux);
    pending.kind = PendingCmd::Chase;
    pending.n = rounds;
    pending.hasMac = haveDest;
    if (haveDest) memcpy(pending.mac, dest, 6); else memset(pending.mac, 0, sizeof(pending.mac));
    havePending = true;
    portEXIT_CRITICAL(&pendingMux);
    { uint8_t dest[6]; bool ok = getTarget(dest); if (ok) sendCmd("CHASE-OK", dest); }
    return;
  }
  if (strncmp(rx, "MONITOR", 7) == 0) {
    parseMonitorPayload((const char*)data, len);
    state = State::MONITORING;

    { uint8_t dest[6]; bool ok = getTarget(dest); if (ok) { ensurePeer(dest); sendCmd("MONITOR-OK", dest); } }

    // Defer MONITOR-START and baseline snapshot to loop()
    uint8_t dest[6]; bool haveDest = getTarget(dest);
    portENTER_CRITICAL(&pendingMux);
    pending.kind = PendingCmd::MonitorBaseline;
    pending.n = 0;
    pending.hasMac = haveDest;
    if (haveDest) memcpy(pending.mac, dest, 6); else memset(pending.mac, 0, sizeof(pending.mac));
    havePending = true;
    portEXIT_CRITICAL(&pendingMux);

    Serial.println(">> MONITORING");
    return;
  }

  if (strncmp(rx, "CHECK", 5) == 0) {
    parseCheckSelection(rx, strlen(rx));
    const bool restrict = checkActive ? true : false;
    if (!hasWorkToCheck(restrict)) {
      char out[64];
      snprintf(out, sizeof(out), "RESULT SUCCESS %s", BOARD_MAC);
      uint8_t dest[6]; if (getTarget(dest)) sendCmd(out, dest);
      goDarkAndIdle();              // <<< keep LEDs dark
      return;
    }
    state = State::FINAL_CHECK;
    Serial.println(">> FINAL_CHECK");
    return;
  }


  if (strncmp(rx, "CLEAN", 5) == 0) {
    stopStreaming(); 
    cleanAll();
    state = State::WAIT_FOR_TARGET;
    // Avoid guard in serviceAckTx() that bails in WAIT_FOR_TARGET
    { uint8_t dest[6]; bool ok = getTarget(dest); if (ok) sendCmdRaw("CLEAN-OK", dest); }
    return;
  }
}

static void cleanAll() {
  memset(monNormal, 0, sizeof(monNormal));
  memset(monLatch, 0, sizeof(monLatch));
  memset(latched, 0, sizeof(latched));
  memset(ignoredCh, 0, sizeof(ignoredCh));
  memset(checkSelect, 0, sizeof(checkSelect));
  checkActive = false;
  unsigned long now = millis();
  for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
    rawPrev[ch] = isPressedRaw(ch);
    rawChangedAt[ch] = now;
    lastPressed[ch] = rawPrev[ch];
    setLed(ch, false);
  }
  needReleaseGate = false;
}

static uint8_t lastTxMac[6]; static bool lastTxMacValid=false;

static bool sendCmdRaw(const char* msg, const uint8_t* dest) {
  uint8_t target[6];
  if (!resolveTarget(dest, target)) {
    Serial.println("WARN: sendCmdRaw: no valid target");
    return false;
  }
  if (!ensurePeer(target)) return false;
  memcpy(lastTxMac, target, 6); lastTxMacValid = true;
  return esp_now_send(target, (const uint8_t*)msg, strlen(msg)+1) == ESP_OK;
}

static bool sendCmd(const char* msg, const uint8_t* dest) {
  static const uint8_t bcast[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
  uint8_t target[6];
  if (!resolveTarget(dest, target)) {
    Serial.println("WARN: sendCmd: no valid target");
    return false;
  }
  if (memcmp(target, bcast, 6) == 0) {
    // Don't require ACK for broadcast
    return sendCmdRaw(msg, target);
  }
  // Frame with ID and schedule resend
  // Cancel any in-flight ACK to avoid mixing transactions
  hubAckActive = false;
  hubAckTimeoutMs = 240; // reset backoff for the new transaction
  uint32_t id = nextSeqId();
  snprintf(hubAckMsg, sizeof(hubAckMsg), "%s ID=%lu", msg, (unsigned long)id);
  memcpy(hubAckMac, target, 6);
  hubAckId = id;
  hubAckRetriesLeft = 4; // a bit more robust
  hubAckLastSend = 0;
  hubAckActive = true;
  // Immediate first send
  serviceAckTx();
  return true;
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onSent(const esp_now_send_info_t* /*tx_info*/, esp_now_send_status_t status) {
  if (lastTxMacValid)
    Serial.printf("→ sent to %02X:%02X:%02X:%02X:%02X:%02X status=%d\n",
      lastTxMac[0],lastTxMac[1],lastTxMac[2],lastTxMac[3],lastTxMac[4],lastTxMac[5], (int)status);
  else
    Serial.printf("→ sent status=%d\n", (int)status);
}
#else
static void onSent(const uint8_t* mac, esp_now_send_status_t status) {
  Serial.printf("→ sent to %02X:%02X:%02X:%02X:%02X:%02X status=%d\n",
    mac[0],mac[1],mac[2],mac[3],mac[4],mac[5], (int)status);
}
#endif

// === Setup / Loop ===
void setup() {
  Serial.begin(115200);
  delay(80);
  String mac = WiFi.macAddress();
  mac.toCharArray(BOARD_MAC, sizeof(BOARD_MAC));
  Serial.printf("Device MAC: %s\n", BOARD_MAC);

  pinMode(BTN_PIN, INPUT_PULLUP);

  Wire.begin(21, 22);
  Wire.setClock(400000);
  // Create I2C mutex
  i2cMutex = xSemaphoreCreateMutex();
  if (!i2cMutex) {
    Serial.println("FATAL: i2cMutex alloc failed");
    while (true) delay(1000);
  }
  for (uint8_t i = 0; i < EXPANDER_COUNT; ++i) {
    i2cLock();
    bool ok = mcp[i].begin_I2C(MCP_I2C_ADDR[i]);
    i2cUnlock();
    if (!ok) {
      Serial.printf("MCP@0x%02X init failed\n", MCP_I2C_ADDR[i]);
      while (true) delay(1000);
    }
  }
  buildPins();
  const unsigned long bootNow = millis();
  for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
    auto &p = pinsMap[ch];
    i2cLock();
    mcp[p.mcpIndex].pinMode(p.ledPin, OUTPUT);
    mcp[p.mcpIndex].digitalWrite(p.ledPin, LOW);
    mcp[p.mcpIndex].pinMode(p.swPin, INPUT_PULLUP);
    i2cUnlock();
    rawPrev[ch] = isPressedRaw(ch);       // avoid phantom first-edge
    rawChangedAt[ch] = bootNow;
    lastPressed[ch] = rawPrev[ch];
  }

  for (int i = 0; i < 3; i++) { allLeds(true); delay(120); allLeds(false); delay(120); }

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  // Disable power save for predictable latency
  esp_wifi_set_ps(WIFI_PS_NONE);
  // Lock primary channel before ESP-NOW
  {
    esp_err_t rc = esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
    if (rc != ESP_OK) Serial.printf("WARN: set_channel() failed: %s\n", esp_err_to_name(rc));
  }

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    while (true) delay(1000);
  }
  esp_now_register_recv_cb(onRecv);
  esp_now_register_send_cb(onSent);

  memset(monNormal, 0, sizeof(monNormal));
  memset(monLatch, 0, sizeof(monLatch));
  memset(latched, 0, sizeof(latched));
  memset(ignoredCh, 0, sizeof(ignoredCh));
  memset(checkSelect, 0, sizeof(checkSelect));

  state = State::SELF_CHECK;
  Serial.println("READY");
}

void loop() {
  unsigned long now = millis();

  if (now - lastBlinkTick >= BLINK_INTERVAL_MS) {
    lastBlinkTick = now;
    blinkState = !blinkState;

    if (state == State::WELCOME) {
      welcomeEdgeCount++;
      allLeds(blinkState);
      if (welcomeEdgeCount >= 6) {
        welcomeEdgeCount = 0;
        allLeds(false);
        state = State::WAIT_FOR_TARGET;
        Serial.println(">> WAIT_FOR_TARGET");
      }
    }
  }

  int reading = digitalRead(BTN_PIN);
  if (reading != btnLastRead) { lastDebounce = now; btnLastRead = reading; }
  if (now - lastDebounce > DEBOUNCE_MS) {
    if (reading != btnStable) {
      btnStable = reading;
      if (btnStable == LOW) triggerHello();
    }
  }

  switch (state) {
    case State::SELF_CHECK:    doSelfCheck();    break;
    case State::WAIT_FOR_TARGET: {
      // Surface any switches held during idle by blinking stuck channels.
      for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
        bool pressed = isPressedRaw(ch);
        setLed(ch, pressed ? blinkState : false);
      }
      break;
    }
    case State::MONITORING:    doMonitoring();   break;
    case State::FINAL_CHECK:   doFinalCheck();   break;
    case State::WELCOME:       break;
  }
  // Drive ACK resend state machine
  serviceAckTx();

  // Handle any pending heavy actions scheduled from RX callback
  if (havePending) {
    PendingCmd pc;
    portENTER_CRITICAL(&pendingMux);
    pc = pending; havePending = false; pending.kind = PendingCmd::None; pending.hasMac = false; pending.n = 0; memset(pending.mac, 0, sizeof(pending.mac));
    portEXIT_CRITICAL(&pendingMux);
    switch (pc.kind) {
      case PendingCmd::Blink: {
        for (int i = 0; i < pc.n; ++i) {
          allLeds(true);  vTaskDelay(pdMS_TO_TICKS(120)); serviceAckTx();
          allLeds(false); vTaskDelay(pdMS_TO_TICKS(120)); serviceAckTx();
        }
        break;
      }
      case PendingCmd::Chase: {
        int rounds = max(1, pc.n);
        while (rounds--) {
          for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
            setLed(ch, true);  vTaskDelay(pdMS_TO_TICKS(40));  serviceAckTx();
            setLed(ch, false); vTaskDelay(pdMS_TO_TICKS(1));   serviceAckTx();
          }
        }
        break;
      }
      case PendingCmd::MonitorBaseline: {
        // Start streaming and send MONITOR-START + baseline snapshot via RAW
        startStreaming();
        char startPkt[48];
        snprintf(startPkt, sizeof(startPkt), "MONITOR-START %s", BOARD_MAC);
        uint8_t destBuf[6];
        bool haveDest = false;
        if (pc.hasMac) { memcpy(destBuf, pc.mac, sizeof(destBuf)); haveDest = true; }
        else haveDest = getTarget(destBuf);
        if (!haveDest) break;
        sendCmdRaw(startPkt, destBuf);
        for (int ch = 0; ch < CHANNEL_COUNT; ++ch) {
          if (monNormal[ch] || monLatch[ch]) {
            bool p = isPressedRaw(ch);
            char pkt[48]; snprintf(pkt, sizeof(pkt), "EV P %d %d %s", ch+1, p?1:0, BOARD_MAC);
            sendCmdRaw(pkt, destBuf);
            // small yield to avoid bursting 80 frames back-to-back
            vTaskDelay(pdMS_TO_TICKS(1));
            if (monLatch[ch]) {
              char pkt2[48]; snprintf(pkt2, sizeof(pkt2), "EV L %d %d %s", ch+1, latched[ch]?1:0, BOARD_MAC);
              sendCmdRaw(pkt2, destBuf);
              vTaskDelay(pdMS_TO_TICKS(1));
            }
          }
        }
        // Mirror baseline into prev* so first deltas are consistent
        for (int i = 0; i < CHANNEL_COUNT; ++i) {
          if (monNormal[i] || monLatch[i]) {
            bool p = isPressedRaw(i);
            prevPressed[i] = p;
            prevLatchedState[i] = latched[i];
          }
        }
        break;
      }
      default: break;
    }
  }

  vTaskDelay(pdMS_TO_TICKS(10));
}

/*
Examples (MAC token is ignored in parsing):
MONITOR NORMAL 2 08:3A:8D:15:27:54
MONITOR LATCH 1 08:3A:8D:15:27:54
CLEAN 08:3A:8D:15:27:54
CHECK 08:3A:8D:15:27:54
*/

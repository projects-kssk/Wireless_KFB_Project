#if defined(__has_include)
#if __has_include(<Arduino.h>)
#define GUI_HAS_ESP32_HEADERS 1
#endif
#else
#define GUI_HAS_ESP32_HEADERS 1
#endif

#if !defined(GUI_HAS_ESP32_HEADERS)
void station_cpp_requires_esp32_headers() {} // host-side stub when ESP32 SDK headers are missing
#else
#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <ctype.h>
#include "esp_idf_version.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/portmacro.h"
#include "esp_err.h"

// ===== Config =====
static constexpr uint8_t ESPNOW_CHANNEL = 1; // must match hub
static_assert(ESPNOW_CHANNEL >= 1 && ESPNOW_CHANNEL <= 13, "Bad ESPNOW channel");
static constexpr unsigned STA_ACK_TIMEOUT_MS = 220;
static constexpr int      STA_ACK_MAX_RETRIES = 4; // total attempts = retries+1
static constexpr size_t   STA_MAX_PAYLOAD    = 220; // leave room for ID framing

// ===== Station state =====
enum StationState { IDLE, WAIT_HELLO, WAIT_RESULT };
static volatile StationState staState = IDLE;
static volatile bool forwardLive = false; // gate EV forwarding during active sessions
static uint8_t sessionMac[6];
static volatile bool haveSessionMac = false;
static portMUX_TYPE sessionMux = portMUX_INITIALIZER_UNLOCKED;

static inline bool isZeroMac(const uint8_t mac[6]) {
  if (!mac) return true;
  for (int i = 0; i < 6; ++i) if (mac[i] != 0) return false;
  return true;
}

// ===== Last TX context =====
static uint8_t expectedMac[6];
static volatile bool haveExpectedMac = false;
// (no external EV handler; EV pass-through is handled inline in RX)

// ===== Simple ACK/ID support =====
static volatile bool staAckReceived = false;
static volatile uint32_t staAckWaitId = 0;
static volatile uint8_t staAckWaitMac[6] = {0};
static portMUX_TYPE ackMux = portMUX_INITIALIZER_UNLOCKED;

static inline void setAckWait(uint32_t id, const uint8_t mac[6]) {
  portENTER_CRITICAL(&ackMux);
  staAckWaitId = id;
  memcpy((void*)staAckWaitMac, mac, 6);
  staAckReceived = false;
  portEXIT_CRITICAL(&ackMux);
}

// Expected MAC tuple (filtering for directed transactions)
static portMUX_TYPE expMux = portMUX_INITIALIZER_UNLOCKED;
static inline void setExpectedMac(const uint8_t mac[6], bool has) {
  portENTER_CRITICAL(&expMux);
  if (has && mac) memcpy(expectedMac, mac, 6);
  haveExpectedMac = has;
  portEXIT_CRITICAL(&expMux);
}
static inline void clearExpectedMac() { setExpectedMac(nullptr, false); }
static uint32_t nextSeqId() {
  static uint32_t seq = 1;
  return seq++;
}
static bool extractIdToken(const char* msg, int len, uint32_t &outId) {
  // find " ID=" and read a decimal id
  if (!msg || len <= 0) return false;
  const char* p = strstr(msg, " ID=");
  if (!p) return false;
  p += 4;
  uint32_t v = 0; bool any=false;
  while (*p && isdigit((unsigned char)*p)) { any=true; v = v*10 + (*p - '0'); ++p; }
  if (!any) return false;
  outId = v;
  return true;
}

// ===== Forward decls (IDF4 vs IDF5) =====
#if defined(ESP_IDF_VERSION_MAJOR) && (ESP_IDF_VERSION_MAJOR >= 5)
static void onEspNowSent(const wifi_tx_info_t *info, esp_now_send_status_t status);
static void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len);
#else
static void onEspNowSent(const uint8_t *mac_addr, esp_now_send_status_t status);
static void onEspNowRecv(const uint8_t *mac, const uint8_t *data, int len);
#endif

// ===== Helpers =====
static String macToString(const uint8_t mac[6]) {
  char buf[18];
  sprintf(buf, "%02X:%02X:%02X:%02X:%02X:%02X",
          mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

static bool parseMac(const String &s, uint8_t mac[6]) {
  if (s.length() != 17) return false;
  for (int i = 0; i < 6; i++) {
    if (i < 5 && s[i * 3 + 2] != ':') return false;
    long b = strtol(s.substring(i * 3, i * 3 + 2).c_str(), nullptr, 16);
    if (b < 0 || b > 255) return false;
    mac[i] = static_cast<uint8_t>(b);
  }
  return true;
}

// (removed unused handleLiveEvent; EV forwarding handled in RX)

// Validate CHECK pins "N[,N]*" with 1..40 range
static bool validateCheckPins(const String &payload) {
  String u = payload; u.trim(); u.toUpperCase();
  if (!u.startsWith("CHECK")) return true; // not a CHECK, nothing to validate
  String list = u.substring(5); list.trim();
  if (list.isEmpty()) return false;

  int count = 0;
  for (int i = 0; i < list.length();) {
    // skip spaces
    while (i < list.length() && isspace((unsigned char)list[i])) i++;
    if (i >= list.length()) break;

    // read number
    int start = i;
    while (i < list.length() && isdigit((unsigned char)list[i])) i++;
    if (start == i) return false; // no digit
    long v = strtol(list.substring(start, i).c_str(), nullptr, 10);
    if (v < 1 || v > 40) return false;
    count++;
    if (count > 32) return false; // arbitrary cap

    // skip spaces
    while (i < list.length() && isspace((unsigned char)list[i])) i++;
    // optional comma
    if (i < list.length() && list[i] == ',') i++;
  }
  return count > 0;
}

// Parse a console line. Prefer cmd='…' if present. Require the LAST MAC and it must be at the end.
// Return payloadOut (without MAC) + macOut.
static bool parseLineForCommand(const String &lineIn, String &payloadOut, uint8_t macOut[6]) {
  String s = lineIn;
  s.trim();

  // Prefer inner command if cmd='…' or cmd="…" present
  int cmdPos = s.indexOf("cmd='");
  if (cmdPos >= 0) {
    int start = cmdPos + 5;
    int end = s.indexOf('\'', start);
    if (end > start) s = s.substring(start, end);
  } else {
    int cmdPosQ = s.indexOf("cmd=\"");
    if (cmdPosQ >= 0) {
      int start = cmdPosQ + 5;
      int end = s.indexOf('"', start);
      if (end > start) s = s.substring(start, end);
    }
  }

  // Find last MAC that is the terminal token
  String up = s;
  up.trim();
  up.toUpperCase();
  auto isHex = [](char c){ return (c>='0'&&c<='9')||(c>='A'&&c<='F'); };

  for (int i = up.length() - 17; i >= 0; --i) {
    if (up[i + 2] != ':' || up[i + 5] != ':' || up[i + 8] != ':' ||
        up[i + 11] != ':' || up[i + 14] != ':') continue;

    bool ok = true;
    for (int k = 0; k < 17; ++k) {
      if ((k % 3) == 2) continue;
      if (!isHex(up[i + k])) { ok = false; break; }
    }
    if (!ok) continue;

    // must be end of string
    String tail = up.substring(i + 17);
    tail.trim();
    if (!tail.isEmpty()) continue;

    String macStr = up.substring(i, i + 17);
    if (!parseMac(macStr, macOut) || isZeroMac(macOut)) continue;

    payloadOut = s.substring(0, i);
    payloadOut.trim();
    return true;
  }
  return false;
}

// ===== Send-callback (IDF4 vs IDF5) =====
#if defined(ESP_IDF_VERSION_MAJOR) && (ESP_IDF_VERSION_MAJOR >= 5)
static void onEspNowSent(const wifi_tx_info_t *info, esp_now_send_status_t st) {
  (void)info;
  Serial.print("→ TX status=");
  Serial.println(st == ESP_NOW_SEND_SUCCESS ? "OK" : "FAIL");
}
#else
static void onEspNowSent(const uint8_t *mac, esp_now_send_status_t st) {
  Serial.print("→ TX to ");
  if (mac) Serial.print(macToString(mac)); else Serial.print("NULL");
  Serial.print(" status=");
  Serial.println(st == ESP_NOW_SEND_SUCCESS ? "OK" : "FAIL");
}
#endif

// ===== RX callback (IDF4 vs IDF5) =====
#if defined(ESP_IDF_VERSION_MAJOR) && (ESP_IDF_VERSION_MAJOR >= 5)
static void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (!info || !data || len <= 0) return;
  const uint8_t *src = info->src_addr;
#else
static void onEspNowRecv(const uint8_t *mac, const uint8_t *data, int len) {
  if (!mac || !data || len <= 0) return;
  const uint8_t *src = mac;
#endif
  if (isZeroMac(src)) return;
  // safe RX copy
  char rxb[256];
  int n = min(len, (int)sizeof(rxb) - 1);
  memcpy(rxb, data, n); rxb[n] = '\0';
  bool isEv = (n >= 3 && rxb[0]=='E' && rxb[1]=='V' && rxb[2]==' ');
  bool isUi = (n >= 3 && rxb[0]=='U' && rxb[1]=='I' && rxb[2]==':');

  // Handle ACK packets early (C-style to avoid heap churn)
  if (strncmp(rxb, "ACK ", 4) == 0) {
    uint32_t id = strtoul(rxb + 4, nullptr, 10);
    // Snapshot ACK tuple under a tiny critical section
    uint32_t waitId; uint8_t waitMac[6];
    portENTER_CRITICAL(&ackMux);
    waitId = staAckWaitId; memcpy(waitMac, (const void*)staAckWaitMac, 6);
    portEXIT_CRITICAL(&ackMux);
    if (id && id == waitId && memcmp(src, waitMac, 6) == 0) {
      portENTER_CRITICAL(&ackMux);
      staAckReceived = true;
      portEXIT_CRITICAL(&ackMux);
    }
    return; // ACK frames carry no additional semantics
  }

  // Auto-ACK any message that carries an ID token — but only for known peers
  uint32_t incomingId = 0;
  if (extractIdToken(rxb, n, incomingId)) {
    // Gate ACKs to the in-flight expected MAC or active session MAC
    bool allowAck = false;
    // expected MAC
    bool expect; uint8_t expMac[6];
    portENTER_CRITICAL(&expMux);
    expect = haveExpectedMac; if (expect) memcpy(expMac, expectedMac, 6);
    portEXIT_CRITICAL(&expMux);
    if (expect && memcmp(src, expMac, 6) == 0) allowAck = true;
    // session MAC
    if (!allowAck && forwardLive) {
      bool has; uint8_t smac[6];
      portENTER_CRITICAL(&sessionMux);
      has = haveSessionMac; if (has) memcpy(smac, sessionMac, 6);
      portEXIT_CRITICAL(&sessionMux);
      if (has && memcmp(src, smac, 6) == 0) allowAck = true;
    }

    if (allowAck) {
      char ackBuf[24];
      int m = snprintf(ackBuf, sizeof(ackBuf), "ACK %lu", (unsigned long)incomingId);
      // Respond directly without waiting for ACK (ACKs are not acked)
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, src, 6);
      peer.channel = ESPNOW_CHANNEL;
      peer.encrypt = false;
#ifdef WIFI_IF_STA
      peer.ifidx = WIFI_IF_STA;
#endif
      if (m > 0 && m < (int)sizeof(ackBuf)) {
        esp_err_t e = esp_now_add_peer(&peer);
        if (e == ESP_OK || e == ESP_ERR_ESPNOW_EXIST) {
          esp_now_send(src, reinterpret_cast<const uint8_t*>(ackBuf), m + 1);
        }
      }
    }
  }

  // EV/UI fast paths — no header logging
  if (isEv) {
    if (forwardLive) {
      uint8_t smac[6]; bool has;
      portENTER_CRITICAL(&sessionMux);
      has = haveSessionMac; if (has) memcpy(smac, sessionMac, 6);
      portEXIT_CRITICAL(&sessionMux);
      if (!has || memcmp(src, smac, 6) == 0) Serial.println(rxb);
    }
    return;
  }
  if (isUi && forwardLive) { Serial.printf("UI %s %s\n", rxb + 3, macToString(src).c_str()); return; }

  // For all other frames, log once with header
  {
    String from = macToString(src);
    Serial.print("← reply from "); Serial.print(from); Serial.print(": "); Serial.println(rxb);
  }

  // One-shot OK responses: clear expected MAC to end filtering window
  if (strncmp(rxb, "MONITOR-OK", 10) == 0 ||
      strncmp(rxb, "PING-OK", 7) == 0   ||
      strncmp(rxb, "CLEAN-OK", 8) == 0) {
    if (strncmp(rxb, "CLEAN-OK", 8) == 0) {
      forwardLive = false;
      portENTER_CRITICAL(&sessionMux);
      haveSessionMac = false;
       memset(sessionMac, 0, sizeof sessionMac); 
      portEXIT_CRITICAL(&sessionMux);
    }
    clearExpectedMac();
    return;
  }

  // (EV frames already handled in fast path above)

  // Session end: accept RESULT/SUCCESS/FAILURE in any state
  if (strncmp(rxb, "RESULT ", 7) == 0 ||
      strncmp(rxb, "SUCCESS", 7) == 0 ||
      strncmp(rxb, "FAILURE", 7) == 0) {
    forwardLive = false;
    portENTER_CRITICAL(&sessionMux);
    haveSessionMac = false;
    memset(sessionMac, 0, sizeof sessionMac);
    portEXIT_CRITICAL(&sessionMux);
    // already logged above; avoid duplicate prints
    staState = IDLE; clearExpectedMac();
    return;
  }

  // Optionally pass UI through when streaming
  // UI handled earlier

  // Filter only when a transaction is in-flight (snapshot expected MAC)
  bool expect; uint8_t expMac[6];
  portENTER_CRITICAL(&expMux);
  expect = haveExpectedMac; memcpy(expMac, expectedMac, 6);
  portEXIT_CRITICAL(&expMux);
  if (expect && memcmp(src, expMac, 6) != 0) {
    Serial.print("ignored: unexpected MAC. expected ");
    Serial.print(macToString(expMac));
    Serial.print(" got ");
    Serial.println(macToString(src));
    return;
  }

  switch (staState) {
    case WAIT_HELLO: {
      bool isReady   = (strncmp(rxb, "READY",   5) == 0);
      bool isWelcome = (strncmp(rxb, "WELCOME", 7) == 0);
      if (isReady || isWelcome) {
        Serial.printf("%s %s\n", isReady ? "READY" : "WELCOME", macToString(src).c_str());
        staState = IDLE;
        clearExpectedMac();
      }
      break;
    }

    case WAIT_RESULT: {
      if (strncmp(rxb, "RESULT ", 7) == 0 ||
          strncmp(rxb, "SUCCESS", 7) == 0 ||
          strncmp(rxb, "FAILURE", 7) == 0) {
        forwardLive = false;
        staState = IDLE; clearExpectedMac();
        break;
      }
      break;
    }

    default:
      break;
  }
}

static bool sendToPeerRaw(const String &payload, const uint8_t mac[6]) {
  if (isZeroMac(mac)) { Serial.println("ERROR: refusing to send to zero MAC"); return false; }
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = ESPNOW_CHANNEL;
  peer.encrypt = false;
#ifdef WIFI_IF_STA
  peer.ifidx = WIFI_IF_STA;
#endif

  esp_err_t addRes = esp_now_add_peer(&peer);
  if (addRes != ESP_OK && addRes != ESP_ERR_ESPNOW_EXIST) {
    Serial.printf("ERROR: add_peer failed (%s)\n", esp_err_to_name(addRes));
    return false;
  }

  esp_err_t res = esp_now_send(mac,
                               (const uint8_t*)payload.c_str(),
                               payload.length() + 1);
  if (res != ESP_OK) {
    // try re-add once if send fails
    esp_now_del_peer(mac);
    if (esp_now_add_peer(&peer) == ESP_OK) {
      res = esp_now_send(mac, (const uint8_t*)payload.c_str(), payload.length() + 1);
    }
  }
  if (res != ESP_OK) {
    Serial.printf("ERROR: send failed (%s)\n", esp_err_to_name(res));
    return false;
  }
  Serial.print("→ Sent '"); Serial.print(payload); Serial.print("' to "); Serial.println(macToString(mac));
  return true;
}


static volatile bool txInFlight = false;

static bool sendWithAck(const String &payload, const uint8_t mac[6], unsigned timeoutMs = STA_ACK_TIMEOUT_MS, int maxRetries = STA_ACK_MAX_RETRIES) {
  if (txInFlight) { Serial.println("WARN: tx in flight"); return false; }
  if (isZeroMac(mac)) { Serial.println("ERROR: zero MAC target"); return false; }
  txInFlight = true;
  uint32_t id = nextSeqId();
  String framed = payload + " ID=" + String(id);
  if (framed.length() > STA_MAX_PAYLOAD) {
    Serial.println("ERROR: framed payload too long");
    txInFlight = false;
    return false;
  }
  setAckWait(id, mac);

  int attempts = 0;
  unsigned long lastSend = 0;
  unsigned curTimeout = timeoutMs;
  while (attempts <= maxRetries) {
    unsigned long now = millis();
      if (attempts == 0 || now - lastSend >= curTimeout) {
      if (!sendToPeerRaw(framed, mac)) {
        // if send API failed, small yield then retry
        vTaskDelay(pdMS_TO_TICKS(1));
      }
      lastSend = now;
      attempts++;
      if (attempts > 1) { // simple linear backoff with clamp
        unsigned next = curTimeout + 80;
        curTimeout = (next > 640u) ? 640u : next;
      }
    }
    
  bool gotAck = false;
  portENTER_CRITICAL(&ackMux);
  gotAck = staAckReceived;
  portEXIT_CRITICAL(&ackMux);
  if (gotAck) { txInFlight = false; return true; }

    // cooperative yield to Wi-Fi task
    vTaskDelay(pdMS_TO_TICKS(1));
  }
  Serial.printf("WARN: no ACK for ID=%lu after %d attempts\n", (unsigned long)id, attempts);
  txInFlight = false;
  return false;
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(50);
  while (!Serial) delay(10);
  Serial.println("Station booting...");

  WiFi.mode(WIFI_STA);
  esp_wifi_set_ps(WIFI_PS_NONE);   // <— add this
  WiFi.disconnect(true, true);

  // Lock primary channel BEFORE esp_now_init()
  esp_err_t chRes = esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (chRes != ESP_OK) {
    Serial.printf("WARN: set_channel(%u) failed: 0x%02X\n", ESPNOW_CHANNEL, chRes);
  }

  if (esp_now_init() != ESP_OK) {
    Serial.println("ERROR: ESP-NOW init failed");
    while (true) delay(1000);
  }

  esp_now_register_recv_cb(onEspNowRecv);
  esp_now_register_send_cb(onEspNowSent);

  Serial.println("Ready. Usage:");
  Serial.println("  WELCOME …MAC");
  Serial.println("  MONITOR NORMAL … LATCH … …MAC");
  Serial.println("  CHECK 5,6,10,13,20 …MAC");
  Serial.println("  PING …MAC");
  Serial.println("  CLEAN …MAC");
  Serial.println("Also supported: cmd='CHECK 5,6,10,13,20 …MAC'");
}

void loop() {
  if (!Serial.available()) { vTaskDelay(pdMS_TO_TICKS(10)); return; }

  // Read one line and extract "<payload> … <MAC at end>" or "cmd='… MAC'"
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.isEmpty()) return;

  String payload;
  uint8_t macTmp[6] = {0};
  if (!parseLineForCommand(line, payload, macTmp)) {
    Serial.printf("ERROR: invalid command or MAC in line: '%s'\n", line.c_str());
    clearExpectedMac();
    return;
  }
  if (isZeroMac(macTmp)) {
    Serial.println("ERROR: target MAC is all zeroes");
    clearExpectedMac();
    return;
  }
  setExpectedMac(macTmp, true);

  String pfx = payload; pfx.trim(); pfx.toUpperCase();
  bool isWelcome = pfx.startsWith("WELCOME");
  bool isMonitor = pfx.startsWith("MONITOR");
  bool isCheck   = pfx.startsWith("CHECK");
  bool isPing    = pfx.startsWith("PING");
  bool isClean   = pfx.startsWith("CLEAN");
  bool isNoise   = pfx.startsWith("HELLO") || pfx.startsWith("READY");

  if (!(isWelcome || isMonitor || isCheck || isPing || isClean)) {
    if (isNoise) Serial.println("note: host noise ignored");
    else Serial.printf("ignored: unknown command '%s'\n", payload.c_str());
    clearExpectedMac();
    return;
  }

  if (isCheck && !validateCheckPins(payload)) {
    Serial.println("ERROR: invalid CHECK pins list");
    clearExpectedMac();
    return;
  }

  // payload saved no longer needed; send directly

  if (isWelcome)      staState = WAIT_HELLO;
  else if (isCheck)   staState = WAIT_RESULT;
  else                staState = IDLE; // MONITOR, PING, CLEAN are fire-and-forget

  // Gate live forwarding during CHECK/MONITOR until end-of-session; bind session to MAC
  if (isMonitor || isCheck) {
    forwardLive = true;
    portENTER_CRITICAL(&sessionMux);
    memcpy(sessionMac, macTmp, 6);
    haveSessionMac = true;
    portEXIT_CRITICAL(&sessionMux);
  }
  if (isClean) {
    forwardLive = false;
    portENTER_CRITICAL(&sessionMux);
    haveSessionMac = false;
    memset(sessionMac, 0, sizeof sessionMac);
    portEXIT_CRITICAL(&sessionMux);
  }

  if (!sendWithAck(payload, macTmp)) {
    staState = IDLE;
    clearExpectedMac();
    forwardLive = false;
    portENTER_CRITICAL(&sessionMux);
    haveSessionMac = false;
    memset(sessionMac, 0, sizeof sessionMac);
    portEXIT_CRITICAL(&sessionMux);
  }
  vTaskDelay(pdMS_TO_TICKS(1));
}

#endif // GUI_HAS_ESP32_HEADERS

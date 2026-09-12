// Floor Ops Console — Waveshare ESP32-S3 pager firmware stub
//
// Polls GET {API_BASE_URL}/pager/state on a timer and prints the help queue
// to Serial. Pressing the ack button sends POST {API_BASE_URL}/pager/ack for
// the team at the top of the queue.
//
// This is a stub, not production firmware — see README.md for what's
// intentionally left out (reconnect/backoff, TLS pinning, LCD driving, etc).
//
// Requirements: "esp32 by Espressif Systems" board package, ArduinoJson v7+.
// Copy pager_config.h.example to pager_config.h and fill in your Wi-Fi +
// API base URL before building.

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "pager_config.h"

// ---- Board pins — check your exact Waveshare ESP32-S3 variant's pinout ----
#define ACK_BUTTON_PIN 0   // BOOT button on most Waveshare S3 boards (active LOW)
#define STATUS_LED_PIN 48  // Onboard addressable LED on many S3 DevKits (plain digital drive here)
#define BUZZER_PIN 4       // Optional piezo buzzer

const unsigned long POLL_INTERVAL_MS = 5000;
const unsigned long BUTTON_DEBOUNCE_MS = 300;

unsigned long lastPollAt = 0;
unsigned long lastButtonAt = 0;

// Team id of the current top-of-queue item, updated by every successful poll.
// -1 means "nothing to ack".
int topQueueTeamId = -1;

void connectWifi() {
  Serial.printf("Connecting to Wi-Fi \"%s\"...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
    if (millis() - start > 20000) {
      Serial.println("\nWi-Fi connect timed out, restarting...");
      ESP.restart();
    }
  }
  Serial.printf("\nWi-Fi connected, IP: %s\n", WiFi.localIP().toString().c_str());
}

// GET /pager/state, parse it, and update topQueueTeamId + the LED/buzzer.
void pollPagerState() {
  HTTPClient http;
  http.begin(String(API_BASE_URL) + "/pager/state");
  int status = http.GET();

  if (status != 200) {
    Serial.printf("GET /pager/state failed: HTTP %d\n", status);
    http.end();
    return;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();

  if (err) {
    Serial.printf("Failed to parse /pager/state response: %s\n", err.c_str());
    return;
  }

  int openSosCount = doc["openSosCount"] | 0;
  JsonVariant minutesLeft = doc["minutesLeft"];
  JsonArray queue = doc["queue"].as<JsonArray>();

  Serial.println("---- pager/state ----");
  Serial.printf("minutesLeft: %s\n", minutesLeft.isNull() ? "null" : String((int)minutesLeft).c_str());
  Serial.printf("openSosCount: %d\n", openSosCount);
  Serial.printf("queue size: %d\n", queue.size());

  if (queue.size() > 0) {
    JsonObject top = queue[0];
    topQueueTeamId = top["teamId"] | -1;
    const char *teamName = top["teamName"] | "unknown team";
    const char *blocker = top["blocker"] | "";
    const char *helpType = top["helpType"] | "";
    int ageMinutes = top["ageMinutes"] | 0;

    Serial.printf("TOP: [%s] %s — %s (waiting %d min)\n", helpType, teamName, blocker, ageMinutes);
  } else {
    topQueueTeamId = -1;
    Serial.println("Queue empty.");
  }

  // Feedback: solid LED (and a short buzz on transition) while any team is paging now.
  digitalWrite(STATUS_LED_PIN, openSosCount > 0 ? HIGH : LOW);
  if (openSosCount > 0) {
    tone(BUZZER_PIN, 2000, 150);
  }
}

// POST /pager/ack for teamId. Called when the button is pressed.
void ackTeam(int teamId) {
  if (teamId < 0) {
    Serial.println("No team to ack — queue is empty.");
    return;
  }

  HTTPClient http;
  http.begin(String(API_BASE_URL) + "/pager/ack");
  http.addHeader("Content-Type", "application/json");

  JsonDocument body;
  body["teamId"] = teamId;
  String payload;
  serializeJson(body, payload);

  int status = http.POST(payload);
  if (status == 200) {
    Serial.printf("Acked team %d — moderator marked en route.\n", teamId);
  } else {
    Serial.printf("POST /pager/ack failed: HTTP %d\n", status);
  }
  http.end();

  // Re-poll immediately so the queue reflects the ack without waiting for the next tick.
  pollPagerState();
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(ACK_BUTTON_PIN, INPUT_PULLUP);
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  connectWifi();
  pollPagerState();
  lastPollAt = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  unsigned long now = millis();

  if (now - lastPollAt >= POLL_INTERVAL_MS) {
    pollPagerState();
    lastPollAt = now;
  }

  // Active-LOW button with simple debounce.
  if (digitalRead(ACK_BUTTON_PIN) == LOW && (now - lastButtonAt) > BUTTON_DEBOUNCE_MS) {
    lastButtonAt = now;
    ackTeam(topQueueTeamId);
  }
}

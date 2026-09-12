# Waveshare ESP32-S3 pager — firmware stub

A starter sketch for a physical pager that polls the Floor Ops Console's help queue and lets a marshal's helper acknowledge a ticket with a button press. This is a **stub**: it gets you talking to the API correctly, but the display driver, button debouncing, and error handling are intentionally minimal so you can adapt them to your exact board.

Nothing here runs inside the Replit project — you build and flash this onto the device separately, pointed at your running API server.

## What it does

1. Connects to Wi-Fi.
2. Polls `GET /api/pager/state` every 5 seconds.
3. Prints the queue to Serial (and drives a status LED / buzzer if the SOS count is above zero — wire these up per your board).
4. On a button press, sends `POST /api/pager/ack` for the team currently at the top of the queue.

## Hardware assumptions

Written for a Waveshare ESP32-S3 board (e.g. ESP32-S3-DevKitC-1, ESP32-S3-Zero, or an ESP32-S3-Touch-LCD board). All boards in that family run the same Arduino-ESP32 core, but pin numbers differ — **check your board's pinout diagram** and update the `#define`s at the top of `pager_stub.ino` before flashing:

| Stub constant | Default | Purpose |
| --- | --- | --- |
| `ACK_BUTTON_PIN` | `GPIO0` (BOOT button on most Waveshare S3 boards) | Press to acknowledge the top queue item |
| `STATUS_LED_PIN` | `GPIO48` (onboard RGB/WS2812 on many S3 DevKits) | Lit while `openSosCount > 0` |
| `BUZZER_PIN` | `GPIO4` | Optional — pulse briefly on a new page-now item |

If your board has an onboard LCD (e.g. Touch-LCD variants), the stub does not drive it — it only writes to Serial. Wire the parsed `PagerState` fields into your board's display library (e.g. `LovyanGFX`, `Arduino_GFX`, or the vendor SDK) once you've confirmed the API polling works over Serial.

## Requirements

- [Arduino IDE](https://www.arduino.cc/en/software) or PlatformIO with the **esp32 by Espressif Systems** board package installed, board set to your Waveshare ESP32-S3 variant.
- Library: **ArduinoJson** (v7+) — install via Library Manager.
- The API server running and reachable from the device's Wi-Fi network.

## Configure

1. Copy the config template and fill in your values:

   ```bash
   cp pager_config.h.example pager_config.h
   ```

2. Edit `pager_config.h`:

   ```cpp
   #define WIFI_SSID     "your-wifi-name"
   #define WIFI_PASSWORD "your-wifi-password"
   #define API_BASE_URL  "https://your-repl-domain.replit.dev/api"  // or your published domain
   ```

   - While developing, use the workspace's dev domain (`$REPLIT_DEV_DOMAIN` shown in the workspace) — but that URL only stays live while the workspace is open.
   - For a pager that needs to work continuously, publish the project and use the deployed production URL instead (ask the agent for it, or check the Deployments pane).

   `pager_config.h` is git-ignored so your Wi-Fi credentials never get committed — only `pager_config.h.example` is tracked.

3. Open `pager_stub.ino` in the Arduino IDE, select your board and port, and upload.

## API contract this stub uses

From [`lib/api-spec/openapi.yaml`](../../lib/api-spec/openapi.yaml):

**`GET /pager/state`** — polled on a timer, no auth, no body:

```json
{
  "minutesLeft": 42,
  "openSosCount": 1,
  "queue": [
    {
      "ticketId": 7,
      "teamId": 3,
      "teamName": "Null Pointers",
      "tableLabel": "Table 4",
      "blocker": "WiFi won't connect to the ESP32 over BLE",
      "helpType": "page_now",
      "ageMinutes": 6,
      "moderatorEnRoute": false
    }
  ],
  "doNotDisturb": []
}
```

- `queue` is already sorted by urgency (`page_now` before `stuck`); the stub always acks `queue[0]`.
- `helpType` is one of `fine`, `stuck`, `page_now`, `do_not_disturb`.
- `minutesLeft` and a queue item's `ticketId` can be `null` — the stub guards for both.

**`POST /pager/ack`** — sent on button press:

```json
// request
{ "teamId": 3 }

// response: 200 with the updated Team, or 404 if the team no longer exists
```

Acking sets `moderatorEnRoute: true` on the team and logs a system ping on its timeline — the marshal's dashboard reflects it immediately.

## Extending the stub

Left out on purpose, since this is a starting point rather than production firmware:

- Wi-Fi reconnect/backoff beyond the basic retry loop
- TLS certificate pinning (uses the ESP32 core's default trust store)
- Debounced multi-button input for acking a specific team rather than always `queue[0]`
- Deep sleep / battery management
- Driving an actual LCD instead of Serial output

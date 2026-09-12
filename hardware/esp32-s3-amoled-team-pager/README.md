# Waveshare ESP32-S3-Touch-AMOLED-1.8 — team pager

An ESP-IDF firmware project for the [ESP32-S3-Touch-AMOLED-1.8](https://docs.waveshare.com/ESP32-S3-Touch-AMOLED-1.8) meant for **one unit per team**, not the moderator. It lets a team signal their status and leave a spoken update without opening the web console.

This is a different device role from [`hardware/esp32-s3-amoled-pager/`](../esp32-s3-amoled-pager/README.md), which is the moderator-facing queue viewer. Both are built on the same board and BSP; they're separate firmware because they do different jobs.

Nothing here runs inside the Replit project — you build and flash this onto the device separately, pointed at your running API server.

## What it does

1. Connects to Wi-Fi (auto-retries on drop).
2. Shows the team's name and four status buttons: **All good**, **Stuck**, **SOS / Page now**, **Do not disturb**. Tapping one `POST`s `/teams/{TEAM_ID}/pings` with that `helpType` — the same signal a team would otherwise set from the check-in flow.
3. A **hold-to-talk** button at the bottom: press and hold to record (up to 30s), release to stop and upload. The clip is captured via the board's onboard ES8311 mic (`bsp_audio_codec_microphone_init()`), encoded as a 16kHz mono WAV in PSRAM, and `POST`ed to `/teams/{TEAM_ID}/pings/audio` — the server transcribes it locally (whisper.cpp) and summarizes it with Claude onto the team's timeline.

Both the network calls and the audio capture run on dedicated FreeRTOS tasks, not the LVGL/touch task, so neither one freezes the touchscreen.

## Requirements

Same as the moderator pager firmware — see [its README](../esp32-s3-amoled-pager/README.md#requirements) for the ESP-IDF version, serial port notes, and Component Manager behavior.

## Configure

1. Copy the config template:

   ```bash
   cp main/pager_config.h.example main/pager_config.h
   ```

2. Edit `main/pager_config.h`:

   ```c
   #define WIFI_SSID     "your-wifi-name"
   #define WIFI_PASSWORD "your-wifi-password"
   #define API_BASE_URL  "https://your-repl-domain.replit.dev/api"

   #define TEAM_ID   1              // must match a real team's id
   #define TEAM_NAME "Your Team Name"
   ```

   `TEAM_ID` is the team's numeric id in the Floor Ops Console (visible in the URL on that team's dossier page, e.g. `/teams/3` → `TEAM_ID 3`). Each physical unit is configured for exactly one team.

   `pager_config.h` is git-ignored so real credentials never get committed.

## Build and flash

```bash
cd hardware/esp32-s3-amoled-team-pager
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

## Notes on the mic path

- The board's mic is wired through the same ES8311 codec chip as the speaker, using its input (ADC) path — `bsp_audio_codec_microphone_init()` handles the board-specific setup (I2S pins, gain, V1/V2 hardware differences) so this firmware never touches those directly.
- A voice note's HTTP timeout is generous (45s) because the very first upload to a freshly-deployed server triggers a one-time whisper.cpp compile + model download server-side (a couple of minutes); later uploads transcribe in a few seconds.
- Recording is strictly push-to-talk — nothing is captured before the button is pressed or after it's released. There's no ambient/always-listening mode.

## API contract this firmware uses

See [`lib/api-spec/openapi.yaml`](../../lib/api-spec/openapi.yaml):

- **`POST /teams/{teamId}/pings`** — `{"source":"team_signal","helpType":"...","note":"..."}`, response 201 with the created `Ping`.
- **`POST /teams/{teamId}/pings/audio`** — raw `audio/wav` body, response 201 with a `Ping` (`source: "team_audio"`) whose `note` is the server-generated summary.

## Extending

Left out on purpose:

- No playback/confirmation tone through the speaker after a voice note is sent (screen text is the only feedback).
- No re-recording/undo before a voice note uploads — release the button and it sends.
- No offline queueing — a signal or voice note sent while Wi-Fi is down is dropped, not retried.
- TLS certificate pinning (uses the ESP32 core's default trust store).

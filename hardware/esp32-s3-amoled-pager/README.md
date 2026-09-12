# Waveshare ESP32-S3-Touch-AMOLED-1.8 pager

An ESP-IDF firmware project for the [ESP32-S3-Touch-AMOLED-1.8](https://docs.waveshare.com/ESP32-S3-Touch-AMOLED-1.8) that turns the board into a moderator's pager for the Floor Ops Console: it shows the live help queue on the built-in AMOLED and lets the moderator acknowledge the top ticket with a tap.

This is a different board from the generic devkit covered in [`hardware/esp32-s3-pager/`](../esp32-s3-pager/README.md) (that one is Serial-only and works on any ESP32-S3 dev board). This project is specific to the Touch-AMOLED-1.8's QSPI AMOLED panel and touch controller and drives the screen directly.

Nothing here runs inside the Replit project — you build and flash this onto the device separately, pointed at your running API server.

## Why ESP-IDF, not Arduino

The Touch-AMOLED-1.8 has two silicon revisions (V1: SH8601 display / FT3168 touch, V2: CO5300 / CST820) with different QSPI init sequences. Rather than re-deriving those, this project depends on Waveshare's own **managed BSP component** (`waveshare/esp32_s3_touch_amoled_1_8`), which auto-detects the revision and handles panel bring-up, touch, LVGL wiring, and brightness control. The Arduino examples in Waveshare's repo bundle the same driver but don't expose it as a reusable component the way ESP-IDF's component manager does, so ESP-IDF is the more maintainable base here.

## What it does

1. Starts the display via `bsp_display_start()` and builds an LVGL dashboard.
2. Connects to Wi-Fi (auto-retries on drop).
3. Polls `GET /pager/state` every 5 seconds from a background task, showing:
   - Minutes left in the event
   - A red "N PAGING NOW" banner when any team has an active SOS, green "All clear" otherwise
   - The top-of-queue team: name, table, blocker text, `page_now`/`stuck` tag, and wait time
4. A full-width **"On my way"** button that `POST`s `/pager/ack` for that team. The button relabels to "En route" once the server confirms (or "On my way" again if a new team reaches the top).

Network calls run on a dedicated FreeRTOS task, not the LVGL/touch task, so a slow request never freezes the touchscreen.

## Requirements

- [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/get-started/index.html) v5.5–v6.0 (`idf.py`, board target `esp32s3`). The BSP component pins this range in `main/idf_component.yml`.
- The board connects over USB as a native CDC/JTAG serial port (`/dev/ttyACM0` on Linux, no separate USB-serial driver needed).
- The API server running and reachable from the device's Wi-Fi network.

## Configure

1. Copy the config template and fill in your values:

   ```bash
   cp main/pager_config.h.example main/pager_config.h
   ```

2. Edit `main/pager_config.h`:

   ```c
   #define WIFI_SSID     "your-wifi-name"
   #define WIFI_PASSWORD "your-wifi-password"
   #define API_BASE_URL  "https://your-repl-domain.replit.dev/api"
   ```

   - While developing, use the workspace's dev domain (`$REPLIT_DEV_DOMAIN`) — but that URL only stays live while the workspace is open.
   - For a pager that needs to work continuously, publish the project and use the deployed production URL instead.

   `pager_config.h` is git-ignored so your Wi-Fi credentials never get committed — only `pager_config.h.example` is tracked.

## Build and flash

```bash
cd hardware/esp32-s3-amoled-pager
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

The first `idf.py build` downloads the `waveshare/esp32_s3_touch_amoled_1_8` component into `managed_components/` via the ESP-IDF Component Manager — no manual driver setup needed. If your user isn't in the `dialout` group (Linux), either add it (`sudo usermod -aG dialout $USER`, then log out/in) or run flash/monitor with `sudo`.

If the screen stays blank, check the serial monitor log first — a failed `bsp_display_start()` logs an error before the app aborts.

## API contract this firmware uses

Same contract as the generic stub — see [`lib/api-spec/openapi.yaml`](../../lib/api-spec/openapi.yaml) and the [generic stub's README](../esp32-s3-pager/README.md#api-contract-this-stub-uses) for the full request/response shapes of `GET /pager/state` and `POST /pager/ack`.

## Extending

Left out on purpose:

- Only ever acks `queue[0]` — there's no way to scroll to or ack a different team from the device.
- No deep sleep / battery percentage readout, even though the board's AXP2101 PMU supports it.
- No use of the onboard mic, speaker, IMU, RTC, or SD card slot.
- TLS certificate pinning (uses the ESP32 core's default trust store).

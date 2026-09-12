// Floor Ops Console — Waveshare ESP32-S3-Touch-AMOLED-1.8 TEAM pager firmware
//
// One physical unit per team. Lets the team:
//   - Tap a status button (All good / Stuck / Page now / Do not disturb) to
//     POST {API_BASE_URL}/teams/{TEAM_ID}/pings with that helpType.
//   - Hold the mic button to record a short push-to-talk voice note, then
//     POST the WAV clip to {API_BASE_URL}/teams/{TEAM_ID}/pings/audio on
//     release -- the server transcribes and summarizes it onto the team's
//     timeline.
//
// Built on the board's official managed BSP component
// (waveshare/esp32_s3_touch_amoled_1_8) for display/touch, and its
// documented bsp_audio_codec_microphone_init() for the ES8311 mic path.
//
// Copy pager_config.h.example to pager_config.h and fill in your Wi-Fi,
// API base URL, TEAM_ID, and TEAM_NAME before building.

#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "bsp/esp-bsp.h"
#include "lvgl.h"

#include "pager_config.h"

static const char *TAG = "floor_ops_team_pager";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1
#define WIFI_MAXIMUM_RETRY 5

#define HTTP_TIMEOUT_MS 8000
#define VOICE_UPLOAD_TIMEOUT_MS 45000 // server-side transcription + summarization can take a while

// ---- Voice note recording ----
#define WAV_SAMPLE_RATE 16000
#define WAV_BITS_PER_SAMPLE 16
#define WAV_CHANNELS 1
#define WAV_HEADER_SIZE 44
#define MAX_RECORD_SECONDS 30
#define MAX_RECORD_BYTES (WAV_SAMPLE_RATE * (WAV_BITS_PER_SAMPLE / 8) * WAV_CHANNELS * MAX_RECORD_SECONDS)
#define RECORD_CHUNK_BYTES 1024

static EventGroupHandle_t s_wifi_event_group;
static int s_wifi_retry_num = 0;

static esp_codec_dev_handle_t s_mic_dev;
static uint8_t *s_audio_buf; // WAV_HEADER_SIZE + MAX_RECORD_BYTES, in PSRAM
static SemaphoreHandle_t s_record_start_sem;
static volatile bool s_recording = false;

static QueueHandle_t s_signal_queue; // holds a `const char *` help-type literal

static lv_obj_t *s_wifi_dot;
static lv_obj_t *s_status_label;
static lv_obj_t *s_signal_status_label;
static lv_obj_t *s_mic_button;
static lv_obj_t *s_mic_button_label;

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

static void ui_set_signal_status(const char *text) {
    lv_label_set_text(s_signal_status_label, text);
}

static void ui_set_wifi_ok(bool ok, bool connecting) {
    if (bsp_display_lock(pdMS_TO_TICKS(500))) {
        lv_obj_set_style_bg_color(s_wifi_dot, lv_color_hex(ok ? 0x2ecc71 : (connecting ? 0x8ba3bd : 0xb3261e)),
                                   LV_PART_MAIN);
        lv_label_set_text(s_status_label, connecting ? "Connecting to Wi-Fi..." : (ok ? "Online" : "Offline"));
        bsp_display_unlock();
    }
}

static void signal_button_event_cb(lv_event_t *e) {
    const char *help_type = (const char *)lv_event_get_user_data(e);
    ui_set_signal_status("Sending...");
    xQueueOverwrite(s_signal_queue, &help_type);
}

static lv_obj_t *ui_make_signal_button(lv_obj_t *parent, int x, int y, int w, int h, uint32_t color,
                                        const char *label, const char *help_type) {
    lv_obj_t *button = lv_button_create(parent);
    lv_obj_set_size(button, w, h);
    lv_obj_set_pos(button, x, y);
    lv_obj_set_style_bg_color(button, lv_color_hex(color), LV_PART_MAIN);
    lv_obj_set_style_radius(button, 12, LV_PART_MAIN);
    lv_obj_add_event_cb(button, signal_button_event_cb, LV_EVENT_CLICKED, (void *)help_type);

    lv_obj_t *lv_label = lv_label_create(button);
    lv_label_set_text(lv_label, label);
    lv_label_set_long_mode(lv_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(lv_label, w - 16);
    lv_obj_set_style_text_align(lv_label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_center(lv_label);

    return button;
}

static void mic_button_event_cb(lv_event_t *e) {
    lv_event_code_t code = lv_event_get_code(e);

    if (code == LV_EVENT_PRESSED) {
        if (s_recording) {
            return;
        }
        s_recording = true;
        lv_label_set_text(s_mic_button_label, "Recording...");
        lv_obj_set_style_bg_color(s_mic_button, lv_color_hex(0xb3261e), LV_PART_MAIN);
        xSemaphoreGive(s_record_start_sem);
    } else if (code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST) {
        if (!s_recording) {
            return;
        }
        s_recording = false;
        lv_label_set_text(s_mic_button_label, "Sending...");
        lv_obj_set_style_bg_color(s_mic_button, lv_color_hex(0x2f9bff), LV_PART_MAIN);
    }
}

static void ui_create(void) {
    lv_obj_t *screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_hex(0x08111f), LV_PART_MAIN);
    lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *title = lv_label_create(screen);
    lv_label_set_text(title, TEAM_NAME);
    lv_obj_set_style_text_color(title, lv_color_hex(0xffffff), LV_PART_MAIN);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_24, LV_PART_MAIN);
    lv_obj_set_width(title, 300);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 16, 20);

    s_wifi_dot = lv_obj_create(screen);
    lv_obj_set_size(s_wifi_dot, 14, 14);
    lv_obj_set_style_radius(s_wifi_dot, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_border_width(s_wifi_dot, 0, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_wifi_dot, lv_color_hex(0x8ba3bd), LV_PART_MAIN);
    lv_obj_clear_flag(s_wifi_dot, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_align(s_wifi_dot, LV_ALIGN_TOP_RIGHT, -16, 24);

    s_status_label = lv_label_create(screen);
    lv_label_set_text(s_status_label, "Connecting to Wi-Fi...");
    lv_obj_set_style_text_color(s_status_label, lv_color_hex(0x8ba3bd), LV_PART_MAIN);
    lv_obj_align(s_status_label, LV_ALIGN_TOP_LEFT, 16, 56);

    // 2x2 grid of help-signal buttons.
    const int grid_top = 96;
    const int col_w = 160;
    const int row_h = 92;
    const int gap = 16;
    const int left_x = 16;
    const int right_x = left_x + col_w + gap;

    ui_make_signal_button(screen, left_x, grid_top, col_w, row_h, 0x1d3b2a, "All good", "fine");
    ui_make_signal_button(screen, right_x, grid_top, col_w, row_h, 0xa15c07, "Stuck", "stuck");
    ui_make_signal_button(screen, left_x, grid_top + row_h + gap, col_w, row_h, 0xb3261e, "SOS\nPage now",
                           "page_now");
    ui_make_signal_button(screen, right_x, grid_top + row_h + gap, col_w, row_h, 0x3d5266, "Do not\ndisturb",
                           "do_not_disturb");

    s_signal_status_label = lv_label_create(screen);
    lv_label_set_text(s_signal_status_label, "");
    lv_obj_set_style_text_color(s_signal_status_label, lv_color_hex(0x8ba3bd), LV_PART_MAIN);
    lv_obj_align(s_signal_status_label, LV_ALIGN_TOP_MID, 0, grid_top + 2 * row_h + gap + 12);

    s_mic_button = lv_button_create(screen);
    lv_obj_set_size(s_mic_button, 336, 64);
    lv_obj_align(s_mic_button, LV_ALIGN_BOTTOM_MID, 0, -20);
    lv_obj_set_style_bg_color(s_mic_button, lv_color_hex(0x2f9bff), LV_PART_MAIN);
    lv_obj_set_style_radius(s_mic_button, 14, LV_PART_MAIN);
    lv_obj_add_event_cb(s_mic_button, mic_button_event_cb, LV_EVENT_PRESSED, NULL);
    lv_obj_add_event_cb(s_mic_button, mic_button_event_cb, LV_EVENT_RELEASED, NULL);
    lv_obj_add_event_cb(s_mic_button, mic_button_event_cb, LV_EVENT_PRESS_LOST, NULL);

    s_mic_button_label = lv_label_create(s_mic_button);
    lv_label_set_text(s_mic_button_label, "Hold to talk");
    lv_obj_center(s_mic_button_label);
}

// ---------------------------------------------------------------------------
// Wi-Fi (same pattern as the moderator pager firmware)
// ---------------------------------------------------------------------------

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        if (s_wifi_retry_num < WIFI_MAXIMUM_RETRY) {
            esp_wifi_connect();
            s_wifi_retry_num++;
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_wifi_retry_num = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        ui_set_wifi_ok(true, false);
    }
}

static void wifi_start(void) {
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(
        esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(
        esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta =
            {
                .ssid = WIFI_SSID,
                .password = WIFI_PASSWORD,
                .threshold.authmode = WIFI_AUTH_WPA2_PSK,
                .sae_pwe_h2e = WPA3_SAE_PWE_BOTH,
            },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
}

// ---------------------------------------------------------------------------
// Help-signal buttons -> POST /teams/{TEAM_ID}/pings
// ---------------------------------------------------------------------------

static bool send_help_signal(const char *help_type) {
    char url[256];
    snprintf(url, sizeof(url), "%s/teams/%d/pings", API_BASE_URL, TEAM_ID);

    char payload[192];
    snprintf(payload, sizeof(payload),
             "{\"source\":\"team_signal\",\"helpType\":\"%s\",\"note\":\"Team signaled from their pager.\"}",
             help_type);

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, payload, strlen(payload));

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status != 201) {
        ESP_LOGW(TAG, "POST /pings failed: err=%s status=%d", esp_err_to_name(err), status);
        return false;
    }
    return true;
}

static void signal_task(void *arg) {
    (void)arg;
    while (true) {
        const char *help_type = NULL;
        if (xQueueReceive(s_signal_queue, &help_type, portMAX_DELAY) == pdTRUE && help_type != NULL) {
            bool ok = send_help_signal(help_type);
            if (bsp_display_lock(pdMS_TO_TICKS(500))) {
                ui_set_signal_status(ok ? "Sent" : "Send failed -- check Wi-Fi");
                bsp_display_unlock();
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Voice notes: mic capture -> WAV -> POST /teams/{TEAM_ID}/pings/audio
// ---------------------------------------------------------------------------

static void write_le16(uint8_t *out, uint16_t value) {
    out[0] = (uint8_t)(value & 0xFF);
    out[1] = (uint8_t)((value >> 8) & 0xFF);
}

static void write_le32(uint8_t *out, uint32_t value) {
    out[0] = (uint8_t)(value & 0xFF);
    out[1] = (uint8_t)((value >> 8) & 0xFF);
    out[2] = (uint8_t)((value >> 16) & 0xFF);
    out[3] = (uint8_t)((value >> 24) & 0xFF);
}

// Writes a canonical 44-byte PCM WAV header for `pcm_bytes` of audio
// already sitting at buf[WAV_HEADER_SIZE..].
static void write_wav_header(uint8_t *buf, uint32_t pcm_bytes) {
    const uint32_t byte_rate = WAV_SAMPLE_RATE * WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);
    const uint16_t block_align = WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);

    memcpy(buf + 0, "RIFF", 4);
    write_le32(buf + 4, 36 + pcm_bytes);
    memcpy(buf + 8, "WAVE", 4);
    memcpy(buf + 12, "fmt ", 4);
    write_le32(buf + 16, 16);
    write_le16(buf + 20, 1); // PCM
    write_le16(buf + 22, WAV_CHANNELS);
    write_le32(buf + 24, WAV_SAMPLE_RATE);
    write_le32(buf + 28, byte_rate);
    write_le16(buf + 32, block_align);
    write_le16(buf + 34, WAV_BITS_PER_SAMPLE);
    memcpy(buf + 36, "data", 4);
    write_le32(buf + 40, pcm_bytes);
}

static bool upload_voice_note(const uint8_t *data, size_t len) {
    char url[256];
    snprintf(url, sizeof(url), "%s/teams/%d/pings/audio", API_BASE_URL, TEAM_ID);

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = VOICE_UPLOAD_TIMEOUT_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_header(client, "Content-Type", "audio/wav");
    esp_http_client_set_post_field(client, (const char *)data, len);

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status != 201) {
        ESP_LOGW(TAG, "POST /pings/audio failed: err=%s status=%d", esp_err_to_name(err), status);
        return false;
    }
    return true;
}

static void recorder_task(void *arg) {
    (void)arg;

    while (true) {
        xSemaphoreTake(s_record_start_sem, portMAX_DELAY);

        esp_codec_dev_sample_info_t fs = {
            .bits_per_sample = WAV_BITS_PER_SAMPLE,
            .channel = WAV_CHANNELS,
            .channel_mask = 0,
            .sample_rate = WAV_SAMPLE_RATE,
        };

        if (esp_codec_dev_open(s_mic_dev, &fs) != ESP_CODEC_DEV_OK) {
            ESP_LOGE(TAG, "Failed to open microphone codec");
            s_recording = false;
            if (bsp_display_lock(pdMS_TO_TICKS(500))) {
                lv_label_set_text(s_mic_button_label, "Mic error");
                bsp_display_unlock();
            }
            continue;
        }

        size_t offset = WAV_HEADER_SIZE;
        const size_t max_offset = WAV_HEADER_SIZE + MAX_RECORD_BYTES;

        while (s_recording && offset + RECORD_CHUNK_BYTES <= max_offset) {
            if (esp_codec_dev_read(s_mic_dev, s_audio_buf + offset, RECORD_CHUNK_BYTES) != ESP_CODEC_DEV_OK) {
                ESP_LOGW(TAG, "esp_codec_dev_read failed mid-recording");
                break;
            }
            offset += RECORD_CHUNK_BYTES;
        }

        esp_codec_dev_close(s_mic_dev);

        uint32_t pcm_bytes = (uint32_t)(offset - WAV_HEADER_SIZE);
        write_wav_header(s_audio_buf, pcm_bytes);

        ESP_LOGI(TAG, "Captured %lu ms of audio, uploading...",
                 (unsigned long)(pcm_bytes * 1000UL / (WAV_SAMPLE_RATE * WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8))));

        bool ok = upload_voice_note(s_audio_buf, WAV_HEADER_SIZE + pcm_bytes);

        if (bsp_display_lock(pdMS_TO_TICKS(500))) {
            lv_label_set_text(s_mic_button_label, ok ? "Sent -- hold to talk" : "Send failed -- hold to talk");
            bsp_display_unlock();
        }
    }
}

void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    s_signal_queue = xQueueCreate(1, sizeof(const char *));
    s_record_start_sem = xSemaphoreCreateBinary();

    s_audio_buf = heap_caps_malloc(WAV_HEADER_SIZE + MAX_RECORD_BYTES, MALLOC_CAP_SPIRAM);
    if (s_audio_buf == NULL) {
        ESP_LOGE(TAG, "Failed to allocate %d bytes of PSRAM for the audio buffer", WAV_HEADER_SIZE + MAX_RECORD_BYTES);
        abort();
    }

    s_mic_dev = bsp_audio_codec_microphone_init();
    if (s_mic_dev == NULL) {
        ESP_LOGE(TAG, "Failed to initialize microphone codec");
    }

    lv_display_t *display = bsp_display_start();
    if (display == NULL) {
        ESP_LOGE(TAG, "Display initialization failed");
        abort();
    }
    ESP_ERROR_CHECK(bsp_display_brightness_set(85));

    if (bsp_display_lock(pdMS_TO_TICKS(1000))) {
        ui_create();
        bsp_display_unlock();
    } else {
        ESP_LOGE(TAG, "Could not lock LVGL to build the dashboard");
    }

    wifi_start();
    xTaskCreate(signal_task, "signal_task", 4096, NULL, 5, NULL);
    xTaskCreate(recorder_task, "recorder_task", 8192, NULL, 5, NULL);

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

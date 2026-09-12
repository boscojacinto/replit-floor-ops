// Floor Ops Console — Waveshare ESP32-S3-Touch-AMOLED-1.8 pager firmware
//
// Built on the board's official managed BSP component
// (waveshare/esp32_s3_touch_amoled_1_8), which brings up the QSPI AMOLED
// panel, I2C touch controller, and LVGL port. This file only adds:
//   - Wi-Fi station connect
//   - a background task polling GET {API_BASE_URL}/pager/state
//   - an LVGL dashboard showing the top of the help queue
//   - a touch button that POSTs {API_BASE_URL}/pager/ack for that team
//
// See README.md in this directory for the API contract and setup steps.
// Copy pager_config.h.example to pager_config.h and fill in your Wi-Fi +
// API base URL before building.

#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "bsp/esp-bsp.h"
#include "cJSON.h"
#include "lvgl.h"

#include "pager_config.h"

static const char *TAG = "floor_ops_pager";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1
#define WIFI_MAXIMUM_RETRY 5

#define POLL_INTERVAL_MS 5000
#define HTTP_TIMEOUT_MS 5000
#define HTTP_RESPONSE_BUFFER_SIZE 4096

// ---------------------------------------------------------------------------
// Shared state between the pager task (network + JSON) and the LVGL UI.
// Only `s_top_team_id` is touched from the touch-event callback (LVGL task);
// everything else that reaches the screen goes through bsp_display_lock().
// ---------------------------------------------------------------------------

typedef struct {
    bool has_minutes_left;
    int minutes_left;
    int open_sos_count;

    bool has_top;
    int top_team_id;
    char team_name[32];
    char table_label[24];
    char blocker[160];
    char help_type[16];
    int age_minutes;
    bool moderator_en_route;
} pager_state_t;

typedef struct {
    char *buf;
    int len;
    int cap;
} http_response_ctx_t;

static volatile int s_top_team_id = -1;
static QueueHandle_t s_ack_queue;
static EventGroupHandle_t s_wifi_event_group;
static int s_wifi_retry_num = 0;

static lv_obj_t *s_wifi_dot;
static lv_obj_t *s_status_label;
static lv_obj_t *s_minutes_label;
static lv_obj_t *s_sos_banner;
static lv_obj_t *s_sos_label;
static lv_obj_t *s_team_name_label;
static lv_obj_t *s_meta_label;
static lv_obj_t *s_help_type_tag;
static lv_obj_t *s_blocker_label;
static lv_obj_t *s_ack_button;
static lv_obj_t *s_ack_button_label;

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

static lv_obj_t *ui_make_card(lv_obj_t *parent, int y, int height) {
    lv_obj_t *card = lv_obj_create(parent);
    lv_obj_set_size(card, 336, height);
    lv_obj_align(card, LV_ALIGN_TOP_MID, 0, y);
    lv_obj_set_style_radius(card, 14, LV_PART_MAIN);
    lv_obj_set_style_bg_color(card, lv_color_hex(0x182433), LV_PART_MAIN);
    lv_obj_set_style_border_color(card, lv_color_hex(0x2f4a63), LV_PART_MAIN);
    lv_obj_set_style_border_width(card, 1, LV_PART_MAIN);
    lv_obj_set_style_pad_all(card, 14, LV_PART_MAIN);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
    return card;
}

static void ack_button_event_cb(lv_event_t *e) {
    (void)e;
    int team_id = s_top_team_id;
    if (team_id < 0) {
        return;
    }

    lv_label_set_text(s_ack_button_label, "Sending...");
    lv_obj_add_state(s_ack_button, LV_STATE_DISABLED);

    // Hand off to the pager task rather than doing the POST here — this
    // callback runs on the LVGL task, and a multi-second HTTP call here
    // would freeze touch handling for the whole board.
    xQueueOverwrite(s_ack_queue, &team_id);
}

static void ui_create(void) {
    lv_obj_t *screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_hex(0x08111f), LV_PART_MAIN);
    lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *title = lv_label_create(screen);
    lv_label_set_text(title, "FLOOR OPS PAGER");
    lv_obj_set_style_text_color(title, lv_color_hex(0xffffff), LV_PART_MAIN);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 16, 20);

    s_wifi_dot = lv_obj_create(screen);
    lv_obj_set_size(s_wifi_dot, 14, 14);
    lv_obj_set_style_radius(s_wifi_dot, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_border_width(s_wifi_dot, 0, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_wifi_dot, lv_color_hex(0x8ba3bd), LV_PART_MAIN);
    lv_obj_clear_flag(s_wifi_dot, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_align(s_wifi_dot, LV_ALIGN_TOP_RIGHT, -16, 22);

    s_status_label = lv_label_create(screen);
    lv_label_set_text(s_status_label, "Connecting to Wi-Fi...");
    lv_obj_set_style_text_color(s_status_label, lv_color_hex(0x8ba3bd), LV_PART_MAIN);
    lv_obj_align(s_status_label, LV_ALIGN_TOP_LEFT, 16, 44);

    lv_obj_t *time_card = ui_make_card(screen, 72, 88);
    lv_obj_t *time_title = lv_label_create(time_card);
    lv_label_set_text(time_title, "TIME LEFT");
    lv_obj_set_style_text_color(time_title, lv_color_hex(0x8bd3ff), LV_PART_MAIN);
    lv_obj_align(time_title, LV_ALIGN_TOP_LEFT, 0, 0);

    s_minutes_label = lv_label_create(time_card);
    lv_label_set_text(s_minutes_label, "--");
    lv_obj_set_style_text_color(s_minutes_label, lv_color_hex(0xffffff), LV_PART_MAIN);
    lv_obj_set_style_text_font(s_minutes_label, &lv_font_montserrat_32, LV_PART_MAIN);
    lv_obj_align(s_minutes_label, LV_ALIGN_BOTTOM_LEFT, 0, 0);

    s_sos_banner = lv_obj_create(screen);
    lv_obj_set_size(s_sos_banner, 336, 44);
    lv_obj_align(s_sos_banner, LV_ALIGN_TOP_MID, 0, 172);
    lv_obj_set_style_radius(s_sos_banner, 10, LV_PART_MAIN);
    lv_obj_set_style_border_width(s_sos_banner, 0, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_sos_banner, lv_color_hex(0x1d3b2a), LV_PART_MAIN);
    lv_obj_clear_flag(s_sos_banner, LV_OBJ_FLAG_SCROLLABLE);

    s_sos_label = lv_label_create(s_sos_banner);
    lv_label_set_text(s_sos_label, "All clear");
    lv_obj_set_style_text_color(s_sos_label, lv_color_hex(0xffffff), LV_PART_MAIN);
    lv_obj_center(s_sos_label);

    lv_obj_t *team_card = ui_make_card(screen, 232, 152);
    lv_obj_t *team_title = lv_label_create(team_card);
    lv_label_set_text(team_title, "NEXT UP");
    lv_obj_set_style_text_color(team_title, lv_color_hex(0x8bd3ff), LV_PART_MAIN);
    lv_obj_align(team_title, LV_ALIGN_TOP_LEFT, 0, 0);

    s_help_type_tag = lv_label_create(team_card);
    lv_label_set_text(s_help_type_tag, "");
    lv_obj_set_style_text_color(s_help_type_tag, lv_color_hex(0xffffff), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_help_type_tag, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_help_type_tag, lv_color_hex(0x4a5568), LV_PART_MAIN);
    lv_obj_set_style_radius(s_help_type_tag, 6, LV_PART_MAIN);
    lv_obj_set_style_pad_hor(s_help_type_tag, 8, LV_PART_MAIN);
    lv_obj_set_style_pad_ver(s_help_type_tag, 2, LV_PART_MAIN);
    lv_obj_align(s_help_type_tag, LV_ALIGN_TOP_RIGHT, 0, 0);

    s_team_name_label = lv_label_create(team_card);
    lv_label_set_text(s_team_name_label, "Queue is empty");
    lv_obj_set_style_text_color(s_team_name_label, lv_color_hex(0xffffff), LV_PART_MAIN);
    lv_obj_set_style_text_font(s_team_name_label, &lv_font_montserrat_24, LV_PART_MAIN);
    lv_obj_set_width(s_team_name_label, 240);
    lv_obj_align(s_team_name_label, LV_ALIGN_TOP_LEFT, 0, 30);

    s_meta_label = lv_label_create(team_card);
    lv_label_set_text(s_meta_label, "");
    lv_obj_set_style_text_color(s_meta_label, lv_color_hex(0x8ba3bd), LV_PART_MAIN);
    lv_obj_align(s_meta_label, LV_ALIGN_TOP_LEFT, 0, 62);

    s_blocker_label = lv_label_create(team_card);
    lv_label_set_text(s_blocker_label, "");
    lv_label_set_long_mode(s_blocker_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(s_blocker_label, 306);
    lv_obj_set_style_text_color(s_blocker_label, lv_color_hex(0xdce9f5), LV_PART_MAIN);
    lv_obj_align(s_blocker_label, LV_ALIGN_TOP_LEFT, 0, 88);

    s_ack_button = lv_button_create(screen);
    lv_obj_set_size(s_ack_button, 336, 48);
    lv_obj_align(s_ack_button, LV_ALIGN_TOP_MID, 0, 396);
    lv_obj_set_style_bg_color(s_ack_button, lv_color_hex(0x2f9bff), LV_PART_MAIN);
    lv_obj_add_state(s_ack_button, LV_STATE_DISABLED);
    lv_obj_add_event_cb(s_ack_button, ack_button_event_cb, LV_EVENT_CLICKED, NULL);

    s_ack_button_label = lv_label_create(s_ack_button);
    lv_label_set_text(s_ack_button_label, "On my way");
    lv_obj_center(s_ack_button_label);
}

// Update the on-screen dashboard from a freshly-polled state. Must be called
// with bsp_display_lock() held.
static void ui_apply_state(const pager_state_t *state) {
    if (state->has_minutes_left) {
        char text[16];
        snprintf(text, sizeof(text), "%d min", state->minutes_left);
        lv_label_set_text(s_minutes_label, text);
    } else {
        lv_label_set_text(s_minutes_label, "--");
    }

    if (state->open_sos_count > 0) {
        char text[32];
        snprintf(text, sizeof(text), "%d PAGING NOW", state->open_sos_count);
        lv_label_set_text(s_sos_label, text);
        lv_obj_set_style_bg_color(s_sos_banner, lv_color_hex(0xb3261e), LV_PART_MAIN);
    } else {
        lv_label_set_text(s_sos_label, "All clear");
        lv_obj_set_style_bg_color(s_sos_banner, lv_color_hex(0x1d3b2a), LV_PART_MAIN);
    }

    if (state->has_top) {
        lv_label_set_text(s_team_name_label, state->team_name);

        char meta[64];
        snprintf(meta, sizeof(meta), "%s - waiting %d min",
                 state->table_label[0] ? state->table_label : "No table",
                 state->age_minutes);
        lv_label_set_text(s_meta_label, meta);

        lv_label_set_text(s_blocker_label, state->blocker);

        if (strcmp(state->help_type, "page_now") == 0) {
            lv_label_set_text(s_help_type_tag, "PAGE NOW");
            lv_obj_set_style_bg_color(s_help_type_tag, lv_color_hex(0xb3261e), LV_PART_MAIN);
        } else {
            lv_label_set_text(s_help_type_tag, "STUCK");
            lv_obj_set_style_bg_color(s_help_type_tag, lv_color_hex(0xa15c07), LV_PART_MAIN);
        }

        lv_obj_clear_state(s_ack_button, LV_STATE_DISABLED);
        if (state->moderator_en_route) {
            lv_label_set_text(s_ack_button_label, "En route - tap to re-ping");
            lv_obj_set_style_bg_color(s_ack_button, lv_color_hex(0x3d5266), LV_PART_MAIN);
        } else {
            lv_label_set_text(s_ack_button_label, "On my way");
            lv_obj_set_style_bg_color(s_ack_button, lv_color_hex(0x2f9bff), LV_PART_MAIN);
        }
    } else {
        lv_label_set_text(s_team_name_label, "Queue is empty");
        lv_label_set_text(s_meta_label, "");
        lv_label_set_text(s_blocker_label, "");
        lv_label_set_text(s_help_type_tag, "");
        lv_label_set_text(s_ack_button_label, "On my way");
        lv_obj_set_style_bg_color(s_ack_button, lv_color_hex(0x2f9bff), LV_PART_MAIN);
        lv_obj_add_state(s_ack_button, LV_STATE_DISABLED);
    }
}

static void ui_set_wifi_ok(bool ok, bool connecting) {
    if (bsp_display_lock(pdMS_TO_TICKS(500))) {
        lv_obj_set_style_bg_color(s_wifi_dot, lv_color_hex(ok ? 0x2ecc71 : (connecting ? 0x8ba3bd : 0xb3261e)),
                                   LV_PART_MAIN);
        if (connecting) {
            lv_label_set_text(s_status_label, "Connecting to Wi-Fi...");
        } else {
            lv_label_set_text(s_status_label, ok ? "Online" : "Offline - retrying...");
        }
        bsp_display_unlock();
    }
}

// ---------------------------------------------------------------------------
// Wi-Fi
// ---------------------------------------------------------------------------

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        if (s_wifi_retry_num < WIFI_MAXIMUM_RETRY) {
            esp_wifi_connect();
            s_wifi_retry_num++;
            ESP_LOGI(TAG, "Retrying Wi-Fi connection (%d/%d)", s_wifi_retry_num, WIFI_MAXIMUM_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_wifi_retry_num = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

// Connects (or times out retrying) then returns immediately. Reconnects are
// handled in the background by the event handler above.
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
// HTTP + JSON
// ---------------------------------------------------------------------------

static esp_err_t http_event_handler(esp_http_client_event_t *evt) {
    if (evt->event_id != HTTP_EVENT_ON_DATA) {
        return ESP_OK;
    }

    http_response_ctx_t *ctx = (http_response_ctx_t *)evt->user_data;
    if (ctx == NULL || esp_http_client_is_chunked_response(evt->client)) {
        return ESP_OK;
    }

    int copy_len = evt->data_len;
    if (ctx->len + copy_len > ctx->cap - 1) {
        copy_len = ctx->cap - 1 - ctx->len;
    }
    if (copy_len > 0) {
        memcpy(ctx->buf + ctx->len, evt->data, copy_len);
        ctx->len += copy_len;
        ctx->buf[ctx->len] = '\0';
    }
    return ESP_OK;
}

static void copy_string_field(const cJSON *obj, const char *key, char *out, size_t out_size, const char *fallback) {
    const cJSON *field = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsString(field) && field->valuestring != NULL) {
        strncpy(out, field->valuestring, out_size - 1);
        out[out_size - 1] = '\0';
    } else {
        strncpy(out, fallback, out_size - 1);
        out[out_size - 1] = '\0';
    }
}

// GET /pager/state, parse it, and refresh the dashboard.
static void poll_pager_state(void) {
    static char resp_buf[HTTP_RESPONSE_BUFFER_SIZE];
    http_response_ctx_t ctx = {.buf = resp_buf, .len = 0, .cap = sizeof(resp_buf)};

    char url[256];
    snprintf(url, sizeof(url), "%s/pager/state", API_BASE_URL);

    esp_http_client_config_t config = {
        .url = url,
        .event_handler = http_event_handler,
        .user_data = &ctx,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status != 200) {
        ESP_LOGW(TAG, "GET /pager/state failed: err=%s status=%d", esp_err_to_name(err), status);
        ui_set_wifi_ok(false, false);
        return;
    }

    cJSON *root = cJSON_Parse(ctx.buf);
    if (root == NULL) {
        ESP_LOGW(TAG, "Failed to parse /pager/state JSON");
        return;
    }

    pager_state_t state = {0};

    cJSON *minutes_left = cJSON_GetObjectItemCaseSensitive(root, "minutesLeft");
    state.has_minutes_left = cJSON_IsNumber(minutes_left);
    state.minutes_left = state.has_minutes_left ? minutes_left->valueint : 0;

    cJSON *open_sos = cJSON_GetObjectItemCaseSensitive(root, "openSosCount");
    state.open_sos_count = cJSON_IsNumber(open_sos) ? open_sos->valueint : 0;

    cJSON *queue = cJSON_GetObjectItemCaseSensitive(root, "queue");
    cJSON *top = (cJSON_IsArray(queue) && cJSON_GetArraySize(queue) > 0) ? cJSON_GetArrayItem(queue, 0) : NULL;

    state.top_team_id = -1;
    if (top != NULL) {
        state.has_top = true;

        cJSON *team_id = cJSON_GetObjectItemCaseSensitive(top, "teamId");
        state.top_team_id = cJSON_IsNumber(team_id) ? team_id->valueint : -1;

        copy_string_field(top, "teamName", state.team_name, sizeof(state.team_name), "Unknown team");
        copy_string_field(top, "tableLabel", state.table_label, sizeof(state.table_label), "");
        copy_string_field(top, "blocker", state.blocker, sizeof(state.blocker), "");
        copy_string_field(top, "helpType", state.help_type, sizeof(state.help_type), "stuck");

        cJSON *age = cJSON_GetObjectItemCaseSensitive(top, "ageMinutes");
        state.age_minutes = cJSON_IsNumber(age) ? age->valueint : 0;

        cJSON *en_route = cJSON_GetObjectItemCaseSensitive(top, "moderatorEnRoute");
        state.moderator_en_route = cJSON_IsTrue(en_route);
    }

    cJSON_Delete(root);

    s_top_team_id = state.top_team_id;
    ui_set_wifi_ok(true, false);

    if (bsp_display_lock(pdMS_TO_TICKS(500))) {
        ui_apply_state(&state);
        bsp_display_unlock();
    }
}

// POST /pager/ack for teamId. The board's next poll (right after this call
// returns) reflects the update, so there's no separate "ack succeeded" UI
// state — ui_apply_state() picks up moderatorEnRoute on the next refresh.
static void ack_team(int team_id) {
    char url[256];
    snprintf(url, sizeof(url), "%s/pager/ack", API_BASE_URL);

    char payload[64];
    snprintf(payload, sizeof(payload), "{\"teamId\":%d}", team_id);

    static char resp_buf[512];
    http_response_ctx_t ctx = {.buf = resp_buf, .len = 0, .cap = sizeof(resp_buf)};

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .event_handler = http_event_handler,
        .user_data = &ctx,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, payload, strlen(payload));

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status != 200) {
        ESP_LOGW(TAG, "POST /pager/ack failed: err=%s status=%d", esp_err_to_name(err), status);
    } else {
        ESP_LOGI(TAG, "Acked team %d", team_id);
    }
}

// ---------------------------------------------------------------------------
// Pager task — owns all network I/O so the LVGL/touch task never blocks on it
// ---------------------------------------------------------------------------

static void pager_task(void *arg) {
    (void)arg;

    poll_pager_state();

    while (true) {
        int ack_team_id;
        if (xQueueReceive(s_ack_queue, &ack_team_id, pdMS_TO_TICKS(POLL_INTERVAL_MS)) == pdTRUE) {
            ack_team(ack_team_id);
        }
        poll_pager_state();
    }
}

void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    s_ack_queue = xQueueCreate(1, sizeof(int));

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
    xTaskCreate(pager_task, "pager_task", 8192, NULL, 5, NULL);

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

idf_component_register(
    SRCS "pager_main.c"
    INCLUDE_DIRS "."
    REQUIRES esp32_s3_touch_amoled_1_8 esp_wifi esp_netif esp_event nvs_flash esp_http_client json)
target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-error=shift-count-negative)

idf_component_get_property(LVGL_LIB lvgl__lvgl COMPONENT_LIB)
if(TARGET ${LVGL_LIB})
    target_compile_options(${LVGL_LIB} PRIVATE -Wno-error=attributes)
endif()

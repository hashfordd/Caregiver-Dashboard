#include "LVGL_Example.h"

/*
  Patient Monitor UI for Watch_Code_Broadcast_LVGL_Module.ino

  Displays the real values produced by Watch_Code_Broadcast.ino:
  - GPS status, latitude, longitude, satellites
  - MAX30102 IR / BPM / average BPM / finger status
  - IMU acceleration summary
  - BLE device count
  - Local LiPo battery voltage / estimate
  - MQTT connection and last publish status
  - Real MAX30102 PPG waveform

  Note:
  MAX30102 measures PPG, not ECG. The chart below is the live IR pulse signal.
*/

// These globals are required by the original Waveshare project.
// Simulated_Gesture.cpp references them, so keep them even if this UI does not use the original gesture demo.
lv_obj_t *Page_panel[50];
lv_obj_t *Simulated_panel1[100];
size_t Simulated_panel1_Size = 0;

// ================= LVGL objects =================
static lv_obj_t *label_title;
static lv_obj_t *label_status;
static lv_obj_t *label_battery_value;
static lv_obj_t *battery_shell;
static lv_obj_t *bar_battery;
static lv_obj_t *battery_cap;
static lv_obj_t *status_dot;

static lv_obj_t *label_heart_icon;
static lv_color_t heart_canvas_buf[44 * 44];
static lv_obj_t *label_raw_heading;
static lv_obj_t *label_avg_heading;
static lv_obj_t *label_hr_value;
static lv_obj_t *label_avg_value;
static lv_obj_t *label_finger_value;
static lv_obj_t *label_gps_value;
static lv_obj_t *label_ble_value;
static lv_obj_t *label_lat_value;
static lv_obj_t *label_lng_value;
static lv_obj_t *label_sat_value;
static lv_obj_t *label_imu_value;
static lv_obj_t *label_ir_value;
static lv_obj_t *label_chart_caption;
static lv_obj_t *sos_overlay;
static lv_obj_t *label_sos;

static lv_obj_t *chart_ppg;
static lv_chart_series_t *ppg_series;

static lv_timer_t *ppg_timer = NULL;
static lv_timer_t *data_timer = NULL;

// ================= Data from Watch_Code_Broadcast =================
static double ui_lat = 0.0;
static double ui_lng = 0.0;
static int ui_satellites = 0;
static bool ui_gps_valid = false;

static long ui_ir_value = 0;
static float ui_bpm = 0.0;
static int ui_avg_bpm = 0;
static bool ui_finger_detected = false;

static float ui_ax = 0.0;
static float ui_ay = 0.0;
static float ui_az = 0.0;
static float ui_gx = 0.0;
static float ui_gy = 0.0;
static float ui_gz = 0.0;

static int ui_ble_count = 0;
static bool ui_mqtt_connected = false;
static bool ui_last_publish_ok = false;
static float ui_battery_volts = 0.0;
static int ui_battery_percent = 0;
static bool ui_sos_prompt_visible = false;
static bool ui_attention_requested = false;
static bool ui_sos_confirmed_visible = false;

static long ppg_min = 50000;
static long ppg_max = 60000;
static long ppg_baseline = 50000;

// Called from Watch_Code_Broadcast_LVGL_Module.ino.
// This only updates display variables and does not change sensor/MQTT behavior.
void PM_SetWatchData(
  double latitude,
  double longitude,
  int satellites,
  bool gps_valid,
  long ir_value,
  float bpm,
  int avg_bpm,
  bool finger_detected,
  float ax_mps2,
  float ay_mps2,
  float az_mps2,
  float gx_dps,
  float gy_dps,
  float gz_dps,
  int ble_device_count,
  bool mqtt_connected,
  bool last_publish_ok,
  float battery_volts,
  int battery_percent,
  bool sos_prompt_visible,
  bool attention_requested,
  bool sos_confirmed_visible
)
{
  ui_lat = latitude;
  ui_lng = longitude;
  ui_satellites = satellites;
  ui_gps_valid = gps_valid;

  ui_ir_value = ir_value;
  ui_bpm = bpm;
  ui_avg_bpm = avg_bpm;
  ui_finger_detected = finger_detected;

  ui_ax = ax_mps2;
  ui_ay = ay_mps2;
  ui_az = az_mps2;
  ui_gx = gx_dps;
  ui_gy = gy_dps;
  ui_gz = gz_dps;

  ui_ble_count = ble_device_count;
  ui_mqtt_connected = mqtt_connected;
  ui_last_publish_ok = last_publish_ok;
  ui_battery_volts = battery_volts;
  ui_battery_percent = battery_percent;
  ui_sos_prompt_visible = sos_prompt_visible;
  ui_attention_requested = attention_requested;
  ui_sos_confirmed_visible = sos_confirmed_visible;
}

// ================= Helper functions =================
static lv_obj_t *create_card(lv_obj_t *parent, int x, int y, int w, int h, uint32_t bg_color)
{
  lv_obj_t *card = lv_obj_create(parent);
  lv_obj_set_size(card, w, h);
  lv_obj_set_pos(card, x, y);
  lv_obj_set_style_bg_color(card, lv_color_hex(bg_color), 0);
  lv_obj_set_style_bg_opa(card, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(card, 10, 0);
  lv_obj_set_style_border_width(card, 1, 0);
  lv_obj_set_style_border_color(card, lv_color_hex(0x2D3A46), 0);
  lv_obj_set_style_pad_all(card, 5, 0);
  lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
  return card;
}

static lv_obj_t *create_panel(lv_obj_t *parent, int x, int y, int w, int h)
{
  lv_obj_t *panel = create_card(parent, x, y, w, h, 0x111B22);
  lv_obj_set_style_radius(panel, 8, 0);
  lv_obj_set_style_border_color(panel, lv_color_hex(0x263642), 0);
  return panel;
}

static lv_obj_t *create_small_label(lv_obj_t *parent, const char *text, int x, int y, uint32_t color)
{
  lv_obj_t *label = lv_label_create(parent);
  lv_label_set_text(label, text);
  lv_obj_set_pos(label, x, y);
  lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
#if LV_FONT_MONTSERRAT_12
  lv_obj_set_style_text_font(label, &lv_font_montserrat_12, 0);
#endif
  return label;
}

static lv_obj_t *create_value_label(lv_obj_t *parent, const char *text, int x, int y, uint32_t color)
{
  lv_obj_t *label = lv_label_create(parent);
  lv_label_set_text(label, text);
  lv_obj_set_pos(label, x, y);
  lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
#if LV_FONT_MONTSERRAT_18
  lv_obj_set_style_text_font(label, &lv_font_montserrat_18, 0);
#endif
  return label;
}

static int estimate_battery_color(int percent)
{
  if (percent <= 20) return 0xFF5B68;
  if (percent <= 45) return 0xFFD166;
  return 0x45E08D;
}

static void set_heart_color(uint32_t color)
{
  lv_canvas_fill_bg(label_heart_icon, lv_color_hex(0x2A1018), LV_OPA_COVER);

  static const char *heart_mask[] = {
    "01100110",
    "11111111",
    "11111111",
    "11111111",
    "01111110",
    "00111100",
    "00011000"
  };

  lv_draw_rect_dsc_t px_dsc;
  lv_draw_rect_dsc_init(&px_dsc);
  px_dsc.bg_color = lv_color_hex(color);
  px_dsc.bg_opa = LV_OPA_COVER;
  px_dsc.radius = 1;

  const int scale = 4;
  const int gap = 1;
  const int start_x = 5;
  const int start_y = 6;

  for (int row = 0; row < 7; row++) {
    for (int col = 0; col < 8; col++) {
      if (heart_mask[row][col] != '1') {
        continue;
      }

      lv_canvas_draw_rect(
        label_heart_icon,
        start_x + col * scale,
        start_y + row * scale,
        scale - gap,
        scale - gap,
        &px_dsc
      );
    }
  }
}

static int normalized_ppg_value(void)
{
  if (!ui_finger_detected || ui_ir_value < 50000) {
    return 50;
  }

  if (ppg_baseline == 0) {
    ppg_baseline = ui_ir_value;
  }

  ppg_baseline = ((ppg_baseline * 7) + ui_ir_value) / 8;
  long centered = ui_ir_value - ppg_baseline;

  if (ui_ir_value < ppg_min) ppg_min = ui_ir_value;
  if (ui_ir_value > ppg_max) ppg_max = ui_ir_value;

  ppg_min = ((ppg_min * 31) + ui_ir_value) / 32;
  ppg_max = ((ppg_max * 31) + ui_ir_value) / 32;

  long span = ppg_max - ppg_min;
  if (span < 1200) span = 1200;

  int value = 50 + (centered * 42) / span;
  return constrain(value, 8, 92);
}

static void update_ppg_timer_cb(lv_timer_t *timer)
{
  LV_UNUSED(timer);
  lv_chart_set_next_value(chart_ppg, ppg_series, normalized_ppg_value());
}

static void update_ui_timer_cb(lv_timer_t *timer)
{
  LV_UNUSED(timer);
  char buf[96];

  if (ui_mqtt_connected && ui_last_publish_ok) {
    lv_label_set_text(label_status, "ONLINE");
    lv_obj_set_style_text_color(label_status, lv_color_hex(0x00FF88), 0);
    lv_obj_set_style_bg_color(status_dot, lv_color_hex(0x00FF88), 0);
  } else if (ui_mqtt_connected) {
    lv_label_set_text(label_status, "SYNC");
    lv_obj_set_style_text_color(label_status, lv_color_hex(0xFFD166), 0);
    lv_obj_set_style_bg_color(status_dot, lv_color_hex(0xFFD166), 0);
  } else {
    lv_label_set_text(label_status, "OFFLINE");
    lv_obj_set_style_text_color(label_status, lv_color_hex(0xFFD166), 0);
    lv_obj_set_style_bg_color(status_dot, lv_color_hex(0xFFD166), 0);
  }
  lv_obj_set_pos(label_status, 21, 10);

  snprintf(buf, sizeof(buf), "%d", ui_battery_percent);
  lv_label_set_text(label_battery_value, buf);
  lv_obj_center(label_battery_value);
  lv_obj_set_style_text_color(label_battery_value, lv_color_white(), 0);
  lv_obj_set_style_border_color(battery_shell, lv_color_hex(estimate_battery_color(ui_battery_percent)), 0);
  lv_obj_set_style_bg_color(bar_battery, lv_color_hex(estimate_battery_color(ui_battery_percent)), 0);
  lv_obj_set_style_bg_color(battery_cap, lv_color_hex(estimate_battery_color(ui_battery_percent)), 0);
  int fill_w = map(ui_battery_percent, 0, 100, 2, 27);
  lv_obj_set_size(bar_battery, fill_w, 12);

  if (ui_finger_detected && ui_bpm > 20) {
    snprintf(buf, sizeof(buf), "%.0f", ui_bpm);
    lv_label_set_text(label_hr_value, buf);
    lv_obj_set_style_text_color(label_hr_value, lv_color_hex(0xFF6B8A), 0);
  } else {
    lv_label_set_text(label_hr_value, "--");
    lv_obj_set_style_text_color(label_hr_value, lv_color_hex(0x777777), 0);
  }
  set_heart_color(0xFF6B9A);

  if (ui_avg_bpm > 20) {
    snprintf(buf, sizeof(buf), "%d", ui_avg_bpm);
  } else {
    snprintf(buf, sizeof(buf), "--");
  }
  lv_label_set_text(label_avg_value, buf);
  lv_obj_set_style_text_color(label_avg_value, lv_color_hex(0xFF3B55), 0);

  snprintf(buf, sizeof(buf), "IR:%ld", ui_ir_value);
  lv_label_set_text(label_ir_value, buf);
  lv_obj_align(label_ir_value, LV_ALIGN_TOP_RIGHT, -8, 180);

  if (ui_finger_detected) {
    lv_label_set_text(label_finger_value, "FINGER");
    lv_obj_set_style_text_color(label_finger_value, lv_color_hex(0x00FF88), 0);
    lv_label_set_text(label_chart_caption, "Live PPG");
  } else {
    lv_label_set_text(label_finger_value, "NO TOUCH");
    lv_obj_set_style_text_color(label_finger_value, lv_color_hex(0xFFD166), 0);
    lv_label_set_text(label_chart_caption, "Live PPG - waiting");
  }

  if (ui_gps_valid) {
    lv_label_set_text(label_gps_value, "LOCK");
    lv_obj_set_style_text_color(label_gps_value, lv_color_hex(0x00FF88), 0);
  } else {
    lv_label_set_text(label_gps_value, "WAIT");
    lv_obj_set_style_text_color(label_gps_value, lv_color_hex(0xFFD166), 0);
  }

  snprintf(buf, sizeof(buf), "%d", ui_ble_count);
  lv_label_set_text(label_ble_value, buf);

  snprintf(buf, sizeof(buf), "%.4f", ui_lat);
  lv_label_set_text(label_lat_value, buf);

  snprintf(buf, sizeof(buf), "%.4f", ui_lng);
  lv_label_set_text(label_lng_value, buf);

  snprintf(buf, sizeof(buf), "Sat:%d", ui_satellites);
  lv_label_set_text(label_sat_value, buf);

  snprintf(buf, sizeof(buf), "A:%.0f", ui_az);
  lv_label_set_text(label_imu_value, buf);

  if (ui_sos_confirmed_visible) {
    lv_label_set_text(label_sos, "SOS SENT");
    lv_obj_set_style_bg_color(label_sos, lv_color_hex(0x19B66A), 0);
    lv_obj_clear_flag(sos_overlay, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(label_sos, LV_OBJ_FLAG_HIDDEN);
  } else if (ui_sos_prompt_visible) {
    lv_label_set_text(label_sos, "SOS");
    lv_obj_set_style_bg_color(label_sos, lv_color_hex(0xD71920), 0);
    lv_obj_clear_flag(sos_overlay, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(label_sos, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_add_flag(sos_overlay, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(label_sos, LV_OBJ_FLAG_HIDDEN);
  }
}

void Lvgl_Example1(void)
{
  lv_obj_t *screen = lv_scr_act();
  lv_obj_clean(screen);
  lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_set_style_bg_color(screen, lv_color_hex(0x080D13), 0);
  lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);

  lv_coord_t sw = lv_disp_get_hor_res(NULL);
  lv_coord_t sh = lv_disp_get_ver_res(NULL);
  int margin = 8;

  status_dot = lv_obj_create(screen);
  lv_obj_set_size(status_dot, 7, 7);
  lv_obj_set_pos(status_dot, 10, 14);
  lv_obj_set_style_radius(status_dot, 4, 0);
  lv_obj_set_style_border_width(status_dot, 0, 0);
  lv_obj_set_style_bg_color(status_dot, lv_color_hex(0xFFD166), 0);
  lv_obj_set_style_pad_all(status_dot, 0, 0);

  label_status = lv_label_create(screen);
  lv_label_set_text(label_status, "OFFLINE");
  lv_obj_set_style_text_color(label_status, lv_color_hex(0xFFD166), 0);
#if LV_FONT_MONTSERRAT_18
  lv_obj_set_style_text_font(label_status, &lv_font_montserrat_18, 0);
#endif
  lv_obj_set_pos(label_status, 21, 10);

  battery_shell = lv_obj_create(screen);
  lv_obj_set_size(battery_shell, 34, 16);
  lv_obj_set_pos(battery_shell, sw - 47, 9);
  lv_obj_set_style_bg_opa(battery_shell, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(battery_shell, 2, 0);
  lv_obj_set_style_border_color(battery_shell, lv_color_hex(0x45E08D), 0);
  lv_obj_set_style_radius(battery_shell, 5, 0);
  lv_obj_set_style_pad_all(battery_shell, 0, 0);
  lv_obj_clear_flag(battery_shell, LV_OBJ_FLAG_SCROLLABLE);

  bar_battery = lv_obj_create(battery_shell);
  lv_obj_set_size(bar_battery, 20, 12);
  lv_obj_set_pos(bar_battery, 2, 2);
  lv_obj_set_style_bg_color(bar_battery, lv_color_hex(0x45E08D), 0);
  lv_obj_set_style_bg_opa(bar_battery, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(bar_battery, 0, 0);
  lv_obj_set_style_radius(bar_battery, 3, 0);
  lv_obj_set_style_pad_all(bar_battery, 0, 0);
  lv_obj_clear_flag(bar_battery, LV_OBJ_FLAG_SCROLLABLE);

  label_battery_value = lv_label_create(battery_shell);
  lv_label_set_text(label_battery_value, "--");
  lv_obj_set_style_text_color(label_battery_value, lv_color_white(), 0);
#if LV_FONT_MONTSERRAT_12
  lv_obj_set_style_text_font(label_battery_value, &lv_font_montserrat_12, 0);
#endif
#if LV_FONT_MONTSERRAT_14
  lv_obj_set_style_text_font(label_battery_value, &lv_font_montserrat_14, 0);
#endif
  lv_obj_set_style_text_opa(label_battery_value, LV_OPA_COVER, 0);
  lv_obj_center(label_battery_value);

  battery_cap = lv_obj_create(screen);
  lv_obj_set_size(battery_cap, 3, 8);
  lv_obj_set_pos(battery_cap, sw - 12, 13);
  lv_obj_set_style_bg_color(battery_cap, lv_color_hex(0x45E08D), 0);
  lv_obj_set_style_bg_opa(battery_cap, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(battery_cap, 0, 0);
  lv_obj_set_style_radius(battery_cap, 2, 0);
  lv_obj_set_style_pad_all(battery_cap, 0, 0);

  lv_obj_t *card_hr = create_panel(screen, margin, 38, sw - margin * 2, 78);
  lv_obj_set_style_bg_color(card_hr, lv_color_hex(0x15181E), 0);
  lv_obj_set_style_border_color(card_hr, lv_color_hex(0x42202A), 0);
  lv_obj_t *hr_title = create_small_label(card_hr, "Heart Rate", 62, 8, 0xFF3B55);
#if LV_FONT_MONTSERRAT_18
  lv_obj_set_style_text_font(hr_title, &lv_font_montserrat_18, 0);
#endif

  lv_obj_t *heart_glow = lv_obj_create(card_hr);
  lv_obj_set_size(heart_glow, 48, 48);
  lv_obj_set_pos(heart_glow, 7, 14);
  lv_obj_set_style_bg_color(heart_glow, lv_color_hex(0x2A1018), 0);
  lv_obj_set_style_bg_opa(heart_glow, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(heart_glow, 0, 0);
  lv_obj_set_style_radius(heart_glow, 24, 0);
  lv_obj_set_style_pad_all(heart_glow, 0, 0);

  label_heart_icon = lv_canvas_create(heart_glow);
  lv_canvas_set_buffer(label_heart_icon, heart_canvas_buf, 44, 44, LV_IMG_CF_TRUE_COLOR);

  lv_obj_center(label_heart_icon);
  set_heart_color(0xFF6B9A);

  label_raw_heading = create_small_label(card_hr, "Raw", 64, 32, 0x66D6FF);
#if LV_FONT_MONTSERRAT_14
  lv_obj_set_style_text_font(label_raw_heading, &lv_font_montserrat_14, 0);
#endif

  label_avg_heading = create_small_label(card_hr, "Avg", 115, 32, 0xFF5C8A);
#if LV_FONT_MONTSERRAT_14
  lv_obj_set_style_text_font(label_avg_heading, &lv_font_montserrat_14, 0);
#endif

  label_hr_value = create_value_label(card_hr, "--", 64, 48, 0xFF6B9A);
#if LV_FONT_MONTSERRAT_18
  lv_obj_set_style_text_font(label_hr_value, &lv_font_montserrat_18, 0);
#endif

  label_avg_value = create_value_label(card_hr, "--", 115, 48, 0xFF3B55);
#if LV_FONT_MONTSERRAT_18
  lv_obj_set_style_text_font(label_avg_value, &lv_font_montserrat_18, 0);
#endif
  label_finger_value = create_value_label(card_hr, "NO TOUCH", 62, 63, 0xFFD166);
#if LV_FONT_MONTSERRAT_12
  lv_obj_set_style_text_font(label_finger_value, &lv_font_montserrat_12, 0);
#endif

  lv_obj_t *card_signal = create_panel(screen, margin, 124, sw - margin * 2, 48);
  lv_obj_set_style_bg_color(card_signal, lv_color_hex(0x101820), 0);
  create_small_label(card_signal, "GPS", 6, 4, 0x8EA0AB);
  label_gps_value = create_value_label(card_signal, "WAIT", 6, 21, 0xFFD166);
#if LV_FONT_MONTSERRAT_14
  lv_obj_set_style_text_font(label_gps_value, &lv_font_montserrat_14, 0);
#endif
  create_small_label(card_signal, "BLE", 62, 4, 0x8EA0AB);
  label_ble_value = lv_label_create(card_signal);
  lv_label_set_text(label_ble_value, "0");
  lv_obj_set_style_text_color(label_ble_value, lv_color_hex(0xC8D8DF), 0);
#if LV_FONT_MONTSERRAT_14
  lv_obj_set_style_text_font(label_ble_value, &lv_font_montserrat_14, 0);
#endif
  lv_obj_set_pos(label_ble_value, 62, 22);
  lv_obj_t *label_vbat = lv_label_create(card_signal);
  lv_label_set_text(label_vbat, "VBAT");
  lv_obj_set_style_text_color(label_vbat, lv_color_hex(0x8EA0AB), 0);
  lv_obj_set_pos(label_vbat, 112, 4);

  label_chart_caption = lv_label_create(screen);
  lv_label_set_text(label_chart_caption, "Live PPG");
  lv_obj_set_style_text_color(label_chart_caption, lv_color_hex(0xC8D8DF), 0);
#if LV_FONT_MONTSERRAT_12
  lv_obj_set_style_text_font(label_chart_caption, &lv_font_montserrat_12, 0);
#endif
  lv_obj_set_pos(label_chart_caption, margin, 180);

  label_ir_value = lv_label_create(screen);
  lv_label_set_text(label_ir_value, "IR:0");
  lv_obj_set_style_text_color(label_ir_value, lv_color_hex(0x8EA0AB), 0);
  lv_obj_align(label_ir_value, LV_ALIGN_TOP_RIGHT, -margin, 180);

  chart_ppg = lv_chart_create(screen);
  lv_obj_set_size(chart_ppg, sw - margin * 2, 62);
  lv_obj_set_pos(chart_ppg, margin, 196);
  lv_obj_set_style_bg_color(chart_ppg, lv_color_hex(0x050A0E), 0);
  lv_obj_set_style_bg_opa(chart_ppg, LV_OPA_COVER, 0);
  lv_obj_set_style_border_color(chart_ppg, lv_color_hex(0x263642), 0);
  lv_obj_set_style_border_width(chart_ppg, 1, 0);
  lv_obj_set_style_radius(chart_ppg, 8, 0);
  lv_obj_set_style_pad_all(chart_ppg, 2, 0);
  lv_obj_set_style_line_color(chart_ppg, lv_color_hex(0x2A2F35), LV_PART_MAIN);
  lv_obj_set_style_line_width(chart_ppg, 1, LV_PART_MAIN);
  lv_obj_set_style_line_opa(chart_ppg, LV_OPA_50, LV_PART_MAIN);

  lv_chart_set_type(chart_ppg, LV_CHART_TYPE_LINE);
  lv_chart_set_range(chart_ppg, LV_CHART_AXIS_PRIMARY_Y, 0, 100);
  lv_chart_set_point_count(chart_ppg, 48);
  lv_chart_set_update_mode(chart_ppg, LV_CHART_UPDATE_MODE_SHIFT);
  lv_chart_set_div_line_count(chart_ppg, 3, 4);
  ppg_series = lv_chart_add_series(chart_ppg, lv_color_hex(0x34F5C5), LV_CHART_AXIS_PRIMARY_Y);
  lv_obj_set_style_line_width(chart_ppg, 1, LV_PART_ITEMS);
  lv_obj_set_style_width(chart_ppg, 0, LV_PART_INDICATOR);
  lv_obj_set_style_height(chart_ppg, 0, LV_PART_INDICATOR);

  for (int i = 0; i < 48; i++) {
    lv_chart_set_next_value(chart_ppg, ppg_series, 50);
  }

  lv_obj_t *lat_name = lv_label_create(screen);
  lv_label_set_text(lat_name, "Lat");
  lv_obj_set_style_text_color(lat_name, lv_color_hex(0x8EA0AB), 0);
  lv_obj_set_pos(lat_name, margin, sh - 43);

  label_lat_value = lv_label_create(screen);
  lv_label_set_text(label_lat_value, "--");
  lv_obj_set_style_text_color(label_lat_value, lv_color_hex(0xFFFFFF), 0);
  lv_obj_set_pos(label_lat_value, 36, sh - 43);

  lv_obj_t *lng_name = lv_label_create(screen);
  lv_label_set_text(lng_name, "Lng");
  lv_obj_set_style_text_color(lng_name, lv_color_hex(0x8EA0AB), 0);
  lv_obj_set_pos(lng_name, margin, sh - 23);

  label_lng_value = lv_label_create(screen);
  lv_label_set_text(label_lng_value, "--");
  lv_obj_set_style_text_color(label_lng_value, lv_color_hex(0xFFFFFF), 0);
  lv_obj_set_pos(label_lng_value, 36, sh - 23);

  label_sat_value = lv_label_create(screen);
  lv_label_set_text(label_sat_value, "Sat:--");
  lv_obj_set_style_text_color(label_sat_value, lv_color_hex(0x8EA0AB), 0);
  lv_obj_set_pos(label_sat_value, sw - 68, sh - 43);

  label_imu_value = lv_label_create(screen);
  lv_label_set_text(label_imu_value, "A:--");
  lv_obj_set_style_text_color(label_imu_value, lv_color_hex(0x8EA0AB), 0);
  lv_obj_set_pos(label_imu_value, sw - 54, sh - 23);

  sos_overlay = lv_obj_create(screen);
  lv_obj_set_size(sos_overlay, sw, sh);
  lv_obj_set_pos(sos_overlay, 0, 0);
  lv_obj_set_style_bg_color(sos_overlay, lv_color_black(), 0);
  lv_obj_set_style_bg_opa(sos_overlay, LV_OPA_70, 0);
  lv_obj_set_style_border_width(sos_overlay, 0, 0);
  lv_obj_set_style_radius(sos_overlay, 0, 0);
  lv_obj_set_style_pad_all(sos_overlay, 0, 0);
  lv_obj_clear_flag(sos_overlay, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(sos_overlay, LV_OBJ_FLAG_HIDDEN);

  label_sos = lv_label_create(screen);
  lv_label_set_text(label_sos, "SOS");
  lv_obj_set_size(label_sos, 120, 34);
  lv_obj_align(label_sos, LV_ALIGN_CENTER, 0, -2);
  lv_obj_set_style_bg_color(label_sos, lv_color_hex(0xD71920), 0);
  lv_obj_set_style_bg_opa(label_sos, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(label_sos, 8, 0);
  lv_obj_set_style_pad_top(label_sos, 7, 0);
  lv_obj_set_style_text_align(label_sos, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_style_text_color(label_sos, lv_color_white(), 0);
#if LV_FONT_MONTSERRAT_18
  lv_obj_set_style_text_font(label_sos, &lv_font_montserrat_18, 0);
#endif
  lv_obj_add_flag(label_sos, LV_OBJ_FLAG_HIDDEN);

  // Keep official gesture simulation references valid.
  Page_panel[0] = screen;
  lv_obj_t *temp_objects[] = {
    label_hr_value,
    label_avg_value,
    label_finger_value,
    label_gps_value,
    label_ble_value,
    label_lat_value,
    label_lng_value,
    label_battery_value,
    label_heart_icon
  };
  memcpy(Simulated_panel1, temp_objects, sizeof(temp_objects));
  Simulated_panel1_Size = sizeof(temp_objects) / sizeof(lv_obj_t *);

  ppg_timer = lv_timer_create(update_ppg_timer_cb, 120, NULL);
  data_timer = lv_timer_create(update_ui_timer_cb, 250, NULL);
  update_ui_timer_cb(NULL);
}

void Lvgl_Example1_close(void)
{
  if (ppg_timer != NULL) {
    lv_timer_del(ppg_timer);
    ppg_timer = NULL;
  }
  if (data_timer != NULL) {
    lv_timer_del(data_timer);
    data_timer = NULL;
  }
  lv_anim_del(NULL, NULL);
  lv_obj_clean(lv_scr_act());
}

// Keep these functions because the official project may still reference them.
void IRAM_ATTR example1_increase_lvgl_tick(lv_timer_t *t)
{
  LV_UNUSED(t);
}

void Backlight_adjustment_event_cb(lv_event_t *e)
{
  LV_UNUSED(e);
}

void LVGL_Backlight_adjustment(uint8_t Backlight)
{
  Set_Backlight(Backlight);
}

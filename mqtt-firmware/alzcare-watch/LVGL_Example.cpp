#include "LVGL_Example.h"

// Landscape UI for the damaged 1.47" LCD.
// Keep the upper-left/middle mostly blank; use the top-right and lower half.

lv_obj_t *Page_panel[50];
lv_obj_t *Simulated_panel1[100];
size_t Simulated_panel1_Size = 0;

static lv_obj_t *status_dot;
static lv_obj_t *label_status;
static lv_obj_t *battery_shell;
static lv_obj_t *battery_fill;
static lv_obj_t *battery_cap;
static lv_obj_t *label_battery;
static lv_obj_t *battery_bolt;
static lv_point_t battery_bolt_points[] = {
  {8, 1},
  {3, 8},
  {9, 8},
  {4, 15}
};

static lv_obj_t *label_raw_value;
static lv_obj_t *label_avg_value;
static lv_obj_t *label_gps_value;
static lv_obj_t *label_ble_value;
static lv_obj_t *label_vbat_value;
static lv_obj_t *label_lat_value;
static lv_obj_t *label_lng_value;
static lv_obj_t *label_sat_value;
static lv_obj_t *label_acc_value;
static lv_obj_t *label_chart_caption;

static lv_obj_t *chart_ppg;
static lv_chart_series_t *ppg_series;
static lv_obj_t *sos_overlay;
static lv_obj_t *label_sos;

static lv_timer_t *ppg_timer = NULL;
static lv_timer_t *data_timer = NULL;

static double ui_lat = 0.0;
static double ui_lng = 0.0;
static int ui_satellites = 0;
static bool ui_gps_valid = false;
static long ui_ir_value = 0;
static float ui_bpm = 0.0;
static int ui_avg_bpm = 0;
static bool ui_finger_detected = false;
static float ui_az = 0.0;
static int ui_ble_count = 0;
static bool ui_mqtt_connected = false;
static bool ui_last_publish_ok = false;
static float ui_battery_volts = 0.0;
static int ui_battery_percent = 0;
static bool ui_battery_charging = false;
static bool ui_sos_prompt_visible = false;
static bool ui_attention_requested = false;
static bool ui_sos_confirmed_visible = false;

static long ppg_min = 50000;
static long ppg_max = 60000;
static long ppg_baseline = 50000;

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
  bool battery_charging,
  bool sos_prompt_visible,
  bool attention_requested,
  bool sos_confirmed_visible
)
{
  LV_UNUSED(ax_mps2);
  LV_UNUSED(ay_mps2);
  LV_UNUSED(gx_dps);
  LV_UNUSED(gy_dps);
  LV_UNUSED(gz_dps);

  ui_lat = latitude;
  ui_lng = longitude;
  ui_satellites = satellites;
  ui_gps_valid = gps_valid;
  ui_ir_value = ir_value;
  ui_bpm = bpm;
  ui_avg_bpm = avg_bpm;
  ui_finger_detected = finger_detected;
  ui_az = az_mps2;
  ui_ble_count = ble_device_count;
  ui_mqtt_connected = mqtt_connected;
  ui_last_publish_ok = last_publish_ok;
  ui_battery_volts = battery_volts;
  ui_battery_percent = battery_percent;
  ui_battery_charging = battery_charging;
  ui_sos_prompt_visible = sos_prompt_visible;
  ui_attention_requested = attention_requested;
  ui_sos_confirmed_visible = sos_confirmed_visible;
}

static lv_obj_t *make_label(lv_obj_t *parent, const char *text, int x, int y, uint32_t color)
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

static lv_obj_t *make_value(lv_obj_t *parent, const char *text, int x, int y, uint32_t color)
{
  lv_obj_t *label = make_label(parent, text, x, y, color);
#if LV_FONT_MONTSERRAT_14
  lv_obj_set_style_text_font(label, &lv_font_montserrat_14, 0);
#endif
  return label;
}

static lv_obj_t *make_panel(lv_obj_t *parent, int x, int y, int w, int h, uint32_t border)
{
  lv_obj_t *panel = lv_obj_create(parent);
  lv_obj_set_size(panel, w, h);
  lv_obj_set_pos(panel, x, y);
  lv_obj_set_style_bg_color(panel, lv_color_hex(0x0B1118), 0);
  lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
  lv_obj_set_style_border_color(panel, lv_color_hex(border), 0);
  lv_obj_set_style_border_width(panel, 1, 0);
  lv_obj_set_style_radius(panel, 7, 0);
  lv_obj_set_style_pad_all(panel, 4, 0);
  lv_obj_clear_flag(panel, LV_OBJ_FLAG_SCROLLABLE);
  return panel;
}

static uint32_t battery_color(int percent)
{
  if (percent <= 20) return 0xFF5B68;
  if (percent <= 45) return 0xFFD166;
  return 0x45E08D;
}

static int normalized_ppg_value(void)
{
  if (!ui_finger_detected || ui_ir_value < 50000) {
    return 50;
  }

  ppg_baseline = ((ppg_baseline * 7) + ui_ir_value) / 8;
  long centered = ui_ir_value - ppg_baseline;

  if (ui_ir_value < ppg_min) ppg_min = ui_ir_value;
  if (ui_ir_value > ppg_max) ppg_max = ui_ir_value;

  ppg_min = ((ppg_min * 31) + ui_ir_value) / 32;
  ppg_max = ((ppg_max * 31) + ui_ir_value) / 32;

  long span = ppg_max - ppg_min;
  if (span < 1200) span = 1200;

  int value = 50 + (centered * 40) / span;
  return constrain(value, 8, 92);
}

static void ppg_timer_cb(lv_timer_t *timer)
{
  LV_UNUSED(timer);
  lv_chart_set_next_value(chart_ppg, ppg_series, normalized_ppg_value());
}

static void ui_timer_cb(lv_timer_t *timer)
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

  snprintf(buf, sizeof(buf), "%d", ui_battery_percent);
  lv_label_set_text(label_battery, buf);
  lv_obj_center(label_battery);
  uint32_t bat_color = battery_color(ui_battery_percent);
  lv_obj_set_style_border_color(battery_shell, lv_color_hex(bat_color), 0);
  lv_obj_set_style_bg_color(battery_fill, lv_color_hex(bat_color), 0);
  lv_obj_set_style_bg_color(battery_cap, lv_color_hex(bat_color), 0);
  lv_obj_set_size(battery_fill, map(ui_battery_percent, 0, 100, 2, 27), 12);

  if (ui_battery_charging) {
    lv_obj_clear_flag(battery_bolt, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_add_flag(battery_bolt, LV_OBJ_FLAG_HIDDEN);
  }

  if (ui_finger_detected && ui_bpm > 20) {
    snprintf(buf, sizeof(buf), "%.0f", ui_bpm);
  } else {
    snprintf(buf, sizeof(buf), "--");
  }
  lv_label_set_text(label_raw_value, buf);

  if (ui_avg_bpm > 20) {
    snprintf(buf, sizeof(buf), "%d", ui_avg_bpm);
  } else {
    snprintf(buf, sizeof(buf), "--");
  }
  lv_label_set_text(label_avg_value, buf);

  lv_label_set_text(label_gps_value, ui_gps_valid ? "LOCK" : "WAIT");
  lv_obj_set_style_text_color(label_gps_value, lv_color_hex(ui_gps_valid ? 0x00FF88 : 0xFFD166), 0);

  snprintf(buf, sizeof(buf), "%d", ui_ble_count);
  lv_label_set_text(label_ble_value, buf);

  snprintf(buf, sizeof(buf), "%.2fV", ui_battery_volts);
  lv_label_set_text(label_vbat_value, buf);

  snprintf(buf, sizeof(buf), "%.4f", ui_lat);
  lv_label_set_text(label_lat_value, buf);

  snprintf(buf, sizeof(buf), "%.4f", ui_lng);
  lv_label_set_text(label_lng_value, buf);

  snprintf(buf, sizeof(buf), "Sat:%d", ui_satellites);
  lv_label_set_text(label_sat_value, buf);

  snprintf(buf, sizeof(buf), "A:%.0f", ui_az);
  lv_label_set_text(label_acc_value, buf);

  lv_label_set_text(label_chart_caption, ui_finger_detected ? "Live PPG" : "Live PPG - waiting");

  if (ui_sos_confirmed_visible) {
    lv_label_set_text(label_sos, "SOS SENT");
    lv_obj_set_style_bg_color(label_sos, lv_color_hex(0x19B66A), 0);
    lv_obj_clear_flag(sos_overlay, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(label_sos, LV_OBJ_FLAG_HIDDEN);
  } else if (ui_sos_prompt_visible || ui_attention_requested) {
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
  lv_obj_set_style_bg_color(screen, lv_color_hex(0x070B10), 0);
  lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);

  lv_coord_t sw = lv_disp_get_hor_res(NULL);
  lv_coord_t sh = lv_disp_get_ver_res(NULL);

  battery_shell = lv_obj_create(screen);
  lv_obj_set_size(battery_shell, 34, 16);
  lv_obj_set_pos(battery_shell, sw - 46, 8);
  lv_obj_set_style_bg_opa(battery_shell, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(battery_shell, 2, 0);
  lv_obj_set_style_border_color(battery_shell, lv_color_hex(0x45E08D), 0);
  lv_obj_set_style_radius(battery_shell, 5, 0);
  lv_obj_set_style_pad_all(battery_shell, 0, 0);
  lv_obj_clear_flag(battery_shell, LV_OBJ_FLAG_SCROLLABLE);

  battery_fill = lv_obj_create(battery_shell);
  lv_obj_set_size(battery_fill, 20, 12);
  lv_obj_set_pos(battery_fill, 2, 2);
  lv_obj_set_style_bg_color(battery_fill, lv_color_hex(0x45E08D), 0);
  lv_obj_set_style_bg_opa(battery_fill, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(battery_fill, 0, 0);
  lv_obj_set_style_radius(battery_fill, 3, 0);
  lv_obj_clear_flag(battery_fill, LV_OBJ_FLAG_SCROLLABLE);

  label_battery = lv_label_create(battery_shell);
  lv_label_set_text(label_battery, "--");
  lv_obj_set_style_text_color(label_battery, lv_color_white(), 0);
#if LV_FONT_MONTSERRAT_12
  lv_obj_set_style_text_font(label_battery, &lv_font_montserrat_12, 0);
#endif
  lv_obj_center(label_battery);

  battery_cap = lv_obj_create(screen);
  lv_obj_set_size(battery_cap, 3, 8);
  lv_obj_set_pos(battery_cap, sw - 11, 12);
  lv_obj_set_style_bg_color(battery_cap, lv_color_hex(0x45E08D), 0);
  lv_obj_set_style_bg_opa(battery_cap, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(battery_cap, 0, 0);
  lv_obj_set_style_radius(battery_cap, 2, 0);

  battery_bolt = lv_line_create(screen);
  lv_line_set_points(battery_bolt, battery_bolt_points, 4);
  lv_obj_set_pos(battery_bolt, sw - 62, 7);
  lv_obj_set_size(battery_bolt, 12, 17);
  lv_obj_set_style_line_width(battery_bolt, 3, 0);
  lv_obj_set_style_line_color(battery_bolt, lv_color_hex(0xFFFFFF), 0);
  lv_obj_set_style_line_rounded(battery_bolt, true, 0);
  lv_obj_add_flag(battery_bolt, LV_OBJ_FLAG_HIDDEN);

  status_dot = lv_obj_create(screen);
  lv_obj_set_size(status_dot, 7, 7);
  lv_obj_set_pos(status_dot, sw - 96, 36);
  lv_obj_set_style_bg_color(status_dot, lv_color_hex(0xFFD166), 0);
  lv_obj_set_style_bg_opa(status_dot, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(status_dot, 0, 0);
  lv_obj_set_style_radius(status_dot, 4, 0);

  label_status = make_value(screen, "OFFLINE", sw - 84, 31, 0xFFD166);

  label_chart_caption = make_label(screen, "Live PPG", 8, 88, 0x66D6FF);

  chart_ppg = lv_chart_create(screen);
  lv_obj_set_size(chart_ppg, 132, 58);
  lv_obj_set_pos(chart_ppg, 8, 108);
  lv_obj_set_style_bg_color(chart_ppg, lv_color_hex(0x050A0E), 0);
  lv_obj_set_style_bg_opa(chart_ppg, LV_OPA_COVER, 0);
  lv_obj_set_style_border_color(chart_ppg, lv_color_hex(0x263642), 0);
  lv_obj_set_style_border_width(chart_ppg, 1, 0);
  lv_obj_set_style_radius(chart_ppg, 6, 0);
  lv_obj_set_style_pad_all(chart_ppg, 2, 0);
  lv_obj_set_style_line_color(chart_ppg, lv_color_hex(0x22272D), LV_PART_MAIN);
  lv_obj_set_style_line_width(chart_ppg, 1, LV_PART_MAIN);
  lv_obj_set_style_line_opa(chart_ppg, LV_OPA_40, LV_PART_MAIN);
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

  lv_obj_t *data = make_panel(screen, 146, 88, sw - 154, 78, 0x243649);
  make_label(data, "Raw", 6, 3, 0x66D6FF);
  make_label(data, "Avg", 50, 3, 0xFF5C8A);
  make_label(data, "GPS", 94, 3, 0x8EA0AB);
  label_raw_value = make_value(data, "--", 6, 18, 0xFF6B9A);
  label_avg_value = make_value(data, "--", 50, 18, 0xFF3B55);
  label_gps_value = make_value(data, "WAIT", 94, 18, 0xFFD166);

  make_label(data, "BLE", 6, 42, 0x8EA0AB);
  make_label(data, "VBAT", 50, 42, 0x8EA0AB);
  make_label(data, "SYS", 104, 42, 0x8EA0AB);
  label_ble_value = make_value(data, "0", 6, 57, 0xC8D8DF);
  label_vbat_value = make_value(data, "--V", 50, 57, 0x45E08D);
  label_acc_value = make_value(data, "A:--", 104, 57, 0xC8D8DF);

  label_lat_value = make_label(screen, "0.0000", 8, sh - 16, 0xEAF7FF);
  make_label(screen, "Lat", 8, sh - 31, 0x8EA0AB);
  label_lng_value = make_label(screen, "0.0000", 74, sh - 16, 0xEAF7FF);
  make_label(screen, "Lng", 74, sh - 31, 0x8EA0AB);
  label_sat_value = make_label(screen, "Sat:0", 142, sh - 16, 0x8EA0AB);

  sos_overlay = lv_obj_create(screen);
  lv_obj_set_size(sos_overlay, sw, sh / 2);
  lv_obj_set_pos(sos_overlay, 0, sh / 2);
  lv_obj_set_style_bg_color(sos_overlay, lv_color_black(), 0);
  lv_obj_set_style_bg_opa(sos_overlay, LV_OPA_70, 0);
  lv_obj_set_style_border_width(sos_overlay, 0, 0);
  lv_obj_set_style_radius(sos_overlay, 0, 0);
  lv_obj_clear_flag(sos_overlay, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(sos_overlay, LV_OBJ_FLAG_HIDDEN);

  label_sos = lv_label_create(screen);
  lv_label_set_text(label_sos, "SOS");
  lv_obj_set_size(label_sos, 120, 34);
  lv_obj_set_pos(label_sos, (sw - 120) / 2, sh / 2 + 25);
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

  Page_panel[0] = screen;
  lv_obj_t *temp_objects[] = {
    label_raw_value,
    label_avg_value,
    label_gps_value,
    label_ble_value,
    label_vbat_value,
    label_lat_value,
    label_lng_value,
    label_battery
  };
  memcpy(Simulated_panel1, temp_objects, sizeof(temp_objects));
  Simulated_panel1_Size = sizeof(temp_objects) / sizeof(lv_obj_t *);

  ppg_timer = lv_timer_create(ppg_timer_cb, 120, NULL);
  data_timer = lv_timer_create(ui_timer_cb, 250, NULL);
  ui_timer_cb(NULL);
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

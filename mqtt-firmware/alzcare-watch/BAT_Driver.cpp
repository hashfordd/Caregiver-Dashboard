#include "BAT_Driver.h"

float BAT_analogVolts = 0;
uint16_t BAT_adcRaw = 0;
int BAT_adcMilliVolts = 0;

void BAT_Init(void)
{
  pinMode(BAT_ADC_PIN, INPUT);
  analogReadResolution(12);
#if defined(ARDUINO_ARCH_ESP32)
  analogSetPinAttenuation(BAT_ADC_PIN, ADC_11db);
#endif
}

float BAT_Get_Volts(void)
{
  uint32_t raw_total = 0;
  uint32_t mv_total = 0;
  const uint8_t samples = 16;

  for (uint8_t i = 0; i < samples; i++) {
    raw_total += analogRead(BAT_ADC_PIN);
    mv_total += analogReadMilliVolts(BAT_ADC_PIN);
    delayMicroseconds(250);
  }

  BAT_adcRaw = raw_total / samples;
  BAT_adcMilliVolts = mv_total / samples;

  float adc_volts = BAT_adcMilliVolts / 1000.0f;

  if (adc_volts <= 0.01f && BAT_adcRaw > 0) {
    adc_volts = (BAT_adcRaw / 4095.0f) * 3.3f;
  }

  BAT_analogVolts = (adc_volts * BAT_ADC_RATIO) / Measurement_offset;

  return BAT_analogVolts;
}

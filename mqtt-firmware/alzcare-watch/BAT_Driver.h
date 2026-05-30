#pragma once
#include <Arduino.h> 

#define BAT_ADC_PIN   1
#define BAT_ADC_RATIO 3.0f
#define Measurement_offset 0.992857f

extern float BAT_analogVolts;
extern uint16_t BAT_adcRaw;
extern int BAT_adcMilliVolts;

void BAT_Init(void);
float BAT_Get_Volts(void);

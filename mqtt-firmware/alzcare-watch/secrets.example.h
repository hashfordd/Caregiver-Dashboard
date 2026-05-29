// secrets.example.h — template for the AlzCare wearable firmware credentials.
// Copy this file to secrets.h (gitignored) and fill in your real values.
#pragma once

#define SECRET_WIFI_SSID   "YOUR_WIFI_SSID"
#define SECRET_WIFI_PASS   "YOUR_WIFI_PASSWORD"

// HiveMQ Cloud cluster + a read/write credential the firmware publishes with.
#define SECRET_MQTT_HOST   "YOUR-CLUSTER.s1.eu.hivemq.cloud"
#define SECRET_MQTT_USER   "alzcare"
#define SECRET_MQTT_PASS   "YOUR_HIVEMQ_PASSWORD"

// This device's MAC — pair it to a patient in the dashboard ("Set up hardware").
#define SECRET_DEVICE_MAC  "aa:bb:cc:dd:ee:ff"

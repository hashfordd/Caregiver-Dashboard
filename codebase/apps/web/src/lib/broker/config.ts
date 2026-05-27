// Direct browser → HiveMQ connection config, read from Vite env. These ship in
// the web bundle, so VITE_MQTT_RO_* must be a READ-ONLY broker credential
// (subscribe on device/# only) — never the read-write cred the bridge uses.
//
// When username/password are blank the feed is "unconfigured": the Live tab
// falls back to Supabase realtime and the connect UI explains what's missing.

export interface BrokerConfig {
  /** wss://<cluster>.s1.eu.hivemq.cloud:8884/mqtt */
  url: string;
  username: string;
  password: string;
}

const url = import.meta.env.VITE_MQTT_WSS_URL as string | undefined;
const username = import.meta.env.VITE_MQTT_RO_USERNAME as string | undefined;
const password = import.meta.env.VITE_MQTT_RO_PASSWORD as string | undefined;

export const brokerConfig: BrokerConfig | null =
  url && username && password ? { url, username, password } : null;

/** Host shown in the firmware-setup step, e.g. 690cc4….s1.eu.hivemq.cloud. */
export const brokerHost: string | null = url
  ? url.replace(/^wss?:\/\//, '').replace(/:\d+.*$/, '')
  : null;

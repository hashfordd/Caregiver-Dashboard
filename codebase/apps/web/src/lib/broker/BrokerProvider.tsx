import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import mqtt, { type MqttClient } from 'mqtt';
import { brokerConfig, brokerHost, type BrokerConfig } from './config';
import { topicMatches } from './topicMatch';

// Shared, app-wide MQTT-over-WebSocket connection to HiveMQ. One client for the
// whole dashboard: features subscribe to topics through `subscribe()` and the
// provider fans incoming messages out to the matching handlers. The bridge
// still owns persistence/positioning/rules — this connection is purely the
// low-latency live feed of raw telemetry straight from the broker.

export type BrokerStatus =
  | 'unconfigured' // no read-only credential set (VITE_MQTT_RO_*)
  | 'idle' // configured but not connected yet
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type BrokerMessageHandler = (topic: string, payload: string) => void;

export interface BrokerContextValue {
  status: BrokerStatus;
  error: string | null;
  /** Host shown in firmware setup, or null when unconfigured. */
  host: string | null;
  config: BrokerConfig | null;
  /** Open the connection (no-op if already connecting/connected). */
  connect: () => void;
  /** Close the connection and stop reconnecting. */
  disconnect: () => void;
  /** Subscribe to one or more topic filters; returns an unsubscribe fn. */
  subscribe: (filters: string[], handler: BrokerMessageHandler) => () => void;
}

// No-op default so a subtree rendered without <BrokerProvider> (e.g. unit
// tests, storybook) still works — it just reports an unconfigured, off feed.
const NOOP_BROKER: BrokerContextValue = {
  status: 'unconfigured',
  error: null,
  host: null,
  config: null,
  connect: () => {},
  disconnect: () => {},
  subscribe: () => () => {},
};

const BrokerContext = createContext<BrokerContextValue>(NOOP_BROKER);

export function BrokerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BrokerStatus>(brokerConfig ? 'idle' : 'unconfigured');
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<MqttClient | null>(null);
  // filter → set of handlers. The ref count per filter drives MQTT (un)subscribe.
  const subsRef = useRef<Map<string, Set<BrokerMessageHandler>>>(new Map());

  const connect = useCallback(() => {
    if (!brokerConfig || clientRef.current) return;
    setError(null);
    setStatus('connecting');
    const client = mqtt.connect(brokerConfig.url, {
      username: brokerConfig.username,
      password: brokerConfig.password,
      reconnectPeriod: 4000,
      connectTimeout: 12_000,
      clientId: `dashboard-${Math.random().toString(16).slice(2, 10)}`,
      protocolVersion: 5,
      clean: true,
    });
    clientRef.current = client;

    client.on('connect', () => {
      setStatus('connected');
      setError(null);
      // (Re)subscribe everything that features have registered.
      const filters = [...subsRef.current.keys()];
      if (filters.length) client.subscribe(filters);
    });
    client.on('reconnect', () => setStatus('reconnecting'));
    client.on('close', () =>
      setStatus((s) => (s === 'connected' || s === 'reconnecting' ? 'reconnecting' : s)),
    );
    client.on('error', (err: Error) => {
      setError(err.message);
      setStatus('error');
    });
    client.on('message', (topic: string, payload: Uint8Array) => {
      let text: string;
      try {
        text = new TextDecoder().decode(payload);
      } catch {
        return;
      }
      for (const [filter, handlers] of subsRef.current) {
        if (topicMatches(filter, topic)) handlers.forEach((h) => h(topic, text));
      }
    });
  }, []);

  const disconnect = useCallback(() => {
    const client = clientRef.current;
    clientRef.current = null;
    if (client) client.end(true);
    setStatus(brokerConfig ? 'idle' : 'unconfigured');
  }, []);

  const subscribe = useCallback<BrokerContextValue['subscribe']>((filters, handler) => {
    for (const f of filters) {
      let set = subsRef.current.get(f);
      if (!set) {
        set = new Set();
        subsRef.current.set(f, set);
        if (clientRef.current?.connected) clientRef.current.subscribe(f);
      }
      set.add(handler);
    }
    return () => {
      for (const f of filters) {
        const set = subsRef.current.get(f);
        if (!set) continue;
        set.delete(handler);
        if (set.size === 0) {
          subsRef.current.delete(f);
          if (clientRef.current?.connected) clientRef.current.unsubscribe(f);
        }
      }
    };
  }, []);

  // Auto-connect once on mount when a credential is configured, so the live
  // feed is continuous without the caregiver re-clicking every session. The
  // "Connect to server" control still lets them retry after an error.
  useEffect(() => {
    if (brokerConfig) connect();
    return () => {
      clientRef.current?.end(true);
      clientRef.current = null;
    };
  }, [connect]);

  const value = useMemo<BrokerContextValue>(
    () => ({
      status,
      error,
      host: brokerHost,
      config: brokerConfig,
      connect,
      disconnect,
      subscribe,
    }),
    [status, error, connect, disconnect, subscribe],
  );

  return <BrokerContext.Provider value={value}>{children}</BrokerContext.Provider>;
}

export function useBroker(): BrokerContextValue {
  return useContext(BrokerContext);
}

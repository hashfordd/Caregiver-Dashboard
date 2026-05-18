import { useEffect, useRef, useState } from 'react';

export interface CaregiverPosition {
  lat: number;
  lng: number;
  /** Reported accuracy radius in metres (GeolocationPosition.coords.accuracy). */
  accuracy: number;
  /** GeolocationPosition.timestamp — ms since epoch. */
  recordedAt: number;
}

export type CaregiverLocationStatus =
  | 'idle'
  | 'unsupported'
  | 'requesting'
  | 'tracking'
  | 'denied'
  | 'error';

export interface CaregiverLocationHandle {
  status: CaregiverLocationStatus;
  position: CaregiverPosition | null;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/** Tracks the caregiver's device location via the browser Geolocation API.
 *
 *  Opt-in by design: the watchPosition call only fires when the caller
 *  invokes `start()`, so the browser permission prompt isn't a surprise
 *  the moment a patient page loads. Calling `stop()` (or unmounting)
 *  clears the watch. */
export function useCaregiverLocation(): CaregiverLocationHandle {
  const [status, setStatus] = useState<CaregiverLocationStatus>('idle');
  const [position, setPosition] = useState<CaregiverPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const stop = (): void => {
    if (watchIdRef.current != null && typeof navigator !== 'undefined') {
      navigator.geolocation?.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    setStatus('idle');
    // Drop the last-known fix so the CaregiverPin disappears immediately.
    // Without this the watch is cancelled but the marker keeps rendering
    // from the stale `position` snapshot.
    setPosition(null);
    setError(null);
  };

  const start = (): void => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported');
      setError('Geolocation is not available in this browser.');
      return;
    }
    if (watchIdRef.current != null) return; // already tracking
    setStatus('requesting');
    setError(null);
    const id = navigator.geolocation.watchPosition(
      (geo) => {
        setStatus('tracking');
        setPosition({
          lat: geo.coords.latitude,
          lng: geo.coords.longitude,
          accuracy: geo.coords.accuracy,
          recordedAt: geo.timestamp,
        });
      },
      (err) => {
        setError(err.message);
        // GeolocationPositionError.PERMISSION_DENIED is 1.
        if (err.code === 1) setStatus('denied');
        else setStatus('error');
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    watchIdRef.current = id;
  };

  // Stop tracking when the component unmounts — leaving an orphan watch
  // would keep the OS GPS sensor warm and drain mobile batteries.
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null && typeof navigator !== 'undefined') {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return { status, position, error, start, stop };
}

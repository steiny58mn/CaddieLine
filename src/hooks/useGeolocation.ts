import { useCallback, useEffect, useRef, useState } from 'react';
import { LatLngLiteral } from '../types/golf';

export type GpsStatus = 'idle' | 'watching' | 'unavailable' | 'denied' | 'manual';

export interface GeolocationState {
  position: LatLngLiteral | null;
  accuracyMeters: number | null;
  status: GpsStatus;
  errorMessage: string | null;
  isManualOverride: boolean;
  setManualPosition: (pos: LatLngLiteral) => void;
  resumeLiveGps: () => void;
  requestSingleFix: () => Promise<LatLngLiteral | null>;
}

const GPS_CACHE_KEY = 'pocketcaddy_last_gps_position';

function getCachedGpsPosition(): LatLngLiteral | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(GPS_CACHE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lat === 'number' &&
      typeof parsed?.lng === 'number' &&
      !Number.isNaN(parsed.lat) &&
      !Number.isNaN(parsed.lng)
    ) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {}
  return null;
}

export function useGeolocation(): GeolocationState {
  const [livePosition, setLivePosition] = useState<LatLngLiteral | null>(getCachedGpsPosition);
  const [manualPosition, setManualPositionState] = useState<LatLngLiteral | null>(null);
  const [isManualOverride, setIsManualOverride] = useState(false);
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  const [status, setStatus] = useState<GpsStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastAccuracyRef = useRef<number | null>(null);

  const startWatch = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('unavailable');
      setErrorMessage('Browser geolocation is unavailable.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    setStatus('watching');
    setErrorMessage(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = Math.round(pos.coords.accuracy);
        const next: LatLngLiteral = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };

        // If we already hold an accurate GPS fix (<15m / ~45ft) and a temporary wild coarse fix (>35m) arrives,
        // keep the accurate position to prevent phantom jumps, while still displaying current accuracy.
        const prevAcc = lastAccuracyRef.current;
        if (prevAcc !== null && prevAcc <= 15 && accuracy > 35) {
          setAccuracyMeters(accuracy);
          return;
        }

        lastAccuracyRef.current = accuracy;
        try {
          localStorage.setItem(GPS_CACHE_KEY, JSON.stringify(next));
        } catch {}
        setLivePosition(next);
        setAccuracyMeters(accuracy);
        setStatus((prev) => (prev === 'manual' ? 'manual' : 'watching'));
        setErrorMessage(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          setErrorMessage('Location access denied. Drag the ball pin on the map to set your position.');
        } else {
          setStatus('unavailable');
          setErrorMessage('GPS signal unavailable. You can position your ball marker directly on the map.');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );
  }, []);

  useEffect(() => {
    startWatch();
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [startWatch]);

  const setManualPosition = useCallback((pos: LatLngLiteral) => {
    setManualPositionState(pos);
    setIsManualOverride(true);
    setStatus('manual');
  }, []);

  const resumeLiveGps = useCallback(() => {
    setIsManualOverride(false);
    setManualPositionState(null);
    startWatch();
  }, [startWatch]);

  const requestSingleFix = useCallback(async (): Promise<LatLngLiteral | null> => {
    if (isManualOverride && manualPosition) {
      return manualPosition;
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return livePosition;
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          try {
            localStorage.setItem(GPS_CACHE_KEY, JSON.stringify(next));
          } catch {}
          setLivePosition(next);
          setAccuracyMeters(Math.round(pos.coords.accuracy));
          resolve(next);
        },
        () => resolve(livePosition),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 2000 }
      );
    });
  }, [isManualOverride, manualPosition, livePosition]);

  return {
    position: isManualOverride ? manualPosition : livePosition,
    accuracyMeters: isManualOverride ? null : accuracyMeters,
    status,
    errorMessage,
    isManualOverride,
    setManualPosition,
    resumeLiveGps,
    requestSingleFix,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';

export function useWakeLock() {
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    setIsSupported(typeof navigator !== 'undefined' && 'wakeLock' in navigator);
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      if (wakeLockSentinelRef.current && !wakeLockSentinelRef.current.released) {
        return;
      }
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinelRef.current = sentinel;
      setIsWakeLockActive(true);

      sentinel.addEventListener('release', () => {
        wakeLockSentinelRef.current = null;
        setIsWakeLockActive(false);
      });
    } catch (err) {
      console.warn('Wake Lock request failed:', err);
      setIsWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockSentinelRef.current) {
        await wakeLockSentinelRef.current.release();
        wakeLockSentinelRef.current = null;
      }
    } catch (err) {
      console.warn('Wake Lock release failed:', err);
    } finally {
      setIsWakeLockActive(false);
    }
  }, []);

  // Re-acquire lock when app tab becomes visible again if lock was active
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isWakeLockActive) {
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isWakeLockActive, requestWakeLock]);

  return {
    isSupported,
    isWakeLockActive,
    requestWakeLock,
    releaseWakeLock,
  };
}

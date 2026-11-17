import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'caddieline_auto_pocket_v1';

export function usePocketMode() {
  const [isPocketShieldActive, setIsPocketShieldActive] = useState(false);
  const [isAutoPocketEnabled, setIsAutoPocketEnabled] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [sensorAvailable, setSensorAvailable] = useState(false);
  const upsideDownTimerRef = useRef<number | null>(null);
  const uprightTimerRef = useRef<number | null>(null);
  const isPocketShieldActiveRef = useRef(isPocketShieldActive);
  isPocketShieldActiveRef.current = isPocketShieldActive;

  // Persist auto pocket preference
  const toggleAutoPocket = useCallback((enabled: boolean) => {
    setIsAutoPocketEnabled(enabled);
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {}
  }, []);

  const enterPocketShield = useCallback(() => {
    setIsPocketShieldActive(true);
    // Subtle haptic confirmation when entering pocket shield
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(60);
      } catch {}
    }
  }, []);

  const exitPocketShield = useCallback(() => {
    setIsPocketShieldActive(false);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([40, 40]);
      } catch {}
    }
  }, []);

  const togglePocketShield = useCallback(() => {
    if (isPocketShieldActiveRef.current) {
      exitPocketShield();
    } else {
      enterPocketShield();
    }
  }, [enterPocketShield, exitPocketShield]);

  // Orientation sensor: detects when phone is placed upside down in pocket
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      setSensorAvailable(true);
      if (!isAutoPocketEnabled) return;

      const beta = e.beta; // Pitch [-180, 180]
      if (beta === null) return;

      // When placed head-down into a pants or jacket pocket:
      // beta is upside-down (abs(beta) > 130 deg)
      const isUpsideDown = Math.abs(beta) > 130;

      // When held upright in front of user:
      // beta is between 25 deg and 95 deg
      const isUpright = beta > 25 && beta < 95;

      if (isUpsideDown && !isPocketShieldActiveRef.current) {
        if (!upsideDownTimerRef.current) {
          upsideDownTimerRef.current = window.setTimeout(() => {
            enterPocketShield();
            upsideDownTimerRef.current = null;
          }, 900);
        }
      } else {
        if (upsideDownTimerRef.current) {
          clearTimeout(upsideDownTimerRef.current);
          upsideDownTimerRef.current = null;
        }
      }

      if (isUpright && isPocketShieldActiveRef.current) {
        if (!uprightTimerRef.current) {
          uprightTimerRef.current = window.setTimeout(() => {
            exitPocketShield();
            uprightTimerRef.current = null;
          }, 400);
        }
      } else {
        if (uprightTimerRef.current) {
          clearTimeout(uprightTimerRef.current);
          uprightTimerRef.current = null;
        }
      }
    };

    window.addEventListener('deviceorientation', handleOrientation, { passive: true });
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      if (upsideDownTimerRef.current) clearTimeout(upsideDownTimerRef.current);
      if (uprightTimerRef.current) clearTimeout(uprightTimerRef.current);
    };
  }, [isAutoPocketEnabled, enterPocketShield, exitPocketShield]);

  return {
    isPocketShieldActive,
    isAutoPocketEnabled,
    sensorAvailable,
    enterPocketShield,
    exitPocketShield,
    togglePocketShield,
    toggleAutoPocket,
  };
}

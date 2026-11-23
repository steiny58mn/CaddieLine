import { useCallback, useEffect, useRef, useState } from 'react';

interface NDEFRecordData {
  recordType: string;
  mediaType?: string;
  id?: string;
  data?: DataView;
  encoding?: string;
  lang?: string;
}

interface NDEFReadingEvent extends Event {
  serialNumber: string;
  message: {
    records: NDEFRecordData[];
  };
}

interface NDEFReaderInstance extends EventTarget {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
}

declare global {
  interface Window {
    NDEFReader?: new () => NDEFReaderInstance;
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
    NativeFeedback?: {
      updateFeedbackSettings?: (vibrate: boolean, sound: boolean) => void;
      requestDeviceUnlock?: () => void;
      notifyWatchClubScanned?: (clubName: string, clubShortName: string) => void;
      updateWatchDistances?: (
        roundActive: boolean,
        courseName: string,
        hole: number,
        par: number,
        front: number,
        pin: number,
        back: number,
        unit: string
      ) => void;
    };
  }
}

export interface NfcTapPayload {
  tagId: string;
  rawRecords: string[];
  source: 'hardware' | 'simulated';
  timestamp: number;
}

export type NfcStatus = 'unsupported' | 'idle' | 'scanning' | 'error';

export function triggerNfcHaptics() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      // Powerful double-burst haptic: 220ms, 70ms pause, 320ms strong pulse
      navigator.vibrate([220, 70, 320]);
    } catch {}
  }
}

export function playNfcChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;

    // Tone 1: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.4, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Tone 2: 880 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.1);
    gain2.gain.setValueAtTime(0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(0.5, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.38);
  } catch {}
}

export interface UseWebNfcOptions {
  vibrate?: boolean;
  sound?: boolean;
}

export function useWebNfc(
  onTagTap: (payload: NfcTapPayload) => void,
  options: UseWebNfcOptions = {}
) {
  const { vibrate = true, sound = true } = options;
  const vibrateRef = useRef(vibrate);
  const soundRef = useRef(sound);

  useEffect(() => {
    vibrateRef.current = vibrate;
    soundRef.current = sound;
    try {
      window.NativeFeedback?.updateFeedbackSettings?.(vibrate, sound);
    } catch {}
  }, [vibrate, sound]);

  const isCapacitorNative =
    typeof window !== 'undefined' &&
    Boolean(
      window.Capacitor?.isNativePlatform?.() ||
      window.Capacitor?.getPlatform?.() === 'android'
    );

  const isWebNfcSupported = typeof window !== 'undefined' && 'NDEFReader' in window;
  const isSupported = isCapacitorNative || isWebNfcSupported;

  const [status, setStatus] = useState<NfcStatus>(
    isCapacitorNative ? 'scanning' : isWebNfcSupported ? 'idle' : 'unsupported'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTap, setLastTap] = useState<NfcTapPayload | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const callbackRef = useRef(onTagTap);

  useEffect(() => {
    callbackRef.current = onTagTap;
  }, [onTagTap]);

  // Listen for native Android NFC tag dispatches from MainActivity
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleNativeTag = (e: Event) => {
      const customEvent = e as CustomEvent<{ tagId: string; text?: string }>;
      const tagId = customEvent.detail?.tagId?.trim().toUpperCase();
      if (!tagId) return;

      const rawRecords = customEvent.detail.text ? [customEvent.detail.text] : [];
      const payload: NfcTapPayload = {
        tagId,
        rawRecords,
        source: 'hardware',
        timestamp: Date.now(),
      };
      if (vibrateRef.current) {
        triggerNfcHaptics();
      }
      if (soundRef.current) {
        playNfcChime();
      }
      setLastTap(payload);
      callbackRef.current(payload);
    };

    window.addEventListener('nativeNfcTag', handleNativeTag);
    if (isCapacitorNative) {
      setStatus('scanning');
    }
    return () => window.removeEventListener('nativeNfcTag', handleNativeTag);
  }, [isCapacitorNative]);

  const stopScan = useCallback(() => {
    if (isCapacitorNative) {
      setStatus('idle');
      return;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus(isSupported ? 'idle' : 'unsupported');
  }, [isCapacitorNative, isSupported]);

  const startScan = useCallback(async () => {
    if (isCapacitorNative) {
      setStatus('scanning');
      setErrorMessage(null);
      return;
    }

    if (!isWebNfcSupported || !window.NDEFReader) {
      setStatus('unsupported');
      setErrorMessage(
        'Web NFC hardware scanning requires Chrome on Android over HTTPS. Use the Tag Simulator below to test on this device.'
      );
      return;
    }

    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const ndef = new window.NDEFReader();
      await ndef.scan({ signal: controller.signal });
      setStatus('scanning');
      setErrorMessage(null);

      ndef.onreading = (event: NDEFReadingEvent) => {
        const decodedRecords: string[] = [];
        const decoder = new TextDecoder();

        for (const record of event.message?.records ?? []) {
          if (record.data) {
            try {
              const text = decoder.decode(record.data).trim();
              if (text) decodedRecords.push(text);
            } catch {
              // Ignore non-UTF8 binary payloads
            }
          }
        }

        // GolfPad NFC tags identify clubs primarily via NTAG serialNumber UID or an NDEF payload ID
        const normalizedTagId =
          event.serialNumber?.trim().toUpperCase() || decodedRecords[0] || `TAG-${Date.now()}`;

        const payload: NfcTapPayload = {
          tagId: normalizedTagId,
          rawRecords: decodedRecords,
          source: 'hardware',
          timestamp: Date.now(),
        };

        if (vibrateRef.current) {
          triggerNfcHaptics();
        }
        if (soundRef.current) {
          playNfcChime();
        }
        setLastTap(payload);
        callbackRef.current(payload);
      };

      ndef.onreadingerror = () => {
        setErrorMessage('Could not read NFC tag. Hold your phone top near the club grip tag for 1 second.');
      };
    } catch (err) {
      let inIframe = false;
      try {
        inIframe = window.self !== window.top;
      } catch {
        inIframe = true;
      }
      const rawMsg = err instanceof Error ? err.message : 'Unable to start Web NFC scanner.';
      const msg =
        inIframe || rawMsg.toLowerCase().includes('frame') || rawMsg.toLowerCase().includes('not allowed')
          ? 'Hardware Web NFC is blocked inside embedded preview frames. Install the Android App or open this page directly in Chrome on Android.'
          : rawMsg;
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [isCapacitorNative, isWebNfcSupported]);

  const simulateTap = useCallback((tagId: string) => {
    const payload: NfcTapPayload = {
      tagId: tagId.trim().toUpperCase(),
      rawRecords: [`golfpad:tag:${tagId}`],
      source: 'simulated',
      timestamp: Date.now(),
    };
    if (vibrateRef.current) {
      triggerNfcHaptics();
    }
    if (soundRef.current) {
      playNfcChime();
    }
    setLastTap(payload);
    callbackRef.current(payload);
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Auto-start scanning on mount and ensure continuous scanning
  useEffect(() => {
    if (isSupported && status === 'idle') {
      void startScan();
    }
  }, [isSupported, status, startScan]);

  // Keep NFC active when app re-enters foreground or screen turns on
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleReactivation = () => {
      if (document.visibilityState === 'visible' && isSupported && status !== 'scanning') {
        void startScan();
      }
    };
    document.addEventListener('visibilitychange', handleReactivation);
    window.addEventListener('focus', handleReactivation);
    return () => {
      document.removeEventListener('visibilitychange', handleReactivation);
      window.removeEventListener('focus', handleReactivation);
    };
  }, [isSupported, status, startScan]);

  return {
    isSupported,
    status,
    errorMessage,
    lastTap,
    startScan,
    stopScan,
    simulateTap,
  };
}

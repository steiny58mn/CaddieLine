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
  }
}

export interface NfcTapPayload {
  tagId: string;
  rawRecords: string[];
  source: 'hardware' | 'simulated';
  timestamp: number;
}

export type NfcStatus = 'unsupported' | 'idle' | 'scanning' | 'error';

export function useWebNfc(onTagTap: (payload: NfcTapPayload) => void) {
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

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.([40, 30, 40]);
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
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(35);
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

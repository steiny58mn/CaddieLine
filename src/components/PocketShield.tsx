import React, { useEffect, useRef, useState } from 'react';
import { Lock, Radio, Shield, Unlock, Zap } from 'lucide-react';

interface PocketShieldProps {
  isActive: boolean;
  onExit: () => void;
  holeNumber: number;
  par: number;
  lastNfcFeedback: string | null;
}

export const PocketShield: React.FC<PocketShieldProps> = ({
  isActive,
  onExit,
  holeNumber,
  par,
  lastNfcFeedback,
}) => {
  const [holdProgress, setHoldProgress] = useState(0);
  const [recentScanNotice, setRecentScanNotice] = useState<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef<number>(0);

  // When NFC feedback changes while pocket shield is active, flash a subtle notice and vibrate
  useEffect(() => {
    if (isActive && lastNfcFeedback) {
      setRecentScanNotice(lastNfcFeedback);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([100, 60, 100]);
        } catch {}
      }
      const timer = setTimeout(() => {
        setRecentScanNotice(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isActive, lastNfcFeedback]);

  if (!isActive) return null;

  // Double-tap anywhere to wake up
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTapTimeRef.current < 380) {
      // Double tap detected!
      onExit();
      return;
    }
    lastTapTimeRef.current = now;

    // Start hold-to-wake timer
    let progress = 0;
    setHoldProgress(0);
    const interval = window.setInterval(() => {
      progress += 10;
      setHoldProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        holdTimerRef.current = null;
        onExit();
      }
    }, 60);
    holdTimerRef.current = interval;
  };

  const handleTouchEnd = () => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldProgress(0);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black select-none flex flex-col items-center justify-between p-6 sm:p-10 cursor-default"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      style={{ touchAction: 'none' }}
    >
      {/* Top minimal dim status */}
      <div className="w-full flex items-center justify-between text-neutral-600 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-neutral-600" />
          <span>POCKET SHIELD</span>
        </div>
        <div className="flex items-center gap-1.5 text-emerald-500/80">
          <Radio className="w-3 h-3 animate-pulse" />
          <span>NFC ACTIVE</span>
        </div>
      </div>

      {/* Center Notice / Feedback */}
      <div className="text-center space-y-4 max-w-xs">
        {recentScanNotice ? (
          <div className="p-4 rounded-3xl bg-emerald-950/80 border border-emerald-600/60 text-emerald-300 animate-in fade-in duration-150 space-y-1">
            <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
              <Zap className="w-4 h-4 text-amber-300" />
              <span>NFC Tag Scanned</span>
            </div>
            <div className="text-sm font-black text-white">{recentScanNotice}</div>
          </div>
        ) : (
          <div className="space-y-2 opacity-30 hover:opacity-70 transition-opacity">
            <div className="w-12 h-12 rounded-full border border-neutral-700 mx-auto flex items-center justify-center text-neutral-500">
              <Lock className="w-5 h-5" />
            </div>
            <div className="font-display text-sm font-bold text-neutral-400">
              Hole {holeNumber} · Par {par}
            </div>
            <div className="text-[11px] text-neutral-600">
              Screen dimmed to prevent pocket taps. Tap club tag anytime.
            </div>
          </div>
        )}
      </div>

      {/* Bottom Unlock Prompt with Hold Progress */}
      <div className="w-full max-w-xs space-y-3 text-center">
        {holdProgress > 0 && (
          <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-75"
              style={{ width: `${holdProgress}%` }}
            />
          </div>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExit();
          }}
          className="w-full h-12 rounded-2xl bg-neutral-900/90 border border-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800 text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <Unlock className="w-4 h-4 text-emerald-400" />
          <span>Double-Tap or Tap Here to Wake</span>
        </button>

        <p className="text-[10px] text-neutral-700">
          Phone auto-wakes when tilted upright out of your pocket
        </p>
      </div>
    </div>
  );
};

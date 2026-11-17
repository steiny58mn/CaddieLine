import React, { useEffect, useState } from 'react';
import { Crosshair, Lock, Play, RotateCcw, Ruler, Unlock, X } from 'lucide-react';
import { LatLngLiteral } from '../types/golf';
import { computeDistanceMeters, formatFeetAndInches } from '../utils/golfMath';

interface GpsTapeMeasureModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPosition: LatLngLiteral | null;
  accuracyMeters: number | null;
  onApplyDistance?: (distanceYards: number) => void;
}

export const GpsTapeMeasureModal: React.FC<GpsTapeMeasureModalProps> = ({
  isOpen,
  onClose,
  userPosition,
  accuracyMeters,
  onApplyDistance,
}) => {
  const [startPoint, setStartPoint] = useState<LatLngLiteral | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedMeters, setLockedMeters] = useState<number | null>(null);

  // If no start point is set when opening, auto-set to current GPS position if available
  useEffect(() => {
    if (isOpen && !startPoint && userPosition) {
      setStartPoint(userPosition);
      setIsLocked(false);
      setLockedMeters(null);
    }
  }, [isOpen, startPoint, userPosition]);

  if (!isOpen) return null;

  const currentDistanceMeters =
    isLocked && lockedMeters !== null
      ? lockedMeters
      : startPoint && userPosition
        ? computeDistanceMeters(startPoint, userPosition)
        : 0;

  const readout = formatFeetAndInches(currentDistanceMeters);
  const distanceYards = Math.round(currentDistanceMeters * 1.09361);
  const distanceMeters = currentDistanceMeters.toFixed(1);

  const accuracyFeet = accuracyMeters ? Math.round(accuracyMeters * 3.28084) : null;

  const handleSetStartHere = () => {
    if (userPosition) {
      setStartPoint(userPosition);
      setIsLocked(false);
      setLockedMeters(null);
    }
  };

  const handleToggleLock = () => {
    if (isLocked) {
      setIsLocked(false);
      setLockedMeters(null);
    } else {
      setIsLocked(true);
      setLockedMeters(currentDistanceMeters);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-[#131f18] border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden transition-colors">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 flex items-center justify-center">
              <Ruler className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F1A14] dark:text-slate-100">
                GPS Tape Measure
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Precise GPS walk-off distance in feet & inches
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Big Digital Readout */}
        <div className="p-6 text-center bg-slate-50 dark:bg-[#0c150f] border-b border-slate-100 dark:border-slate-800">
          <div className="inline-flex items-baseline gap-2 text-[#0F1A14] dark:text-emerald-400 font-mono font-bold tracking-tight">
            <span className="text-5xl sm:text-6xl tabular-nums">{readout.feet}</span>
            <span className="text-xl sm:text-2xl text-slate-500 dark:text-slate-400 font-sans font-medium">ft</span>
            <span className="text-5xl sm:text-6xl tabular-nums ml-2">{readout.inches}</span>
            <span className="text-xl sm:text-2xl text-slate-500 dark:text-slate-400 font-sans font-medium">in</span>
          </div>

          <div className="flex items-center justify-center gap-3 mt-3 text-xs text-slate-500 dark:text-slate-400 font-mono">
            <span>{distanceYards} yds</span>
            <span>·</span>
            <span>{distanceMeters} m</span>
            {accuracyFeet !== null && (
              <>
                <span>·</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  GPS ±{accuracyFeet} ft
                </span>
              </>
            )}
          </div>

          {isLocked && (
            <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 text-xs font-semibold">
              <Lock className="w-3.5 h-3.5" />
              <span>Measurement Frozen</span>
            </div>
          )}
        </div>

        {/* Starting Point & Live Position info */}
        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 space-y-1">
              <span className="text-slate-400 font-medium">Starting Point:</span>
              <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                {startPoint ? 'Marked at Ball' : 'Not Set'}
              </div>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 space-y-1">
              <span className="text-slate-400 font-medium">GPS Status:</span>
              <div className="font-semibold text-emerald-700 dark:text-emerald-400 truncate flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5" />
                <span>{userPosition ? 'Live Tracking' : 'Waiting for Fix'}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSetStartHere}
              disabled={!userPosition}
              className="min-h-[44px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors shadow-xs"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Start from Here</span>
            </button>

            <button
              type="button"
              onClick={handleToggleLock}
              disabled={!startPoint}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[#0F1A14] dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
            >
              {isLocked ? (
                <>
                  <Unlock className="w-4 h-4 text-amber-600" />
                  <span>Resume Live</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Freeze Distance</span>
                </>
              )}
            </button>
          </div>

          {onApplyDistance && (
            <button
              type="button"
              onClick={() => {
                onApplyDistance(distanceYards);
                onClose();
              }}
              disabled={currentDistanceMeters <= 0}
              className="w-full min-h-[44px] px-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Apply {distanceYards} yds ({readout.formatted}) to Current Shot</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

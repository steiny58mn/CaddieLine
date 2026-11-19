import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Edit3,
  Flag,
  History,
  LockOpen,
  Play,
  Radio,
  RotateCcw,
  Trash2,
  Trees,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import {
  Club,
  DistanceUnit,
  HolePinData,
  LatLngLiteral,
  RoundHoleMode,
  HoleScoreState,
  ShotDirection,
  ShotLie,
  ShotRecord,
} from '../types/golf';
import {
  CLUB_PRESETS,
  LIE_OPTIONS,
  computeDistanceYards,
  formatDistanceValue,
  getEffectivePutts,
  getNextHoleNumber,
  getPrevHoleNumber,
  getHolePenalties,
  getHoleStrokes,
  getLieMeta,
  recommendClub,
  getScoreLabel,
  isPenaltyShot,
  isShotPutt,
  unitSuffix,
} from '../utils/golfMath';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { PWAInstallButton } from './PWAInstallButton';
import { EditShotModal } from './EditShotModal';

interface ShotLoggerPanelProps {
  holeData: HolePinData;
  allHoles: Record<number, HolePinData>;
  allScores: Record<number, HoleScoreState>;
  holeScore: HoleScoreState;
  previousShot: ShotRecord | null;
  subCourseName?: string;
  holeMode?: RoundHoleMode;
  onToggleHoleMode?: (mode: RoundHoleMode) => void;
  bag: Club[];
  unit: DistanceUnit;
  playerPosition?: LatLngLiteral | null;
  selectedClubId: string;
  selectedLie: ShotLie;
  selectedDirection: ShotDirection;
  autoDetectedDistanceYards: number | null;
  lastNfcFeedback: string | null;
  onSelectHole: (holeNumber: number) => void;
  onSelectClub: (clubId: string) => void;
  onSelectLie: (lie: ShotLie) => void;
  onSelectDirection: (dir: ShotDirection) => void;
  onLogShot?: () => void;
  onAddPutt: () => void;
  onDeleteShot: (shotId: string) => void;
  onUndoLastShot: () => void;
  onPrevHole: () => void;
  onNextHole: () => void;
  onOpenBagNfc: () => void;
  onUpdateShot?: (shotId: string, updates: Partial<ShotRecord>) => void;
  onAddPenalty: () => void;
  onTrackShot: (chosenClubId?: string) => void;
  showPhoneLockedNotice?: boolean;
  onRequestDeviceUnlock?: () => void;
}

const PutterIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M16 3v14c0 1.7-1.3 3-3 3H7.5a1.5 1.5 0 0 1 0-3H13" />
    <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const CurvedLeftArrowIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M16 19.5C16 12.5 13 8.5 6.5 6.5" />
    <path d="M11 4.5 6.5 6.5l2 4.5" />
  </svg>
);

const StraightUpArrowIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 19.5V5" />
    <path d="M7.5 9.5 12 5l4.5 4.5" />
  </svg>
);

const CurvedRightArrowIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M8 19.5C8 12.5 11 8.5 17.5 6.5" />
    <path d="M13 4.5 17.5 6.5l-2 4.5" />
  </svg>
);

const LandingSpotIcon: React.FC<{ lie: ShotLie; active: boolean; className?: string }> = ({
  lie,
  active,
  className = 'w-4 h-4 shrink-0',
}) => {
  const strokeClass = active ? 'text-white' : undefined;
  switch (lie) {
    case 'fairway':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`${className} ${strokeClass ?? 'text-emerald-600 dark:text-emerald-400'}`}
          aria-hidden="true"
        >
          <path d="M6 20 9 4h6l3 16" />
          <path d="M9 10h6" />
          <path d="M8 15h8" />
        </svg>
      );
    case 'green':
      return <Flag className={`${className} ${strokeClass ?? 'text-teal-600 dark:text-teal-400'}`} />;
    case 'fringe':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`${className} ${strokeClass ?? 'text-lime-600 dark:text-lime-400'}`}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8" strokeDasharray="3 2" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'rough':
    case 'left_rough':
    case 'right_rough':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`${className} ${strokeClass ?? 'text-amber-600 dark:text-amber-400'}`}
          aria-hidden="true"
        >
          <path d="M6 19c0-5 1-8 3-11" />
          <path d="M12 19c0-6 0-10 1-14" />
          <path d="M18 19c0-5-1-8-3-11" />
        </svg>
      );
    case 'trees':
    case 'left_trees':
    case 'right_trees':
      return <Trees className={`${className} ${strokeClass ?? 'text-emerald-800 dark:text-emerald-300'}`} />;
    case 'sand':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`${className} ${strokeClass ?? 'text-yellow-600 dark:text-yellow-400'}`}
          aria-hidden="true"
        >
          <path d="M3 17c3-3 7-3 10 0s7 3 10 0" />
          <circle cx="8" cy="9" r="1.5" fill="currentColor" />
          <circle cx="14" cy="7" r="1.5" fill="currentColor" />
          <circle cx="17" cy="11" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'water':
      return <Waves className={`${className} ${strokeClass ?? 'text-sky-600 dark:text-sky-400'}`} />;
    case 'ob':
      return <Ban className={`${className} ${strokeClass ?? 'text-rose-600 dark:text-rose-400'}`} />;
    case 'holed':
      return <CheckCircle2 className={`${className} ${strokeClass ?? 'text-violet-600 dark:text-violet-400'}`} />;
    default:
      return <Flag className={`${className} ${strokeClass ?? 'text-slate-500'}`} />;
  }
};

export const ShotLoggerPanel: React.FC<ShotLoggerPanelProps> = ({
  holeData,
  allHoles,
  allScores,
  holeScore,
  previousShot,
  subCourseName,
  holeMode = '18',
  onToggleHoleMode,
  bag,
  unit,
  playerPosition,
  selectedClubId,
  selectedLie,
  selectedDirection,
  autoDetectedDistanceYards,
  lastNfcFeedback,
  onSelectHole,
  onSelectClub,
  onSelectLie,
  onSelectDirection,
  onAddPutt,
  onDeleteShot,
  onUndoLastShot,
  onPrevHole,
  onNextHole,
  onUpdateShot,
  onAddPenalty,
  onTrackShot,
  showPhoneLockedNotice,
  onRequestDeviceUnlock,
}) => {
  const [isHolePickerOpen, setIsHolePickerOpen] = useState(false);
  const [isTrackClubModalOpen, setIsTrackClubModalOpen] = useState(false);
  const [isShotLogOpen, setIsShotLogOpen] = useState(false);
  const [editingShot, setEditingShot] = useState<ShotRecord | null>(null);

  const holeStrokes = getHoleStrokes(holeScore);
  const puttsCount = getEffectivePutts(holeScore);
  const penaltiesCount = getHolePenalties(holeScore);
  const availableClubs = bag.length > 0 ? bag : CLUB_PRESETS;
  const suffix = unitSuffix(unit);
  const { isInstalled } = usePWAInstall();

  const lastNonPenShot = useMemo(() => {
    const nonPens = (holeScore.shots || []).filter((s) => !isPenaltyShot(s));
    return nonPens.length > 0 ? nonPens[nonPens.length - 1] : null;
  }, [holeScore.shots]);
  const hasOpenShot = Boolean(lastNonPenShot && !lastNonPenShot.endLatLng);
  // Deleting current shot ignores penalty strokes; deleting penalties requires going to the log
  const canUndo = holeScore.shots.some((s) => !isPenaltyShot(s)) || holeScore.manualPutts > 0;

  const lastShotDistance = useMemo(() => {
    if (!previousShot) return null;
    return previousShot.distanceYards;
  }, [previousShot]);

  // Calculate Green Distances (Front / Center / Back) from effective player position
  const greenDistances = useMemo(() => {
    const origin = playerPosition ?? holeData.teeLatLng ?? null;
    const greenCenter = holeData.greenCenterLatLng ?? null;
    const greenFront = holeData.greenFrontLatLng ?? null;
    const greenBack = holeData.greenBackLatLng ?? null;

    let center = origin && greenCenter ? computeDistanceYards(origin, greenCenter) : holeData.yardage;
    let front = origin && greenFront ? computeDistanceYards(origin, greenFront) : null;
    let back = origin && greenBack ? computeDistanceYards(origin, greenBack) : null;

    if (center !== null && front === null) {
      front = Math.max(0, center - 15);
    }
    if (center !== null && back === null) {
      back = center + 15;
    }

    return { front, center, back };
  }, [playerPosition, holeData.teeLatLng, holeData.greenCenterLatLng, holeData.greenFrontLatLng, holeData.greenBackLatLng, holeData.yardage]);

  const suggestedClub = useMemo(() => {
    return recommendClub(greenDistances.center, bag);
  }, [greenDistances.center, bag]);

  // Par styling badge
  const parBadgeColor =
    holeData.par === 3
      ? 'from-sky-500 to-blue-600 text-white'
      : holeData.par === 5
        ? 'from-amber-500 to-orange-600 text-white'
        : 'from-emerald-600 to-teal-700 text-white';

  return (
    <div className="flex flex-col h-full bg-[#f8faf8] dark:bg-[#07100a] lg:border-r border-slate-200 dark:border-slate-800/80 select-none">
      {/* 1. Hero Hole Header */}
      <div className="relative shrink-0 p-3 sm:p-4 bg-gradient-to-b from-white via-white to-slate-50/70 dark:from-[#0d1810] dark:via-[#0c160f] dark:to-[#09120c] border-b border-slate-200/90 dark:border-slate-800/90 shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          {/* Prev Hole Button */}
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onPrevHole();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 shadow-2xs shrink-0"
            aria-label="Previous hole"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          {/* Hole Title & Par / Distance Pills */}
          <div className="flex-1 min-w-0 text-center">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsHolePickerOpen((prev) => !prev)}
                className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-slate-200/80 dark:border-slate-700/80 transition-all active:scale-95"
                aria-expanded={isHolePickerOpen}
              >
                <span className="font-display text-base sm:text-lg font-black tracking-tight text-[#0F1A14] dark:text-slate-100">
                  Hole {holeData.holeNumber}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                    isHolePickerOpen ? 'rotate-180 text-emerald-600' : ''
                  }`}
                />
              </button>

              <span
                className={`px-2.5 py-0.5 rounded-lg text-xs font-black font-mono tracking-tight bg-gradient-to-r shadow-xs ${parBadgeColor}`}
              >
                PAR {holeData.par}
              </span>

              <span className="px-2 py-0.5 rounded-lg text-xs font-bold font-mono bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {formatDistanceValue(holeData.yardage, unit)} {suffix}
              </span>

              {holeData.handicap > 0 && (
                <span className="hidden xs:inline px-1.5 py-0.5 rounded text-[10px] font-bold font-mono text-slate-500 bg-slate-100 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                  HCP {holeData.handicap}
                </span>
              )}
            </div>

            {/* Loop Sub-course Label if applicable */}
            {subCourseName && (
              <div className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-400 truncate mt-1">
                {subCourseName}
              </div>
            )}
          </div>

          {/* Next Hole Button */}
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onNextHole();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 shadow-2xs shrink-0"
            aria-label="Next hole"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Hole Dropdown Picker Grid */}
        {isHolePickerOpen && (
          <div className="absolute left-3 right-3 top-full mt-2 z-40 rounded-2xl bg-white/95 dark:bg-[#0f1d13]/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between mb-2 gap-1 flex-wrap">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Switch Hole
              </span>
              {onToggleHoleMode && (
                <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => onToggleHoleMode('18')}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-colors ${
                      holeMode === '18'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    18H
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleHoleMode('front9')}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-colors ${
                      holeMode === 'front9'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    Front 9
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleHoleMode('back9')}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-colors ${
                      holeMode === 'back9'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    Back 9
                  </button>
                  {Object.keys(allHoles).length > 18 && (
                    <button
                      type="button"
                      onClick={() => onToggleHoleMode('all27')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-colors ${
                        holeMode === 'all27'
                          ? 'bg-emerald-600 text-white shadow-2xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                      }`}
                    >
                      27H
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {(holeMode === 'front9'
                ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
                : holeMode === 'back9'
                  ? [10, 11, 12, 13, 14, 15, 16, 17, 18]
                  : Array.from({ length: Math.max(18, Object.keys(allHoles).length) }, (_, idx) => idx + 1)
              ).map((num) => {
                const h = allHoles[num];
                const strokes = allScores[num] ? getHoleStrokes(allScores[num]) : 0;
                const active = num === holeData.holeNumber;
                const isMapped = Boolean(h?.teeLatLng || h?.greenCenterLatLng);
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      onSelectHole(num);
                      setIsHolePickerOpen(false);
                    }}
                    className={`min-h-[46px] rounded-xl border text-center flex flex-col items-center justify-center transition-all relative ${
                      active
                        ? 'bg-gradient-to-br from-emerald-600 to-teal-700 border-emerald-600 text-white font-black shadow-md shadow-emerald-600/30'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="text-xs font-mono font-bold leading-none">{num}</span>
                    <span
                      className={`text-[10px] font-mono leading-none mt-1 ${
                        active
                          ? 'text-emerald-100 font-bold'
                          : strokes > 0
                            ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                            : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {strokes > 0 ? strokes : `P${h?.par ?? 4}`}
                    </span>
                    {isMapped && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full absolute top-1.5 right-1.5 ${
                          active ? 'bg-white' : 'bg-emerald-500'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Phone Locked NFC Warning Pill (Title text only + Unlock Button) */}
      {showPhoneLockedNotice && (
        <div className="shrink-0 px-2.5 sm:px-3 pt-2">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700/80 px-3 py-2 flex items-center justify-between gap-2 shadow-2xs animate-in fade-in duration-150">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-xs font-bold text-amber-950 dark:text-amber-200 truncate">
                NFC Scanning Paused (Phone Locked)
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onRequestDeviceUnlock && (
                <button
                  type="button"
                  onClick={onRequestDeviceUnlock}
                  className="h-7 px-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all active:scale-95 shadow-2xs flex items-center gap-1"
                >
                  <LockOpen className="w-3.5 h-3.5" />
                  <span>Unlock</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Green Range Distance to Pin & Green Display (Above Track Shots) */}
      <div className="shrink-0 px-2.5 sm:px-3 pt-2">
        <div className="rounded-2xl bg-gradient-to-b from-white to-slate-50/90 dark:from-[#0d1810] dark:to-[#09120c] border border-slate-200/90 dark:border-slate-800/90 p-2.5 sm:p-3 flex flex-col justify-between shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 text-[10px] sm:text-[11px] font-bold tracking-wider uppercase shrink-0">
            <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
              <Crosshair className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Yards</span>
            </span>

            {/* Recommended Club centered */}
            {suggestedClub && (
              <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="text-[10px] text-slate-400 font-sans font-medium uppercase">Rec:</span>
                <span>{suggestedClub.name}</span>
              </span>
            )}

            {/* Right side icon */}
            <span className="w-4 h-4 flex items-center justify-end">
              <Flag className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 py-1">
            {/* Front of Green (Left, smaller font) */}
            <div className="flex-1 text-center min-w-0">
              <div className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center justify-center gap-1">
                <ArrowDownToLine className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Front</span>
              </div>
              <div className="text-lg sm:text-2xl font-black font-mono text-slate-700 dark:text-slate-300 tabular-nums mt-0.5">
                {greenDistances.front !== null
                  ? formatDistanceValue(greenDistances.front, unit)
                  : '—'}
              </div>
            </div>

            {/* Pin / Middle of Green (Center, expanded large prominent font) */}
            <div className="flex-[1.4] text-center min-w-0 px-2 border-x border-slate-200/70 dark:border-slate-800/70">
              <div className="text-[11px] sm:text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center justify-center gap-1">
                <Flag className="w-3.5 h-3.5 shrink-0" />
                <span>Pin</span>
              </div>
              <div className="text-3xl sm:text-4xl md:text-5xl font-black font-mono text-[#0F1A14] dark:text-white tabular-nums tracking-tight mt-0.5">
                {greenDistances.center !== null ? (
                  <>
                    <span>{formatDistanceValue(greenDistances.center, unit)}</span>
                    <span className="text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400 font-mono ml-1">
                      {suffix}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>

            {/* Back of Green (Right, smaller font) */}
            <div className="flex-1 text-center min-w-0">
              <div className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center justify-center gap-1">
                <ArrowUpToLine className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Back</span>
              </div>
              <div className="text-lg sm:text-2xl font-black font-mono text-slate-700 dark:text-slate-300 tabular-nums mt-0.5">
                {greenDistances.back !== null
                  ? formatDistanceValue(greenDistances.back, unit)
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Track Shot Action Row */}
      <div className="shrink-0 px-2.5 sm:px-3 pt-2">
        <div className="flex items-center gap-1.5 w-full">
          {/* Flight Direction Icons - Wider buttons for easy thumb tapping */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0" role="group" aria-label="Shot direction">
            <button
              type="button"
              onClick={() => onSelectDirection('left')}
              className={`h-11 w-11 sm:w-12 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                selectedDirection === 'left'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Left"
              aria-label="Left"
            >
              <CurvedLeftArrowIcon className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onSelectDirection('straight')}
              className={`h-11 w-11 sm:w-12 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                selectedDirection === 'straight'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Straight"
              aria-label="Straight"
            >
              <StraightUpArrowIcon className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onSelectDirection('right')}
              className={`h-11 w-11 sm:w-12 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                selectedDirection === 'right'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Right"
              aria-label="Right"
            >
              <CurvedRightArrowIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Track Shot Button (Opens Club Selection Modal) */}
          <button
            type="button"
            onClick={() => setIsTrackClubModalOpen(true)}
            className="h-11 px-3 flex-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-[0.96] text-white font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-600/30 transition-all whitespace-nowrap"
            title="Select club and start tracking shot distance"
          >
            <Play className="w-3.5 h-3.5 shrink-0 fill-current" />
            <span>Track Shot</span>
          </button>

          {/* Track Putt Button */}
          <button
            type="button"
            onClick={onAddPutt}
            className="h-11 px-3 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 active:scale-[0.96] text-white font-extrabold text-xs sm:text-sm inline-flex items-center gap-1 shadow-sm shadow-teal-500/30 shrink-0 transition-all whitespace-nowrap"
            title="Track a putt"
          >
            <PutterIcon className="w-3.5 h-3.5 shrink-0" />
            <span>Track Putt</span>
          </button>
        </div>
      </div>

      {/* 4. Shot Landed Panel (Where Did the Shot Land?) */}
      <div className="shrink-0 px-2.5 sm:px-3 py-1.5">
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0c160f] p-2 sm:p-2.5 shadow-2xs">
          <div className="flex items-center justify-between shrink-0 mb-1.5 px-0.5">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
              Where Did the Shot Land?
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {LIE_OPTIONS.map((option) => {
              const active = selectedLie === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelectLie(option.id)}
                  className={`h-10 sm:h-11 px-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
                    active
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/30 font-bold scale-[1.02]'
                      : 'bg-slate-50/90 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <LandingSpotIcon lie={option.id} active={active} className="w-4 h-4" />
                  <span className="text-xs font-bold leading-none truncate">
                    {option.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Flexible Spacer */}
      <div className="flex-1 min-h-[4px]" />

      {/* 5. Live Tracking Distance Badge/Banner (Green banner style above strokes & delete button) */}
      <div className="shrink-0 px-2.5 sm:px-3 pt-1">
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/60 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-200 font-semibold flex items-center justify-between gap-2 shadow-2xs">
          {/* Left Side: Lightning Icon + Last Shot Info First */}
          <div className="flex items-center gap-1.5 min-w-0">
            <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="truncate text-xs">
              {previousShot ? (
                <>
                  <span className="text-emerald-600 dark:text-emerald-400 font-black mr-1">P:</span>
                  <strong className="text-slate-900 dark:text-slate-100 font-bold">
                    {previousShot.clubName}
                  </strong>
                  {lastShotDistance !== null ? (
                    <span className="text-emerald-700 dark:text-emerald-300 font-mono font-semibold">
                      {' · '}
                      {formatDistanceValue(lastShotDistance, unit)} {suffix}
                    </span>
                  ) : previousShot.isPutt ? (
                    <span className="text-teal-600 dark:text-teal-300 font-semibold"> · Putt</span>
                  ) : null}
                </>
              ) : (
                <span className="opacity-75">
                  <span className="text-emerald-600 dark:text-emerald-400 font-black mr-1">P:</span>—
                </span>
              )}
            </span>
          </div>

          {/* Right Side: Current Club / Tracking Status */}
          <div className="flex items-center gap-1.5 shrink-0 text-right">
            {hasOpenShot ? (
              <div className="inline-flex items-center gap-1">
                <Radio className="w-3 h-3 text-emerald-600 dark:text-emerald-400 animate-pulse shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400 font-black">C:</span>
                <span className="font-extrabold text-[#0F1A14] dark:text-slate-100">
                  {lastNonPenShot?.clubName ?? "Shot"}
                </span>
                <span className="font-mono font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {autoDetectedDistanceYards !== null
                    ? `${formatDistanceValue(autoDetectedDistanceYards, unit)} ${suffix}`
                    : 'Walking...'}
                </span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400 font-black">C:</span>
                <span className="font-mono text-emerald-800 dark:text-emerald-300 opacity-90">
                  Ready
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 6. Strokes / Putts / Penalty & Log Row (Directly below distance banner, above delete button, NO next button) */}
      <div className="shrink-0 px-2.5 sm:px-3 pt-2">
        <div className="flex items-center justify-between gap-1.5 min-h-[44px]">
          {/* Left Group: Strokes + Putts + Penalties */}
          <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
            <div
              className="h-11 w-[52px] min-w-[52px] px-2 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 flex items-center justify-center gap-1.5 text-sky-800 dark:text-sky-300 shadow-2xs shrink-0"
              title="Total Strokes on Hole"
            >
              <Flag className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="text-xs font-mono font-bold tabular-nums">{holeStrokes || 0}</span>
            </div>

            <div
              className="h-11 w-[52px] min-w-[52px] px-2 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200/80 dark:border-teal-800/50 flex items-center justify-center gap-1.5 text-teal-800 dark:text-teal-300 shadow-2xs shrink-0"
              title="Putts on Green"
            >
              <PutterIcon className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
              <span className="text-xs font-mono font-bold tabular-nums">{puttsCount}</span>
            </div>

            {/* Quick +1 Penalty Button */}
            <button
              type="button"
              onClick={onAddPenalty}
              className="h-11 w-[52px] min-w-[52px] px-2 rounded-xl bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-800/60 flex items-center justify-center gap-1.5 text-rose-800 dark:text-rose-300 shadow-2xs shrink-0 transition-all active:scale-95"
              title={penaltiesCount > 0 ? `Penalty Strokes: ${penaltiesCount} (Tap to add)` : 'Add Penalty Stroke'}
              aria-label={penaltiesCount > 0 ? `Add penalty stroke, current count ${penaltiesCount}` : 'Add Penalty Stroke'}
            >
              <Ban className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span className="text-xs font-mono font-bold tabular-nums">{penaltiesCount}</span>
            </button>
          </div>

          {/* Log Modal Button on Far Right */}
          <button
            type="button"
            onClick={() => setIsShotLogOpen(true)}
            className="h-11 w-[68px] min-w-[68px] px-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 text-xs font-bold transition-all active:scale-95 shadow-2xs shrink-0"
            title={`View Hole ${holeData.holeNumber} Shot Log (${holeScore.shots.length})`}
          >
            <History className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>Log</span>
            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[10px] text-emerald-700 dark:text-emerald-400 font-bold min-w-[18px] text-center">
              {holeScore.shots.length}
            </span>
          </button>
        </div>
      </div>

      {/* 7. Delete Current Shot Button (Anchored to the very bottom with ample safety padding) */}
      <div className="shrink-0 px-2.5 sm:px-3 pt-4 pb-3">
        <button
          type="button"
          onClick={onUndoLastShot}
          disabled={!canUndo}
          className="w-full h-11 px-4 rounded-2xl border border-rose-300 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none shadow-2xs"
          title="Delete current shot"
        >
          <Trash2 className="w-4 h-4 shrink-0 text-rose-500" />
          <span>Delete current shot</span>
        </button>
      </div>

      {/* PWA Install Banner if applicable */}
      {!isInstalled && (
        <div className="px-3 pb-2 flex items-center justify-between gap-3 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-900/40 mx-2.5 mb-1">
          <span className="text-[11px] text-emerald-900 dark:text-emerald-300 font-medium">
            Install to Home Screen for hardware NFC club scanning
          </span>
          <PWAInstallButton variant="compact" />
        </div>
      )}

      {/* Shot Log Modal */}
      {isShotLogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsShotLogOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#0c160f] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-3.5 sm:p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-display font-black text-base text-slate-900 dark:text-white">
                  Hole {holeData.holeNumber} Shot Log
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
                  {holeScore.shots.length} {holeScore.shots.length === 1 ? 'shot' : 'shots'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsShotLogOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Shots List */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2">
              {holeScore.shots.length === 0 ? (
                <div className="p-8 text-center text-slate-400 dark:text-slate-500 space-y-1">
                  <p className="font-semibold text-sm">No shots logged on Hole {holeData.holeNumber} yet.</p>
                  <p className="text-xs">Tap &ldquo;Track Shot&rdquo; or scan your GolfPad NFC tag to begin tracking.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/50">
                  {(() => {
                    const regularShots = holeScore.shots.filter((s) => !isPenaltyShot(s));
                    const penaltyShots = holeScore.shots.filter((s) => isPenaltyShot(s));
                    const sortedLogShots = [...regularShots, ...penaltyShots];

                    return sortedLogShots.map((shot: ShotRecord) => {
                      const isPen = isPenaltyShot(shot);
                      const lieMeta = getLieMeta(shot.lie);
                      const isActiveOpenShot =
                        !isPen && shot.id === lastNonPenShot?.id && !shot.endLatLng;
                    const isPutt = isShotPutt(shot);
                    const displayDistance =
                      isPen
                        ? '+1 Penalty Stroke'
                        : shot.distanceYards !== null
                          ? `${formatDistanceValue(shot.distanceYards, unit)} ${suffix}`
                          : isPutt
                            ? 'Green'
                            : isActiveOpenShot && autoDetectedDistanceYards !== null
                              ? `${formatDistanceValue(autoDetectedDistanceYards, unit)} ${suffix} (live)`
                              : isActiveOpenShot
                                ? 'Tracking GPS'
                                : 'GPS waiting';

                    return (
                      <div
                        key={shot.id}
                        className={`px-3 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                          isPen
                            ? 'bg-rose-50/70 dark:bg-rose-950/30'
                            : isActiveOpenShot
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/40'
                              : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <div
                          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                          onClick={() => !isPen && setEditingShot(shot)}
                          role="button"
                          tabIndex={0}
                          title={isPen ? 'Penalty Stroke' : 'Click to edit shot details'}
                        >
                          <span
                            className={`w-7 h-7 rounded-full text-white text-xs font-black flex items-center justify-center shrink-0 shadow-xs ${
                              isPen ? 'bg-rose-600' : ''
                            }`}
                            style={isPen ? undefined : { backgroundColor: lieMeta.dotColor }}
                          >
                            {isPen ? 'P' : shot.strokeNumber}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                              <span className={isPen ? 'text-rose-700 dark:text-rose-300 font-extrabold' : ''}>
                                {shot.clubName}
                              </span>
                              <span className="text-slate-400 font-normal">·</span>
                              <span
                                className="font-semibold text-xs px-1.5 py-0.2 rounded"
                                style={
                                  isPen
                                    ? { backgroundColor: '#ffe4e6', color: '#be123c' }
                                    : {
                                        backgroundColor: `${lieMeta.dotColor}18`,
                                        color: lieMeta.dotColor,
                                      }
                                }
                              >
                                {isPen ? '+1 Penalty' : isActiveOpenShot ? 'In Progress' : lieMeta.label}
                              </span>
                              {isPutt && (
                                <span className="text-[10px] font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 px-1 rounded">
                                  Putt
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {displayDistance}
                              {!isPen && (
                                <>
                                  {' · '}
                                  {shot.direction === 'straight'
                                    ? 'Straight'
                                    : shot.direction.charAt(0).toUpperCase() + shot.direction.slice(1)}
                                  {shot.source === 'nfc' ? ' · NFC' : ''}
                                  {shot.penaltyStrokes > 0 ? ` · +${shot.penaltyStrokes} Pen` : ''}
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {!isPen && (
                            <button
                              type="button"
                              onClick={() => setEditingShot(shot)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
                              aria-label={`Edit shot ${shot.strokeNumber}`}
                              title="Edit shot"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteShot(shot.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                            aria-label={`Delete ${isPen ? 'penalty' : `shot ${shot.strokeNumber}`}`}
                            title={isPen ? 'Delete penalty' : 'Delete shot'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsShotLogOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Shot Modal */}
      {(() => {
        const editingShotIndex = editingShot ? holeScore.shots.findIndex((s) => s.id === editingShot.id) : -1;
        const previousShotLie = editingShotIndex > 0 ? holeScore.shots[editingShotIndex - 1]?.lie : null;
        return (
          <EditShotModal
            shot={editingShot}
            isOpen={Boolean(editingShot)}
            onClose={() => setEditingShot(null)}
            onSave={(shotId, updates) => {
              onUpdateShot?.(shotId, updates);
              setEditingShot(null);
            }}
            onDelete={(shotId) => {
              onDeleteShot(shotId);
              setEditingShot(null);
            }}
            bag={availableClubs}
            previousShotLie={previousShotLie}
          />
        );
      })()}
          {/* Club Picker Modal when Tracking Shot */}
      {isTrackClubModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#0d1711] rounded-3xl border border-slate-200 dark:border-slate-800 p-4 w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-display font-black text-base text-[#0F1A14] dark:text-white">
                  Track Shot · Select Club
                </h3>
                <p className="text-xs text-slate-500">
                  Select which club you are hitting
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTrackClubModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white flex items-center justify-center font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="py-3 grid grid-cols-3 sm:grid-cols-4 gap-2 overflow-y-auto no-scrollbar max-h-[60vh]">
              {availableClubs.map((club) => {
                const isSelected = club.id === selectedClubId;
                return (
                  <button
                    key={club.id}
                    type="button"
                    onClick={() => {
                      setIsTrackClubModalOpen(false);
                      onTrackShot(club.id);
                    }}
                    className={`p-2.5 rounded-2xl border text-center flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
                      isSelected
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-600 shadow-md scale-[1.02]'
                        : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-[#0F1A14] dark:text-slate-100 hover:border-emerald-400'
                    }`}
                  >
                    <span className="font-mono text-base font-black leading-none">
                      {club.shortName}
                    </span>
                    <span className="text-[10px] leading-tight font-medium opacity-80 truncate max-w-full">
                      {club.name}
                    </span>
                    {club.typicalYards && (
                      <span className="text-[9px] font-mono opacity-60">
                        {club.typicalYards} {suffix}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

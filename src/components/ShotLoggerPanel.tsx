import React, { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Edit3,
  Flag,
  History,
  Radio,
  RotateCcw,
  Ruler,
  Shield,
  Trash2,
  Trees,
  Waves,
  Zap,
} from 'lucide-react';
import {
  Club,
  DistanceUnit,
  HolePinData,
  HoleScoreState,
  ShotDirection,
  ShotLie,
  ShotRecord,
} from '../types/golf';
import {
  CLUB_PRESETS,
  LIE_OPTIONS,
  formatDistanceValue,
  getEffectivePutts,
  getHolePenalties,
  getHoleStrokes,
  getLieMeta,
  getScoreLabel,
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
  bag: Club[];
  unit: DistanceUnit;
  selectedClubId: string;
  selectedLie: ShotLie;
  selectedDirection: ShotDirection;
  autoDetectedDistanceYards: number | null;
  lastNfcFeedback: string | null;
  onSelectHole: (holeNumber: number) => void;
  onSelectClub: (clubId: string) => void;
  onSelectLie: (lie: ShotLie) => void;
  onSelectDirection: (dir: ShotDirection) => void;
  onLogShot: () => void;
  onAddPutt: () => void;
  onDeleteShot: (shotId: string) => void;
  onUndoLastShot: () => void;
  onPrevHole: () => void;
  onNextHole: () => void;
  onOpenBagNfc: () => void;
  onUpdateShot?: (shotId: string, updates: Partial<ShotRecord>) => void;
  onAddPenalty: () => void;
  onEnterPocketShield?: () => void;
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

const LandingSpotIcon: React.FC<{ lie: ShotLie; active: boolean }> = ({ lie, active }) => {
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
          className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-emerald-600 dark:text-emerald-400'}`}
          aria-hidden="true"
        >
          <path d="M6 20 9 4h6l3 16" />
          <path d="M9 10h6" />
          <path d="M8 15h8" />
        </svg>
      );
    case 'green':
      return <Flag className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-teal-600 dark:text-teal-400'}`} />;
    case 'fringe':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-lime-600 dark:text-lime-400'}`}
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
          className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-amber-600 dark:text-amber-400'}`}
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
      return <Trees className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-emerald-800 dark:text-emerald-300'}`} />;
    case 'sand':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-yellow-600 dark:text-yellow-400'}`}
          aria-hidden="true"
        >
          <path d="M3 17c3-3 7-3 10 0s7 3 10 0" />
          <circle cx="8" cy="9" r="1.5" fill="currentColor" />
          <circle cx="14" cy="7" r="1.5" fill="currentColor" />
          <circle cx="17" cy="11" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'water':
      return <Waves className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-sky-600 dark:text-sky-400'}`} />;
    case 'ob':
      return <Ban className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-rose-600 dark:text-rose-400'}`} />;
    case 'holed':
      return <CheckCircle2 className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-violet-600 dark:text-violet-400'}`} />;
    default:
      return <Flag className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-slate-500'}`} />;
  }
};

const CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'wood', label: 'Woods', color: 'from-blue-600 to-indigo-600' },
  { id: 'hybrid', label: 'Hybrids', color: 'from-purple-600 to-indigo-600' },
  { id: 'iron', label: 'Irons', color: 'from-emerald-600 to-teal-600' },
  { id: 'wedge', label: 'Wedges', color: 'from-amber-500 to-orange-600' },
  { id: 'putter', label: 'Putter', color: 'from-rose-500 to-pink-600' },
];

export const ShotLoggerPanel: React.FC<ShotLoggerPanelProps> = ({
  holeData,
  allHoles,
  allScores,
  holeScore,
  previousShot,
  subCourseName,
  bag,
  unit,
  selectedClubId,
  selectedLie,
  selectedDirection,
  autoDetectedDistanceYards,
  lastNfcFeedback,
  onSelectHole,
  onSelectClub,
  onSelectLie,
  onSelectDirection,
  onLogShot,
  onAddPutt,
  onDeleteShot,
  onUndoLastShot,
  onPrevHole,
  onNextHole,
  onOpenBagNfc,
  onUpdateShot,
  onAddPenalty,
  onEnterPocketShield,
}) => {
  const [isHolePickerOpen, setIsHolePickerOpen] = useState(false);
  const [editingShot, setEditingShot] = useState<ShotRecord | null>(null);
  const [clubCategoryFilter, setClubCategoryFilter] = useState<string>('all');

  const holeStrokes = getHoleStrokes(holeScore);
  const puttsCount = getEffectivePutts(holeScore);
  const penaltiesCount = getHolePenalties(holeScore);
  const availableClubs = bag.length > 0 ? bag : CLUB_PRESETS;
  const selectedClub = availableClubs.find((c) => c.id === selectedClubId) ?? availableClubs[0];
  const suffix = unitSuffix(unit);
  const { isInstalled } = usePWAInstall();

  const lastShot = holeScore.shots[holeScore.shots.length - 1];
  const hasOpenNfcShot = Boolean(lastShot && lastShot.source === 'nfc' && !lastShot.endLatLng);
  const canUndo = holeScore.shots.length > 0 || holeScore.manualPutts > 0;

  // Filter clubs by category for quick-tap bar
  const displayedClubs = useMemo(() => {
    if (clubCategoryFilter === 'all') return availableClubs;
    return availableClubs.filter((c) => c.category === clubCategoryFilter);
  }, [availableClubs, clubCategoryFilter]);

  // Par styling badge
  const parBadgeColor =
    holeData.par === 3
      ? 'from-sky-500 to-blue-600 text-white'
      : holeData.par === 5
        ? 'from-amber-500 to-orange-600 text-white'
        : 'from-emerald-600 to-teal-700 text-white';

  return (
    <div className="flex flex-col h-full bg-[#f8faf8] dark:bg-[#07100a] lg:border-r border-slate-200 dark:border-slate-800/80 select-none">
      {/* Hero Hole Card */}
      <div className="relative shrink-0 p-3 sm:p-4 bg-gradient-to-b from-white via-white to-slate-50/70 dark:from-[#0d1810] dark:via-[#0c160f] dark:to-[#09120c] border-b border-slate-200/90 dark:border-slate-800/90 shadow-2xs">
        {/* Top Hole Control Strip */}
        <div className="flex items-center justify-between gap-2">
          {/* Prev Hole Button */}
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onPrevHole();
            }}
            disabled={holeData.holeNumber <= 1}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95 shadow-2xs shrink-0"
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
            disabled={holeData.holeNumber >= 18}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95 shadow-2xs shrink-0"
            aria-label="Next hole"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Athletic Hole Status Ribbon */}
        <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between gap-2">
          {/* Live Hole Score Summary */}
          <div className="flex items-center gap-2">
            <div className="px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-1.5 shadow-2xs">
              <span className="text-[11px] font-medium text-slate-500">Strokes:</span>
              <span className="font-mono font-black text-sm text-[#0F1A14] dark:text-white">
                {holeStrokes || 0}
              </span>
              {holeStrokes > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded-md ${
                    holeStrokes - holeData.par < 0
                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                      : holeStrokes - holeData.par === 0
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                  }`}
                >
                  {getScoreLabel(holeStrokes, holeData.par)}
                </span>
              )}
            </div>

            <div className="px-2 py-1 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200/80 dark:border-teal-800/50 flex items-center gap-1 text-teal-800 dark:text-teal-300 shadow-2xs">
              <PutterIcon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span className="text-[11px] font-mono font-bold">{puttsCount}</span>
            </div>

            {penaltiesCount > 0 && (
              <div className="px-2 py-1 rounded-xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 flex items-center gap-1 text-rose-700 dark:text-rose-300 text-[11px] font-mono font-bold">
                +{penaltiesCount} Pen
              </div>
            )}
          </div>

          {/* Live Shot / Previous Shot readout */}
          <div className="flex items-center gap-2 text-right">
            {autoDetectedDistanceYards !== null ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 font-mono text-xs font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-radar" />
                <span>
                  {formatDistanceValue(autoDetectedDistanceYards, unit)} {suffix}
                </span>
              </div>
            ) : previousShot ? (
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[140px] sm:max-w-[180px]">
                <span className="opacity-75">Last:</span>{' '}
                <strong className="text-slate-800 dark:text-slate-200 font-bold">
                  {previousShot.clubShortName}
                </strong>
                {previousShot.distanceYards !== null && (
                  <span className="text-emerald-700 dark:text-emerald-400 font-mono font-semibold">
                    {' · '}
                    {formatDistanceValue(previousShot.distanceYards, unit)}
                    {suffix}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Hole Dropdown Picker Grid */}
        {isHolePickerOpen && (
          <div className="absolute left-3 right-3 top-full mt-2 z-40 rounded-2xl bg-white/95 dark:bg-[#0f1d13]/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Switch Hole
              </span>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Mapped Hole
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: 18 }, (_, idx) => idx + 1).map((num) => {
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

      {/* Main Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3.5">
        {/* Active NFC / GPS Tracking Banner */}
        {hasOpenNfcShot && (
          <div className="rounded-2xl p-3 bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/25 flex items-center justify-between gap-3 animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative w-9 h-9 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0">
                <Radio className="w-5 h-5 animate-pulse" />
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border-2 border-emerald-600" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-100">
                  Tracking Live Shot #{holeScore.shots.length}
                </div>
                <div className="text-sm font-extrabold truncate">
                  {lastShot.clubName} ({lastShot.clubShortName})
                </div>
              </div>
            </div>
            <div className="text-right shrink-0 font-mono">
              <div className="text-lg font-black tabular-nums">
                {autoDetectedDistanceYards !== null
                  ? `${formatDistanceValue(autoDetectedDistanceYards, unit)} ${suffix}`
                  : 'Walking...'}
              </div>
              <div className="text-[10px] text-emerald-100 opacity-90">Scan next club tag</div>
            </div>
          </div>
        )}

        {lastNfcFeedback && (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2 text-xs text-emerald-950 dark:text-emerald-200 font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{lastNfcFeedback}</span>
          </div>
        )}

        {/* Club Selection Dropdown */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0c160f] p-3 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="club-select-dropdown" className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span>Club:</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-black">
                {selectedClub?.shortName}
              </span>
              <span className="text-slate-400 font-normal">({selectedClub?.name})</span>
            </label>

            {bag.length === 0 ? (
              <button
                type="button"
                onClick={onOpenBagNfc}
                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
              >
                + Pair Bag Tags
              </button>
            ) : (
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                Avg {formatDistanceValue(selectedClub?.typicalYards, unit)} {suffix}
              </span>
            )}
          </div>

          <select
            id="club-select-dropdown"
            value={selectedClubId}
            onChange={(e) => onSelectClub(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {availableClubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.shortName} · {club.name} ({formatDistanceValue(club.typicalYards, unit)} {suffix})
              </option>
            ))}
          </select>
        </div>

        {/* Shot Lie / Landing Spot (Colorful Tactile Grid) */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0c160f] p-3 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Where Did the Shot Land?
            </span>
            <span className="text-[11px] font-semibold text-slate-500">
              {getLieMeta(selectedLie).label}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {LIE_OPTIONS.map((option) => {
              const active = selectedLie === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelectLie(option.id)}
                  className={`min-h-[50px] p-2 rounded-xl border text-center flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
                    active
                      ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white border-emerald-600 shadow-md shadow-emerald-600/30 font-bold scale-[1.02]'
                      : 'bg-slate-50/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <LandingSpotIcon lie={option.id} active={active} />
                  <span className="text-xs font-semibold leading-tight truncate max-w-full">
                    {option.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Direction, Log Shot, & Undo in the SAME ROW with icons */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0c160f] p-3 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Flight Direction & Shot Action
            </span>
            <span className="text-xs font-bold capitalize text-slate-500 dark:text-slate-400">
              {selectedDirection}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Direction icons (Left, Straight, Right) */}
            <div className="flex-1 grid grid-cols-3 gap-1 sm:gap-1.5" role="group" aria-label="Shot direction">
              <button
                type="button"
                onClick={() => onSelectDirection('left')}
                className={`h-12 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                  selectedDirection === 'left'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Left"
                aria-label="Left"
              >
                <CurvedLeftArrowIcon className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => onSelectDirection('straight')}
                className={`h-12 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                  selectedDirection === 'straight'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Straight"
                aria-label="Straight"
              >
                <StraightUpArrowIcon className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => onSelectDirection('right')}
                className={`h-12 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                  selectedDirection === 'right'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Right"
                aria-label="Right"
              >
                <CurvedRightArrowIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Log Shot Button (Icon) */}
            <button
              type="button"
              onClick={onLogShot}
              className="h-12 w-14 sm:w-16 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-[0.96] text-white shadow-md shadow-emerald-600/30 flex items-center justify-center shrink-0 transition-all"
              title={hasOpenNfcShot ? 'Finish Shot' : 'Log Shot'}
              aria-label={hasOpenNfcShot ? 'Finish Shot' : 'Log Shot'}
            >
              <Flag className="w-5 h-5 fill-current" />
            </button>

            {/* Undo Button (Icon) */}
            <button
              type="button"
              onClick={onUndoLastShot}
              disabled={!canUndo}
              className="h-12 w-12 sm:w-14 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center shrink-0 transition-all shadow-2xs"
              title="Undo Last Shot"
              aria-label="Undo Last Shot"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Modifiers: +1 Putt, +1 Penalty, & Pocket Shield */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-0.5">
          {/* +1 PUTT BUTTON */}
          <button
            type="button"
            onClick={onAddPutt}
            className="h-12 rounded-xl bg-gradient-to-r from-teal-500 via-teal-600 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 active:scale-[0.98] text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-teal-500/25 transition-all"
          >
            <PutterIcon className="w-4 h-4" />
            <span>+1 Putt</span>
          </button>

          {/* QUICK BUTTON TO ADD A PENALTY STROKE */}
          <button
            type="button"
            onClick={onAddPenalty}
            className="h-12 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 active:scale-[0.98] font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-2xs transition-all"
            title="Add 1 Penalty Stroke (+1 Pen)"
          >
            <Ban className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span>+1 Penalty</span>
          </button>

          {/* POCKET SHIELD BUTTON */}
          {onEnterPocketShield && (
            <button
              type="button"
              onClick={onEnterPocketShield}
              className="col-span-2 sm:col-span-1 h-12 rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/60 dark:bg-purple-950/20 hover:bg-purple-100/60 dark:hover:bg-purple-900/40 text-purple-800 dark:text-purple-300 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
              title="Pocket Shield: Dim OLED screen & lock touches while Web NFC scans"
            >
              <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
              <span>Pocket Shield</span>
            </button>
          )}
        </div>

        {/* Shot Log Feed for Current Hole */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span>Hole {holeData.holeNumber} Shot Log</span>
              <span className="px-1.5 py-0.2 rounded-md bg-slate-200 dark:bg-slate-800 text-[10px] font-mono">
                {holeScore.shots.length}
              </span>
            </h3>
            {holeData.holeNumber < 18 && (
              <button
                type="button"
                onClick={onNextHole}
                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                Finish & Next Hole →
              </button>
            )}
          </div>

          {holeScore.shots.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400 text-center space-y-1 shadow-2xs">
              <div className="font-semibold text-slate-700 dark:text-slate-300">
                No shots logged on Hole {holeData.holeNumber} yet
              </div>
              <div className="text-[11px] opacity-80">
                Tap your club's GolfPad NFC tag, or tap &ldquo;Log Shot&rdquo; above.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs bg-white dark:bg-slate-900">
              {holeScore.shots.map((shot: ShotRecord, idx) => {
                const lieMeta = getLieMeta(shot.lie);
                const isActiveOpenNfc =
                  idx === holeScore.shots.length - 1 &&
                  shot.source === 'nfc' &&
                  !shot.endLatLng;
                const isPutt = isShotPutt(shot);
                const displayDistance =
                  shot.distanceYards !== null
                    ? `${formatDistanceValue(shot.distanceYards, unit)} ${suffix}`
                    : isPutt
                      ? 'Green'
                      : isActiveOpenNfc && autoDetectedDistanceYards !== null
                        ? `${formatDistanceValue(autoDetectedDistanceYards, unit)} ${suffix} (live)`
                        : isActiveOpenNfc
                          ? 'Tracking GPS'
                          : 'GPS waiting';

                return (
                  <div
                    key={shot.id}
                    className={`px-3 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                      isActiveOpenNfc
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div
                      className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                      onClick={() => setEditingShot(shot)}
                      role="button"
                      tabIndex={0}
                      title="Click to edit shot details"
                    >
                      <span
                        className="w-7 h-7 rounded-full text-white text-xs font-black flex items-center justify-center shrink-0 shadow-xs"
                        style={{ backgroundColor: lieMeta.dotColor }}
                      >
                        {shot.strokeNumber}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                          <span>{shot.clubName}</span>
                          <span className="text-slate-400 font-normal">·</span>
                          <span
                            className="font-semibold text-xs px-1.5 py-0.2 rounded"
                            style={{
                              backgroundColor: `${lieMeta.dotColor}18`,
                              color: lieMeta.dotColor,
                            }}
                          >
                            {isActiveOpenNfc ? 'In Progress' : lieMeta.label}
                          </span>
                          {isPutt && (
                            <span className="text-[10px] font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 px-1 rounded">
                              Putt
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {displayDistance}
                          {' · '}
                          {shot.direction === 'straight'
                            ? 'Straight'
                            : shot.direction.charAt(0).toUpperCase() + shot.direction.slice(1)}
                          {shot.source === 'nfc' ? ' · NFC' : ''}
                          {shot.penaltyStrokes > 0 ? ` · +${shot.penaltyStrokes} Pen` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditingShot(shot)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
                        aria-label={`Edit shot ${shot.strokeNumber}`}
                        title="Edit shot"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteShot(shot.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                        aria-label={`Delete shot ${shot.strokeNumber}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* PWA Install Banner if applicable */}
        {!isInstalled && (
          <div className="pt-2 flex items-center justify-between gap-3 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
            <span className="text-[11px] text-emerald-900 dark:text-emerald-300 font-medium">
              Install to Home Screen for hardware NFC club scanning
            </span>
            <PWAInstallButton variant="compact" />
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
      </div>
    </div>
  );
};

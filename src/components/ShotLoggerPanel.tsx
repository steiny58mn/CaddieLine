import React, { useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  History,
  RotateCcw,
  Trash2,
  Trees,
  Waves,
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

const CurvedLeftArrowIcon: React.FC<{ className?: string }> = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.15"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M16 19.5C16 12.5 13 8.5 6.5 6.5" />
    <path d="M11 4.5 6.5 6.5l2 4.5" />
  </svg>
);

const StraightUpArrowIcon: React.FC<{ className?: string }> = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.15"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 19.5V5" />
    <path d="M7.5 9.5 12 5l4.5 4.5" />
  </svg>
);

const CurvedRightArrowIcon: React.FC<{ className?: string }> = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.15"
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
          className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-emerald-600'}`}
          aria-hidden="true"
        >
          <path d="M6 20 9 4h6l3 16" />
          <path d="M9 10h6" />
          <path d="M8 15h8" />
        </svg>
      );
    case 'green':
      return <Flag className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-teal-600'}`} />;
    case 'fringe':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-lime-600'}`}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8" strokeDasharray="3 2" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'rough':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-amber-600'}`}
          aria-hidden="true"
        >
          <path d="M6 19c0-5 1-8 3-11" />
          <path d="M12 19c0-6 0-10 1-14" />
          <path d="M18 19c0-5-1-8-3-11" />
        </svg>
      );
    case 'trees':
      return <Trees className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-orange-600'}`} />;
    case 'sand':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-yellow-600'}`}
          aria-hidden="true"
        >
          <path d="M4 16c2-5 6-7 10-5 2.5 1.2 4 0 6-2v7c-2 2-5 3-9 3-4.5 0-7-1.2-7-3Z" />
        </svg>
      );
    case 'water':
      return <Waves className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-sky-600'}`} />;
    case 'ob':
      return <Ban className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-rose-600'}`} />;
    case 'holed':
      return <CheckCircle2 className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-emerald-700'}`} />;
    default:
      return <Flag className={`w-4 h-4 shrink-0 ${strokeClass ?? 'text-slate-600'}`} />;
  }
};

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
}) => {
  const [isHolePickerOpen, setIsHolePickerOpen] = useState(false);
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

  return (
    <div className="flex flex-col h-full bg-white lg:border-r border-slate-200">
      {/* Hole Navigation Header (Read-only API Par + Putt Button + Live Shot Distance & Previous Shot) */}
      <div className="relative shrink-0 px-3 sm:px-4 py-2.5 border-b border-slate-200 bg-[#FAFBFA] space-y-2">
        <div className="flex items-center justify-between w-full gap-2">
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onPrevHole();
            }}
            disabled={holeData.holeNumber <= 1}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors shrink-0"
            aria-label="Previous hole"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="px-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsHolePickerOpen((prev) => !prev)}
                className="font-display text-lg font-bold text-[#0F1A14] hover:text-emerald-800 inline-flex items-center gap-1 rounded-lg px-1 -ml-1 py-0.5 hover:bg-slate-200/60 transition-colors"
                aria-expanded={isHolePickerOpen}
                aria-label="Choose hole number"
              >
                <span>Hole {holeData.holeNumber}</span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 transition-transform ${
                    isHolePickerOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="text-xs font-mono font-bold text-[#0F1A14]">
                Par {holeData.par}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {formatDistanceValue(holeData.yardage, unit)} {suffix}
              </span>
              {(() => {
                if (!subCourseName) return null;
                if (subCourseName.includes('/')) {
                  const [frontRaw, backRaw] = subCourseName.split('/').map((s) => s.trim());
                  const isBack = holeData.holeNumber > 9;
                  const loopLabel = isBack ? backRaw : frontRaw;
                  const localHole = isBack ? holeData.holeNumber - 9 : holeData.holeNumber;
                  if (!loopLabel) return null;
                  return (
                    <>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-xs font-semibold text-emerald-800 whitespace-nowrap">
                        {loopLabel} #{localHole}
                      </span>
                    </>
                  );
                }
                return (
                  <>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-xs font-semibold text-emerald-800 whitespace-nowrap">
                      {subCourseName}
                    </span>
                  </>
                );
              })()}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums truncate">
              Hole: <strong className="text-[#0F1A14]">{holeStrokes || '—'}</strong>{' '}
              {holeStrokes > 0 && `(${getScoreLabel(holeStrokes, holeData.par)})`}
              {puttsCount > 0 && (
                <span className="ml-2 text-slate-500">
                  · <strong className="text-[#0F1A14]">{puttsCount}</strong>{' '}
                  {puttsCount === 1 ? 'putt' : 'putts'}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onAddPutt}
            className="min-h-[44px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            title="Add 1 Putt on Green"
            aria-label="Add putt"
          >
            <PutterIcon className="w-4 h-4 text-emerald-700" />
            <span>+ Putt</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onNextHole();
            }}
            disabled={holeData.holeNumber >= 18}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors shrink-0"
            aria-label="Next hole"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Centered Live Shot Distance + Previous Shot Strip inside Hole Panel */}
        <div className="pt-1.5 border-t border-slate-200/80 flex items-center justify-center flex-wrap gap-x-3 gap-y-1 text-[11px] leading-tight text-center">
          <div className="inline-flex items-center gap-1.5 font-mono tabular-nums shrink-0">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                autoDetectedDistanceYards !== null ? 'bg-emerald-600 animate-pulse' : 'bg-slate-300'
              }`}
              aria-hidden="true"
            />
            <span className="text-slate-500 font-sans font-medium">Shot:</span>
            <strong className="text-[#0F1A14] font-bold">
              {autoDetectedDistanceYards !== null
                ? `${formatDistanceValue(autoDetectedDistanceYards, unit)} ${suffix}`
                : `-- ${suffix}`}
            </strong>
          </div>

          <span className="text-slate-300" aria-hidden="true">
            |
          </span>

          <div className="inline-flex items-center gap-1 min-w-0 max-w-full text-slate-600">
            <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {previousShot ? (
              <span className="truncate tabular-nums">
                <span className="text-slate-500">Prev H{previousShot.holeNumber} #{previousShot.strokeNumber}:</span>{' '}
                <strong className="text-[#0F1A14] font-semibold">{previousShot.clubShortName}</strong>
                {previousShot.distanceYards !== null && (
                  <span className="font-mono font-semibold text-emerald-800">
                    {' '}
                    · {formatDistanceValue(previousShot.distanceYards, unit)} {suffix}
                  </span>
                )}
                <span className="text-slate-500"> · {getLieMeta(previousShot.lie).shortLabel}</span>
              </span>
            ) : (
              <span className="text-slate-400">Prev: —</span>
            )}
          </div>
        </div>

        {isHolePickerOpen && (
          <div className="absolute left-3 right-3 top-full mt-1.5 z-30 rounded-2xl bg-white border border-slate-200 shadow-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700">Select Hole</span>
              <span className="text-[11px] text-emerald-700 font-medium">● Mapped</span>
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
                    className={`min-h-[44px] rounded-xl border text-center flex flex-col items-center justify-center transition-colors relative ${
                      active
                        ? 'bg-emerald-700 border-emerald-700 text-white font-bold'
                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-emerald-50'
                    }`}
                  >
                    <span className="text-xs font-mono leading-none">{num}</span>
                    <span
                      className={`text-[10px] font-mono leading-none mt-1 ${
                        active ? 'text-emerald-100' : 'text-slate-500'
                      }`}
                    >
                      {strokes > 0 ? strokes : `P${h?.par ?? 4}`}
                    </span>
                    {isMapped && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full absolute top-1 right-1 ${
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

      {/* Scrollable Shot Logger Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {lastNfcFeedback && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs text-emerald-950 font-medium">
            {lastNfcFeedback}
          </div>
        )}

        {/* Single-Row Club Selected, Direction Arrows, Flag Log Shot & Undo Panel */}
        <div className="rounded-2xl border border-slate-200 bg-[#FAFBFA] p-2.5 sm:p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="club-selected-dropdown" className="text-xs font-semibold text-slate-700">
              Club Selected & Direction
            </label>
            {bag.length === 0 ? (
              <button
                type="button"
                onClick={onOpenBagNfc}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 whitespace-nowrap"
              >
                Pair Saved Clubs →
              </button>
            ) : (
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                Avg {formatDistanceValue(selectedClub?.typicalYards, unit)} {suffix}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5">
            <select
              id="club-selected-dropdown"
              value={selectedClub?.id ?? ''}
              onChange={(e) => onSelectClub(e.target.value)}
              className="flex-1 min-w-0 h-11 px-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-semibold text-[#0F1A14] focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              {bag.length > 0 ? (
                bag.map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.shortName} · {club.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="" disabled>
                    No clubs paired
                  </option>
                  {CLUB_PRESETS.map((club) => (
                    <option key={club.id} value={club.id}>
                      {club.shortName} · {club.name}
                    </option>
                  ))}
                </>
              )}
            </select>

            <div
              className="inline-flex items-center gap-1 sm:gap-1.5 shrink-0"
              role="group"
              aria-label="Shot direction"
            >
              <button
                type="button"
                onClick={() => onSelectDirection('left')}
                className={`h-11 w-[42px] sm:w-12 rounded-xl border flex items-center justify-center transition-colors ${
                  selectedDirection === 'left'
                    ? 'bg-[#0F1A14] text-white border-[#0F1A14]'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
                aria-label="Left direction"
                title="Left"
              >
                <CurvedLeftArrowIcon />
              </button>
              <button
                type="button"
                onClick={() => onSelectDirection('straight')}
                className={`h-11 w-[42px] sm:w-12 rounded-xl border flex items-center justify-center transition-colors ${
                  selectedDirection === 'straight'
                    ? 'bg-[#0F1A14] text-white border-[#0F1A14]'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
                aria-label="Straight direction"
                title="Straight"
              >
                <StraightUpArrowIcon />
              </button>
              <button
                type="button"
                onClick={() => onSelectDirection('right')}
                className={`h-11 w-[42px] sm:w-12 rounded-xl border flex items-center justify-center transition-colors ${
                  selectedDirection === 'right'
                    ? 'bg-[#0F1A14] text-white border-[#0F1A14]'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
                aria-label="Right direction"
                title="Right"
              >
                <CurvedRightArrowIcon />
              </button>
            </div>

            <button
              type="button"
              onClick={onLogShot}
              className="h-11 w-[42px] sm:w-12 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white shadow-sm flex items-center justify-center shrink-0 transition-all"
              title={
                hasOpenNfcShot
                  ? `Finish Shot #${holeScore.shots.length} · ${lastShot.clubShortName} (${getLieMeta(selectedLie).shortLabel})`
                  : `Log Shot #${holeScore.shots.length + 1} · ${selectedClub?.shortName ?? 'Club'} (${getLieMeta(selectedLie).shortLabel})`
              }
              aria-label={
                hasOpenNfcShot
                  ? `Finish Shot ${holeScore.shots.length}`
                  : `Log Shot ${holeScore.shots.length + 1}`
              }
            >
              <Flag className="w-[18px] h-[18px]" />
            </button>

            <button
              type="button"
              onClick={onUndoLastShot}
              disabled={!canUndo}
              className="h-11 w-[42px] sm:w-12 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shrink-0 transition-colors"
              title="Undo last shot or putt"
              aria-label="Undo last shot"
            >
              <RotateCcw className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* Where Shot Landed (Unified Compact Icon Grid) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700">Where Shot Landed</span>
            {penaltiesCount > 0 && (
              <span className="text-xs font-mono font-semibold text-rose-700 tabular-nums">
                +{penaltiesCount} penalty
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {LIE_OPTIONS.map((option) => {
              const active = selectedLie === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelectLie(option.id)}
                  className={`min-h-[48px] px-2 py-2 rounded-xl border text-center flex flex-col items-center justify-center gap-1 transition-colors ${
                    active
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <LandingSpotIcon lie={option.id} active={active} />
                  <span className="text-[11px] font-semibold leading-none truncate max-w-full">
                    {option.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Shot Log Feed for Current Hole */}
        <div className="pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-slate-700">
              Hole {holeData.holeNumber} Shot Log ({holeScore.shots.length})
            </h3>
            {holeData.holeNumber < 18 && (
              <button
                type="button"
                onClick={onNextHole}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 whitespace-nowrap"
              >
                Finish & Next Hole →
              </button>
            )}
          </div>

          {holeScore.shots.length === 0 ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-3 text-xs text-slate-500">
              No shots logged on Hole {holeData.holeNumber} yet. Tap a GolfPad NFC tag on your club
              to start tracking GPS shot distance automatically, or log a shot above.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
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
                        ? `${formatDistanceValue(autoDetectedDistanceYards, unit)} ${suffix} (live GPS)`
                        : isActiveOpenNfc
                          ? 'Tracking GPS · scan next tag to end'
                          : 'GPS waiting';

                return (
                  <div
                    key={shot.id}
                    className={`px-3 py-2.5 flex items-center justify-between gap-2 ${
                      isActiveOpenNfc ? 'bg-emerald-50/60' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-6 h-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center shrink-0"
                        style={{ backgroundColor: lieMeta.dotColor }}
                      >
                        {shot.strokeNumber}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#0F1A14] truncate">
                          {shot.clubName}
                          <span className="text-slate-400 font-normal mx-1">·</span>
                          <span className="font-medium text-slate-700">
                            {isActiveOpenNfc ? 'In Progress' : lieMeta.label}
                          </span>
                          {isPutt && (
                            <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">
                              · Putt
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
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
                    <button
                      type="button"
                      onClick={() => onDeleteShot(shot.id)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                      aria-label={`Delete shot ${shot.strokeNumber}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Android / Mobile Standalone Install Row (auto-hides once installed) */}
        {!isInstalled && (
          <div className="pt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500">
              Install to Android Home Screen for hardware NFC tag scanning
            </span>
            <PWAInstallButton variant="compact" />
          </div>
        )}
      </div>
    </div>
  );
};

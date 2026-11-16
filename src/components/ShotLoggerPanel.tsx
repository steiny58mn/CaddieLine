import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  Minus,
  Nfc,
  Plus,
  RotateCcw,
  Trash2,
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
  DIRECTION_OPTIONS,
  LIE_OPTIONS,
  formatDistanceValue,
  formatRelativeToPar,
  getEffectivePutts,
  getHolePenalties,
  getHoleStrokes,
  getLieMeta,
  getScoreLabel,
  unitSuffix,
} from '../utils/golfMath';
import { NfcStatus } from '../hooks/useWebNfc';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { PWAInstallButton } from './PWAInstallButton';

interface ShotLoggerPanelProps {
  holeData: HolePinData;
  allHoles: Record<number, HolePinData>;
  allScores: Record<number, HoleScoreState>;
  holeScore: HoleScoreState;
  totalScoreRelativeToPar: number;
  holesPlayedCount: number;
  bag: Club[];
  unit: DistanceUnit;
  selectedClubId: string;
  selectedLie: ShotLie;
  selectedDirection: ShotDirection;
  manualDistanceYards: string;
  autoDetectedDistanceYards: number | null;
  nfcStatus: NfcStatus;
  nfcSupported: boolean;
  lastNfcFeedback: string | null;
  onSelectHole: (holeNumber: number) => void;
  onSelectClub: (clubId: string) => void;
  onSelectLie: (lie: ShotLie) => void;
  onSelectDirection: (dir: ShotDirection) => void;
  onChangeManualDistance: (val: string) => void;
  onLogShot: () => void;
  onDeleteShot: (shotId: string) => void;
  onUndoLastShot: () => void;
  onUpdatePutts: (putts: number) => void;
  onUpdateHoleMeta: (patch: Partial<HolePinData>) => void;
  onPrevHole: () => void;
  onNextHole: () => void;
  onToggleNfcScan: () => void;
  onOpenBagNfc: () => void;
}

export const ShotLoggerPanel: React.FC<ShotLoggerPanelProps> = ({
  holeData,
  allHoles,
  allScores,
  holeScore,
  totalScoreRelativeToPar,
  holesPlayedCount,
  bag,
  unit,
  selectedClubId,
  selectedLie,
  selectedDirection,
  manualDistanceYards,
  autoDetectedDistanceYards,
  nfcStatus,
  nfcSupported,
  lastNfcFeedback,
  onSelectHole,
  onSelectClub,
  onSelectLie,
  onSelectDirection,
  onChangeManualDistance,
  onLogShot,
  onDeleteShot,
  onUndoLastShot,
  onUpdatePutts,
  onUpdateHoleMeta,
  onPrevHole,
  onNextHole,
  onToggleNfcScan,
  onOpenBagNfc,
}) => {
  const [isHolePickerOpen, setIsHolePickerOpen] = useState(false);
  const holeStrokes = getHoleStrokes(holeScore);
  const puttsCount = getEffectivePutts(holeScore);
  const penaltiesCount = getHolePenalties(holeScore);
  const selectedClub = bag.find((c) => c.id === selectedClubId) ?? bag[0];
  const suffix = unitSuffix(unit);
  const { isInstalled } = usePWAInstall();

  return (
    <div className="flex flex-col h-full bg-white border-t lg:border-t-0 lg:border-l border-slate-200">
      {/* Hole Navigation & Live Score Header */}
      <div className="relative px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-[#FAFBFA]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onPrevHole();
            }}
            disabled={holeData.holeNumber <= 1}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            aria-label="Previous hole"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="px-2">
            <div className="flex items-center gap-2">
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
              <label className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                <span>Par</span>
                <select
                  value={holeData.par}
                  onChange={(e) => onUpdateHoleMeta({ par: Number(e.target.value) })}
                  className="bg-slate-100 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-[#0F1A14] border border-slate-200"
                  aria-label="Hole par"
                >
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </label>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {formatDistanceValue(holeData.yardage, unit)} {suffix}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Hole: <strong className="text-[#0F1A14]">{holeStrokes || '—'}</strong>{' '}
              {holeStrokes > 0 && `(${getScoreLabel(holeStrokes, holeData.par)})`}
              <span className="mx-1.5 text-slate-300" aria-hidden="true">
                ·
              </span>
              Round: <strong className="text-emerald-800">{formatRelativeToPar(totalScoreRelativeToPar)}</strong>{' '}
              ({holesPlayedCount} played)
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onNextHole();
            }}
            disabled={holeData.holeNumber >= 18}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            aria-label="Next hole"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Web NFC Quick Toggle */}
        <button
          type="button"
          onClick={nfcSupported ? onToggleNfcScan : onOpenBagNfc}
          className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
            nfcStatus === 'scanning'
              ? 'bg-emerald-700 text-white border-emerald-700'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
          title="GolfPad NFC Sensor Scanner"
        >
          <Nfc className="w-4 h-4" />
          <span>{nfcStatus === 'scanning' ? 'NFC Active' : 'NFC Tap'}</span>
        </button>

        {isHolePickerOpen && (
          <div className="absolute left-3 right-3 top-full mt-1.5 z-30 rounded-2xl bg-white border border-slate-200 shadow-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700">
                Select Hole (zooms map to hole)
              </span>
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
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {lastNfcFeedback && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs text-emerald-950 font-medium flex items-center justify-between gap-2">
            <span>{lastNfcFeedback}</span>
          </div>
        )}

        {/* 1. Club Selector */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700">
              1. Club Selected — <span className="text-[#0F1A14]">{selectedClub?.name}</span>
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              Avg {formatDistanceValue(selectedClub?.typicalYards, unit)} {suffix}
            </span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {bag.map((club) => {
              const active = club.id === selectedClubId;
              return (
                <button
                  key={club.id}
                  type="button"
                  onClick={() => onSelectClub(club.id)}
                  className={`min-h-[44px] min-w-[52px] px-2.5 py-1.5 rounded-xl border text-center transition-colors shrink-0 flex flex-col items-center justify-center ${
                    active
                      ? 'bg-[#0F1A14] text-white border-[#0F1A14] shadow-sm'
                      : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className="text-xs font-bold leading-none">{club.shortName}</span>
                  <span
                    className={`text-[10px] font-mono tabular-nums mt-1 leading-none ${
                      active ? 'text-emerald-300' : 'text-slate-500'
                    }`}
                  >
                    {club.category === 'putter' ? 'Green' : `${formatDistanceValue(club.typicalYards, unit)}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Where Did the Shot Go? (Lie & Result) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700">2. Where Shot Landed</span>
            {penaltiesCount > 0 && (
              <span className="text-xs font-mono font-semibold text-rose-700 tabular-nums">
                +{penaltiesCount} penalty
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {LIE_OPTIONS.map((option) => {
              const active = selectedLie === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelectLie(option.id)}
                  className={`min-h-[44px] px-3 py-2 rounded-xl border text-left text-xs font-semibold flex items-center gap-2 transition-colors ${
                    active
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/60"
                    style={{ backgroundColor: active ? '#FFFFFF' : option.dotColor }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Shot Line / Miss Direction + Distance */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-2">
              3. Shot Direction
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {DIRECTION_OPTIONS.slice(0, 3).map((dir) => {
                const active = selectedDirection === dir.id;
                return (
                  <button
                    key={dir.id}
                    type="button"
                    onClick={() => onSelectDirection(dir.id)}
                    className={`min-h-[44px] px-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
                      active
                        ? 'bg-[#0F1A14] text-white border-[#0F1A14]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {dir.id === 'left' && <ArrowLeft className="w-3.5 h-3.5" />}
                    {dir.id === 'straight' && <Check className="w-3.5 h-3.5" />}
                    {dir.id === 'right' && <ArrowRight className="w-3.5 h-3.5" />}
                    <span>{dir.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="shot-distance-input" className="text-xs font-semibold text-slate-700">
                Shot Distance ({suffix})
              </label>
              {autoDetectedDistanceYards !== null && (
                <button
                  type="button"
                  onClick={() => onChangeManualDistance(String(autoDetectedDistanceYards))}
                  className="text-[11px] font-mono font-semibold text-emerald-700 hover:underline"
                >
                  GPS: {formatDistanceValue(autoDetectedDistanceYards, unit)}
                  {suffix}
                </button>
              )}
            </div>
            <input
              id="shot-distance-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={450}
              value={manualDistanceYards}
              onChange={(e) => onChangeManualDistance(e.target.value)}
              placeholder={
                autoDetectedDistanceYards !== null
                  ? String(autoDetectedDistanceYards)
                  : selectedClub?.category === 'putter'
                    ? '12'
                    : String(selectedClub?.typicalYards ?? 150)
              }
              className="w-full h-[44px] px-3 rounded-xl border border-slate-300 font-mono text-sm tabular-nums text-[#0F1A14] focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        </div>

        {/* Log Shot Primary Action */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLogShot}
            className="flex-1 h-12 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white font-semibold text-sm shadow-sm flex items-center justify-center gap-2 transition-all"
          >
            <Flag className="w-4 h-4" />
            <span>
              Log Shot #{holeScore.shots.length + 1} · {selectedClub?.shortName} (
              {getLieMeta(selectedLie).shortLabel})
            </span>
          </button>
          {holeScore.shots.length > 0 && (
            <button
              type="button"
              onClick={onUndoLastShot}
              className="h-12 w-12 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center justify-center shrink-0"
              title="Undo last shot"
              aria-label="Undo last shot"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick Putts Counter & Finish Hole */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-700">Putts on Green</div>
            <div className="text-[11px] text-slate-500">Auto-updates hole score</div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onUpdatePutts(Math.max(0, puttsCount - 1))}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700"
              aria-label="Decrease putts"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-9 text-center font-mono text-base font-bold tabular-nums text-[#0F1A14]">
              {puttsCount}
            </span>
            <button
              type="button"
              onClick={() => onUpdatePutts(puttsCount + 1)}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700"
              aria-label="Increase putts"
            >
              <Plus className="w-4 h-4" />
            </button>
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
            <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-3.5 text-xs text-slate-500">
              No shots logged on Hole {holeData.holeNumber} yet. Choose a club and where the shot
              went, tap a GolfPad NFC tag, or tap &ldquo;Tap Shot End&rdquo; on the map.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {holeScore.shots.map((shot: ShotRecord) => {
                const lieMeta = getLieMeta(shot.lie);
                return (
                  <div
                    key={shot.id}
                    className="px-3 py-2.5 bg-white flex items-center justify-between gap-2"
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
                          <span className="font-medium text-slate-700">{lieMeta.label}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                          {shot.distanceYards !== null
                            ? `${formatDistanceValue(shot.distanceYards, unit)} ${suffix}`
                            : 'Distance not set'}
                          {' · '}
                          {shot.direction === 'straight'
                            ? 'On Line'
                            : shot.direction.charAt(0).toUpperCase() + shot.direction.slice(1)}
                          {shot.source === 'nfc' ? ' · NFC Tag' : ''}
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

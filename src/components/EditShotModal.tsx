import React, { useEffect, useState } from 'react';
import { Check, Edit3, Trash2, X } from 'lucide-react';
import { Club, ShotDirection, ShotLie, ShotRecord } from '../types/golf';
import { CLUB_PRESETS, ClubPreset, getLieMeta, isPutterClub } from '../utils/golfMath';

interface EditShotModalProps {
  shot: ShotRecord | null;
  previousShotLie?: ShotLie | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (shotId: string, updates: Partial<ShotRecord>) => void;
  onDelete: (shotId: string) => void;
  bag: (Club | ClubPreset)[];
}

const LIE_OPTIONS: ShotLie[] = [
  'fairway',
  'rough',
  'sand',
  'green',
  'fringe',
  'trees',
  'water',
  'ob',
  'holed',
];

const DIRECTION_OPTIONS: ShotDirection[] = [
  'straight',
  'left',
  'right',
  'short',
  'long',
];

export const EditShotModal: React.FC<EditShotModalProps> = ({
  shot,
  previousShotLie,
  isOpen,
  onClose,
  onSave,
  onDelete,
  bag,
}) => {
  const [selectedClubId, setSelectedClubId] = useState('');
  const [selectedLie, setSelectedLie] = useState<ShotLie>('fairway');
  const [selectedDirection, setSelectedDirection] = useState<ShotDirection>('straight');
  const [distanceYards, setDistanceYards] = useState<number>(0);
  const [penaltyStrokes, setPenaltyStrokes] = useState<number>(0);
  const [isPuttOverride, setIsPuttOverride] = useState<boolean | null>(null);

  const clubPool = bag && bag.length > 0 ? bag : CLUB_PRESETS;

  useEffect(() => {
    if (shot) {
      setSelectedClubId(shot.clubId);
      setSelectedLie(shot.lie);
      setSelectedDirection(shot.direction);
      setDistanceYards(shot.distanceYards ?? 0);
      setPenaltyStrokes(shot.penaltyStrokes ?? 0);
      setIsPuttOverride(shot.isPuttManualOverride ? (shot.isPutt ?? false) : null);
    }
  }, [shot]);

  if (!isOpen || !shot) return null;

  const currentClub =
    clubPool.find((c) => c.id === selectedClubId) ??
    clubPool[0];

  const isCurrentPutter = isPutterClub(currentClub);

  // Default rule evaluation:
  // - Manually added putts (+1 Putt button) are assumed to be putts.
  // - Scanned putters count as putts ONLY if previous shot landed on the green.
  // - Other clubs are regular strokes.
  const defaultIsPutt = shot.source === 'manual' && shot.isPutt
    ? true
    : isCurrentPutter
      ? (previousShotLie !== undefined ? previousShotLie === 'green' : (shot.isPutt ?? false))
      : false;

  const effectiveIsPutt = isPuttOverride !== null ? isPuttOverride : defaultIsPutt;

  const handleLieChange = (lie: ShotLie) => {
    setSelectedLie(lie);
    const meta = getLieMeta(lie);
    setPenaltyStrokes(meta.penalty);
  };

  const handleSave = () => {
    onSave(shot.id, {
      clubId: currentClub.id,
      clubName: currentClub.name,
      clubShortName: currentClub.shortName,
      lie: selectedLie,
      direction: selectedDirection,
      distanceYards: distanceYards > 0 ? distanceYards : null,
      penaltyStrokes,
      isPutt: effectiveIsPutt,
      isPuttManualOverride: isPuttOverride !== null ? true : shot.isPuttManualOverride,
    });
    onClose();
  };

  const handleDelete = () => {
    onDelete(shot.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="bg-white dark:bg-[#101b13] border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-[#0F1A14] dark:text-slate-100">
                Edit Shot #{shot.strokeNumber}
              </h2>
              <p className="text-[11px] text-slate-500">
                Hole {shot.holeNumber} · {shot.source === 'nfc' ? 'NFC Club Scan' : 'Manual Entry'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Club Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Club Used for this Shot
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200/80 dark:border-slate-800">
              {clubPool.map((c) => {
                const isSelected = selectedClubId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedClubId(c.id)}
                    className={`h-8 px-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
                      isSelected
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/30'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {c.shortName} <span className="text-[10px] font-normal opacity-80">({c.name})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lie Selection (Where Shot Ended Up) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Where Shot Ended Up (Landing Lie)
              </label>
              <span className="text-[11px] font-semibold text-slate-500">
                {getLieMeta(selectedLie).label}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {LIE_OPTIONS.map((lie) => {
                const meta = getLieMeta(lie);
                const isSelected = selectedLie === lie;
                return (
                  <button
                    key={lie}
                    type="button"
                    onClick={() => handleLieChange(lie)}
                    className={`h-10 px-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 border ${
                      isSelected
                        ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white border-emerald-600 shadow-sm shadow-emerald-600/30 font-bold'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: meta.dotColor }}
                    />
                    <span className="truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Putt Designation & Manual Override Toggle */}
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-2 mt-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 flex-wrap">
                    <span>Count as Putt</span>
                    <span
                      className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-md ${
                        effectiveIsPutt
                          ? 'bg-teal-100 text-teal-800 dark:bg-teal-950/80 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                          : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {effectiveIsPutt ? 'PUTT (+1)' : 'REGULAR STROKE'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isPuttOverride !== null ? (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        Manual override active: {effectiveIsPutt ? 'Counted as putt' : 'Counted as stroke'}
                      </span>
                    ) : shot.source === 'manual' && shot.isPutt ? (
                      'Assumed as putt (manually entered putt)'
                    ) : isCurrentPutter ? (
                      previousShotLie === 'green'
                        ? 'Counted as putt (previous shot landed on green)'
                        : `Texas wedge from ${previousShotLie || 'off green'} (counted as regular stroke)`
                    ) : (
                      'Approach stroke (landing on green does not make it a putt)'
                    )}
                  </div>
                </div>

                {/* Manual Override Segmented Buttons */}
                <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-800 p-1 rounded-xl shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsPuttOverride(false)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                      !effectiveIsPutt
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Stroke
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPuttOverride(true)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                      effectiveIsPutt
                        ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Putt
                  </button>
                </div>
              </div>

              {isPuttOverride !== null && (
                <button
                  type="button"
                  onClick={() => setIsPuttOverride(null)}
                  className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                >
                  Reset to automatic rule ({defaultIsPutt ? 'Putt' : 'Regular Stroke'})
                </button>
              )}
            </div>
          </div>

          {/* Direction */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Shot Direction
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {DIRECTION_OPTIONS.map((dir) => {
                const isSelected = selectedDirection === dir;
                return (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setSelectedDirection(dir)}
                    className={`h-9 px-2 rounded-xl text-xs font-bold capitalize border transition-all ${
                      isSelected
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {dir}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Distance */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Distance (Yards)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={550}
                value={distanceYards || ''}
                onChange={(e) => setDistanceYards(Math.max(0, parseInt(e.target.value) || 0))}
                className="flex-1 h-11 px-3 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-[#0F1A14] dark:text-slate-100 font-mono"
                placeholder="Yards"
              />
              <div className="flex items-center gap-1">
                {[-10, -1, 1, 10].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => setDistanceYards((prev) => Math.max(0, prev + delta))}
                    className="h-11 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Penalty */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Penalty Strokes
            </span>
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((pen) => (
                <button
                  key={pen}
                  type="button"
                  onClick={() => setPenaltyStrokes(pen)}
                  className={`w-10 h-9 rounded-xl text-xs font-black border transition-colors ${
                    penaltyStrokes === pen
                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  +{pen}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-[#0c150f]/50">
          <button
            type="button"
            onClick={handleDelete}
            className="h-11 px-3.5 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="h-11 px-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/25"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

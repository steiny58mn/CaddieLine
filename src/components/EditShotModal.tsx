import React, { useEffect, useState } from 'react';
import { Check, Edit3, Trash2, X } from 'lucide-react';
import { Club, ShotDirection, ShotLie, ShotRecord } from '../types/golf';
import { CLUB_PRESETS, ClubPreset, getLieMeta } from '../utils/golfMath';

interface EditShotModalProps {
  shot: ShotRecord | null;
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

  const clubPool = bag && bag.length > 0 ? bag : CLUB_PRESETS;

  useEffect(() => {
    if (shot) {
      setSelectedClubId(shot.clubId);
      setSelectedLie(shot.lie);
      setSelectedDirection(shot.direction);
      setDistanceYards(shot.distanceYards ?? 0);
      setPenaltyStrokes(shot.penaltyStrokes ?? 0);
    }
  }, [shot]);

  if (!isOpen || !shot) return null;

  const currentClub =
    clubPool.find((c) => c.id === selectedClubId) ??
    clubPool[0];

  const isGreenOrHoled = selectedLie === 'green' || selectedLie === 'holed';

  const handleLieChange = (lie: ShotLie) => {
    setSelectedLie(lie);
    // If user changes to green and club is not putter, suggest putter if available
    if (lie === 'green' && selectedClubId !== 'pt') {
      const putter = clubPool.find((c) => c.category === 'putter' || c.id === 'pt');
      if (putter) setSelectedClubId(putter.id);
    }
    // Update default penalty
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
      isPutt: isGreenOrHoled,
    });
    onClose();
  };

  const handleDelete = () => {
    onDelete(shot.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-[#101b13] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0F1A14] dark:text-slate-100">
                Edit Shot #{shot.strokeNumber}
              </h2>
              <p className="text-[11px] text-slate-500">
                Hole {shot.holeNumber} · {shot.source === 'nfc' ? 'NFC Tracked' : 'Manual Entry'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Club Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Club Used
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
              {clubPool.map((c) => {
                const isSelected = selectedClubId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedClubId(c.id)}
                    className={`h-8 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                      isSelected
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {c.shortName} <span className="text-[10px] font-normal opacity-80">({c.name})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lie Selection & Surface */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Lie & Surface
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {LIE_OPTIONS.map((lie) => {
                const meta = getLieMeta(lie);
                const isSelected = selectedLie === lie;
                return (
                  <button
                    key={lie}
                    type="button"
                    onClick={() => handleLieChange(lie)}
                    className={`h-9 px-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 border ${
                      isSelected
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
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

            {/* Dynamic Putt Notification Banner */}
            <div
              className={`p-2.5 rounded-xl text-xs font-medium flex items-center gap-2 mt-2 transition-colors ${
                isGreenOrHoled
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
              }`}
            >
              {isGreenOrHoled ? (
                <>
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Counted as a Putt (adds +1 to hole putts)</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />
                  <span>Lie is off green — not counted as a putt (-1 if previously a putt)</span>
                </>
              )}
            </div>
          </div>

          {/* Direction */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
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
                    className={`h-8 px-2 rounded-xl text-xs font-semibold capitalize border transition-all ${
                      isSelected
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
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
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Distance (Yards)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={550}
                value={distanceYards || ''}
                onChange={(e) => setDistanceYards(Math.max(0, parseInt(e.target.value) || 0))}
                className="flex-1 h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-[#0F1A14] dark:text-slate-100 font-mono"
                placeholder="Yards"
              />
              <div className="flex items-center gap-1">
                {[-10, -1, 1, 10].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => setDistanceYards((prev) => Math.max(0, prev + delta))}
                    className="h-11 px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Penalty */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Penalty Strokes
            </span>
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((pen) => (
                <button
                  key={pen}
                  type="button"
                  onClick={() => setPenaltyStrokes(pen)}
                  className={`w-9 h-8 rounded-lg text-xs font-bold border transition-colors ${
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
            className="h-11 px-3.5 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="h-11 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors shadow-xs"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

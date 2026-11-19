import React, { useState } from 'react';
import { Check, CheckCircle2, Layers, Nfc, Plus, Smartphone, Trash2 } from 'lucide-react';
import { Club, ClubCategory, DistanceUnit } from '../types/golf';
import { CLUB_PRESETS, ClubPreset, sortGolfClubs, unitSuffix } from '../utils/golfMath';
import { NfcStatus, NfcTapPayload } from '../hooks/useWebNfc';
import { PWAInstallButton } from './PWAInstallButton';

interface BagNfcViewProps {
  bag: Club[];
  unit: DistanceUnit;
  nfcSupported: boolean;
  nfcStatus: NfcStatus;
  nfcError: string | null;
  lastNfcTap: NfcTapPayload | null;
  pairingTarget: ClubPreset | null;
  autoLogOnNfc: boolean;
  onChangeUnit: (unit: DistanceUnit) => void;
  onToggleAutoLogOnNfc: (val: boolean) => void;
  onStopNfcScan: () => void;
  onStartPairClub: (club: ClubPreset) => void;
  onCancelPairing: () => void;
  onUpdateClub: (clubId: string, patch: Partial<Club>) => void;
  onAddClub: (club: Club) => void;
  onAddMultipleClubs?: (clubs: Club[]) => void;
  onDeleteClub: (clubId: string) => void;
  nfcVibrateEnabled?: boolean;
  onToggleNfcVibrate?: (enabled: boolean) => void;
  nfcSoundEnabled?: boolean;
  onToggleNfcSound?: (enabled: boolean) => void;
  onSimulateTagTap?: (tagId: string) => void;
}

const STANDARD_14_IDS = ['dr', '3w', '5w', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'pw', 'gw', 'sw', 'pt'];

export const BagNfcView: React.FC<BagNfcViewProps> = ({
  bag,
  unit,
  nfcSupported,
  nfcStatus,
  nfcError,
  lastNfcTap,
  pairingTarget,
  autoLogOnNfc,
  onChangeUnit,
  onToggleAutoLogOnNfc,
  onStartPairClub,
  onCancelPairing,
  onUpdateClub,
  onAddClub,
  onAddMultipleClubs,
  onDeleteClub,
  nfcVibrateEnabled = true,
  onToggleNfcVibrate,
  nfcSoundEnabled = true,
  onToggleNfcSound,
}) => {
  const [newClubName, setNewClubName] = useState('');
  const [newClubAbbr, setNewClubAbbr] = useState('');
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());

  const suffix = unitSuffix(unit);

  const handleCreateClub = (e?: React.FormEvent, shouldScan: boolean = false) => {
    e?.preventDefault();
    const trimmedName = newClubName.trim();
    if (!trimmedName) return;

    const lower = trimmedName.toLowerCase();
    const category: ClubCategory = lower.includes('putt')
      ? 'putter'
      : lower.includes('wedge') || /^\d\d°/.test(trimmedName) || /\b(pw|gw|sw|lw|aw)\b/i.test(lower)
        ? 'wedge'
        : lower.includes('hybrid') || /\b\dh\b/.test(lower)
          ? 'hybrid'
          : lower.includes('wood') || lower.includes('driver') || /\b\dw\b/.test(lower)
            ? 'wood'
            : 'iron';

    const typicalYards =
      category === 'putter' ? 10 : category === 'wedge' ? 100 : category === 'wood' ? 220 : 165;

    const firstToken = trimmedName.split(/\s+/)[0] ?? trimmedName;
    const autoShort =
      firstToken.length <= 4 ? firstToken.toUpperCase() : trimmedName.slice(0, 3).toUpperCase();
    const shortName = newClubAbbr.trim() ? newClubAbbr.trim().toUpperCase() : autoShort;

    const id = `club_${Date.now()}`;
    const created: Club = {
      id,
      name: trimmedName,
      shortName,
      category,
      typicalYards,
    };
    onAddClub(created);
    if (shouldScan) {
      onStartPairClub(created);
    }
    setNewClubName('');
    setNewClubAbbr('');
  };

  const handleAddStandard14 = () => {
    const existingIds = new Set(bag.map((c) => c.id));
    const toAdd: Club[] = [];
    for (const presetId of STANDARD_14_IDS) {
      if (!existingIds.has(presetId)) {
        const preset = CLUB_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          toAdd.push({
            id: preset.id,
            name: preset.name,
            shortName: preset.shortName,
            category: preset.category,
            typicalYards: preset.typicalYards,
          });
        }
      }
    }
    if (toAdd.length > 0) {
      if (onAddMultipleClubs) {
        onAddMultipleClubs(toAdd);
      } else {
        toAdd.forEach((c) => onAddClub(c));
      }
    }
    setSelectedPresets(new Set());
  };

  const handleTogglePresetSelection = (presetId: string) => {
    setSelectedPresets((prev) => {
      const next = new Set(prev);
      if (next.has(presetId)) {
        next.delete(presetId);
      } else {
        next.add(presetId);
      }
      return next;
    });
  };

  const handleAddSelectedPresets = () => {
    if (selectedPresets.size === 0) return;
    const existingIds = new Set(bag.map((c) => c.id));
    const toAdd: Club[] = [];
    selectedPresets.forEach((presetId) => {
      if (!existingIds.has(presetId)) {
        const preset = CLUB_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          toAdd.push({
            id: preset.id,
            name: preset.name,
            shortName: preset.shortName,
            category: preset.category,
            typicalYards: preset.typicalYards,
          });
        }
      }
    });
    if (toAdd.length > 0) {
      if (onAddMultipleClubs) {
        onAddMultipleClubs(toAdd);
      } else {
        toAdd.forEach((c) => onAddClub(c));
      }
    }
    setSelectedPresets(new Set());
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-28 lg:pb-12 text-slate-900 dark:text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500">
            Hardware NFC Tag Sensors ·{' '}
            {bag.length === 0 ? 'No clubs in bag' : `${bag.length} clubs configured`}
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black text-[#0F1A14] dark:text-slate-100 tracking-tight mt-0.5">
            GolfBag & NFC Sensors
          </h2>
        </div>

        {/* Units Toggle */}
        <div className="inline-flex items-center p-1 bg-slate-200/80 dark:bg-slate-800 rounded-2xl self-start sm:self-auto border border-slate-300/60 dark:border-slate-700/60">
          <button
            type="button"
            onClick={() => onChangeUnit('yards')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
              unit === 'yards' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-bold' : 'text-slate-600 dark:text-slate-400 font-semibold'
            }`}
          >
            Yards
          </button>
          <button
            type="button"
            onClick={() => onChangeUnit('meters')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
              unit === 'meters' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-bold' : 'text-slate-600 dark:text-slate-400 font-semibold'
            }`}
          >
            Meters
          </button>
        </div>
      </div>

      {/* NFC Scanner Status Card */}
      <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 p-5 sm:p-6 space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                nfcStatus === 'scanning'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}
            >
              <Nfc className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">
                GolfPad / NTAG Grip Tag Integration
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
                Tap <strong>Pair Tag</strong> next to any club in your bag, then hold your phone against the grip sensor to pair.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <PWAInstallButton />
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>NFC Active</span>
            </div>
          </div>
        </div>

        {nfcError && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900">
            {nfcError}
          </div>
        )}

        {pairingTarget && (
          <div className="rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5 text-xs text-sky-950 dark:text-sky-200 font-medium">
              <Smartphone className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
              <span>
                Scanning for <strong>{pairingTarget.name}</strong> — tap your physical grip tag against your phone now.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onCancelPairing}
                className="h-8 px-3 rounded-lg text-xs font-bold text-sky-800 dark:text-sky-300 bg-sky-100 dark:bg-sky-900/60 hover:bg-sky-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-3">
          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoLogOnNfc}
              onChange={(e) => onToggleAutoLogOnNfc(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Auto-log previous shot when a new club NFC tag is scanned (records GPS carry distance)
            </span>
          </label>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-1 border-t border-slate-100/80 dark:border-slate-800/80">
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={nfcVibrateEnabled}
                onChange={(e) => onToggleNfcVibrate?.(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Haptic vibration on tag scan
              </span>
            </label>

            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={nfcSoundEnabled}
                onChange={(e) => onToggleNfcSound?.(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Audio chime on tag scan
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Quick Add Clubs Card (Placed Above Bag List to prevent layout shift) */}
      <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">
              Add Clubs to Bag
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tap any club to add it immediately, or select multiples and add all at once.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAddStandard14}
              className="h-8 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-2xs"
            >
              <Layers className="w-3.5 h-3.5 text-emerald-600" />
              <span>Add Standard 14 Set</span>
            </button>

            {selectedPresets.size > 0 && (
              <button
                type="button"
                onClick={handleAddSelectedPresets}
                className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all inline-flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Selected ({selectedPresets.size})</span>
              </button>
            )}
          </div>
        </div>

        {/* Preset Chips Grid - Constant position without shifting */}
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {CLUB_PRESETS.map((preset) => {
            const existing = bag.find((c) => c.id === preset.id);
            const isScanningThis = pairingTarget?.id === preset.id;
            const isPaired = Boolean(existing?.nfcTagId);
            const isSelected = selectedPresets.has(preset.id);

            return (
              <button
                key={preset.id}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  if (existing) {
                    if (isScanningThis) {
                      onCancelPairing();
                    } else {
                      onStartPairClub(preset);
                    }
                  } else {
                    if (selectedPresets.size > 0) {
                      handleTogglePresetSelection(preset.id);
                    } else {
                      onAddClub({
                        id: preset.id,
                        name: preset.name,
                        shortName: preset.shortName,
                        category: preset.category,
                        typicalYards: preset.typicalYards,
                      });
                    }
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!existing) handleTogglePresetSelection(preset.id);
                }}
                className={`min-h-[48px] px-2 py-1.5 rounded-xl border text-center flex flex-col items-center justify-center gap-0.5 transition-colors relative select-none ${
                  isScanningThis
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                    : isPaired
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100'
                      : existing
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border-emerald-300/80 dark:border-emerald-800'
                        : isSelected
                          ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-950 dark:text-sky-200 border-sky-400 ring-2 ring-sky-300'
                          : 'bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 border-dashed border-slate-300 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800'
                }`}
                title={
                  existing
                    ? isPaired
                      ? `${preset.name} (Paired)`
                      : `${preset.name} (In Bag · Click to Pair)`
                    : `Click to add ${preset.name} to bag`
                }
              >
                <span className="font-mono text-xs font-bold leading-none">
                  {preset.shortName}
                </span>
                <span
                  className={`text-[10px] leading-none truncate max-w-full font-semibold ${
                    isScanningThis
                      ? 'text-sky-100'
                      : isPaired
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : existing
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : isSelected
                            ? 'text-sky-700 dark:text-sky-400'
                            : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {isScanningThis
                    ? 'Scan...'
                    : isPaired
                      ? 'Paired'
                      : existing
                        ? 'In Bag'
                        : isSelected
                          ? 'Selected'
                          : '+ Add'}
                </span>
                {existing && (
                  <Check
                    className="w-3 h-3 text-emerald-600 dark:text-emerald-400 absolute top-1 right-1"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Custom Club Form */}
        <form
          onSubmit={(e) => handleCreateClub(e, false)}
          className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            value={newClubName}
            onChange={(e) => setNewClubName(e.target.value)}
            placeholder="Custom Club (e.g. 54° Wedge, 8 Iron)"
            aria-label="Club name"
            className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-[#0F1A14] dark:text-slate-100 flex-1 min-w-[140px]"
          />
          <input
            type="text"
            value={newClubAbbr}
            onChange={(e) => setNewClubAbbr(e.target.value)}
            placeholder="Abbr (54°)"
            aria-label="Club abbreviation"
            maxLength={5}
            className="h-9 px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-[#0F1A14] dark:text-slate-100 w-24 text-center uppercase"
          />
          <button
            type="button"
            onClick={() => handleCreateClub(undefined, false)}
            disabled={!newClubName.trim()}
            className="h-9 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap shadow-2xs active:scale-95 transition-all disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Club</span>
          </button>
        </form>
      </div>

      {/* Bag Clubs List Card - Single-line club rows */}
      <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 overflow-hidden shadow-sm">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">
            Clubs in Your Bag ({bag.length})
          </h3>
          <span className="text-xs text-slate-500">
            {bag.filter((c) => Boolean(c.nfcTagId)).length} of {bag.length} paired
          </span>
        </div>

        {bag.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500">
            No clubs in bag yet. Tap any club above to add it.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {sortGolfClubs(bag).map((club) => {
              const isPairing = pairingTarget?.id === club.id;
              const isPaired = Boolean(club.nfcTagId);
              // Strictly ensure average does not exceed 3 digits
              const safeAvg =
                typeof club.typicalYards === 'number' && !isNaN(club.typicalYards)
                  ? Math.min(999, Math.max(0, Math.round(club.typicalYards)))
                  : null;
              const displayAvg = safeAvg !== null ? safeAvg : '—';

              return (
                <div
                  key={club.id}
                  className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                >
                  {/* Left: Short Name, Name, Type, Paired status (NO UID) */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-[#0F1A14] dark:bg-slate-800 text-white font-mono text-xs font-black flex items-center justify-center shrink-0 shadow-2xs">
                      {club.shortName}
                    </div>
                    <div className="min-w-0 flex items-center gap-1.5 sm:gap-2">
                      <span className="text-xs sm:text-sm font-bold text-[#0F1A14] dark:text-slate-100 truncate">
                        {club.name}
                      </span>
                      <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 shrink-0 hidden xs:inline">
                        {club.category}
                      </span>
                      {isPaired ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded-md shrink-0">
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                          <span>Paired</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 shrink-0 hidden sm:inline">
                          Unpaired
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Avg pill, Pair Tag button, Delete button (NO Sim Tap) */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400 shadow-2xs">
                      <span className="text-[10px] text-slate-500 font-sans font-semibold">Avg:</span>
                      <span>{displayAvg}</span>
                      <span className="text-[10px] text-slate-400 font-sans">{suffix}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => (isPairing ? onCancelPairing() : onStartPairClub(club))}
                      className={`h-8 px-2.5 rounded-lg border text-xs font-bold whitespace-nowrap transition-colors shrink-0 ${
                        isPairing
                          ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                          : isPaired
                            ? 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                            : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 shadow-2xs'
                      }`}
                    >
                      {isPairing ? 'Scanning...' : isPaired ? 'Re-pair' : 'Pair Tag'}
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteClub(club.id)}
                      className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0 transition-colors"
                      aria-label={`Remove ${club.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

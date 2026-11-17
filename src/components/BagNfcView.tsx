import React, { useState } from 'react';
import { Check, CheckCircle2, Nfc, Play, Plus, Radio, Smartphone, Trash2 } from 'lucide-react';
import { Club, DistanceUnit } from '../types/golf';
import { CLUB_PRESETS, ClubPreset, unitSuffix } from '../utils/golfMath';
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
  onDeleteClub: (clubId: string) => void;
  onSimulateTagTap: (tagId: string) => void;
}

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
  onStopNfcScan,
  onStartPairClub,
  onCancelPairing,
  onUpdateClub,
  onAddClub,
  onDeleteClub,
  onSimulateTagTap,
}) => {
  const [newClubName, setNewClubName] = useState('');

  const suffix = unitSuffix(unit);

  const handleCreateClub = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newClubName.trim();
    if (!trimmedName) return;

    const lower = trimmedName.toLowerCase();
    const category: Club['category'] = lower.includes('putt')
      ? 'putter'
      : lower.includes('wedge') || lower.includes('°') || /\b(pw|gw|sw|lw)\b/.test(lower)
        ? 'wedge'
        : lower.includes('hybrid') || /\b\dh\b/.test(lower)
          ? 'hybrid'
          : lower.includes('wood') || lower.includes('driver') || /\b\dw\b/.test(lower)
            ? 'wood'
            : 'iron';

    const typicalYards =
      category === 'putter' ? 10 : category === 'wedge' ? 100 : category === 'wood' ? 220 : 165;

    const firstToken = trimmedName.split(/\s+/)[0] ?? trimmedName;
    const shortName =
      firstToken.length <= 4 ? firstToken.toUpperCase() : trimmedName.slice(0, 3).toUpperCase();

    const id = `club_${Date.now()}`;
    const created: Club = {
      id,
      name: trimmedName,
      shortName,
      category,
      typicalYards,
    };
    onAddClub(created);
    onStartPairClub(created);
    setNewClubName('');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-28 lg:pb-12 text-slate-900 dark:text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500">
            Web NFC Hardware Integration ·{' '}
            {bag.length === 0 ? 'No clubs paired yet' : `${bag.length} clubs configured`}
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black text-[#0F1A14] dark:text-slate-100 tracking-tight mt-0.5">
            GolfBag & GolfPad NFC Sensors
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

      {/* GolfPad Web NFC Scanner Status Card */}
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
                GolfPad / NTAG Grip Tag Pairing (Web NFC)
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
                {nfcSupported
                  ? 'Tap any club button below (D, 3W, 5W, 7W, etc.) to start NFC scanning immediately, then hold your phone against the club grip tag to pair it.'
                  : 'Tap any club button below to pair it. Hardware Web NFC scanning runs in Chrome on Android over HTTPS; on desktop or iOS you can simulate tag scans or enter tag IDs.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <PWAInstallButton />
            {nfcStatus === 'scanning' && (
              <button
                type="button"
                onClick={onStopNfcScan}
                className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Radio className="w-4 h-4 text-emerald-400" />
                <span>Stop NFC Scan</span>
              </button>
            )}
          </div>
        </div>

        {nfcError && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900">
            {nfcError}
          </div>
        )}

        {pairingTarget && (
          <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-sky-950 font-medium">
              <Smartphone className="w-4 h-4 text-sky-700 shrink-0" />
              <span>
                Scanning for <strong>{pairingTarget.name} ({pairingTarget.shortName})</strong> — tap
                your physical GolfPad tag to the NFC reader now.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(!nfcSupported || nfcStatus !== 'scanning') && (
                <button
                  type="button"
                  onClick={() =>
                    onSimulateTagTap(`GP-TAG-${pairingTarget.shortName.toUpperCase()}-01`)
                  }
                  className="min-h-[36px] px-3 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Simulate Tap</span>
                </button>
              )}
              <button
                type="button"
                onClick={onCancelPairing}
                className="min-h-[36px] px-2.5 text-xs font-semibold text-sky-800 hover:underline whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoLogOnNfc}
              onChange={(e) => onToggleAutoLogOnNfc(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span className="text-xs font-medium text-slate-700">
              Auto-log previous shot when a new club NFC tag is tapped (records GPS carry distance)
            </span>
          </label>

          {lastNfcTap && (
            <div className="text-xs font-mono text-slate-500 tabular-nums">
              Last read: <strong className="text-[#0F1A14]">{lastNfcTap.tagId}</strong> (
              {lastNfcTap.source})
            </div>
          )}
        </div>
      </div>

      {/* Paired Clubs List */}
      <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">Paired Clubs in Your Bag</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Clubs appear here as you pair them below. Adjust carry yardages or re-scan tags anytime.
            </p>
          </div>
        </div>

        {bag.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500">
            No clubs paired yet. Click any club button at the bottom to start scanning its tag right away.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {bag.map((club) => {
              const isPairing = pairingTarget?.id === club.id;
              return (
                <div
                  key={club.id}
                  className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#0F1A14] text-white font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      {club.shortName}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#0F1A14] truncate">{club.name}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>{club.category.charAt(0).toUpperCase() + club.category.slice(1)}</span>
                        <span aria-hidden="true">·</span>
                        {club.nfcTagId ? (
                          <span className="inline-flex items-center gap-1 font-mono text-emerald-700">
                            <CheckCircle2 className="w-3 h-3" />
                            {club.nfcTagId}
                          </span>
                        ) : (
                          <span className="text-slate-400">No tag paired</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                      <span>Avg:</span>
                      <input
                        type="number"
                        min={1}
                        max={380}
                        value={club.typicalYards}
                        onChange={(e) =>
                          onUpdateClub(club.id, { typicalYards: Math.max(1, Number(e.target.value)) })
                        }
                        className="w-16 h-9 px-2 rounded-lg border border-slate-200 font-mono text-xs tabular-nums text-center text-[#0F1A14]"
                        aria-label={`${club.name} typical yardage`}
                      />
                      <span className="font-mono text-[11px] text-slate-400">{suffix}</span>
                    </label>

                    <input
                      type="text"
                      value={club.nfcTagId ?? ''}
                      onChange={(e) =>
                        onUpdateClub(club.id, { nfcTagId: e.target.value.toUpperCase() || undefined })
                      }
                      placeholder="NFC Tag UID"
                      className="w-32 h-9 px-2.5 rounded-lg border border-slate-200 font-mono text-xs text-[#0F1A14] placeholder:text-slate-300"
                      aria-label={`${club.name} NFC tag ID`}
                    />

                    <button
                      type="button"
                      onClick={() => (isPairing ? onCancelPairing() : onStartPairClub(club))}
                      className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors ${
                        isPairing
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {isPairing ? 'Scanning...' : 'Pair Tag'}
                    </button>

                    {club.nfcTagId && (
                      <button
                        type="button"
                        onClick={() => onSimulateTagTap(club.nfcTagId!)}
                        className="min-h-[36px] px-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                        title="Simulate tapping this GolfPad NFC tag on mobile"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Sim Tap</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onDeleteClub(club.id)}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      aria-label={`Remove ${club.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Club Buttons at the Bottom — Tap Any Club to Start Scanning Immediately */}
        <div className="px-5 py-5 bg-slate-50/70 dark:bg-slate-900/60 border-t border-slate-200/80 dark:border-slate-800/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <h4 className="text-xs font-black text-[#0F1A14] dark:text-slate-100">
              Tap a Club to Scan & Pair NFC Tag
            </h4>
            <span className="text-[11px] text-slate-500">
              Clicking any club starts NFC scanning right away
            </span>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {CLUB_PRESETS.map((preset) => {
              const existing = bag.find((c) => c.id === preset.id);
              const isScanningThis = pairingTarget?.id === preset.id;
              const isPaired = Boolean(existing?.nfcTagId);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    isScanningThis ? onCancelPairing() : onStartPairClub(preset)
                  }
                  className={`min-h-[48px] px-2 py-2 rounded-xl border text-center flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
                    isScanningThis
                      ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                      : isPaired
                        ? 'bg-emerald-50 text-emerald-950 border-emerald-300 hover:bg-emerald-100'
                        : 'bg-white text-[#0F1A14] border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                  title={`Scan NFC tag for ${preset.name}`}
                >
                  <span className="font-mono text-xs font-bold leading-none">
                    {preset.shortName}
                  </span>
                  <span
                    className={`text-[10px] leading-none truncate max-w-full ${
                      isScanningThis
                        ? 'text-sky-100'
                        : isPaired
                          ? 'text-emerald-700 font-semibold'
                          : 'text-slate-400'
                    }`}
                  >
                    {isScanningThis ? 'Scan...' : isPaired ? 'Paired' : 'Tap'}
                  </span>
                  {isPaired && !isScanningThis && (
                    <Check
                      className="w-3 h-3 text-emerald-700 absolute top-1 right-1"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Add & Scan Custom Club Row */}
        <form
          onSubmit={handleCreateClub}
          className="px-5 py-4 bg-slate-50/90 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2.5"
        >
          <input
            type="text"
            value={newClubName}
            onChange={(e) => setNewClubName(e.target.value)}
            placeholder="Club name (e.g. 54° Wedge)"
            aria-label="Club name"
            className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-[#0F1A14] dark:text-slate-100 flex-1 min-w-[150px]"
          />
          <button
            type="submit"
            className="h-10 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add & Scan</span>
          </button>
        </form>
      </div>
    </div>
  );
};

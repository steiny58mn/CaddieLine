import React, { useState } from 'react';
import { CheckCircle2, Nfc, Play, Plus, Radio, Smartphone, Trash2 } from 'lucide-react';
import { Club, ClubCategory, DistanceUnit } from '../types/golf';
import { formatDistanceValue, unitSuffix } from '../utils/golfMath';
import { NfcStatus, NfcTapPayload } from '../hooks/useWebNfc';
import { PWAInstallButton } from './PWAInstallButton';

interface BagNfcViewProps {
  bag: Club[];
  unit: DistanceUnit;
  nfcSupported: boolean;
  nfcStatus: NfcStatus;
  nfcError: string | null;
  lastNfcTap: NfcTapPayload | null;
  pairingClubId: string | null;
  autoLogOnNfc: boolean;
  onChangeUnit: (unit: DistanceUnit) => void;
  onToggleAutoLogOnNfc: (val: boolean) => void;
  onStartNfcScan: () => void;
  onStopNfcScan: () => void;
  onStartPairingClub: (clubId: string | null) => void;
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
  pairingClubId,
  autoLogOnNfc,
  onChangeUnit,
  onToggleAutoLogOnNfc,
  onStartNfcScan,
  onStopNfcScan,
  onStartPairingClub,
  onUpdateClub,
  onAddClub,
  onDeleteClub,
  onSimulateTagTap,
}) => {
  const [newClubName, setNewClubName] = useState('');
  const [newClubShort, setNewClubShort] = useState('');
  const [newClubCategory, setNewClubCategory] = useState<ClubCategory>('iron');
  const [newClubYards, setNewClubYards] = useState('150');

  const suffix = unitSuffix(unit);
  const pairingClub = bag.find((c) => c.id === pairingClubId) ?? null;

  const handleCreateClub = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClubName.trim()) return;
    const id = `club_${Date.now()}`;
    onAddClub({
      id,
      name: newClubName.trim(),
      shortName: newClubShort.trim() || newClubName.trim().slice(0, 3).toUpperCase(),
      category: newClubCategory,
      typicalYards: Math.max(5, Number(newClubYards) || 150),
    });
    setNewClubName('');
    setNewClubShort('');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24 lg:pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500">
            Web NFC Hardware Integration · {bag.length} clubs configured
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0F1A14] mt-0.5">
            GolfBag & GolfPad NFC Sensors
          </h2>
        </div>

        {/* Units Toggle */}
        <div className="inline-flex items-center p-1 bg-slate-200/80 rounded-xl self-start sm:self-auto">
          <button
            type="button"
            onClick={() => onChangeUnit('yards')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
              unit === 'yards' ? 'bg-white text-[#0F1A14] shadow-xs' : 'text-slate-600'
            }`}
          >
            Yards
          </button>
          <button
            type="button"
            onClick={() => onChangeUnit('meters')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
              unit === 'meters' ? 'bg-white text-[#0F1A14] shadow-xs' : 'text-slate-600'
            }`}
          >
            Meters
          </button>
        </div>
      </div>

      {/* GolfPad Web NFC Control Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
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
              <h3 className="text-sm font-bold text-[#0F1A14]">
                GolfPad / NTAG Grip Tag Scanner (Web NFC)
              </h3>
              <p className="text-xs text-slate-600 mt-1 max-w-2xl">
                {nfcSupported
                  ? 'Your browser supports Web NFC! Start scanning and tap the top of your phone against any GolfPad NFC grip tag before swinging to capture GPS coordinates, calculate your previous shot distance, and select your club.'
                  : 'Hardware Web NFC is supported in Chrome on Android over HTTPS. On desktop or iOS, you can still configure your tag IDs and use "Simulate Tap" below to test the exact sensor pipeline.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <PWAInstallButton />
            {nfcStatus === 'scanning' ? (
              <button
                type="button"
                onClick={onStopNfcScan}
                className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
              >
                Stop NFC Scan
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartNfcScan}
                className="min-h-[44px] px-4 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Radio className="w-4 h-4" />
                <span>{nfcSupported ? 'Start NFC Scanning' : 'Check Web NFC'}</span>
              </button>
            )}
          </div>
        </div>

        {nfcError && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900">
            {nfcError}
          </div>
        )}

        {pairingClub && (
          <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-sky-950 font-medium">
              <Smartphone className="w-4 h-4 text-sky-700 shrink-0" />
              <span>
                Pairing mode active for <strong>{pairingClub.name}</strong> — tap your physical
                GolfPad tag to the NFC reader now.
              </span>
            </div>
            <button
              type="button"
              onClick={() => onStartPairingClub(null)}
              className="text-xs font-semibold text-sky-800 hover:underline whitespace-nowrap"
            >
              Cancel
            </button>
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

      {/* Club Bag & NFC Tag Registry Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#0F1A14]">Your Bag & Paired NFC Tags</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Adjust carry yardages for club recommendations, pair physical tags, or test tag taps
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {bag.map((club) => {
            const isPairing = pairingClubId === club.id;
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
                    onClick={() => onStartPairingClub(isPairing ? null : club.id)}
                    className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors ${
                      isPairing
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {isPairing ? 'Waiting Tap...' : 'Pair Tag'}
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

                  {bag.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteClub(club.id)}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      aria-label={`Remove ${club.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Custom Club Row */}
        <form
          onSubmit={handleCreateClub}
          className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center gap-2.5"
        >
          <input
            type="text"
            value={newClubName}
            onChange={(e) => setNewClubName(e.target.value)}
            placeholder="Add club (e.g. 2 Iron)"
            className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs text-[#0F1A14] flex-1 min-w-[150px]"
          />
          <input
            type="text"
            value={newClubShort}
            onChange={(e) => setNewClubShort(e.target.value)}
            placeholder="Short (2i)"
            className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs text-[#0F1A14] w-24"
          />
          <select
            value={newClubCategory}
            onChange={(e) => setNewClubCategory(e.target.value as ClubCategory)}
            className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs text-[#0F1A14]"
          >
            <option value="wood">Wood</option>
            <option value="hybrid">Hybrid</option>
            <option value="iron">Iron</option>
            <option value="wedge">Wedge</option>
            <option value="putter">Putter</option>
          </select>
          <input
            type="number"
            min={5}
            max={350}
            value={newClubYards}
            onChange={(e) => setNewClubYards(e.target.value)}
            className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs font-mono tabular-nums text-[#0F1A14] w-24"
            aria-label="New club yardage"
          />
          <button
            type="submit"
            className="h-10 px-4 rounded-xl bg-[#0F1A14] text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Club</span>
          </button>
        </form>
      </div>
    </div>
  );
};

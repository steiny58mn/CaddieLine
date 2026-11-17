import React from 'react';
import { Check, Download, Save, Trash2 } from 'lucide-react';
import { RoundState, ShotRecord } from '../types/golf';
import {
  LIE_OPTIONS,
  formatDistanceValue,
  formatRelativeToPar,
  getEffectivePutts,
  getHoleStrokes,
  isHolePlayed,
  isShotPutt,
  normalizeShotLie,
  unitSuffix,
} from '../utils/golfMath';

interface StatsViewProps {
  round: RoundState;
  savedRounds: RoundState[];
  roundJustSaved: boolean;
  onSaveRound: () => void;
  onResetRound: () => void;
  onLoadRound: (round: RoundState) => void;
  onDeleteSavedRound: (roundId: string) => void;
}

export const StatsView: React.FC<StatsViewProps> = ({
  round,
  savedRounds,
  roundJustSaved,
  onSaveRound,
  onResetRound,
  onLoadRound,
  onDeleteSavedRound,
}) => {
  const holeNums = Object.keys(round.scores).map(Number);
  const playedHoles = holeNums.filter((n) => isHolePlayed(round.scores[n]));
  const totalPutts = playedHoles.reduce((sum, n) => sum + getEffectivePutts(round.scores[n]), 0);
  const avgPuttsPerHole = playedHoles.length > 0 ? totalPutts / playedHoles.length : null;
  const totalStrokes = playedHoles.reduce((sum, n) => sum + getHoleStrokes(round.scores[n]), 0);
  const totalParPlayed = playedHoles.reduce((sum, n) => sum + (round.holes[n]?.par ?? 4), 0);

  const allShots: ShotRecord[] = Object.values(round.scores).flatMap((h) => h.shots);
  const nonPuttShots = allShots.filter((s) => !isShotPutt(s));
  const suffix = unitSuffix(round.unit);

  const leftCount = nonPuttShots.filter(
    (s) => s.direction === 'left' || s.lie === 'left_rough' || s.lie === 'left_trees'
  ).length;
  const rightCount = nonPuttShots.filter(
    (s) => s.direction === 'right' || s.lie === 'right_rough' || s.lie === 'right_trees'
  ).length;
  const straightCount = Math.max(0, nonPuttShots.length - leftCount - rightCount);

  const totalNonPutt = nonPuttShots.length;
  const leftPct = totalNonPutt > 0 ? Math.round((leftCount / totalNonPutt) * 100) : 0;
  const straightPct = totalNonPutt > 0 ? Math.round((straightCount / totalNonPutt) * 100) : 0;
  const rightPct = totalNonPutt > 0 ? Math.max(0, 100 - leftPct - straightPct) : 0;

  // Club performance aggregation using plain object dictionary
  const clubStats: Record<
    string,
    { clubName: string; count: number; distances: number[]; onTarget: number }
  > = {};

  allShots.forEach((shot) => {
    if (!clubStats[shot.clubId]) {
      clubStats[shot.clubId] = {
        clubName: shot.clubName,
        count: 0,
        distances: [],
        onTarget: 0,
      };
    }
    clubStats[shot.clubId].count += 1;
    if (shot.distanceYards !== null && shot.distanceYards > 0) {
      clubStats[shot.clubId].distances.push(shot.distanceYards);
    }
    if (shot.lie === 'fairway' || shot.lie === 'green' || shot.lie === 'holed') {
      clubStats[shot.clubId].onTarget += 1;
    }
  });

  const clubRows = Object.entries(clubStats).sort((a, b) => b[1].count - a[1].count);

  const handleExportCsv = () => {
    const headers = [
      'Hole',
      'Par',
      'Shot',
      'Club',
      'Lie',
      'Direction',
      'DistanceYards',
      'Penalty',
      'Source',
    ];
    const rows = allShots.map((s) => [
      s.holeNumber,
      round.holes[s.holeNumber]?.par ?? 4,
      s.strokeNumber,
      `"${s.clubName}"`,
      s.lie,
      s.direction,
      s.distanceYards ?? '',
      s.penaltyStrokes,
      s.source,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `caddieline-round-${new Date(round.startedAt).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24 lg:pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500">
            {round.course ? round.course.name : 'Current Session'} · {allShots.length} shots tracked
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0F1A14] mt-0.5">
            Shot Dispersion & Club Analytics
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={onSaveRound}
            className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
              roundJustSaved
                ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                : 'bg-emerald-700 hover:bg-emerald-800 text-white'
            }`}
          >
            {roundJustSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{roundJustSaved ? 'Round Saved' : 'Save Round'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={allShots.length === 0}
            className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-2 whitespace-nowrap transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={onResetRound}
            className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap transition-colors"
          >
            End Round
          </button>
        </div>
      </div>

      {/* Round Putting & Scoring Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-white to-teal-50/50 dark:from-slate-900 dark:to-teal-950/30 rounded-3xl border border-teal-200/80 dark:border-teal-800/80 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Avg Putts / Hole</div>
          <div className="font-mono text-2xl sm:text-3xl font-black text-teal-700 dark:text-teal-300 tabular-nums mt-1">
            {avgPuttsPerHole !== null ? avgPuttsPerHole.toFixed(2) : '—'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums font-medium">
            {playedHoles.length > 0
              ? `Across ${playedHoles.length} ${playedHoles.length === 1 ? 'hole' : 'holes'}`
              : 'No holes played'}
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-purple-50/50 dark:from-slate-900 dark:to-purple-950/30 rounded-3xl border border-purple-200/80 dark:border-purple-800/80 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Putts</div>
          <div className="font-mono text-2xl sm:text-3xl font-black text-purple-700 dark:text-purple-300 tabular-nums mt-1">
            {totalPutts}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">Tracked separately</div>
        </div>

        <div className="bg-gradient-to-br from-white to-emerald-50/50 dark:from-slate-900 dark:to-emerald-950/30 rounded-3xl border border-emerald-200/80 dark:border-emerald-800/80 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Strokes</div>
          <div className="font-mono text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-300 tabular-nums mt-1">
            {totalStrokes > 0 ? totalStrokes : '—'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums font-medium">
            {totalStrokes > 0
              ? `${formatRelativeToPar(totalStrokes - totalParPlayed)} vs par`
              : 'Includes putts'}
          </div>
        </div>
      </div>

      {/* Dispersion & Lie Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Directional Dispersion */}
        <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 p-5 sm:p-6 shadow-sm">
          <h3 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">Directional Miss Tendency</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Full swings & approach shots excluding putts ({totalNonPutt} shots)
          </p>

          {totalNonPutt === 0 ? (
            <div className="mt-6 py-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl">
              Log full shots in Hole Stats Entry to measure left, on-line, and right tendencies.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="h-5 w-full rounded-full overflow-hidden flex bg-slate-100">
                {leftPct > 0 && (
                  <div
                    style={{ width: `${leftPct}%` }}
                    className="bg-amber-500 h-full transition-all"
                    title={`Left: ${leftPct}%`}
                  />
                )}
                {straightPct > 0 && (
                  <div
                    style={{ width: `${straightPct}%` }}
                    className="bg-emerald-600 h-full transition-all"
                    title={`On Line: ${straightPct}%`}
                  />
                )}
                {rightPct > 0 && (
                  <div
                    style={{ width: `${rightPct}%` }}
                    className="bg-orange-500 h-full transition-all"
                    title={`Right: ${rightPct}%`}
                  />
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-amber-50/70 border border-amber-200/70 p-3">
                  <div className="text-xs font-semibold text-amber-900">Left Miss</div>
                  <div className="font-mono text-xl font-bold text-[#0F1A14] tabular-nums mt-1">
                    {leftPct}%
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">{leftCount} shots</div>
                </div>
                <div className="rounded-xl bg-emerald-50/80 border border-emerald-200 p-3">
                  <div className="text-xs font-semibold text-emerald-900">On Target</div>
                  <div className="font-mono text-xl font-bold text-[#0F1A14] tabular-nums mt-1">
                    {straightPct}%
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    {straightCount} shots
                  </div>
                </div>
                <div className="rounded-xl bg-orange-50/70 border border-orange-200/70 p-3">
                  <div className="text-xs font-semibold text-orange-900">Right Miss</div>
                  <div className="font-mono text-xl font-bold text-[#0F1A14] tabular-nums mt-1">
                    {rightPct}%
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">{rightCount} shots</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Landing Lie Distribution */}
        <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 p-5 sm:p-6 shadow-sm">
          <h3 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">Where Shots Landed</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Distribution across fairways, rough, trees, bunkers, hazards, and greens
          </p>

          {allShots.length === 0 ? (
            <div className="mt-6 py-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl">
              No shots recorded yet in this round.
            </div>
          ) : (
            <div className="mt-4 space-y-2.5">
              {LIE_OPTIONS.map((meta) => {
                const count = allShots.filter((s) => normalizeShotLie(s.lie) === meta.id).length;
                if (count === 0) return null;
                const pct = Math.round((count / allShots.length) * 100);
                return (
                  <div key={meta.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800 flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block"
                          style={{ backgroundColor: meta.dotColor }}
                        />
                        {meta.label}
                      </span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: meta.dotColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Club Distance & Accuracy Table */}
      <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">Club Performance Summary</h3>
        </div>
        {clubRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Club distances and hit rates appear here as you track shots.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="py-2.5 px-5 font-semibold">Club</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Shots</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Avg Dist</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Longest</th>
                  <th className="py-2.5 px-5 font-semibold text-right">Fairway / Green %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {clubRows.map(([clubId, data]) => {
                  const avg =
                    data.distances.length > 0
                      ? Math.round(
                          data.distances.reduce((a, b) => a + b, 0) / data.distances.length
                        )
                      : null;
                  const max = data.distances.length > 0 ? Math.max(...data.distances) : null;
                  const targetPct = Math.round((data.onTarget / data.count) * 100);
                  return (
                    <tr key={clubId} className="hover:bg-slate-50/60">
                      <td className="py-3 px-5 font-semibold text-[#0F1A14]">{data.clubName}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                        {data.count}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                        {avg !== null ? `${formatDistanceValue(avg, round.unit)} ${suffix}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                        {max !== null ? `${formatDistanceValue(max, round.unit)} ${suffix}` : '—'}
                      </td>
                      <td className="py-3 px-5 text-right font-mono tabular-nums font-semibold text-emerald-700">
                        {targetPct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Saved Rounds History */}
      <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">Saved Rounds</h3>
          <span className="text-xs text-slate-500">Stored locally on this device</span>
        </div>
        {savedRounds.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Previous rounds will appear here when you start a fresh round.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {savedRounds.map((item) => {
              const holeNums = Object.keys(item.scores).map(Number);
              const played = holeNums.filter((n) => isHolePlayed(item.scores[n]));
              const strokes = holeNums.reduce((s, n) => s + getHoleStrokes(item.scores[n]), 0);
              const parPlayed = played.reduce((s, n) => s + (item.holes[n]?.par ?? 4), 0);
              return (
                <div
                  key={item.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#0F1A14] truncate">
                      {item.course?.name ?? 'Custom Practice Round'}
                    </div>
                    <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                      {new Date(item.startedAt).toLocaleDateString()} · {played.length} holes ·{' '}
                      {strokes > 0
                        ? `${strokes} (${formatRelativeToPar(strokes - parPlayed)})`
                        : 'No score'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onLoadRound(item)}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedRound(item.id)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      aria-label="Delete saved round"
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
    </div>
  );
};

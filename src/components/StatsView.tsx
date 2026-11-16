import React from 'react';
import { Download, Trash2 } from 'lucide-react';
import { RoundState, ShotRecord } from '../types/golf';
import {
  LIE_OPTIONS,
  formatDistanceValue,
  formatRelativeToPar,
  getHoleStrokes,
  isHolePlayed,
  unitSuffix,
} from '../utils/golfMath';

interface StatsViewProps {
  round: RoundState;
  savedRounds: RoundState[];
  onLoadRound: (round: RoundState) => void;
  onDeleteSavedRound: (roundId: string) => void;
}

export const StatsView: React.FC<StatsViewProps> = ({
  round,
  savedRounds,
  onLoadRound,
  onDeleteSavedRound,
}) => {
  const allShots: ShotRecord[] = Object.values(round.scores).flatMap((h) => h.shots);
  const nonPuttShots = allShots.filter((s) => s.clubId !== 'pt');
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

        <button
          type="button"
          onClick={handleExportCsv}
          disabled={allShots.length === 0}
          className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-2 self-start sm:self-auto whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          <span>Export Shots CSV</span>
        </button>
      </div>

      {/* Dispersion & Lie Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Directional Dispersion */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-bold text-[#0F1A14]">Directional Miss Tendency</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Full swings & approach shots excluding putts ({totalNonPutt} shots)
          </p>

          {totalNonPutt === 0 ? (
            <div className="mt-6 py-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl">
              Log full shots on the Live Hole view to measure left, on-line, and right tendencies.
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
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-bold text-[#0F1A14]">Where Shots Landed</h3>
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
                const count = allShots.filter((s) => s.lie === meta.id).length;
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
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-bold text-[#0F1A14]">Club Performance Summary</h3>
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
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#0F1A14]">Saved Rounds</h3>
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

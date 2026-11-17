import React, { useState } from 'react';
import { AlertTriangle, Check, Download, Trash2 } from 'lucide-react';
import { DistanceUnit, HolePinData, HoleScoreState, RoundHoleMode, RoundState, ShotRecord } from '../types/golf';
import { formatTeeSummaryLabel } from '../services/golfCourseApiService';
import {
  formatDistanceValue,
  formatRelativeToPar,
  getEffectivePutts,
  getHoleFairwayStatus,
  getHoleGIR,
  getHolePenalties,
  getHoleStrokes,
  isHolePlayed,
  unitSuffix,
} from '../utils/golfMath';

interface ScorecardViewProps {
  round: RoundState;
  holeMode?: RoundHoleMode;
  onToggleHoleMode?: (mode: RoundHoleMode) => void;
  roundJustSaved: boolean;
  onSelectHole: (holeNumber: number) => void;
  onUpdateHoleMeta: (holeNumber: number, patch: Partial<HolePinData>) => void;
  onOverrideHoleScore: (holeNumber: number, score: number | undefined) => void;
  onSelectTee?: (teeId: string) => void;
  onSaveRound?: () => void;
  onResetRound?: () => void;
  onSaveAndEndRound: () => void;
  onDiscardRound: () => void;
}

const ScoreSymbol: React.FC<{ strokes: number; par: number }> = ({ strokes, par }) => {
  if (strokes <= 0) {
    return <span className="text-slate-300 dark:text-slate-600 font-mono">—</span>;
  }
  const diff = strokes - par;

  if (diff <= -2) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-amber-500 ring-2 ring-amber-300/80 bg-amber-100 dark:bg-amber-950/80 text-amber-950 dark:text-amber-200 font-mono font-black text-xs tabular-nums shadow-xs">
        {strokes}
      </span>
    );
  }
  if (diff === -1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-rose-500 bg-rose-50 dark:bg-rose-950/80 text-rose-950 dark:text-rose-200 font-mono font-black text-xs tabular-nums shadow-xs">
        {strokes}
      </span>
    );
  }
  if (diff === 0) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 font-mono font-bold text-xs text-slate-900 dark:text-slate-100 tabular-nums">
        {strokes}
      </span>
    );
  }
  if (diff === 1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border-2 border-sky-600 bg-sky-50 dark:bg-sky-950/80 text-sky-950 dark:text-sky-200 font-mono font-black text-xs tabular-nums shadow-xs">
        {strokes}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border-2 border-purple-700 bg-purple-50 dark:bg-purple-950/80 text-purple-950 dark:text-purple-200 font-mono font-black text-xs tabular-nums shadow-xs">
      {strokes}
    </span>
  );
};

interface NineHoleTableProps {
  title: string;
  holeNumbers: number[];
  holes: Record<number, HolePinData>;
  scores: Record<number, HoleScoreState>;
  currentHole: number;
  unit: DistanceUnit;
  onSelectHole: (holeNumber: number) => void;
  onOverrideHoleScore: (holeNumber: number, score: number | undefined) => void;
  onUpdateHoleMeta?: (holeNumber: number, patch: Partial<HolePinData>) => void;
}

const NineHoleTable: React.FC<NineHoleTableProps> = ({
  title,
  holeNumbers,
  holes,
  scores,
  currentHole,
  unit,
  onSelectHole,
  onOverrideHoleScore,
  onUpdateHoleMeta,
}) => {
  const sumPar = holeNumbers.reduce((acc, n) => acc + (holes[n]?.par ?? 4), 0);
  const sumYards = holeNumbers.reduce((acc, n) => acc + (holes[n]?.yardage ?? 0), 0);
  const sumScore = holeNumbers.reduce((acc, n) => acc + getHoleStrokes(scores[n]), 0);
  const sumPutts = holeNumbers.reduce((acc, n) => acc + getEffectivePutts(scores[n]), 0);

  return (
    <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/60">
        <h3 className="text-sm font-bold text-[#0F1A14] dark:text-slate-100">{title}</h3>
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
          Par {sumPar} · {formatDistanceValue(sumYards, unit)} {unitSuffix(unit)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-center border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700/80 text-xs text-slate-700 dark:text-slate-200 bg-slate-100/90 dark:bg-slate-800/90 font-bold">
              <th className="py-2.5 px-3 text-left font-bold w-24">Hole</th>
              {holeNumbers.map((num) => (
                <th key={num} className="py-2 px-1">
                  <button
                    type="button"
                    onClick={() => onSelectHole(num)}
                    className={`min-h-[36px] min-w-[36px] rounded-lg font-mono font-bold text-xs transition-colors ${
                      currentHole === num
                        ? 'bg-emerald-700 text-white'
                        : 'text-[#0F1A14] dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                    }`}
                  >
                    {num}
                  </button>
                </th>
              ))}
              <th className="py-2.5 px-3 font-bold text-[#0F1A14] dark:text-slate-100 bg-slate-200/80 dark:bg-slate-700/80">
                {holeNumbers[0] === 1 ? 'OUT' : 'IN'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-800 dark:text-slate-200">
            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-600 dark:text-slate-300">
                {unit === 'meters' ? 'Meters' : 'Yards'}
              </td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-2 px-1 font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {formatDistanceValue(holes[num]?.yardage, unit)}
                </td>
              ))}
              <td className="py-2 px-3 font-mono font-semibold text-slate-700 dark:text-slate-200 bg-slate-100/80 dark:bg-slate-800/80 tabular-nums">
                {formatDistanceValue(sumYards, unit)}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-600 dark:text-slate-300">Par</td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-1 px-1">
                  <button
                    type="button"
                    onClick={() => {
                      const cur = holes[num]?.par ?? 4;
                      const next = cur === 3 ? 4 : cur === 4 ? 5 : cur === 5 ? 6 : 3;
                      onUpdateHoleMeta?.(num, { par: next });
                    }}
                    title={`Click to adjust Hole ${num} Par (currently ${holes[num]?.par ?? 4})`}
                    className="min-h-[28px] min-w-[28px] font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums rounded px-1 hover:bg-slate-200/80 dark:hover:bg-slate-700 transition-colors"
                  >
                    {holes[num]?.par ?? 4}
                  </button>
                </td>
              ))}
              <td className="py-2 px-3 font-mono font-bold text-[#0F1A14] dark:text-slate-100 bg-slate-100/80 dark:bg-slate-800/80 tabular-nums">
                {sumPar}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-500 dark:text-slate-400">Hcp</td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-2 px-1 font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                  {holes[num]?.handicap ?? '—'}
                </td>
              ))}
              <td className="py-2 px-3 font-mono text-slate-400 dark:text-slate-500 bg-slate-100/80 dark:bg-slate-800/80">—</td>
            </tr>

            <tr>
              <td className="py-2.5 px-3 text-left font-semibold text-[#0F1A14] dark:text-slate-100">Score</td>
              {holeNumbers.map((num) => {
                const strokes = getHoleStrokes(scores[num]);
                return (
                  <td key={num} className="py-2 px-1">
                    <button
                      type="button"
                      onClick={() => onSelectHole(num)}
                      className="inline-flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 p-0.5 transition-colors"
                      title={`Jump to Hole ${num}`}
                    >
                      <ScoreSymbol strokes={strokes} par={holes[num]?.par ?? 4} />
                    </button>
                  </td>
                );
              })}
              <td className="py-2.5 px-3 font-mono font-bold text-sm text-[#0F1A14] dark:text-emerald-400 bg-slate-200/80 dark:bg-slate-800/90 tabular-nums">
                {sumScore > 0 ? sumScore : '—'}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-500 dark:text-slate-400">Putts</td>
              {holeNumbers.map((num) => {
                const putts = getEffectivePutts(scores[num]);
                return (
                  <td key={num} className="py-2 px-1 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                    {isHolePlayed(scores[num]) || putts > 0 ? putts : '—'}
                  </td>
                );
              })}
              <td className="py-2 px-3 font-mono font-semibold text-slate-700 dark:text-slate-200 bg-slate-100/80 dark:bg-slate-800/80 tabular-nums">
                {sumPutts > 0 ? sumPutts : '—'}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-500 dark:text-slate-400">FIR / GIR</td>
              {holeNumbers.map((num) => {
                const fir = getHoleFairwayStatus(scores[num], holes[num]?.par ?? 4);
                const gir = getHoleGIR(scores[num], holes[num]?.par ?? 4);
                const played = isHolePlayed(scores[num]);
                return (
                  <td key={num} className="py-2 px-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {!played ? (
                      '—'
                    ) : (
                      <span>
                        {fir === 'na' ? '·' : fir === 'hit' ? 'F' : fir === 'left' ? 'L' : 'R'}
                        /
                        {gir ? 'G' : '·'}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="py-2 px-3 font-mono text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800/80">
                {holeNumbers.filter((n) => getHoleGIR(scores[n], holes[n]?.par ?? 4)).length} GIR
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-500 dark:text-slate-400">Manual</td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-1 px-1">
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={scores[num].manualScoreOverride ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : undefined;
                      onOverrideHoleScore(num, val);
                    }}
                    placeholder="Auto"
                    className="w-11 h-7 text-center rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                    aria-label={`Manual score override for hole ${num}`}
                  />
                </td>
              ))}
              <td className="py-2 px-3 text-[11px] text-slate-400 dark:text-slate-500 bg-slate-100/80 dark:bg-slate-800/80">Override</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const ScorecardView: React.FC<ScorecardViewProps> = ({
  round,
  holeMode = '18',
  onToggleHoleMode,
  onSelectHole,
  onUpdateHoleMeta,
  onOverrideHoleScore,
  onSelectTee,
  onSaveAndEndRound,
  onDiscardRound,
}) => {
  const [showEndRoundConfirm, setShowEndRoundConfirm] = useState(false);

  const allHoles = holeMode === 'front9'
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
    : holeMode === 'back9'
      ? [10, 11, 12, 13, 14, 15, 16, 17, 18]
      : Array.from({ length: 18 }, (_, i) => i + 1);
  const playedHoles = allHoles.filter((n) => isHolePlayed(round.scores[n]));
  const totalStrokes = allHoles.reduce((acc, n) => acc + getHoleStrokes(round.scores[n]), 0);
  const playedPar = playedHoles.reduce((acc, n) => acc + (round.holes[n]?.par ?? 4), 0);
  const totalPar = allHoles.reduce((acc, n) => acc + (round.holes[n]?.par ?? 4), 0);
  const relativeToPar = totalStrokes - playedPar;
  const totalPutts = allHoles.reduce((acc, n) => acc + getEffectivePutts(round.scores[n]), 0);
  const totalPenalties = allHoles.reduce((acc, n) => acc + getHolePenalties(round.scores[n]), 0);

  const availableTees = round.course?.availableTees ?? [];
  const activeTee =
    availableTees.find((t) => t.id === round.course?.selectedTeeId) ?? availableTees[0];

  const allShots: ShotRecord[] = Object.values(round.scores).flatMap((h) => h.shots);

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
    link.download = `pocketcaddy-round-${new Date(round.startedAt).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24 lg:pb-8">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex items-start justify-between w-full sm:w-auto gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-300">
              {round.course ? round.course.name : 'Active 18-Hole Round'} · Par {totalPar}
              {activeTee?.courseRating && activeTee?.slopeRating
                ? ` · Rating ${activeTee.courseRating} / Slope ${activeTee.slopeRating}`
                : ''}
            </div>
            <h2 className="font-display text-xl sm:text-3xl font-bold text-[#0F1A14] dark:text-slate-100 mt-0.5 truncate max-w-[70vw] sm:max-w-none">
              Official Round Scorecard
            </h2>
          </div>

          {/* Export Icon-Only Button at the Top */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={allShots.length === 0}
            className="w-9 h-9 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 flex items-center justify-center shrink-0 shadow-2xs transition-all active:scale-95"
            title="Export round shots to CSV"
            aria-label="Export CSV"
          >
            <Download className="w-4 h-4 shrink-0" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto flex-nowrap overflow-x-auto no-scrollbar max-w-full">


          {/* 9 or 18 Hole Toggle */}
          {onToggleHoleMode && (
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-300 dark:border-slate-700 shrink-0">
              <button
                type="button"
                onClick={() => onToggleHoleMode('18')}
                className={`px-2 py-1 rounded-lg text-xs font-extrabold transition-colors ${
                  holeMode === '18'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                18H
              </button>
              <button
                type="button"
                onClick={() => onToggleHoleMode('front9')}
                className={`px-2 py-1 rounded-lg text-xs font-extrabold transition-colors ${
                  holeMode === 'front9'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                Front 9
              </button>
              <button
                type="button"
                onClick={() => onToggleHoleMode('back9')}
                className={`px-2 py-1 rounded-lg text-xs font-extrabold transition-colors ${
                  holeMode === 'back9'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                Back 9
              </button>
              {Object.keys(round.holes).length > 18 && (
                <button
                  type="button"
                  onClick={() => onToggleHoleMode('all27')}
                  className={`px-2 py-1 rounded-lg text-xs font-extrabold transition-colors ${
                    holeMode === 'all27'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  }`}
                >
                  27H
                </button>
              )}
            </div>
          )}

          {/* Save & End Round Button */}
          <button
            type="button"
            onClick={() => setShowEndRoundConfirm(true)}
            className="h-10 px-2.5 sm:px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-[0.96] text-white font-extrabold text-xs inline-flex items-center gap-1 sm:gap-1.5 shadow-sm shadow-emerald-600/30 whitespace-nowrap transition-all shrink-0"
            title="Save and End Round"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>Save & End Round</span>
          </button>


        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/60 inline-block" />
          Eagle or better
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full border-2 border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 inline-block" />
          Birdie
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-sm border border-sky-600 bg-sky-50 dark:bg-sky-950/60 inline-block" />
          Bogey
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-sm border-2 border-rose-600 bg-rose-50 dark:bg-rose-950/60 inline-block" />
          Double+
        </span>
      </div>

      {/* Front 9 & Back 9 Tables */}
      <NineHoleTable
        title="Front 9"
        holeNumbers={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
        holes={round.holes}
        scores={round.scores}
        currentHole={round.currentHole}
        unit={round.unit}
        onSelectHole={onSelectHole}
        onOverrideHoleScore={onOverrideHoleScore}
        onUpdateHoleMeta={onUpdateHoleMeta}
      />

      <NineHoleTable
        title="Back 9"
        holeNumbers={[10, 11, 12, 13, 14, 15, 16, 17, 18]}
        holes={round.holes}
        scores={round.scores}
        currentHole={round.currentHole}
        unit={round.unit}
        onSelectHole={onSelectHole}
        onOverrideHoleScore={onOverrideHoleScore}
        onUpdateHoleMeta={onUpdateHoleMeta}
      />

      {Object.keys(round.holes).length > 18 && (
        <NineHoleTable
          title="Third 9"
          holeNumbers={[19, 20, 21, 22, 23, 24, 25, 26, 27]}
          holes={round.holes}
          scores={round.scores}
          currentHole={round.currentHole}
          unit={round.unit}
          onSelectHole={onSelectHole}
          onOverrideHoleScore={onOverrideHoleScore}
          onUpdateHoleMeta={onUpdateHoleMeta}
        />
      )}

      {/* Streamlined Round Scorecard Summary Bar */}
      <div className="bg-white dark:bg-[#0c160f] rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div>
            <span className="text-slate-500 dark:text-slate-400 font-medium">Score: </span>
            <span className="font-display font-black text-base text-[#0F1A14] dark:text-white tabular-nums">
              {totalStrokes > 0 ? totalStrokes : '—'}
            </span>
            <span className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400 ml-1.5 tabular-nums">
              {playedHoles.length > 0 ? formatRelativeToPar(relativeToPar) : 'E'}
            </span>
          </div>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <div>
            <span className="text-slate-500 dark:text-slate-400 font-medium">Putts: </span>
            <span className="font-mono font-black text-sm text-[#0F1A14] dark:text-white tabular-nums">
              {totalPutts}
            </span>
          </div>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <div>
            <span className="text-slate-500 dark:text-slate-400 font-medium">Penalties: </span>
            <span className="font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums">
              {totalPenalties}
            </span>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium tabular-nums">
          Thru {playedHoles.length} of {allHoles.length} holes{holeMode === 'front9' ? ' (Front 9)' : holeMode === 'back9' ? ' (Back 9)' : holeMode === 'all27' ? ' (All 27)' : ''}
        </div>
      </div>

      {/* End Round Confirmation Modal */}
      {showEndRoundConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setShowEndRoundConfirm(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-[#0c160f] border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                <Check className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-black text-base text-[#0F1A14] dark:text-slate-100">
                  Finish Round?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Save your scores and stats to device history, or end and discard this round.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {/* Option 1: Save & End Round */}
              <button
                type="button"
                onClick={() => {
                  setShowEndRoundConfirm(false);
                  onSaveAndEndRound();
                }}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs shadow-md shadow-emerald-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>Save & End Round</span>
              </button>

              {/* Option 2: End & Discard Round */}
              <button
                type="button"
                onClick={() => {
                  setShowEndRoundConfirm(false);
                  onDiscardRound();
                }}
                className="w-full h-11 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4 text-rose-500" />
                <span>End & Discard Round</span>
              </button>

              {/* Option 3: Cancel / Keep Playing */}
              <button
                type="button"
                onClick={() => setShowEndRoundConfirm(false)}
                className="w-full h-10 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                Keep Playing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

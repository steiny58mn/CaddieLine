import React from 'react';
import { Check, Save } from 'lucide-react';
import { DistanceUnit, HolePinData, HoleScoreState, RoundState } from '../types/golf';
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
  roundJustSaved: boolean;
  onSelectHole: (holeNumber: number) => void;
  onUpdateHoleMeta: (holeNumber: number, patch: Partial<HolePinData>) => void;
  onOverrideHoleScore: (holeNumber: number, score: number | undefined) => void;
  onSelectTee?: (teeId: string) => void;
  onSaveRound: () => void;
  onResetRound: () => void;
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
}) => {
  const sumPar = holeNumbers.reduce((acc, n) => acc + (holes[n]?.par ?? 4), 0);
  const sumYards = holeNumbers.reduce((acc, n) => acc + (holes[n]?.yardage ?? 0), 0);
  const sumScore = holeNumbers.reduce((acc, n) => acc + getHoleStrokes(scores[n]), 0);
  const sumPutts = holeNumbers.reduce((acc, n) => acc + getEffectivePutts(scores[n]), 0);

  return (
    <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/60">
        <h3 className="text-sm font-bold text-[#0F1A14] dark:text-slate-100">{title}</h3>
        <span className="text-xs font-mono text-slate-500 tabular-nums">
          Par {sumPar} · {formatDistanceValue(sumYards, unit)} {unitSuffix(unit)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-center border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/40">
              <th className="py-2.5 px-3 text-left font-semibold w-24">Hole</th>
              {holeNumbers.map((num) => (
                <th key={num} className="py-2 px-1">
                  <button
                    type="button"
                    onClick={() => onSelectHole(num)}
                    className={`min-h-[36px] min-w-[36px] rounded-lg font-mono font-bold text-xs transition-colors ${
                      currentHole === num
                        ? 'bg-emerald-700 text-white'
                        : 'text-[#0F1A14] hover:bg-slate-200/70'
                    }`}
                  >
                    {num}
                  </button>
                </th>
              ))}
              <th className="py-2.5 px-3 font-bold text-[#0F1A14] dark:text-slate-100 bg-slate-100/80 dark:bg-slate-800/60">
                {holeNumbers[0] === 1 ? 'OUT' : 'IN'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-800 dark:text-slate-200">
            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-600">
                {unit === 'meters' ? 'Meters' : 'Yards'}
              </td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-2 px-1 font-mono text-slate-500 tabular-nums">
                  {formatDistanceValue(holes[num]?.yardage, unit)}
                </td>
              ))}
              <td className="py-2 px-3 font-mono font-semibold text-slate-700 bg-slate-50 tabular-nums">
                {formatDistanceValue(sumYards, unit)}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-600">Par</td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-2 px-1 font-mono font-semibold text-slate-700 tabular-nums">
                  {holes[num]?.par ?? 4}
                </td>
              ))}
              <td className="py-2 px-3 font-mono font-bold text-[#0F1A14] bg-slate-50 tabular-nums">
                {sumPar}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-500">Hcp</td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-2 px-1 font-mono text-slate-400 tabular-nums">
                  {holes[num]?.handicap ?? '—'}
                </td>
              ))}
              <td className="py-2 px-3 font-mono text-slate-400 bg-slate-50">—</td>
            </tr>

            <tr>
              <td className="py-2.5 px-3 text-left font-semibold text-[#0F1A14]">Score</td>
              {holeNumbers.map((num) => {
                const strokes = getHoleStrokes(scores[num]);
                return (
                  <td key={num} className="py-2 px-1">
                    <button
                      type="button"
                      onClick={() => onSelectHole(num)}
                      className="inline-flex items-center justify-center rounded-lg hover:bg-slate-100 p-0.5 transition-colors"
                      title={`Jump to Hole ${num}`}
                    >
                      <ScoreSymbol strokes={strokes} par={holes[num]?.par ?? 4} />
                    </button>
                  </td>
                );
              })}
              <td className="py-2.5 px-3 font-mono font-bold text-sm text-[#0F1A14] bg-slate-100/70 tabular-nums">
                {sumScore > 0 ? sumScore : '—'}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-500">Putts</td>
              {holeNumbers.map((num) => {
                const putts = getEffectivePutts(scores[num]);
                return (
                  <td key={num} className="py-2 px-1 font-mono text-slate-600 tabular-nums">
                    {isHolePlayed(scores[num]) || putts > 0 ? putts : '—'}
                  </td>
                );
              })}
              <td className="py-2 px-3 font-mono font-semibold text-slate-700 bg-slate-50 tabular-nums">
                {sumPutts > 0 ? sumPutts : '—'}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-500">FIR / GIR</td>
              {holeNumbers.map((num) => {
                const fir = getHoleFairwayStatus(scores[num], holes[num]?.par ?? 4);
                const gir = getHoleGIR(scores[num], holes[num]?.par ?? 4);
                const played = isHolePlayed(scores[num]);
                return (
                  <td key={num} className="py-2 px-1 font-mono text-[11px] text-slate-600">
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
              <td className="py-2 px-3 font-mono text-[11px] text-slate-500 bg-slate-50">
                {holeNumbers.filter((n) => getHoleGIR(scores[n], holes[n]?.par ?? 4)).length} GIR
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-500">Manual</td>
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
                    className="w-11 h-7 text-center rounded border border-slate-200 text-[11px] font-mono tabular-nums text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                    aria-label={`Manual score override for hole ${num}`}
                  />
                </td>
              ))}
              <td className="py-2 px-3 text-[11px] text-slate-400 bg-slate-50">Override</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const ScorecardView: React.FC<ScorecardViewProps> = ({
  round,
  roundJustSaved,
  onSelectHole,
  onUpdateHoleMeta,
  onOverrideHoleScore,
  onSelectTee,
  onSaveRound,
  onResetRound,
}) => {
  const allHoles = Array.from({ length: 18 }, (_, i) => i + 1);
  const playedHoles = allHoles.filter((n) => isHolePlayed(round.scores[n]));
  const totalStrokes = allHoles.reduce((acc, n) => acc + getHoleStrokes(round.scores[n]), 0);
  const playedPar = playedHoles.reduce((acc, n) => acc + (round.holes[n]?.par ?? 4), 0);
  const totalPar = allHoles.reduce((acc, n) => acc + (round.holes[n]?.par ?? 4), 0);
  const relativeToPar = totalStrokes - playedPar;
  const totalPutts = allHoles.reduce((acc, n) => acc + getEffectivePutts(round.scores[n]), 0);
  const totalPenalties = allHoles.reduce((acc, n) => acc + getHolePenalties(round.scores[n]), 0);

  const firEligible = playedHoles.filter((n) => (round.holes[n]?.par ?? 4) > 3);
  const firHits = firEligible.filter(
    (n) => getHoleFairwayStatus(round.scores[n], round.holes[n]?.par ?? 4) === 'hit'
  );
  const girHits = playedHoles.filter((n) => getHoleGIR(round.scores[n], round.holes[n]?.par ?? 4));

  const availableTees = round.course?.availableTees ?? [];
  const activeTee =
    availableTees.find((t) => t.id === round.course?.selectedTeeId) ?? availableTees[0];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24 lg:pb-8">
      {/* Header & Summary Strip */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500">
            {round.course ? round.course.name : 'Active 18-Hole Round'} · Par {totalPar}
            {activeTee?.courseRating && activeTee?.slopeRating
              ? ` · Rating ${activeTee.courseRating} / Slope ${activeTee.slopeRating}`
              : ''}
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0F1A14] mt-0.5">
            Official Round Scorecard
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {availableTees.length > 0 && onSelectTee && (
            <select
              value={activeTee?.id ?? ''}
              onChange={(e) => onSelectTee(e.target.value)}
              aria-label="Select tee set"
              className="min-h-[44px] max-w-[230px] px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-[#0F1A14] focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              {availableTees.map((tee) => (
                <option key={tee.id} value={tee.id}>
                  {formatTeeSummaryLabel(tee)}
                </option>
              ))}
            </select>
          )}

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
            onClick={onResetRound}
            className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            End Round
          </button>
        </div>
      </div>

      {/* 4-column KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-white to-emerald-50/50 dark:from-slate-900 dark:to-emerald-950/30 rounded-3xl border border-emerald-200/80 dark:border-emerald-800/80 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Score</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-3xl font-black text-[#0F1A14] dark:text-white tabular-nums">
              {totalStrokes > 0 ? totalStrokes : '—'}
            </span>
            <span className="font-mono text-sm font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
              {playedHoles.length > 0 ? formatRelativeToPar(relativeToPar) : 'E'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums font-medium">
            Thru {playedHoles.length} of 18 holes
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-sky-50/50 dark:from-slate-900 dark:to-sky-950/30 rounded-3xl border border-sky-200/80 dark:border-sky-800/80 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fairways Hit (FIR)</div>
          <div className="mt-1 font-display text-3xl font-black text-sky-700 dark:text-sky-300 tabular-nums">
            {firEligible.length > 0
              ? `${Math.round((firHits.length / firEligible.length) * 100)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums font-medium">
            {firHits.length} of {firEligible.length} tee shots
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-teal-50/50 dark:from-slate-900 dark:to-teal-950/30 rounded-3xl border border-teal-200/80 dark:border-teal-800/80 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Greens in Reg (GIR)</div>
          <div className="mt-1 font-display text-3xl font-black text-teal-700 dark:text-teal-300 tabular-nums">
            {playedHoles.length > 0
              ? `${Math.round((girHits.length / playedHoles.length) * 100)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums font-medium">
            {girHits.length} of {playedHoles.length} holes
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-purple-50/50 dark:from-slate-900 dark:to-purple-950/30 rounded-3xl border border-purple-200/80 dark:border-purple-800/80 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Putts & Penalties</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-3xl font-black text-purple-700 dark:text-purple-300 tabular-nums">
              {totalPutts}
            </span>
            <span className="text-xs text-slate-500 font-bold">putts</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums font-medium">
            {totalPenalties} penalty {totalPenalties === 1 ? 'stroke' : 'strokes'}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full border-2 border-amber-500 bg-amber-50 inline-block" />
          Eagle or better
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full border-2 border-emerald-600 bg-emerald-50 inline-block" />
          Birdie
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-sm border border-sky-600 bg-sky-50 inline-block" />
          Bogey
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-sm border-2 border-rose-600 bg-rose-50 inline-block" />
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
      />
    </div>
  );
};

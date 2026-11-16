import React from 'react';
import { DistanceUnit, HolePinData, HoleScoreState, RoundState } from '../types/golf';
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
  onSelectHole: (holeNumber: number) => void;
  onUpdateHoleMeta: (holeNumber: number, patch: Partial<HolePinData>) => void;
  onOverrideHoleScore: (holeNumber: number, score: number | undefined) => void;
  onResetRound: () => void;
}

const ScoreSymbol: React.FC<{ strokes: number; par: number }> = ({ strokes, par }) => {
  if (strokes <= 0) {
    return <span className="text-slate-300 font-mono">—</span>;
  }
  const diff = strokes - par;

  if (diff <= -2) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-amber-500 ring-2 ring-amber-300/60 bg-amber-50 text-amber-950 font-mono font-bold text-xs tabular-nums">
        {strokes}
      </span>
    );
  }
  if (diff === -1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-emerald-600 bg-emerald-50 text-emerald-950 font-mono font-bold text-xs tabular-nums">
        {strokes}
      </span>
    );
  }
  if (diff === 0) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 font-mono font-bold text-xs text-[#0F1A14] tabular-nums">
        {strokes}
      </span>
    );
  }
  if (diff === 1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-sm border border-sky-600 bg-sky-50 text-sky-950 font-mono font-bold text-xs tabular-nums">
        {strokes}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-sm border-2 border-rose-600 bg-rose-50 text-rose-950 font-mono font-bold text-xs tabular-nums">
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
  onUpdateHoleMeta: (holeNumber: number, patch: Partial<HolePinData>) => void;
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
  onUpdateHoleMeta,
  onOverrideHoleScore,
}) => {
  const sumPar = holeNumbers.reduce((acc, n) => acc + holes[n].par, 0);
  const sumYards = holeNumbers.reduce((acc, n) => acc + holes[n].yardage, 0);
  const sumScore = holeNumbers.reduce((acc, n) => acc + getHoleStrokes(scores[n]), 0);
  const sumPutts = holeNumbers.reduce((acc, n) => acc + getEffectivePutts(scores[n]), 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-[#FAFBFA]">
        <h3 className="text-sm font-bold text-[#0F1A14]">{title}</h3>
        <span className="text-xs font-mono text-slate-500 tabular-nums">
          Par {sumPar} · {formatDistanceValue(sumYards, unit)} {unitSuffix(unit)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-center border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50/70">
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
              <th className="py-2.5 px-3 font-bold text-[#0F1A14] bg-slate-100/80">
                {holeNumbers[0] === 1 ? 'OUT' : 'IN'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-600">
                {unit === 'meters' ? 'Meters' : 'Yards'}
              </td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-2 px-1 font-mono text-slate-500 tabular-nums">
                  {formatDistanceValue(holes[num].yardage, unit)}
                </td>
              ))}
              <td className="py-2 px-3 font-mono font-semibold text-slate-700 bg-slate-50 tabular-nums">
                {formatDistanceValue(sumYards, unit)}
              </td>
            </tr>

            <tr>
              <td className="py-2 px-3 text-left font-medium text-slate-600">Par</td>
              {holeNumbers.map((num) => (
                <td key={num} className="py-1.5 px-1">
                  <select
                    value={holes[num].par}
                    onChange={(e) => onUpdateHoleMeta(num, { par: Number(e.target.value) })}
                    className="bg-transparent font-mono font-semibold text-slate-700 text-xs text-center rounded hover:bg-slate-100 py-1 px-1 cursor-pointer"
                    aria-label={`Hole ${num} par`}
                  >
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                  </select>
                </td>
              ))}
              <td className="py-2 px-3 font-mono font-bold text-[#0F1A14] bg-slate-50 tabular-nums">
                {sumPar}
              </td>
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
                      <ScoreSymbol strokes={strokes} par={holes[num].par} />
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
                const fir = getHoleFairwayStatus(scores[num], holes[num].par);
                const gir = getHoleGIR(scores[num], holes[num].par);
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
                {holeNumbers.filter((n) => getHoleGIR(scores[n], holes[n].par)).length} GIR
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
  onSelectHole,
  onUpdateHoleMeta,
  onOverrideHoleScore,
  onResetRound,
}) => {
  const allHoles = Array.from({ length: 18 }, (_, i) => i + 1);
  const playedHoles = allHoles.filter((n) => isHolePlayed(round.scores[n]));
  const totalStrokes = allHoles.reduce((acc, n) => acc + getHoleStrokes(round.scores[n]), 0);
  const playedPar = playedHoles.reduce((acc, n) => acc + round.holes[n].par, 0);
  const totalPar = allHoles.reduce((acc, n) => acc + round.holes[n].par, 0);
  const relativeToPar = totalStrokes - playedPar;
  const totalPutts = allHoles.reduce((acc, n) => acc + getEffectivePutts(round.scores[n]), 0);
  const totalPenalties = allHoles.reduce((acc, n) => acc + getHolePenalties(round.scores[n]), 0);

  const firEligible = playedHoles.filter((n) => round.holes[n].par > 3);
  const firHits = firEligible.filter(
    (n) => getHoleFairwayStatus(round.scores[n], round.holes[n].par) === 'hit'
  );
  const girHits = playedHoles.filter((n) => getHoleGIR(round.scores[n], round.holes[n].par));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24 lg:pb-8">
      {/* Header & Summary Strip */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500">
            {round.course ? round.course.name : 'Active 18-Hole Round'} · Par {totalPar}
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0F1A14] mt-0.5">
            Official Round Scorecard
          </h2>
        </div>

        <button
          type="button"
          onClick={onResetRound}
          className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 self-start sm:self-auto whitespace-nowrap"
        >
          Start Fresh Round
        </button>
      </div>

      {/* 4-column KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">Total Score</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold text-[#0F1A14] tabular-nums">
              {totalStrokes > 0 ? totalStrokes : '—'}
            </span>
            <span className="font-mono text-sm font-bold text-emerald-700 tabular-nums">
              {playedHoles.length > 0 ? formatRelativeToPar(relativeToPar) : 'E'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
            Thru {playedHoles.length} of 18 holes
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">Fairways Hit (FIR)</div>
          <div className="mt-1 font-display text-3xl font-bold text-[#0F1A14] tabular-nums">
            {firEligible.length > 0
              ? `${Math.round((firHits.length / firEligible.length) * 100)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {firHits.length} of {firEligible.length} par 4/5 tee shots
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">Greens in Reg (GIR)</div>
          <div className="mt-1 font-display text-3xl font-bold text-[#0F1A14] tabular-nums">
            {playedHoles.length > 0
              ? `${Math.round((girHits.length / playedHoles.length) * 100)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {girHits.length} of {playedHoles.length} holes played
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">Putts & Penalties</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold text-[#0F1A14] tabular-nums">
              {totalPutts}
            </span>
            <span className="text-xs text-slate-500">putts</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
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
        onUpdateHoleMeta={onUpdateHoleMeta}
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
        onUpdateHoleMeta={onUpdateHoleMeta}
        onOverrideHoleScore={onOverrideHoleScore}
      />
    </div>
  );
};

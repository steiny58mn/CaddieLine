import {
  Club,
  ClubCategory,
  DistanceUnit,
  HolePinData,
  HoleScoreState,
  LatLngLiteral,
  RoundState,
  ShotDirection,
  ShotLie,
  ShotRecord,
} from '../types/golf';

export interface ClubPreset {
  id: string;
  name: string;
  shortName: string;
  category: ClubCategory;
  typicalYards: number;
}

export const CLUB_PRESETS: ClubPreset[] = [
  { id: 'dr', name: 'Driver', shortName: 'D', category: 'wood', typicalYards: 255 },
  { id: '3w', name: '3 Wood', shortName: '3W', category: 'wood', typicalYards: 230 },
  { id: '5w', name: '5 Wood', shortName: '5W', category: 'wood', typicalYards: 212 },
  { id: '7w', name: '7 Wood', shortName: '7W', category: 'wood', typicalYards: 198 },
  { id: '9w', name: '9 Wood', shortName: '9W', category: 'wood', typicalYards: 185 },
  { id: '2h', name: '2 Hybrid', shortName: '2H', category: 'hybrid', typicalYards: 215 },
  { id: '3h', name: '3 Hybrid', shortName: '3H', category: 'hybrid', typicalYards: 205 },
  { id: '4h', name: '4 Hybrid', shortName: '4H', category: 'hybrid', typicalYards: 195 },
  { id: '5h', name: '5 Hybrid', shortName: '5H', category: 'hybrid', typicalYards: 183 },
  { id: '2i', name: '2 Iron', shortName: '2I', category: 'iron', typicalYards: 205 },
  { id: '3i', name: '3 Iron', shortName: '3I', category: 'iron', typicalYards: 195 },
  { id: '4i', name: '4 Iron', shortName: '4I', category: 'iron', typicalYards: 185 },
  { id: '5i', name: '5 Iron', shortName: '5I', category: 'iron', typicalYards: 175 },
  { id: '6i', name: '6 Iron', shortName: '6I', category: 'iron', typicalYards: 165 },
  { id: '7i', name: '7 Iron', shortName: '7I', category: 'iron', typicalYards: 155 },
  { id: '8i', name: '8 Iron', shortName: '8I', category: 'iron', typicalYards: 145 },
  { id: '9i', name: '9 Iron', shortName: '9I', category: 'iron', typicalYards: 134 },
  { id: 'pw', name: 'Pitching Wedge', shortName: 'PW', category: 'wedge', typicalYards: 122 },
  { id: 'gw', name: 'Gap Wedge (50°)', shortName: 'GW', category: 'wedge', typicalYards: 108 },
  { id: 'sw', name: 'Sand Wedge (56°)', shortName: 'SW', category: 'wedge', typicalYards: 92 },
  { id: 'lw', name: 'Lob Wedge (60°)', shortName: 'LW', category: 'wedge', typicalYards: 74 },
  { id: 'pt', name: 'Putter', shortName: 'PT', category: 'putter', typicalYards: 10 },
];

export const DEFAULT_CLUB_BAG: Club[] = [];

export const DEFAULT_PAR_LAYOUT: Array<{ par: number; yardage: number; handicap: number }> = [
  { par: 4, yardage: 405, handicap: 9 },
  { par: 4, yardage: 382, handicap: 13 },
  { par: 3, yardage: 174, handicap: 17 },
  { par: 5, yardage: 528, handicap: 3 },
  { par: 4, yardage: 430, handicap: 1 },
  { par: 4, yardage: 364, handicap: 15 },
  { par: 3, yardage: 192, handicap: 11 },
  { par: 4, yardage: 418, handicap: 5 },
  { par: 5, yardage: 545, handicap: 7 },
  { par: 4, yardage: 410, handicap: 8 },
  { par: 4, yardage: 394, handicap: 12 },
  { par: 3, yardage: 165, handicap: 18 },
  { par: 5, yardage: 515, handicap: 4 },
  { par: 4, yardage: 442, handicap: 2 },
  { par: 4, yardage: 356, handicap: 16 },
  { par: 3, yardage: 204, handicap: 10 },
  { par: 4, yardage: 424, handicap: 6 },
  { par: 5, yardage: 536, handicap: 14 },
];

export interface LieOptionMeta {
  id: ShotLie;
  label: string;
  shortLabel: string;
  defaultDirection: ShotDirection;
  penalty: number;
  badgeClass: string;
  dotColor: string;
}

export const LIE_OPTIONS: LieOptionMeta[] = [
  {
    id: 'fairway',
    label: 'Fairway',
    shortLabel: 'Fairway',
    defaultDirection: 'straight',
    penalty: 0,
    badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    dotColor: '#059669',
  },
  {
    id: 'green',
    label: 'Green',
    shortLabel: 'Green',
    defaultDirection: 'straight',
    penalty: 0,
    badgeClass: 'bg-teal-50 text-teal-900 border-teal-200',
    dotColor: '#0D9488',
  },
  {
    id: 'fringe',
    label: 'Fringe',
    shortLabel: 'Fringe',
    defaultDirection: 'straight',
    penalty: 0,
    badgeClass: 'bg-lime-50 text-lime-900 border-lime-200',
    dotColor: '#65A30D',
  },
  {
    id: 'rough',
    label: 'Rough',
    shortLabel: 'Rough',
    defaultDirection: 'straight',
    penalty: 0,
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
    dotColor: '#D97706',
  },
  {
    id: 'trees',
    label: 'Trees',
    shortLabel: 'Trees',
    defaultDirection: 'straight',
    penalty: 0,
    badgeClass: 'bg-orange-50 text-orange-950 border-orange-200',
    dotColor: '#EA580C',
  },
  {
    id: 'sand',
    label: 'Bunker',
    shortLabel: 'Bunker',
    defaultDirection: 'straight',
    penalty: 0,
    badgeClass: 'bg-yellow-50 text-yellow-950 border-yellow-300',
    dotColor: '#CA8A04',
  },
  {
    id: 'water',
    label: 'Water (+1)',
    shortLabel: 'Water',
    defaultDirection: 'straight',
    penalty: 1,
    badgeClass: 'bg-sky-50 text-sky-950 border-sky-200',
    dotColor: '#0284C7',
  },
  {
    id: 'ob',
    label: 'OB (+1)',
    shortLabel: 'OB (+1)',
    defaultDirection: 'straight',
    penalty: 1,
    badgeClass: 'bg-rose-50 text-rose-950 border-rose-200',
    dotColor: '#E11D48',
  },
  {
    id: 'holed',
    label: 'Holed',
    shortLabel: 'Holed',
    defaultDirection: 'straight',
    penalty: 0,
    badgeClass: 'bg-emerald-900 text-white border-emerald-900',
    dotColor: '#047857',
  },
];

export const DIRECTION_OPTIONS: Array<{ id: ShotDirection; label: string; shortLabel: string }> = [
  { id: 'left', label: 'Left / Pull', shortLabel: 'Left' },
  { id: 'straight', label: 'On Line', shortLabel: 'Straight' },
  { id: 'right', label: 'Right / Push', shortLabel: 'Right' },
  { id: 'short', label: 'Short', shortLabel: 'Short' },
  { id: 'long', label: 'Long', shortLabel: 'Long' },
];

export function normalizeShotLie(lie: ShotLie): ShotLie {
  if (lie === 'left_rough' || lie === 'right_rough') return 'rough';
  if (lie === 'left_trees' || lie === 'right_trees') return 'trees';
  return lie;
}

export function getLieMeta(lie: ShotLie): LieOptionMeta {
  const normalized = normalizeShotLie(lie);
  return LIE_OPTIONS.find((item) => item.id === normalized) ?? LIE_OPTIONS[0];
}

const EARTH_RADIUS_METERS = 6371000;
const METERS_TO_YARDS = 1.0936133;

export function computeDistanceMeters(a?: LatLngLiteral | null, b?: LatLngLiteral | null): number {
  if (
    !a ||
    !b ||
    typeof a.lat !== 'number' ||
    typeof a.lng !== 'number' ||
    typeof b.lat !== 'number' ||
    typeof b.lng !== 'number' ||
    Number.isNaN(a.lat) ||
    Number.isNaN(a.lng) ||
    Number.isNaN(b.lat) ||
    Number.isNaN(b.lng)
  ) {
    return 0;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function computeDistanceYards(a?: LatLngLiteral | null, b?: LatLngLiteral | null): number {
  return Math.round(computeDistanceMeters(a, b) * METERS_TO_YARDS);
}

export function computePolygonCentroid(polygon: LatLngLiteral[]): LatLngLiteral {
  if (polygon.length === 0) return { lat: 0, lng: 0 };
  if (polygon.length <= 2) {
    const lat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length;
    const lng = polygon.reduce((s, p) => s + p.lng, 0) / polygon.length;
    return { lat, lng };
  }

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    const f = p1.lng * p2.lat - p2.lng * p1.lat;
    twiceArea += f;
    cx += (p1.lng + p2.lng) * f;
    cy += (p1.lat + p2.lat) * f;
  }

  if (Math.abs(twiceArea) < 1e-12) {
    const lat = polygon.reduce((s, p) => s + p.lat, 0) / n;
    const lng = polygon.reduce((s, p) => s + p.lng, 0) / n;
    return { lat, lng };
  }

  return {
    lat: cy / (3 * twiceArea),
    lng: cx / (3 * twiceArea),
  };
}

export function isPointInPolygon(pt: LatLngLiteral, polygon: LatLngLiteral[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function toLocalMeters(origin: LatLngLiteral, target: LatLngLiteral): { x: number; y: number } {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (target.lng - origin.lng) * cosLat * 111320,
    y: (target.lat - origin.lat) * 111320,
  };
}

function fromLocalMeters(origin: LatLngLiteral, x: number, y: number): LatLngLiteral {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180) || 1;
  return {
    lat: origin.lat + y / 111320,
    lng: origin.lng + x / (cosLat * 111320),
  };
}

export function pointToSegmentDistanceMeters(
  pt: LatLngLiteral,
  segA: LatLngLiteral,
  segB: LatLngLiteral
): { distanceMeters: number; closestPoint: LatLngLiteral } {
  const a = toLocalMeters(pt, segA);
  const b = toLocalMeters(pt, segB);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return { distanceMeters: Math.hypot(a.x, a.y), closestPoint: segA };
  }
  const t = Math.max(0, Math.min(1, (-a.x * dx - a.y * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return {
    distanceMeters: Math.hypot(cx, cy),
    closestPoint: fromLocalMeters(pt, cx, cy),
  };
}

export function pointToPolylineMinDistanceMeters(pt: LatLngLiteral, line: LatLngLiteral[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return computeDistanceMeters(pt, line[0]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const { distanceMeters } = pointToSegmentDistanceMeters(pt, line[i], line[i + 1]);
    if (distanceMeters < best) best = distanceMeters;
  }
  return best;
}

export interface PolygonDistanceResult {
  frontYards: number;
  centerYards: number;
  backYards: number;
  frontPoint: LatLngLiteral;
  centerPoint: LatLngLiteral;
  backPoint: LatLngLiteral;
}

export function computePolygonFrontCenterBack(
  origin: LatLngLiteral,
  polygon: LatLngLiteral[],
  aimCenter?: LatLngLiteral
): PolygonDistanceResult | null {
  if (polygon.length < 3) return null;

  const centroid = computePolygonCentroid(polygon);
  const centerPoint = aimCenter ?? centroid;
  const targetVec = toLocalMeters(origin, centerPoint);
  const targetLen = Math.hypot(targetVec.x, targetVec.y);
  const centerYards = computeDistanceYards(origin, centerPoint);

  if (targetLen < 0.5) {
    // Player is virtually on the center of the polygon
    return {
      frontYards: 0,
      centerYards: 0,
      backYards: 0,
      frontPoint: origin,
      centerPoint,
      backPoint: origin,
    };
  }

  const ux = targetVec.x / targetLen;
  const uy = targetVec.y / targetLen;

  // Ray-polygon intersections along ray P(t) = t * (ux, uy), t >= 0
  const localPts = polygon.map((p) => toLocalMeters(origin, p));
  const intersections: number[] = [];

  for (let i = 0; i < localPts.length; i += 1) {
    const a = localPts[i];
    const b = localPts[(i + 1) % localPts.length];
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const denom = ux * sy - uy * sx;
    if (Math.abs(denom) < 1e-8) continue;

    const t = (a.x * sy - a.y * sx) / denom;
    const u = (a.x * uy - a.y * ux) / denom;
    if (t >= 0 && u >= -1e-6 && u <= 1 + 1e-6) {
      intersections.push(t);
    }
  }

  // Deduplicate close intersections at vertices
  intersections.sort((a, b) => a - b);
  const uniqueHits: number[] = [];
  for (const t of intersections) {
    if (uniqueHits.length === 0 || Math.abs(t - uniqueHits[uniqueHits.length - 1]) > 0.25) {
      uniqueHits.push(t);
    }
  }

  // Closest boundary point (also great fallback if ray misses concave bunker)
  let minEdgeDist = Infinity;
  let closestEdgePoint = polygon[0];
  let maxAlongMeters = -Infinity;
  let farthestPoint = polygon[0];

  for (let i = 0; i < polygon.length; i += 1) {
    const segA = polygon[i];
    const segB = polygon[(i + 1) % polygon.length];
    const seg = pointToSegmentDistanceMeters(origin, segA, segB);
    if (seg.distanceMeters < minEdgeDist) {
      minEdgeDist = seg.distanceMeters;
      closestEdgePoint = seg.closestPoint;
    }
    const lv = localPts[i];
    const proj = lv.x * ux + lv.y * uy;
    if (proj > maxAlongMeters) {
      maxAlongMeters = proj;
      farthestPoint = segA;
    }
  }

  let frontMeters: number;
  let backMeters: number;
  let frontPoint: LatLngLiteral;
  let backPoint: LatLngLiteral;

  if (uniqueHits.length >= 2) {
    // Normal outside-polygon crossing
    frontMeters = uniqueHits[0];
    backMeters = uniqueHits[uniqueHits.length - 1];
    frontPoint = fromLocalMeters(origin, frontMeters * ux, frontMeters * uy);
    backPoint = fromLocalMeters(origin, backMeters * ux, backMeters * uy);
  } else if (uniqueHits.length === 1) {
    // Player is standing inside the polygon (e.g. already in bunker or on green)
    frontMeters = 0;
    backMeters = uniqueHits[0];
    frontPoint = origin;
    backPoint = fromLocalMeters(origin, backMeters * ux, backMeters * uy);
  } else {
    frontMeters = minEdgeDist;
    frontPoint = closestEdgePoint;
    backMeters = Math.max(minEdgeDist, Math.hypot(toLocalMeters(origin, farthestPoint).x, toLocalMeters(origin, farthestPoint).y));
    backPoint = farthestPoint;
  }

  return {
    frontYards: Math.round(frontMeters * METERS_TO_YARDS),
    centerYards,
    backYards: Math.round(Math.max(frontMeters, backMeters) * METERS_TO_YARDS),
    frontPoint,
    centerPoint,
    backPoint,
  };
}

export function isHazardInPlayCorridor(
  origin: LatLngLiteral,
  greenCenter: LatLngLiteral | undefined,
  hazardCenter: LatLngLiteral
): boolean {
  const distToHazardMeters = computeDistanceMeters(origin, hazardCenter);
  if (distToHazardMeters > 365) return false; // > ~400 yds away

  if (!greenCenter) {
    return distToHazardMeters <= 320;
  }

  const distToGreenMeters = computeDistanceMeters(origin, greenCenter);
  const hazardToGreenMeters = computeDistanceMeters(hazardCenter, greenCenter);

  // Near the green (greenside bunkers/water)
  if (hazardToGreenMeters <= 65) return true;

  // Within play corridor from player toward green
  const perpDist = pointToSegmentDistanceMeters(hazardCenter, origin, greenCenter).distanceMeters;
  return perpDist <= 85 && distToHazardMeters <= distToGreenMeters + 40;
}

export function formatDistanceValue(yards: number | null | undefined, unit: DistanceUnit): string {
  if (yards === null || yards === undefined || Number.isNaN(yards)) return '--';
  if (unit === 'meters') {
    return `${Math.round(yards / METERS_TO_YARDS)}`;
  }
  return `${Math.round(yards)}`;
}

export function unitSuffix(unit: DistanceUnit): string {
  return unit === 'meters' ? 'm' : 'yds';
}

export function recommendClub(distanceYards: number | null, bag: Club[]): Club | null {
  if (distanceYards === null || distanceYards <= 0) return null;
  const nonPutters = bag.filter((c) => c.category !== 'putter');
  if (nonPutters.length === 0) return null;
  return nonPutters.reduce((best, curr) =>
    Math.abs(curr.typicalYards - distanceYards) < Math.abs(best.typicalYards - distanceYards)
      ? curr
      : best
  );
}

export function createInitialRoundState(course: RoundState['course'] = null): RoundState {
  const holes: Record<number, HolePinData> = {};
  const scores: Record<number, HoleScoreState> = {};

  for (let i = 1; i <= 18; i += 1) {
    const layout = DEFAULT_PAR_LAYOUT[i - 1];
    holes[i] = {
      holeNumber: i,
      par: layout.par,
      handicap: layout.handicap,
      yardage: layout.yardage,
      hazards: [],
    };
    scores[i] = {
      holeNumber: i,
      shots: [],
      manualPutts: 0,
    };
  }

  return {
    id: `round_${Date.now()}`,
    course,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    unit: 'yards',
    currentHole: 1,
    holes,
    scores,
  };
}

export function isPutterClub(club: {
  clubId?: string;
  clubName?: string;
  id?: string;
  name?: string;
  category?: string;
} | null | undefined): boolean {
  if (!club) return false;
  if (club.category === 'putter') return true;
  if (club.id === 'pt' || club.clubId === 'pt') return true;
  const name = (club.name || club.clubName || '').toLowerCase();
  return name.includes('putt');
}

/**
 * A shot is counted as a putt ONLY if:
 * 1. It was hit with a putter (or manually entered as a putt), AND
 * 2. The ball was already on the green when hit (meaning the previous shot's lie was 'green').
 * Ending up on the green or in the cup does NOT make an approach shot a putt.
 */
export function isShotPutt(
  shot: {
    clubId?: string;
    clubName?: string;
    lie?: ShotLie;
    isPutt?: boolean;
  },
  previousContext?: unknown
): boolean {
  // If called as Array.prototype.filter(isShotPutt), previousContext is index (number)
  if (typeof previousContext === 'number' || previousContext === undefined) {
    return Boolean(shot.isPutt);
  }

  // Non-putter strokes are NEVER putts (e.g. 7-iron landing on green is NOT a putt)
  if (!isPutterClub(shot) && !shot.isPutt) {
    return false;
  }

  // Putter stroke: counts as a putt ONLY if previous shot landed on green!
  if (typeof previousContext === 'string') {
    return previousContext === 'green';
  }
  if (previousContext && typeof previousContext === 'object' && 'lie' in previousContext) {
    return (previousContext as { lie: ShotLie }).lie === 'green';
  }

  return Boolean(shot.isPutt);
}

/**
 * Re-evaluates every shot on a hole:
 * - Approach shots landing on the green are NOT putts.
 * - Hole-outs from off the green are NOT putts.
 * - Putter strokes count as putts ONLY if the previous shot landed on the green.
 * - Putter strokes from off the green (fringe/fairway/rough) are NOT counted as putts.
 */
export function resolveHoleShotsPutts(shots: ShotRecord[]): ShotRecord[] {
  return shots.map((shot, idx) => {
    // 1. Explicit player manual override on this shot is always respected
    if (shot.isPuttManualOverride !== undefined) {
      return shot;
    }

    // 2. Manually added putt (e.g. +1 Putt button) is assumed to be a putt
    if (shot.source === 'manual' && shot.isPutt) {
      return shot;
    }

    const isPutter = isPutterClub(shot);
    if (!isPutter) {
      // Non-putter shot: landing on green/holed does NOT make it a putt!
      return shot.isPutt ? { ...shot, isPutt: false } : shot;
    }

    // 3. Scanned putter: goes off previous shot landing location (green)
    const prevShot = idx > 0 ? shots[idx - 1] : null;
    const countedAsPutt = prevShot ? prevShot.lie === 'green' : (shot.isPutt ?? false);

    if (shot.isPutt !== countedAsPutt) {
      return { ...shot, isPutt: countedAsPutt };
    }
    return shot;
  });
}

export interface DistanceFeetInches {
  totalFeet: number;
  totalInches: number;
  feet: number;
  inches: number;
  formatted: string;
}

export function formatFeetAndInches(meters: number): DistanceFeetInches {
  const totalInches = Math.max(0, Math.round(meters * 39.3700787));
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return {
    totalFeet: Math.round(totalInches / 12),
    totalInches,
    feet,
    inches,
    formatted: `${feet} ft ${inches} in`,
  };
}

export function getLoggedPuttCount(score: HoleScoreState): number {
  return score.shots.filter(isShotPutt).length;
}

export function getEffectivePutts(score: HoleScoreState): number {
  const loggedPutts = getLoggedPuttCount(score);
  return Math.max(loggedPutts, score.manualPutts);
}

export function getHolePenalties(score: HoleScoreState): number {
  return score.shots.reduce((sum, s) => sum + (s.penaltyStrokes || 0), 0);
}

export function getHoleStrokes(score: HoleScoreState): number {
  if (score.manualScoreOverride !== undefined && score.manualScoreOverride > 0) {
    return score.manualScoreOverride;
  }
  const shotStrokes = score.shots.reduce((sum, s) => sum + 1 + (s.penaltyStrokes || 0), 0);
  const loggedPutts = getLoggedPuttCount(score);
  const extraPutts = Math.max(0, score.manualPutts - loggedPutts);
  return shotStrokes + extraPutts;
}

export function isHolePlayed(score: HoleScoreState): boolean {
  return getHoleStrokes(score) > 0;
}

export function getHoleFairwayStatus(score: HoleScoreState, par: number): 'hit' | 'left' | 'right' | 'na' {
  if (par <= 3) return 'na';
  const teeShot = score.shots[0];
  if (!teeShot) return 'na';
  if (teeShot.lie === 'fairway') return 'hit';
  if (teeShot.direction === 'left' || teeShot.lie === 'left_rough' || teeShot.lie === 'left_trees') {
    return 'left';
  }
  if (teeShot.direction === 'right' || teeShot.lie === 'right_rough' || teeShot.lie === 'right_trees') {
    return 'right';
  }
  return 'na';
}

export function getHoleGIR(score: HoleScoreState, par: number): boolean {
  const targetRegulationStroke = par - 2;
  let cumulativeStrokes = 0;
  for (const shot of score.shots) {
    cumulativeStrokes += 1 + (shot.penaltyStrokes || 0);
    if ((shot.lie === 'green' || shot.lie === 'holed') && cumulativeStrokes <= targetRegulationStroke) {
      return true;
    }
  }
  return false;
}

export function formatRelativeToPar(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

export function getScoreLabel(strokes: number, par: number): string {
  if (strokes <= 0) return '—';
  const diff = strokes - par;
  if (strokes === 1) return 'Hole-in-One';
  if (diff <= -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  if (diff === 2) return 'Double';
  return `+${diff}`;
}

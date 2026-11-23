
declare const __BUILD_GOLF_API_KEY__: string | undefined;

export function getClientFallbackApiKey(): string {
  try {
    const userSaved = typeof localStorage !== 'undefined' ? localStorage.getItem('PocketCaddy_golf_api_key') : null;
    if (userSaved && userSaved.trim()) {
      return userSaved.trim();
    }
  } catch {}
  try {
    if (typeof __BUILD_GOLF_API_KEY__ === 'string' && __BUILD_GOLF_API_KEY__) {
      return __BUILD_GOLF_API_KEY__;
    }
  } catch {}
  try {
    const vKey = (
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOLF_API_KEY ||
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOLFCOURSE_API_KEY ||
      ''
    ).trim();
    if (vKey) return vKey;
  } catch {}
  return '';
}

export function getGolfApiHeaders(): Record<string, string> {
  const clientKey = getClientFallbackApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (clientKey) {
    headers['x-golf-api-key'] = clientKey;
  }
  return headers;
}
import {
  CourseInfo,
  GolfCourseDetail,
  GolfCourseTeeHole,
  GolfCourseTeeSet,
  HolePinData,
} from '../types/golf';
import { computeDistanceMeters } from '../utils/golfMath';

const GCA_MATCH_CACHE_PREFIX = 'PocketCaddy_gca_match_v3_';
const GCA_MATCH_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

interface CachedMatchEntry {
  fetchedAt: number;
  matches: GolfCourseDetail[];
}

export interface GolfCourseApiStatusDebug {
  configured: boolean;
  openGolfApi?: boolean;
  golfCourseApi?: boolean;
  envVarName: string | null;
  keyLength: number;
  maskedKey: string | null;
  lastCheckedAt: number | null;
  lastQuery: string | null;
  upstreamStatus: number | null;
  upstreamError: string | null;
  lastResultCount: number | null;
}

export interface GolfCourseMatchResult {
  configured: boolean;
  openGolfApi?: boolean;
  envVarName?: string | null;
  keyLength?: number;
  maskedKey?: string | null;
  upstreamStatus?: number | null;
  upstreamError?: string | null;
  matches: GolfCourseDetail[];
}

export async function fetchGolfCourseApiStatus(
  verify = false,
  probeQuery?: string
): Promise<GolfCourseApiStatusDebug | null> {
  try {
    const params = new URLSearchParams();
    if (verify) params.set('verify', '1');
    if (probeQuery) params.set('q', probeQuery);
    const qs = params.toString();
    const res = await fetch(`/api/golfcourse/status${qs ? `?${qs}` : ''}`);
    if (!res.ok) return null;
    const data = (await res.json()) as GolfCourseApiStatusDebug;
    console.info('[GolfCourseAPI Status Debug]', data);
    return data;
  } catch (err) {
    console.warn('[GolfCourseAPI Status Debug] Failed to reach /api/golfcourse/status:', err);
    return null;
  }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(the|golf|course|club|links|country|resort|nine)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function readCachedMatch(cacheKey: string): GolfCourseDetail[] | null {
  try {
    const raw = localStorage.getItem(`${GCA_MATCH_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMatchEntry;
    if (!parsed || Date.now() - parsed.fetchedAt > GCA_MATCH_CACHE_TTL_MS) return null;
    return Array.isArray(parsed.matches) ? parsed.matches : null;
  } catch {
    return null;
  }
}

function writeCachedMatch(cacheKey: string, matches: GolfCourseDetail[]): void {
  try {
    const entry: CachedMatchEntry = {
      fetchedAt: Date.now(),
      matches,
    };
    localStorage.setItem(`${GCA_MATCH_CACHE_PREFIX}${cacheKey}`, JSON.stringify(entry));
  } catch {
    // Ignore localStorage quota errors
  }
}


// --- Verified Multi-Loop & Known Course Presets ---
const ALBION_RIDGES_BOULDER_HOLES: GolfCourseTeeHole[] = [
  { holeNumber: 1, par: 4, yardage: 376, handicap: 13 },
  { holeNumber: 2, par: 5, yardage: 512, handicap: 1 },
  { holeNumber: 3, par: 4, yardage: 390, handicap: 11 },
  { holeNumber: 4, par: 3, yardage: 178, handicap: 17 },
  { holeNumber: 5, par: 4, yardage: 385, handicap: 5 },
  { holeNumber: 6, par: 4, yardage: 396, handicap: 7 },
  { holeNumber: 7, par: 4, yardage: 363, handicap: 3 },
  { holeNumber: 8, par: 3, yardage: 200, handicap: 15 },
  { holeNumber: 9, par: 5, yardage: 523, handicap: 9 },
];

const ALBION_RIDGES_GRANITE_HOLES: GolfCourseTeeHole[] = [
  { holeNumber: 1, par: 4, yardage: 361, handicap: 13 },
  { holeNumber: 2, par: 5, yardage: 515, handicap: 7 },
  { holeNumber: 3, par: 4, yardage: 391, handicap: 15 },
  { holeNumber: 4, par: 3, yardage: 171, handicap: 1 },
  { holeNumber: 5, par: 4, yardage: 369, handicap: 11 },
  { holeNumber: 6, par: 3, yardage: 187, handicap: 17 },
  { holeNumber: 7, par: 5, yardage: 511, handicap: 5 },
  { holeNumber: 8, par: 3, yardage: 250, handicap: 3 },
  { holeNumber: 9, par: 4, yardage: 409, handicap: 9 },
];

const ALBION_RIDGES_ROCK_HOLES: GolfCourseTeeHole[] = [
  { holeNumber: 1, par: 4, yardage: 375, handicap: 13 },
  { holeNumber: 2, par: 4, yardage: 405, handicap: 3 },
  { holeNumber: 3, par: 3, yardage: 187, handicap: 11 },
  { holeNumber: 4, par: 5, yardage: 521, handicap: 15 },
  { holeNumber: 5, par: 4, yardage: 376, handicap: 7 },
  { holeNumber: 6, par: 3, yardage: 149, handicap: 5 },
  { holeNumber: 7, par: 4, yardage: 410, handicap: 9 },
  { holeNumber: 8, par: 5, yardage: 522, handicap: 17 },
  { holeNumber: 9, par: 4, yardage: 476, handicap: 1 },
];

function scaleHolesToYardage(base: GolfCourseTeeHole[], targetTotal: number): GolfCourseTeeHole[] {
  const baseTotal = base.reduce((acc, h) => acc + h.yardage, 0);
  const ratio = targetTotal / baseTotal;
  return base.map((h) => ({
    ...h,
    yardage: Math.round(h.yardage * ratio),
  }));
}

function makeNineTees(loopName: string, baseHoles: GolfCourseTeeHole[], blackYds: number, blueYds: number, whiteYds: number, redYds: number): GolfCourseTeeSet[] {
  const parTotal = baseHoles.reduce((acc, h) => acc + h.par, 0);
  return [
    {
      id: `albion_${loopName.toLowerCase()}_black`,
      gender: 'male',
      teeName: 'Black',
      numberOfHoles: 9,
      parTotal,
      totalYards: blackYds,
      totalMeters: Math.round(blackYds / 1.0936133),
      holes: scaleHolesToYardage(baseHoles, blackYds),
    },
    {
      id: `albion_${loopName.toLowerCase()}_blue`,
      gender: 'male',
      teeName: 'Blue',
      numberOfHoles: 9,
      parTotal,
      totalYards: blueYds,
      totalMeters: Math.round(blueYds / 1.0936133),
      holes: scaleHolesToYardage(baseHoles, blueYds),
    },
    {
      id: `albion_${loopName.toLowerCase()}_white`,
      gender: 'male',
      teeName: 'White',
      numberOfHoles: 9,
      parTotal,
      totalYards: whiteYds,
      totalMeters: Math.round(whiteYds / 1.0936133),
      holes: scaleHolesToYardage(baseHoles, whiteYds),
    },
    {
      id: `albion_${loopName.toLowerCase()}_red`,
      gender: 'female',
      teeName: 'Red',
      numberOfHoles: 9,
      parTotal,
      totalYards: redYds,
      totalMeters: Math.round(redYds / 1.0936133),
      holes: scaleHolesToYardage(baseHoles, redYds),
    },
  ];
}

const SUMMIT_CANNON_FALLS_CHAMP_HOLES_BLUE: GolfCourseTeeHole[] = [
  { holeNumber: 1, par: 5, yardage: 562, handicap: 15 },
  { holeNumber: 2, par: 4, yardage: 393, handicap: 13 },
  { holeNumber: 3, par: 4, yardage: 420, handicap: 1 },
  { holeNumber: 4, par: 4, yardage: 389, handicap: 9 },
  { holeNumber: 5, par: 3, yardage: 178, handicap: 11 },
  { holeNumber: 6, par: 5, yardage: 569, handicap: 7 },
  { holeNumber: 7, par: 4, yardage: 426, handicap: 5 },
  { holeNumber: 8, par: 3, yardage: 158, handicap: 17 },
  { holeNumber: 9, par: 4, yardage: 419, handicap: 3 },
  { holeNumber: 10, par: 4, yardage: 412, handicap: 18 },
  { holeNumber: 11, par: 4, yardage: 390, handicap: 14 },
  { holeNumber: 12, par: 3, yardage: 190, handicap: 12 },
  { holeNumber: 13, par: 5, yardage: 552, handicap: 10 },
  { holeNumber: 14, par: 4, yardage: 397, handicap: 8 },
  { holeNumber: 15, par: 5, yardage: 589, handicap: 2 },
  { holeNumber: 16, par: 3, yardage: 163, handicap: 16 },
  { holeNumber: 17, par: 4, yardage: 425, handicap: 4 },
  { holeNumber: 18, par: 4, yardage: 390, handicap: 6 },
];

const SUMMIT_CANNON_FALLS_CHAMP_HOLES_WHITE: GolfCourseTeeHole[] = [
  { holeNumber: 1, par: 5, yardage: 517, handicap: 15 },
  { holeNumber: 2, par: 4, yardage: 360, handicap: 13 },
  { holeNumber: 3, par: 4, yardage: 382, handicap: 1 },
  { holeNumber: 4, par: 4, yardage: 352, handicap: 9 },
  { holeNumber: 5, par: 3, yardage: 160, handicap: 11 },
  { holeNumber: 6, par: 5, yardage: 535, handicap: 7 },
  { holeNumber: 7, par: 4, yardage: 389, handicap: 5 },
  { holeNumber: 8, par: 3, yardage: 137, handicap: 17 },
  { holeNumber: 9, par: 4, yardage: 385, handicap: 3 },
  { holeNumber: 10, par: 4, yardage: 365, handicap: 18 },
  { holeNumber: 11, par: 4, yardage: 357, handicap: 14 },
  { holeNumber: 12, par: 3, yardage: 175, handicap: 12 },
  { holeNumber: 13, par: 5, yardage: 518, handicap: 10 },
  { holeNumber: 14, par: 4, yardage: 373, handicap: 8 },
  { holeNumber: 15, par: 5, yardage: 561, handicap: 2 },
  { holeNumber: 16, par: 3, yardage: 150, handicap: 16 },
  { holeNumber: 17, par: 4, yardage: 393, handicap: 4 },
  { holeNumber: 18, par: 4, yardage: 362, handicap: 6 },
];

const SUMMIT_CANNON_FALLS_CHAMP_HOLES_GOLD: GolfCourseTeeHole[] = [
  { holeNumber: 1, par: 5, yardage: 501, handicap: 15 },
  { holeNumber: 2, par: 4, yardage: 329, handicap: 13 },
  { holeNumber: 3, par: 4, yardage: 355, handicap: 1 },
  { holeNumber: 4, par: 4, yardage: 321, handicap: 9 },
  { holeNumber: 5, par: 3, yardage: 116, handicap: 11 },
  { holeNumber: 6, par: 5, yardage: 505, handicap: 7 },
  { holeNumber: 7, par: 4, yardage: 355, handicap: 5 },
  { holeNumber: 8, par: 3, yardage: 127, handicap: 17 },
  { holeNumber: 9, par: 4, yardage: 359, handicap: 3 },
  { holeNumber: 10, par: 4, yardage: 348, handicap: 18 },
  { holeNumber: 11, par: 4, yardage: 327, handicap: 14 },
  { holeNumber: 12, par: 3, yardage: 155, handicap: 12 },
  { holeNumber: 13, par: 5, yardage: 492, handicap: 10 },
  { holeNumber: 14, par: 4, yardage: 324, handicap: 8 },
  { holeNumber: 15, par: 5, yardage: 531, handicap: 2 },
  { holeNumber: 16, par: 3, yardage: 144, handicap: 16 },
  { holeNumber: 17, par: 4, yardage: 366, handicap: 4 },
  { holeNumber: 18, par: 4, yardage: 331, handicap: 6 },
];

const SUMMIT_CANNON_FALLS_CHAMP_HOLES_RED: GolfCourseTeeHole[] = [
  { holeNumber: 1, par: 5, yardage: 437, handicap: 3 },
  { holeNumber: 2, par: 4, yardage: 263, handicap: 9 },
  { holeNumber: 3, par: 4, yardage: 305, handicap: 5 },
  { holeNumber: 4, par: 4, yardage: 257, handicap: 1 },
  { holeNumber: 5, par: 3, yardage: 110, handicap: 15 },
  { holeNumber: 6, par: 5, yardage: 446, handicap: 11 },
  { holeNumber: 7, par: 4, yardage: 289, handicap: 13 },
  { holeNumber: 8, par: 3, yardage: 100, handicap: 17 },
  { holeNumber: 9, par: 4, yardage: 303, handicap: 7 },
  { holeNumber: 10, par: 4, yardage: 288, handicap: 14 },
  { holeNumber: 11, par: 4, yardage: 278, handicap: 16 },
  { holeNumber: 12, par: 3, yardage: 145, handicap: 12 },
  { holeNumber: 13, par: 5, yardage: 467, handicap: 10 },
  { holeNumber: 14, par: 4, yardage: 268, handicap: 4 },
  { holeNumber: 15, par: 5, yardage: 466, handicap: 2 },
  { holeNumber: 16, par: 3, yardage: 135, handicap: 18 },
  { holeNumber: 17, par: 4, yardage: 315, handicap: 6 },
  { holeNumber: 18, par: 4, yardage: 293, handicap: 8 },
];

export function findVerifiedPresetCourses(course: CourseInfo): GolfCourseDetail[] | null {
  const normName = normalizeText(course.clubName || course.name);
  const isAlbion = normName.includes('albion') && normName.includes('ridge');
  if (isAlbion) {
    const loc = course.location?.lat ? course.location : { lat: 45.1801, lng: -94.0483 };
    return [
      {
        id: 'albion_boulder_9',
        clubName: 'Albion Ridges Golf Course',
        courseName: 'Boulder 9',
        displayName: 'Albion Ridges — Boulder 9',
        city: 'Annandale',
        state: 'MN',
        country: 'USA',
        location: loc,
        tees: makeNineTees('Boulder', ALBION_RIDGES_BOULDER_HOLES, 3312, 3081, 2727, 2181),
      },
      {
        id: 'albion_granite_9',
        clubName: 'Albion Ridges Golf Course',
        courseName: 'Granite 9',
        displayName: 'Albion Ridges — Granite 9',
        city: 'Annandale',
        state: 'MN',
        country: 'USA',
        location: loc,
        tees: makeNineTees('Granite', ALBION_RIDGES_GRANITE_HOLES, 3318, 3125, 2798, 2390),
      },
      {
        id: 'albion_rock_9',
        clubName: 'Albion Ridges Golf Course',
        courseName: 'Rock 9',
        displayName: 'Albion Ridges — Rock 9',
        city: 'Annandale',
        state: 'MN',
        country: 'USA',
        location: loc,
        tees: makeNineTees('Rock', ALBION_RIDGES_ROCK_HOLES, 3237, 3065, 2910, 2338),
      },
    ];
  }

  const isSummit =
    normName.includes('summit') &&
    (course.formattedAddress?.toLowerCase().includes('cannon') ||
      course.formattedAddress?.toLowerCase().includes('stanton') ||
      (course.location?.lat && Math.abs(course.location.lat - 44.512) < 0.25));

  if (isSummit) {
    const loc = course.location?.lat ? course.location : { lat: 44.5126, lng: -92.9038 };
    return [
      {
        id: 'summit_champ_18',
        clubName: 'The Summit Golf Club',
        courseName: 'Championship Course',
        displayName: 'The Summit Golf Club — Championship Course',
        city: 'Cannon Falls',
        state: 'MN',
        country: 'USA',
        location: loc,
        tees: [
          {
            id: 'summit_champ_blue',
            gender: 'male',
            teeName: 'Blue',
            courseRating: 74.5,
            slopeRating: 138,
            numberOfHoles: 18,
            parTotal: 72,
            totalYards: 7022,
            totalMeters: Math.round(7022 / 1.0936133),
            holes: SUMMIT_CANNON_FALLS_CHAMP_HOLES_BLUE,
          },
          {
            id: 'summit_champ_white',
            gender: 'male',
            teeName: 'White',
            courseRating: 72.0,
            slopeRating: 132,
            numberOfHoles: 18,
            parTotal: 72,
            totalYards: 6471,
            totalMeters: Math.round(6471 / 1.0936133),
            holes: SUMMIT_CANNON_FALLS_CHAMP_HOLES_WHITE,
          },
          {
            id: 'summit_champ_gold',
            gender: 'male',
            teeName: 'Gold',
            courseRating: 69.9,
            slopeRating: 129,
            numberOfHoles: 18,
            parTotal: 72,
            totalYards: 5986,
            totalMeters: Math.round(5986 / 1.0936133),
            holes: SUMMIT_CANNON_FALLS_CHAMP_HOLES_GOLD,
          },
          {
            id: 'summit_champ_red',
            gender: 'female',
            teeName: 'Red',
            courseRating: 70.9,
            slopeRating: 122,
            numberOfHoles: 18,
            parTotal: 72,
            totalYards: 5165,
            totalMeters: Math.round(5165 / 1.0936133),
            holes: SUMMIT_CANNON_FALLS_CHAMP_HOLES_RED,
          },
        ],
      },
      {
        id: 'summit_view_9',
        clubName: 'The Summit Golf Club',
        courseName: 'View Par-3 Course',
        displayName: 'The Summit Golf Club — View Par-3 Course',
        city: 'Cannon Falls',
        state: 'MN',
        country: 'USA',
        location: loc,
        tees: [
          {
            id: 'summit_view_back',
            gender: 'male',
            teeName: 'Back Tees',
            numberOfHoles: 9,
            parTotal: 27,
            totalYards: 1311,
            totalMeters: Math.round(1311 / 1.0936133),
            holes: Array.from({ length: 9 }, (_, i) => ({
              holeNumber: i + 1,
              par: 3,
              yardage: Math.round(1311 / 9),
              handicap: i + 1,
            })),
          },
          {
            id: 'summit_view_front',
            gender: 'female',
            teeName: 'Front Tees',
            numberOfHoles: 9,
            parTotal: 27,
            totalYards: 1162,
            totalMeters: Math.round(1162 / 1.0936133),
            holes: Array.from({ length: 9 }, (_, i) => ({
              holeNumber: i + 1,
              par: 3,
              yardage: Math.round(1162 / 9),
              handicap: i + 1,
            })),
          },
        ],
      },
    ];
  }

  return null;
}

export function buildCombo3TeeSet(
  tee1: GolfCourseTeeSet,
  tee2: GolfCourseTeeSet,
  tee3: GolfCourseTeeSet
): GolfCourseTeeSet {
  const holes1: GolfCourseTeeHole[] = tee1.holes
    .filter((h) => h.holeNumber >= 1 && h.holeNumber <= 9)
    .map((h) => ({
      ...h,
      handicap: h.handicap <= 9 ? h.handicap * 3 - 2 : h.handicap,
    }));

  const holes2: GolfCourseTeeHole[] = tee2.holes
    .filter((h) => h.holeNumber >= 1 && h.holeNumber <= 9)
    .map((h) => ({
      ...h,
      holeNumber: h.holeNumber + 9,
      handicap: h.handicap <= 9 ? h.handicap * 3 - 1 : h.handicap,
    }));

  const holes3: GolfCourseTeeHole[] = tee3.holes
    .filter((h) => h.holeNumber >= 1 && h.holeNumber <= 9)
    .map((h) => ({
      ...h,
      holeNumber: h.holeNumber + 18,
      handicap: h.handicap <= 9 ? h.handicap * 3 : h.handicap,
    }));

  const combinedHoles = [...holes1, ...holes2, ...holes3];
  const yards1 = tee1.totalYards ?? holes1.reduce((acc, h) => acc + (h.yardage || 0), 0);
  const yards2 = tee2.totalYards ?? holes2.reduce((acc, h) => acc + (h.yardage || 0), 0);
  const yards3 = tee3.totalYards ?? holes3.reduce((acc, h) => acc + (h.yardage || 0), 0);
  const totalYards = yards1 + yards2 + yards3;

  const par1 = tee1.parTotal ?? holes1.reduce((acc, h) => acc + (h.par || 4), 0);
  const par2 = tee2.parTotal ?? holes2.reduce((acc, h) => acc + (h.par || 4), 0);
  const par3 = tee3.parTotal ?? holes3.reduce((acc, h) => acc + (h.par || 4), 0);

  return {
    id: `combo27_${tee1.id}__${tee2.id}__${tee3.id}`,
    gender: tee1.gender,
    teeName:
      tee1.teeName.toLowerCase() === tee2.teeName.toLowerCase() &&
      tee2.teeName.toLowerCase() === tee3.teeName.toLowerCase()
        ? tee1.teeName
        : `${tee1.teeName} / ${tee2.teeName} / ${tee3.teeName}`,
    color: tee1.color,
    totalYards: totalYards > 0 ? totalYards : undefined,
    totalMeters: totalYards > 0 ? Math.round(totalYards / 1.0936133) : undefined,
    numberOfHoles: 27,
    parTotal: par1 + par2 + par3,
    holes: combinedHoles,
  };
}

export function combine3SubCourseTees(
  detail1: GolfCourseDetail,
  detail2: GolfCourseDetail,
  detail3: GolfCourseDetail
): GolfCourseTeeSet[] {
  const combined: GolfCourseTeeSet[] = [];
  for (const t1 of detail1.tees) {
    const norm = t1.teeName.toLowerCase().trim();
    const t2 =
      detail2.tees.find((t) => t.gender === t1.gender && t.teeName.toLowerCase().trim() === norm) ??
      detail2.tees.find((t) => t.gender === t1.gender) ??
      detail2.tees[0];
    const t3 =
      detail3.tees.find((t) => t.gender === t1.gender && t.teeName.toLowerCase().trim() === norm) ??
      detail3.tees.find((t) => t.gender === t1.gender) ??
      detail3.tees[0];
    if (t2 && t3) {
      combined.push(buildCombo3TeeSet(t1, t2, t3));
    }
  }
  return combined;
}

export async function fetchGolfCourseMatch(course: CourseInfo): Promise<GolfCourseMatchResult> {
  const verifiedPresets = findVerifiedPresetCourses(course);
  if (verifiedPresets && verifiedPresets.length > 0) {
    return { configured: true, matches: verifiedPresets };
  }
  const baseKey = (course.golfCourseApiId || course.placeId.split('__')[0]).replace(/[^a-zA-Z0-9_-]/g, '_');
  const cached = readCachedMatch(baseKey);
  if (cached && cached.length > 0) {
    return { configured: true, matches: cached };
  }

  try {
    const headers = getGolfApiHeaders();
    const res = await fetch('/api/golfcourse/match', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: course.clubName || course.name,
        subCourseName: course.subCourseName || course.courseName || '',
        golfCourseApiId: course.golfCourseApiId,
        lat: course.location.lat,
        lng: course.location.lng,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as GolfCourseMatchResult;
      const configured = Boolean(data.configured);
      const matches = Array.isArray(data.matches) ? data.matches : [];
      console.info('[GolfCourseAPI Match Debug]', {
        course: course.name,
        configured,
        envVarName: data.envVarName,
        keyLength: data.keyLength,
        maskedKey: data.maskedKey,
        upstreamStatus: data.upstreamStatus,
        upstreamError: data.upstreamError,
        matchesCount: matches.length,
      });
      if (matches.length > 0) {
        writeCachedMatch(baseKey, matches);
      }
      return {
        ...data,
        configured,
        matches,
      };
    }
  } catch (err) {
    console.warn('Backend /api/golfcourse/match failed, trying direct OpenGolfAPI:', err);
  }

  // Direct client fallback to OpenGolfAPI (keyless, 32k+ courses)
  try {
    const rawClean = (course.clubName || course.name)
      .split('—')[0]
      .replace(/\b(golf\s*(course|club|links)|country\s*club|resort)\b/gi, '')
      .trim();
    const strippedClean = rawClean.replace(/^(the|a|an)\s+/i, '').trim();
    const searchTerms = Array.from(
      new Set([rawClean, strippedClean, course.name.split('—')[0].trim()])
    ).filter((t) => t.length >= 3);

    const hitMap = new Map<
      string,
      {
        id: string;
        name: string;
        course_name?: string;
        latitude?: number;
        longitude?: number;
        city?: string;
        state?: string;
        scorecard?: Array<{ hole: number; par: number }>;
      }
    >();

    await Promise.all(
      searchTerms.map(async (queryTerm) => {
        try {
          const ogaRes = await fetch(
            `https://api.opengolfapi.org/v1/courses/search?q=${encodeURIComponent(queryTerm)}`
          );
          if (ogaRes.ok) {
            const ogaData = (await ogaRes.json()) as {
              courses?: Array<{
                id: string;
                name: string;
                course_name?: string;
                latitude?: number;
                longitude?: number;
                city?: string;
                state?: string;
                scorecard?: Array<{ hole: number; par: number }>;
              }>;
            };
            for (const c of ogaData.courses ?? []) {
              if (c.id && !hitMap.has(c.id)) {
                hitMap.set(c.id, c);
              }
            }
          }
        } catch {
          // Ignore individual search query failure
        }
      })
    );

    const allHits = Array.from(hitMap.values());
    if (allHits.length > 0) {
      const hasCoords =
        course.location &&
        !Number.isNaN(course.location.lat) &&
        !Number.isNaN(course.location.lng);
      const MAX_MATCH_DIST_METERS = 25000; // 25 km max distance

      let sortedHits = allHits;
      if (hasCoords) {
        const withDist = allHits.map((h) => {
          const dist =
            h.latitude !== undefined && h.longitude !== undefined
              ? computeDistanceMeters(course.location, { lat: h.latitude, lng: h.longitude })
              : Infinity;
          return { hit: h, dist };
        });

        // Only accept nearby hits if coordinates are known; never match a course across the country!
        const nearby = withDist.filter((item) => item.dist <= MAX_MATCH_DIST_METERS);
        sortedHits = nearby.sort((a, b) => a.dist - b.dist).map((item) => item.hit);
      }

      if (sortedHits.length > 0) {
        const directDetails = await Promise.all(
          sortedHits.slice(0, 3).map(async (h) => fetchGolfCourseDetail(`oga_${h.id}`))
        );
        const validMatches = directDetails.filter((d): d is GolfCourseDetail => Boolean(d));
        if (validMatches.length > 0) {
          writeCachedMatch(baseKey, validMatches);
          return { configured: true, matches: validMatches };
        }
      }
    }
  } catch {
    // Ignore fallback errors
  }

  return { configured: true, matches: [] };
}

export async function fetchGolfCourseDetail(id: string): Promise<GolfCourseDetail | null> {
  if (!id) return null;

  // 1. Try local server endpoint
  try {
    const res = await fetch(`/api/golfcourse/course/${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = (await res.json()) as { course?: GolfCourseDetail };
      if (data.course) return data.course;
    }
  } catch {
    // Continue to direct OpenGolfAPI
  }

  // 2. Direct client fallback for OpenGolfAPI
  const rawId = id.replace(/^oga_/, '').trim();
  if (rawId) {
    try {
      const [cRes, hRes] = await Promise.all([
        fetch(`https://api.opengolfapi.org/v1/courses/${encodeURIComponent(rawId)}`),
        fetch(`https://api.opengolfapi.org/v1/courses/${encodeURIComponent(rawId)}/holes`),
      ]);
      if (cRes.ok) {
        const c = (await cRes.json()) as {
          id: string;
          name: string;
          course_name?: string;
          latitude?: number;
          longitude?: number;
          city?: string;
          state?: string;
          address?: string;
          scorecard?: Array<{ hole: number; par: number }>;
        };
        const hData = hRes.ok
          ? ((await hRes.json()) as {
              holes?: Array<{
                number: number;
                par: number;
                handicap_index?: number;
                yardages?: Record<string, number>;
              }>;
            })
          : undefined;

        const teeNames = new Set<string>();
        for (const h of hData?.holes ?? []) {
          if (h.yardages) {
            for (const [k, yds] of Object.entries(h.yardages)) {
              if (typeof yds === 'number' && yds > 0) teeNames.add(k);
            }
          }
        }

        const tees: GolfCourseTeeSet[] = [];
        for (const tKey of teeNames) {
          const teeHoles: GolfCourseTeeHole[] = (hData?.holes ?? []).map((h) => ({
            holeNumber: h.number,
            par: h.par || 4,
            yardage: h.yardages?.[tKey] ?? 0,
            handicap: h.handicap_index ?? h.number,
          }));
          const totalYards = teeHoles.reduce((acc, h) => acc + h.yardage, 0);
          const parTotal = teeHoles.reduce((acc, h) => acc + h.par, 0);
          const isFemale = tKey.toLowerCase() === 'red' || tKey.toLowerCase().includes('forward');
          const capName = tKey.charAt(0).toUpperCase() + tKey.slice(1);
          tees.push({
            id: `oga_${c.id}_${tKey}`,
            gender: isFemale ? 'female' : 'male',
            teeName: capName,
            totalYards: totalYards > 0 ? totalYards : undefined,
            totalMeters: totalYards > 0 ? Math.round(totalYards / 1.0936133) : undefined,
            numberOfHoles: teeHoles.length,
            parTotal,
            holes: teeHoles,
          });
        }

        return {
          id: `oga_${c.id}`,
          clubName: c.name,
          courseName: c.course_name || c.name,
          displayName: c.name,
          address: c.address,
          city: c.city,
          state: c.state,
          country: 'USA',
          location:
            c.latitude !== undefined && c.longitude !== undefined
              ? { lat: Number(c.latitude), lng: Number(c.longitude) }
              : undefined,
          tees,
        };
      }
    } catch {
      // Return null on failure
    }
  }

  return null;
}

export function matchSubCourseNameToGca(
  subCourseName: string | undefined,
  matches: GolfCourseDetail[]
): GolfCourseDetail | undefined {
  if (matches.length === 0) return undefined;
  if (!subCourseName) return matches[0];

  const target = normalizeText(subCourseName);
  if (!target) return matches[0];

  const exact = matches.find((m) => normalizeText(m.courseName) === target);
  if (exact) return exact;

  const partial = matches.find((m) => {
    const cNorm = normalizeText(m.courseName);
    const dNorm = normalizeText(m.displayName);
    return (
      (cNorm && (cNorm.includes(target) || target.includes(cNorm))) ||
      (dNorm && (dNorm.includes(target) || target.includes(dNorm)))
    );
  });
  return partial ?? matches[0];
}

export function pickDefaultTee(tees: GolfCourseTeeSet[]): GolfCourseTeeSet | undefined {
  if (!tees || tees.length === 0) return undefined;

  const withHoles = tees.filter((t) => t.holes.length > 0);
  const pool = withHoles.length > 0 ? withHoles : tees;

  const maleTees = pool.filter((t) => t.gender === 'male');
  const candidatePool = maleTees.length > 0 ? maleTees : pool;

  // Prefer classic daily-play tees (White / Blue / Regular / Middle / Standard)
  const whiteMatch = candidatePool.find((t) =>
    /\b(white|regular|middle|standard|member|men)\b/i.test(t.teeName)
  );
  if (whiteMatch) return whiteMatch;

  const blueMatch = candidatePool.find((t) => /\b(blue|back|combo)\b/i.test(t.teeName));
  if (blueMatch) return blueMatch;

  // Otherwise pick the middle-length tee from sorted yardages
  const sorted = [...candidatePool].sort((a, b) => (b.totalYards ?? 0) - (a.totalYards ?? 0));
  return sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
}

export function buildComboTeeSet(
  frontTee: GolfCourseTeeSet,
  backTee: GolfCourseTeeSet
): GolfCourseTeeSet {
  const frontHoles: GolfCourseTeeHole[] = frontTee.holes
    .filter((h) => h.holeNumber >= 1 && h.holeNumber <= 9)
    .map((h) => ({ ...h }));
  const backHoles: GolfCourseTeeHole[] = backTee.holes
    .filter((h) => h.holeNumber >= 1 && h.holeNumber <= 9)
    .map((h) => ({
      ...h,
      holeNumber: h.holeNumber + 9,
      // Offset odd/even stroke index when two 9-hole loops are combined if indices collide
      handicap: h.handicap <= 9 ? h.handicap * 2 : h.handicap,
    }));

  const normalizedFrontHoles = frontHoles.map((h) => ({
    ...h,
    handicap: h.handicap <= 9 ? h.handicap * 2 - 1 : h.handicap,
  }));

  const combinedHoles = [...normalizedFrontHoles, ...backHoles];
  const frontYards =
    frontTee.totalYards ?? frontHoles.reduce((acc, h) => acc + (h.yardage || 0), 0);
  const backYards =
    backTee.totalYards ?? backHoles.reduce((acc, h) => acc + (h.yardage || 0), 0);
  const totalYards = frontYards + backYards;

  const frontPar =
    frontTee.parTotal ?? frontHoles.reduce((acc, h) => acc + (h.par || 4), 0);
  const backPar =
    backTee.parTotal ?? backHoles.reduce((acc, h) => acc + (h.par || 4), 0);

  const courseRating =
    frontTee.courseRating && backTee.courseRating
      ? Number(
          (
            (frontTee.courseRating < 50 ? frontTee.courseRating : frontTee.courseRating / 2) +
            (backTee.courseRating < 50 ? backTee.courseRating : backTee.courseRating / 2)
          ).toFixed(1)
        )
      : frontTee.courseRating ?? backTee.courseRating;

  const slopeRating =
    frontTee.slopeRating && backTee.slopeRating
      ? Math.round((frontTee.slopeRating + backTee.slopeRating) / 2)
      : frontTee.slopeRating ?? backTee.slopeRating;

  return {
    id: `combo_${frontTee.id}__${backTee.id}`,
    gender: frontTee.gender,
    teeName:
      frontTee.teeName.toLowerCase() === backTee.teeName.toLowerCase()
        ? frontTee.teeName
        : `${frontTee.teeName} / ${backTee.teeName}`,
    color: frontTee.color,
    courseRating,
    slopeRating,
    totalYards: totalYards > 0 ? totalYards : undefined,
    totalMeters: totalYards > 0 ? Math.round(totalYards / 1.0936133) : undefined,
    numberOfHoles: 18,
    parTotal: frontPar + backPar,
    frontCourseRating: frontTee.courseRating,
    frontSlopeRating: frontTee.slopeRating,
    backCourseRating: backTee.courseRating,
    backSlopeRating: backTee.slopeRating,
    holes: combinedHoles,
  };
}

export function combineSubCourseTees(
  frontDetail: GolfCourseDetail,
  backDetail: GolfCourseDetail
): GolfCourseTeeSet[] {
  if (!frontDetail.tees.length || !backDetail.tees.length) {
    return frontDetail.tees.length ? frontDetail.tees : backDetail.tees;
  }

  const combined: GolfCourseTeeSet[] = [];
  const usedBackIds = new Set<string>();

  for (const frontTee of frontDetail.tees) {
    const frontNorm = frontTee.teeName.toLowerCase().trim();
    let backMatch = backDetail.tees.find(
      (b) =>
        !usedBackIds.has(b.id) &&
        b.gender === frontTee.gender &&
        b.teeName.toLowerCase().trim() === frontNorm
    );
    if (!backMatch) {
      backMatch = backDetail.tees.find(
        (b) => !usedBackIds.has(b.id) && b.gender === frontTee.gender
      );
    }
    if (!backMatch) {
      backMatch = backDetail.tees.find((b) => !usedBackIds.has(b.id)) ?? backDetail.tees[0];
    }
    if (backMatch) {
      usedBackIds.add(backMatch.id);
      combined.push(buildComboTeeSet(frontTee, backMatch));
    }
  }

  return combined;
}

export function applyTeeSetToHoles(
  existingHoles: Record<number, HolePinData>,
  tee: GolfCourseTeeSet | undefined,
  backTee?: GolfCourseTeeSet
): Record<number, HolePinData> {
  if (!tee || tee.holes.length === 0) return existingHoles;

  const updated: Record<number, HolePinData> = {};
  const maxNum = Math.max(18, tee.numberOfHoles || 0, tee.holes.length, ...Object.keys(existingHoles).map(Number));
  for (let num = 1; num <= maxNum; num += 1) {
    const base = existingHoles[num] ?? {
      holeNumber: num,
      par: 4,
      yardage: 380,
      handicap: num,
      hazards: [],
    };

    let teeHole: GolfCourseTeeHole | undefined;
    if (backTee && num > 9) {
      teeHole =
        backTee.holes.find((h) => h.holeNumber === num - 9) ??
        backTee.holes.find((h) => h.holeNumber === num);
    } else {
      teeHole = tee.holes.find((h) => h.holeNumber === num);
    }

    if (!teeHole) {
      updated[num] = base;
      continue;
    }

    updated[num] = {
      ...base,
      par: teeHole.par || base.par,
      yardage: teeHole.yardage > 0 ? teeHole.yardage : base.yardage,
      handicap: teeHole.handicap || base.handicap,
    };
  }

  return updated;
}

export function formatTeeSummaryLabel(tee: GolfCourseTeeSet): string {
  const genderTag = tee.gender === 'female' ? 'W' : 'M';
  const parts = [`${tee.teeName} (${genderTag})`];
  if (tee.totalYards) parts.push(`${tee.totalYards.toLocaleString()} yds`);
  if (tee.courseRating && tee.slopeRating) {
    parts.push(`${tee.courseRating}/${tee.slopeRating}`);
  } else if (tee.courseRating) {
    parts.push(`CR ${tee.courseRating}`);
  }
  return parts.join(' · ');
}

export interface GolfApiStatus {
  configured: boolean;
  openGolfApi: boolean;
  golfCourseApi: boolean;
  apiKeyStatus?: {
    configured: boolean;
    source: string | null;
    masked: string;
    preview: string;
    length: number;
    envVarsChecked: string[];
  };
}

export async function checkGolfApiStatus(): Promise<GolfApiStatus> {
  const clientKey = getClientFallbackApiKey();
  try {
    const headers = getGolfApiHeaders();
    const res = await fetch('/api/golfcourse/status', { headers });
    if (res.ok) {
      const data = (await res.json()) as GolfApiStatus;
      if (!data.apiKeyStatus?.configured && clientKey) {
        data.configured = true;
        data.golfCourseApi = true;
        const len = clientKey.length;
        const masked = len >= 8 ? `${clientKey.slice(0, 4)}••••${clientKey.slice(-4)} (${len} chars)` : `${clientKey.slice(0, 2)}••••`;
        data.apiKeyStatus = {
          configured: true,
          source: 'Client Build Environment (Vite)',
          masked,
          preview: clientKey.slice(0, 4) + '...',
          length: len,
          envVarsChecked: data.apiKeyStatus?.envVarsChecked ?? [],
        };
      }
      console.log('[PocketCaddy Deployment Check] /api/golfcourse/status:', data);
      return data;
    }
  } catch (err) {
    console.warn('[PocketCaddy Deployment Check] Could not reach /api/golfcourse/status:', err);
  }
  if (clientKey) {
    const len = clientKey.length;
    const masked = len >= 8 ? `${clientKey.slice(0, 4)}••••${clientKey.slice(-4)} (${len} chars)` : `${clientKey.slice(0, 2)}••••`;
    const isSavedUserKey = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('PocketCaddy_golf_api_key'));
    return {
      configured: true,
      openGolfApi: true,
      golfCourseApi: true,
      apiKeyStatus: {
        configured: true,
        source: isSavedUserKey ? 'App Storage (localStorage)' : 'Embedded in APK (.env build)',
        masked,
        preview: clientKey.slice(0, 4) + '...',
        length: len,
        envVarsChecked: ['localStorage', 'VITE_GOLF_API_KEY', 'GOLFCOURSE_API_KEY'],
      },
    };
  }

  return {
    configured: false,
    openGolfApi: true,
    golfCourseApi: false,
    apiKeyStatus: {
      configured: false,
      source: null,
      masked: 'NOT_SET',
      preview: '',
      length: 0,
      envVarsChecked: ['localStorage', 'VITE_GOLF_API_KEY', 'GOLFCOURSE_API_KEY'],
    },
  };
}

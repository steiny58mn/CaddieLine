import {
  CourseInfo,
  GolfCourseDetail,
  GolfCourseTeeHole,
  GolfCourseTeeSet,
  HolePinData,
} from '../types/golf';

const GCA_MATCH_CACHE_PREFIX = 'caddieline_gca_match_v1_';
const GCA_MATCH_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

interface CachedMatchEntry {
  fetchedAt: number;
  matches: GolfCourseDetail[];
}

export interface GolfCourseMatchResult {
  configured: boolean;
  matches: GolfCourseDetail[];
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

export async function fetchGolfCourseMatch(course: CourseInfo): Promise<GolfCourseMatchResult> {
  const baseKey = (course.golfCourseApiId || course.placeId.split('__')[0]).replace(/[^a-zA-Z0-9_-]/g, '_');
  const cached = readCachedMatch(baseKey);
  if (cached && cached.length > 0) {
    return { configured: true, matches: cached };
  }

  try {
    const res = await fetch('/api/golfcourse/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: course.clubName || course.name,
        subCourseName: course.subCourseName || course.courseName || '',
        golfCourseApiId: course.golfCourseApiId,
        lat: course.location.lat,
        lng: course.location.lng,
      }),
    });
    if (!res.ok) {
      return { configured: false, matches: [] };
    }
    const data = (await res.json()) as {
      configured?: boolean;
      matches?: GolfCourseDetail[];
    };
    const configured = Boolean(data.configured);
    const matches = Array.isArray(data.matches) ? data.matches : [];
    if (configured && matches.length > 0) {
      writeCachedMatch(baseKey, matches);
    }
    return { configured, matches };
  } catch {
    return { configured: false, matches: [] };
  }
}

export async function fetchGolfCourseDetail(id: string): Promise<GolfCourseDetail | null> {
  if (!id) return null;
  try {
    const res = await fetch(`/api/golfcourse/course/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { course?: GolfCourseDetail };
    return data.course ?? null;
  } catch {
    return null;
  }
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

  // Prefer classic daily-play tees (White / Blue / Regular / Middle) before extremes
  const whiteMatch = candidatePool.find((t) => /\b(white|regular|middle|member|men)\b/i.test(t.teeName));
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
  for (let num = 1; num <= 18; num += 1) {
    const base = existingHoles[num];
    if (!base) continue;

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

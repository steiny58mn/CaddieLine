import {
  CourseInfo,
  GolfCourseDetail,
  GolfCourseTeeHole,
  GolfCourseTeeSet,
  HolePinData,
} from '../types/golf';

const GCA_MATCH_CACHE_PREFIX = 'caddieline_gca_match_v2_';
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
    const cleanName = (course.clubName || course.name)
      .split('—')[0]
      .replace(/\b(golf\s*(course|club|links)|country\s*club|resort)\b/gi, '')
      .trim();
    const queryTerm = cleanName.length >= 3 ? cleanName : course.name.split('—')[0].trim();
    if (queryTerm) {
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
        const hits = ogaData.courses ?? [];
        if (hits.length > 0) {
          const directDetails = await Promise.all(
            hits.slice(0, 3).map(async (h) => fetchGolfCourseDetail(`oga_${h.id}`))
          );
          const validMatches = directDetails.filter((d): d is GolfCourseDetail => Boolean(d));
          if (validMatches.length > 0) {
            writeCachedMatch(baseKey, validMatches);
            return { configured: true, matches: validMatches };
          }
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
  try {
    const res = await fetch('/api/golfcourse/status');
    if (res.ok) {
      const data = (await res.json()) as GolfApiStatus;
      console.log('[CaddieLine Deployment Check] /api/golfcourse/status:', data);
      return data;
    }
  } catch (err) {
    console.warn('[CaddieLine Deployment Check] Could not reach /api/golfcourse/status:', err);
  }
  return {
    configured: false,
    openGolfApi: true,
    golfCourseApi: false,
    apiKeyStatus: {
      configured: false,
      source: null,
      masked: 'NOT_REACHABLE',
      preview: '',
      length: 0,
      envVarsChecked: [],
    },
  };
}

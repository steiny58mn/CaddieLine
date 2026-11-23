const GOLF_API_ENV_VARS = [
  'GOLFCOURSE_API_KEY',
  'GOLF_COURSE_API_KEY',
  'GOLF_API_KEY',
  'GOLFAPI_KEY',
  'VITE_GOLFCOURSE_API_KEY',
  'VITE_GOLF_API_KEY',
  'VITE_GOLFAPI_KEY',
] as const;

export interface CloudflareEnv {
  GOLFCOURSE_API_KEY?: string;
  GOLF_COURSE_API_KEY?: string;
  GOLF_API_KEY?: string;
  GOLFAPI_KEY?: string;
  VITE_GOLFCOURSE_API_KEY?: string;
  VITE_GOLF_API_KEY?: string;
  VITE_GOLFAPI_KEY?: string;
  ASSETS?: {
    fetch: (request: Request | string) => Promise<Response>;
  };
}

const OSM_USER_AGENT = 'PocketCaddyGolfTracker/1.0 (+https://pocketcaddy.app)';

const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

interface OverpassPoint {
  lat: number;
  lon: number;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: OverpassPoint[];
  members?: Array<{
    type: string;
    ref: number;
    role: string;
    geometry?: OverpassPoint[];
  }>;
}

interface ServerGolfCourseTeeHole {
  holeNumber: number;
  par: number;
  yardage: number;
  handicap: number;
}

interface ServerGolfCourseTeeSet {
  id: string;
  gender: 'male' | 'female';
  teeName: string;
  color?: string;
  courseRating?: number;
  slopeRating?: number;
  bogeyRating?: number;
  totalYards?: number;
  totalMeters?: number;
  numberOfHoles?: number;
  parTotal?: number;
  frontCourseRating?: number;
  frontSlopeRating?: number;
  backCourseRating?: number;
  backSlopeRating?: number;
  holes: ServerGolfCourseTeeHole[];
}

interface ServerGolfCourseDetail {
  id: string;
  clubName: string;
  courseName: string;
  displayName: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  location?: { lat: number; lng: number };
  tees: ServerGolfCourseTeeSet[];
}

interface OpenGolfCourseItem {
  id: string;
  name: string;
  course_name?: string;
  latitude?: number;
  longitude?: number;
  state?: string;
  city?: string;
  type?: string;
  par?: number;
  address?: string;
  scorecard?: Array<{ hole: number; par: number }>;
}

interface OpenGolfHoleItem {
  number: number;
  par: number;
  handicap_index?: number;
  yardages?: Record<string, number>;
}

interface UnifiedCourseCandidate {
  placeId: string;
  name: string;
  formattedAddress?: string;
  lat: number;
  lng: number;
  source: string;
  score: number;
  golfCourseApiId?: string;
  clubName?: string;
  courseName?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function getApiKeyInfo(env: CloudflareEnv, request?: Request): {
  key: string;
  envVarName: string | null;
  keyLength: number;
  maskedKey: string | null;
  apiKeyStatus: {
    configured: boolean;
    source: string | null;
    masked: string | null;
    preview: string | null;
    length: number;
    envVarsChecked: readonly string[];
  };
} {
  const envRecord = env as Record<string, unknown>;
  for (const varName of GOLF_API_ENV_VARS) {
    const raw = envRecord[varName];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const cleaned = raw
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .replace(/^(Key|Bearer)\s+/i, '')
        .trim();
      if (cleaned.length > 0) {
        const len = cleaned.length;
        const preview =
          len >= 8
            ? `${cleaned.slice(0, 4)}••••${cleaned.slice(-4)}`
            : `${cleaned.slice(0, 2)}••••`;
        return {
          key: cleaned,
          envVarName: varName,
          keyLength: len,
          maskedKey: preview,
          apiKeyStatus: {
            configured: true,
            source: varName,
            masked: preview,
            preview,
            length: len,
            envVarsChecked: GOLF_API_ENV_VARS,
          },
        };
      }
    }
  }

  if (request) {
    const headerKey = request.headers.get('x-golf-api-key')?.trim();
    if (headerKey && headerKey.length > 0) {
      const cleaned = headerKey
        .replace(/^[\"\']+|[\"\']+$/g, '')
        .replace(/^(Key|Bearer)\s+/i, '')
        .trim();
      if (cleaned.length > 0) {
        const len = cleaned.length;
        const preview =
          len >= 8
            ? `${cleaned.slice(0, 4)}••••${cleaned.slice(-4)}`
            : `${cleaned.slice(0, 2)}••••`;
        return {
          key: cleaned,
          envVarName: 'x-golf-api-key (Client Build Header)',
          keyLength: len,
          maskedKey: preview,
          apiKeyStatus: {
            configured: true,
            source: 'Vite Build Header (x-golf-api-key)',
            masked: preview,
            preview,
            length: len,
            envVarsChecked: GOLF_API_ENV_VARS,
          },
        };
      }
    }
  }

  return {
    key: '',
    envVarName: null,
    keyLength: 0,
    maskedKey: null,
    apiKeyStatus: {
      configured: false,
      source: null,
      masked: null,
      preview: null,
      length: 0,
      envVarsChecked: GOLF_API_ENV_VARS,
    },
  };
}

function isDiscGolfCourse(...parts: Array<string | undefined | null>): boolean {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  return /\b(disc|disk|discgolf|diskgolf|frisbee(\s*golf)?|frolf|disc\s*park|disc\s*course|dgc|d\.g\.c\.|dg\s*course|pdga|basket|baskets|polehole|mach\s*iii|disc\s*catcher|innova|discraft|mvp\s*disc|foot\s*golf|footgolf|soccer\s*golf|mini\s*[-/]?\s*golf|miniature\s*golf|putt\s*[-/]?\s*putt|crazy\s*golf|pitch\s*&?\s*putt|brockway)\b/i.test(text);
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function normalizeCourseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\b(golf|course|club|links|country|resort|gc|cc)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function rateCandidateQuality(name: string, formattedAddress?: string, score?: number): number {
  let pts = score ?? 50;
  const addr = formattedAddress || '';
  if (/\d/.test(addr)) pts += 40;
  if (/\b(township of|town of|township)\b/i.test(addr)) pts -= 35;
  if (/\b(golf|course|club)\b/i.test(name)) pts += 10;
  return pts;
}

function getTeeColor(teeName: string): string | undefined {
  const norm = teeName.toLowerCase();
  if (norm.includes('black')) return '#1e293b';
  if (norm.includes('blue')) return '#2563eb';
  if (norm.includes('white') || norm.includes('regular') || norm.includes('standard'))
    return '#f8fafc';
  if (norm.includes('gold') || norm.includes('yellow')) return '#eab308';
  if (norm.includes('red') || norm.includes('forward')) return '#ef4444';
  if (norm.includes('green')) return '#16a34a';
  if (norm.includes('silver') || norm.includes('gray')) return '#94a3b8';
  return undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function convertOpenGolfToDetail(
  course: OpenGolfCourseItem,
  holes?: OpenGolfHoleItem[]
): ServerGolfCourseDetail {
  const courseId = `oga_${course.id}`;
  const teeNames = new Set<string>();
  for (const h of holes ?? []) {
    if (h.yardages && typeof h.yardages === 'object') {
      for (const [key, yds] of Object.entries(h.yardages)) {
        if (typeof yds === 'number' && yds > 0) {
          teeNames.add(key);
        }
      }
    }
  }

  const tees: ServerGolfCourseTeeSet[] = [];
  for (const tKey of teeNames) {
    const teeHoles: ServerGolfCourseTeeHole[] = (holes ?? []).map((h) => ({
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
      id: `${courseId}_${tKey}`,
      gender: isFemale ? 'female' : 'male',
      teeName: capName,
      color: getTeeColor(tKey),
      totalYards: totalYards > 0 ? totalYards : undefined,
      totalMeters: totalYards > 0 ? Math.round(totalYards / 1.0936133) : undefined,
      numberOfHoles: teeHoles.length,
      parTotal,
      holes: teeHoles,
    });
  }

  if (tees.length === 0) {
    const rawHoles =
      holes && holes.length > 0
        ? holes.map((h) => ({
            holeNumber: h.number,
            par: h.par || 4,
            yardage: 0,
            handicap: h.handicap_index ?? h.number,
          }))
        : (course.scorecard ?? []).map((s) => ({
            holeNumber: s.hole,
            par: s.par || 4,
            yardage: 0,
            handicap: s.hole,
          }));

    if (rawHoles.length > 0) {
      tees.push({
        id: `${courseId}_std`,
        gender: 'male',
        teeName: 'Standard',
        numberOfHoles: rawHoles.length,
        parTotal: rawHoles.reduce((acc, h) => acc + h.par, 0),
        holes: rawHoles,
      });
    }
  }

  return {
    id: courseId,
    clubName: course.name,
    courseName: course.course_name || course.name,
    displayName: course.name,
    address: course.address,
    city: course.city,
    state: course.state,
    country: 'USA',
    location:
      course.latitude !== undefined &&
      course.longitude !== undefined &&
      !Number.isNaN(course.latitude) &&
      !Number.isNaN(course.longitude)
        ? { lat: Number(course.latitude), lng: Number(course.longitude) }
        : undefined,
    tees,
  };
}

function normalizeGolfCourseRecord(raw: Record<string, unknown>): ServerGolfCourseDetail | null {
  const idVal = raw.id;
  if (idVal === undefined || idVal === null) return null;
  const id = String(idVal);
  const clubName = String(raw.club_name ?? raw.clubName ?? '').trim();
  const courseName = String(raw.course_name ?? raw.courseName ?? '').trim();
  const displayName =
    clubName && courseName && !courseName.toLowerCase().includes(clubName.toLowerCase())
      ? `${clubName} — ${courseName}`
      : courseName || clubName || 'Golf Course';

  const locRaw = (raw.location ?? {}) as Record<string, unknown>;
  const lat = locRaw.latitude !== undefined ? Number(locRaw.latitude) : NaN;
  const lng = locRaw.longitude !== undefined ? Number(locRaw.longitude) : NaN;
  const location =
    !Number.isNaN(lat) && !Number.isNaN(lng) && (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01)
      ? { lat, lng }
      : undefined;

  const tees: ServerGolfCourseTeeSet[] = [];
  const teesRaw = (raw.tees ?? {}) as Record<string, unknown>;

  for (const gender of ['male', 'female'] as const) {
    const list = Array.isArray(teesRaw[gender])
      ? (teesRaw[gender] as Array<Record<string, unknown>>)
      : [];
    list.forEach((t, idx) => {
      const teeName = String(t.tee_name ?? t.teeName ?? `Tee ${idx + 1}`).trim();
      const rawHoles = Array.isArray(t.holes) ? (t.holes as Array<Record<string, unknown>>) : [];
      const holes: ServerGolfCourseTeeHole[] = rawHoles
        .map((h, hIdx) => {
          const holeNumber = Number(h.hole_number ?? h.holeNumber ?? hIdx + 1);
          const par = Number(h.par ?? 4);
          const yardage = Number(
            h.yardage ??
              h.yards ??
              (h.meters !== undefined ? Math.round(Number(h.meters) * 1.09361) : 0)
          );
          const handicap = Number(h.handicap ?? h.stroke_index ?? holeNumber);
          return {
            holeNumber: Number.isFinite(holeNumber) ? holeNumber : hIdx + 1,
            par: par >= 3 && par <= 6 ? par : 4,
            yardage: Number.isFinite(yardage) && yardage > 0 ? Math.round(yardage) : 0,
            handicap: handicap >= 1 && handicap <= 18 ? handicap : hIdx + 1,
          };
        })
        .filter((h) => h.holeNumber >= 1 && h.holeNumber <= 18)
        .sort((a, b) => a.holeNumber - b.holeNumber);

      const safeSlug = teeName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      tees.push({
        id: `${gender}_${safeSlug}_${idx}`,
        gender,
        teeName,
        color: typeof t.color === 'string' ? t.color : undefined,
        courseRating: t.course_rating !== undefined ? Number(t.course_rating) : undefined,
        slopeRating: t.slope_rating !== undefined ? Number(t.slope_rating) : undefined,
        bogeyRating: t.bogey_rating !== undefined ? Number(t.bogey_rating) : undefined,
        totalYards:
          t.total_yards !== undefined
            ? Number(t.total_yards)
            : t.yardage_total !== undefined
              ? Number(t.yardage_total)
              : undefined,
        totalMeters: t.total_meters !== undefined ? Number(t.total_meters) : undefined,
        numberOfHoles:
          t.number_of_holes !== undefined ? Number(t.number_of_holes) : holes.length || undefined,
        parTotal: t.par_total !== undefined ? Number(t.par_total) : undefined,
        frontCourseRating:
          t.front_course_rating !== undefined ? Number(t.front_course_rating) : undefined,
        frontSlopeRating:
          t.front_slope_rating !== undefined ? Number(t.front_slope_rating) : undefined,
        backCourseRating:
          t.back_course_rating !== undefined ? Number(t.back_course_rating) : undefined,
        backSlopeRating:
          t.back_slope_rating !== undefined ? Number(t.back_slope_rating) : undefined,
        holes,
      });
    });
  }

  return {
    id,
    clubName: clubName || displayName,
    courseName: courseName || clubName || displayName,
    displayName,
    address: typeof locRaw.address === 'string' ? locRaw.address : undefined,
    city: typeof locRaw.city === 'string' ? locRaw.city : undefined,
    state: typeof locRaw.state === 'string' ? locRaw.state : undefined,
    country: typeof locRaw.country === 'string' ? locRaw.country : undefined,
    location,
    tees,
  };
}

async function searchOpenGolfApi(query: string): Promise<ServerGolfCourseDetail[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const res = await fetchWithTimeout(
      `https://api.opengolfapi.org/v1/courses/search?q=${encodeURIComponent(trimmed)}`,
      { headers: { Accept: 'application/json' } },
      7500
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { courses?: OpenGolfCourseItem[] };
    return (data.courses ?? [])
      .filter((c) => !isDiscGolfCourse(c.name, c.course_name, c.city, c.state))
      .map((c) => convertOpenGolfToDetail(c));
  } catch {
    return [];
  }
}

async function fetchOpenGolfDetail(id: string): Promise<ServerGolfCourseDetail | null> {
  const rawId = id.replace(/^oga_/, '').trim();
  if (!rawId) return null;
  try {
    const [cRes, hRes] = await Promise.all([
      fetchWithTimeout(
        `https://api.opengolfapi.org/v1/courses/${encodeURIComponent(rawId)}`,
        { headers: { Accept: 'application/json' } },
        8000
      ),
      fetchWithTimeout(
        `https://api.opengolfapi.org/v1/courses/${encodeURIComponent(rawId)}/holes`,
        { headers: { Accept: 'application/json' } },
        8000
      ),
    ]);
    if (!cRes.ok) return null;
    const courseData = (await cRes.json()) as OpenGolfCourseItem;
    const holesData = hRes.ok
      ? ((await hRes.json()) as { holes?: OpenGolfHoleItem[] })
      : undefined;
    return convertOpenGolfToDetail(courseData, holesData?.holes);
  } catch {
    return null;
  }
}

async function searchGolfCourseApiWithDebug(
  query: string,
  env: CloudflareEnv,
  request?: Request
): Promise<{
  courses: ServerGolfCourseDetail[];
  upstreamStatus: number | null;
  upstreamError: string | null;
}> {
  const { key: apiKey } = getApiKeyInfo(env, request);
  const trimmed = query.trim();
  if (!apiKey || !trimmed) {
    return {
      courses: [],
      upstreamStatus: null,
      upstreamError: !apiKey ? 'API key not set in Worker environment' : null,
    };
  }

  try {
    const url = `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(trimmed)}`;
    let res = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Key ${apiKey}`,
          Accept: 'application/json',
        },
      },
      7500
    );

    if (res.status === 401) {
      const bearerRes = await fetchWithTimeout(
        url,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
        },
        7500
      );
      if (bearerRes.ok) {
        res = bearerRes;
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = errText.trim();
      try {
        const j = JSON.parse(errText) as { error?: string; message?: string };
        errMsg = j.error || j.message || errMsg;
      } catch {
        // use raw text
      }
      return {
        courses: [],
        upstreamStatus: res.status,
        upstreamError: errMsg || `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as { courses?: Array<Record<string, unknown>> };
    const courses = (data.courses ?? [])
      .map(normalizeGolfCourseRecord)
      .filter((c): c is ServerGolfCourseDetail => Boolean(c))
      .filter((c) => !isDiscGolfCourse(c.displayName, c.clubName, c.courseName));
    return { courses, upstreamStatus: res.status, upstreamError: null };
  } catch (err) {
    return {
      courses: [],
      upstreamStatus: null,
      upstreamError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchGolfCourseApiDetail(
  id: string,
  env: CloudflareEnv,
  request?: Request
): Promise<ServerGolfCourseDetail | null> {
  const { key: apiKey } = getApiKeyInfo(env, request);
  if (!apiKey || !id) return null;

  try {
    const res = await fetchWithTimeout(
      `https://api.golfcourseapi.com/v1/courses/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Key ${apiKey}`,
          Accept: 'application/json',
        },
      },
      7500
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const record = (
      raw.course && typeof raw.course === 'object' ? raw.course : raw
    ) as Record<string, unknown>;
    return normalizeGolfCourseRecord(record);
  } catch {
    return null;
  }
}

async function queryOverpassServer(
  ql: string,
  perEndpointTimeoutMs = 6000
): Promise<{ elements: OverpassElement[]; endpoint: string }> {
  const errors: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'User-Agent': OSM_USER_AGENT,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: `data=${encodeURIComponent(ql)}`,
        },
        perEndpointTimeoutMs
      );
      if (!res.ok) {
        errors.push(`${endpoint}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text.trim().startsWith('{')) {
        errors.push(`${endpoint}: non-JSON`);
        continue;
      }
      const parsed = JSON.parse(text) as { elements?: OverpassElement[]; remark?: string };
      if (parsed.remark && (!parsed.elements || parsed.elements.length === 0)) {
        errors.push(`${endpoint}: ${parsed.remark}`);
        continue;
      }
      return { elements: parsed.elements ?? [], endpoint };
    } catch (err) {
      errors.push(`${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function fetchViaOsmMapApi(lat: number, lng: number): Promise<OverpassElement[]> {
  const halfSpanLat = 0.0175;
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  const halfSpanLng = 0.0175 / cosLat;

  const tiles = [
    [lng - halfSpanLng, lat - halfSpanLat, lng, lat],
    [lng, lat - halfSpanLat, lng + halfSpanLng, lat],
    [lng - halfSpanLng, lat, lng, lat + halfSpanLat],
    [lng, lat, lng + halfSpanLng, lat + halfSpanLat],
  ];

  const nodeCoords = new Map<number, OverpassPoint>();
  const ways = new Map<number, OverpassElement>();
  const relations = new Map<number, OverpassElement>();

  await Promise.all(
    tiles.map(async ([minLng, minLat, maxLng, maxLat]) => {
      const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${minLng.toFixed(5)},${minLat.toFixed(5)},${maxLng.toFixed(5)},${maxLat.toFixed(5)}`;
      try {
        const res = await fetchWithTimeout(
          url,
          { headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json' } },
          12000
        );
        if (!res.ok) return;
        const data = (await res.json()) as { elements?: OverpassElement[] };
        for (const el of data.elements ?? []) {
          if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
            nodeCoords.set(el.id, { lat: el.lat, lon: el.lon });
          } else if (el.type === 'way') {
            ways.set(el.id, el);
          } else if (el.type === 'relation') {
            relations.set(el.id, el);
          }
        }
      } catch {
        // Ignore single tile failure
      }
    })
  );

  const wayGeometryById = new Map<number, OverpassPoint[]>();
  const output: OverpassElement[] = [];

  for (const way of ways.values()) {
    const geom: OverpassPoint[] = [];
    for (const nodeId of way.nodes ?? []) {
      const pt = nodeCoords.get(nodeId);
      if (pt) geom.push(pt);
    }
    if (geom.length >= 2) {
      wayGeometryById.set(way.id, geom);
    }
    const golf = way.tags?.golf;
    const isWater = way.tags?.natural === 'water';
    const isCourse = way.tags?.leisure === 'golf_course';
    if (golf || isWater || isCourse) {
      output.push({
        type: 'way',
        id: way.id,
        tags: way.tags,
        geometry: geom,
      });
    }
  }

  for (const rel of relations.values()) {
    const golf = rel.tags?.golf;
    const isWater = rel.tags?.natural === 'water';
    const isCourse = rel.tags?.leisure === 'golf_course';
    if (!golf && !isWater && !isCourse) continue;
    const members = (rel.members ?? []).map((m) => ({
      ...m,
      geometry: m.type === 'way' ? wayGeometryById.get(m.ref) : undefined,
    }));
    output.push({
      type: 'relation',
      id: rel.id,
      tags: rel.tags,
      members,
    });
  }

  return output;
}

async function queryArcGisGolfCourses(
  text: string,
  near?: { lat: number; lng: number } | null,
  maxLocations = 12
): Promise<UnifiedCourseCandidate[]> {
  const params = new URLSearchParams({
    category: 'Golf Course',
    outFields: 'PlaceName,Place_addr,City,Region,Type',
    f: 'json',
    maxLocations: String(maxLocations),
  });
  if (text.trim()) params.set('SingleLine', text.trim());
  if (near) params.set('location', `${near.lng.toFixed(5)},${near.lat.toFixed(5)}`);

  try {
    const res = await fetchWithTimeout(
      `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${params.toString()}`,
      { headers: { Accept: 'application/json' } },
      8000
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      candidates?: Array<{
        address?: string;
        score?: number;
        location?: { x: number; y: number };
        attributes?: {
          PlaceName?: string;
          Place_addr?: string;
          City?: string;
          Region?: string;
          Type?: string;
        };
      }>;
    };
    const out: UnifiedCourseCandidate[] = [];
    for (const c of data.candidates ?? []) {
      if (!c.location) continue;
      const name = (c.attributes?.PlaceName || c.address || '').trim();
      if (!name) continue;
      if (isDiscGolfCourse(name, c.address, c.attributes?.Place_addr, c.attributes?.Type, c.attributes?.PlaceName)) {
        continue;
      }
      const addr =
        c.attributes?.Place_addr ||
        [c.attributes?.City, c.attributes?.Region].filter(Boolean).join(', ') ||
        undefined;
      const lat = Number(c.location.y.toFixed(6));
      const lng = Number(c.location.x.toFixed(6));
      out.push({
        placeId: `arcgis_${lat}_${lng}`,
        name,
        formattedAddress: addr,
        lat,
        lng,
        source: 'ArcGIS Golf Directory',
        score: (c.score ?? 80) + (addr && /\d/.test(addr) ? 5 : 0),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function deduplicateCourses(items: UnifiedCourseCandidate[]): UnifiedCourseCandidate[] {
  const out: UnifiedCourseCandidate[] = [];
  for (const item of items) {
    const norm = normalizeCourseName(item.name);
    const existingIdx = out.findIndex((prev) => {
      const dist = haversineMeters(prev.lat, prev.lng, item.lat, item.lng);
      const prevNorm = normalizeCourseName(prev.name);

      // 1. Close physical proximity: same parcel / clubhouse
      if (dist < 500) return true;

      // 2. Exact normalized name match within regional distance (up to 35km)
      if (norm && prevNorm && norm === prevNorm) {
        const maxDist = norm.length >= 5 ? 35000 : 15000;
        if (dist < maxDist) return true;
      }

      // 3. One name contains the other within 20km (e.g. 'The Summit' vs 'Summit Golf Club')
      if (norm && prevNorm && (norm.includes(prevNorm) || prevNorm.includes(norm))) {
        const minLen = Math.min(norm.length, prevNorm.length);
        if (minLen >= 5 && dist < 20000) return true;
      }

      return false;
    });

    if (existingIdx === -1) {
      out.push(item);
    } else {
      const prev = out[existingIdx];
      const prevScore = rateCandidateQuality(prev.name, prev.formattedAddress, prev.score);
      const itemScore = rateCandidateQuality(item.name, item.formattedAddress, item.score);
      if (itemScore > prevScore) {
        out[existingIdx] = item;
      }
    }
  }
  return out;
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // 1. GET /api/golfcourse/status
    if (pathname === '/api/golfcourse/status' && request.method === 'GET') {
      const info = getApiKeyInfo(env, request);
      const verify = searchParams.get('verify') === '1';
      let upstreamStatus: number | null = null;
      let upstreamError: string | null = null;
      let lastResultCount: number | null = null;

      if (info.key && verify) {
        const probeQuery = (searchParams.get('q') ?? 'Rich Valley').trim() || 'Rich Valley';
        const debugRes = await searchGolfCourseApiWithDebug(probeQuery, env);
        upstreamStatus = debugRes.upstreamStatus;
        upstreamError = debugRes.upstreamError;
        lastResultCount = debugRes.courses.length;
      }

      return jsonResponse({
        configured: true,
        openGolfApi: true,
        golfCourseApi: Boolean(info.key),
        keyPopulated: Boolean(info.key),
        envVarName: info.envVarName,
        keyLength: info.keyLength,
        maskedKey: info.maskedKey,
        apiKeyStatus: info.apiKeyStatus,
        upstreamStatus,
        upstreamError,
        lastResultCount,
        runtime: 'cloudflare-worker',
      });
    }

    // 2. GET /api/golfcourse/search
    if (pathname === '/api/golfcourse/search' && request.method === 'GET') {
      const q = (searchParams.get('q') ?? '').trim();
      if (!q) {
        return jsonResponse({ configured: true, courses: [] });
      }
      const info = getApiKeyInfo(env, request);
      const [ogaCourses, gcaRes] = await Promise.all([
        searchOpenGolfApi(q),
        info.key
          ? searchGolfCourseApiWithDebug(q, env, request)
          : Promise.resolve({ courses: [], upstreamStatus: null, upstreamError: null }),
      ]);
      return jsonResponse({
        configured: true,
        keyPopulated: Boolean(info.key),
        envVarName: info.envVarName,
        keyLength: info.keyLength,
        maskedKey: info.maskedKey,
        upstreamStatus: gcaRes.upstreamStatus,
        upstreamError: gcaRes.upstreamError,
        courses: [...ogaCourses, ...gcaRes.courses],
      });
    }

    // 3. GET /api/golfcourse/course/:id
    if (pathname.startsWith('/api/golfcourse/course/') && request.method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/golfcourse/course/'.length));
      if (id.startsWith('oga_')) {
        const course = await fetchOpenGolfDetail(id);
        if (!course) return jsonResponse({ error: 'Course not found in OpenGolfAPI' }, 404);
        return jsonResponse({ course });
      }
      const course =
        (await fetchGolfCourseApiDetail(id, env, request)) ?? (await fetchOpenGolfDetail(id));
      if (!course) return jsonResponse({ error: 'Course not found' }, 404);
      return jsonResponse({ course });
    }

    // 4. POST /api/golfcourse/match
    if (pathname === '/api/golfcourse/match' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const name = String(body.name ?? '').trim();
      const subCourseName = String(body.subCourseName ?? '').trim();
      const golfCourseApiId = body.golfCourseApiId ? String(body.golfCourseApiId) : '';
      const lat = body.lat !== undefined ? Number(body.lat) : NaN;
      const lng = body.lng !== undefined ? Number(body.lng) : NaN;

      const matchedList: ServerGolfCourseDetail[] = [];

      if (golfCourseApiId) {
        if (golfCourseApiId.startsWith('oga_')) {
          const direct = await fetchOpenGolfDetail(golfCourseApiId);
          if (direct) matchedList.push(direct);
        } else {
          const direct =
            (await fetchGolfCourseApiDetail(golfCourseApiId, env, request)) ??
            (await fetchOpenGolfDetail(golfCourseApiId));
          if (direct) matchedList.push(direct);
        }
      }

      const baseName = name
        .split('—')[0]
        .replace(/\b(golf\s*(course|club|links)|country\s*club|resort)\b/gi, '')
        .trim();
      const queryTerm = baseName.length >= 3 ? baseName : name.split('—')[0].trim();

      const info = getApiKeyInfo(env, request);
      let upstreamStatus: number | null = null;
      let upstreamError: string | null = null;

      if (queryTerm) {
        const targetNorm = normalizeCourseName(name.split('—')[0]);

        const ogaHits = await searchOpenGolfApi(queryTerm);
        const ogaRelevant = ogaHits.filter((c) => {
          if (matchedList.some((m) => m.id === c.id)) return false;
          if (c.location && !Number.isNaN(lat) && !Number.isNaN(lng)) {
            const dist = haversineMeters(lat, lng, c.location.lat, c.location.lng);
            if (dist <= 15000) return true;
          }
          const clubNorm = normalizeCourseName(c.clubName);
          return Boolean(
            targetNorm &&
              clubNorm &&
              (clubNorm.includes(targetNorm) || targetNorm.includes(clubNorm))
          );
        });

        const ogaHydrated = await Promise.all(
          ogaRelevant.slice(0, 4).map(async (c) => {
            if (c.tees.some((t) => t.holes.length > 0)) return c;
            return (await fetchOpenGolfDetail(c.id)) ?? c;
          })
        );
        matchedList.push(...ogaHydrated);

        if (info.key) {
          const gcaRes = await searchGolfCourseApiWithDebug(queryTerm, env, request);
          upstreamStatus = gcaRes.upstreamStatus;
          upstreamError = gcaRes.upstreamError;
          const relevant = gcaRes.courses.filter((c) => {
            if (matchedList.some((m) => m.id === c.id)) return false;
            if (c.location && !Number.isNaN(lat) && !Number.isNaN(lng)) {
              const dist = haversineMeters(lat, lng, c.location.lat, c.location.lng);
              if (dist <= 8000) return true;
            }
            const clubNorm = normalizeCourseName(c.clubName);
            return Boolean(
              targetNorm &&
                clubNorm &&
                (clubNorm.includes(targetNorm) || targetNorm.includes(clubNorm))
            );
          });

          const hydrated = await Promise.all(
            relevant.slice(0, 4).map(async (c) => {
              if (c.tees.some((t) => t.holes.length > 0)) return c;
              return (await fetchGolfCourseApiDetail(c.id, env, request)) ?? c;
            })
          );
          matchedList.push(...hydrated);
        }
      }

      if (subCourseName && matchedList.length > 1) {
        const subLower = subCourseName.toLowerCase();
        matchedList.sort((a, b) => {
          const aMatch = a.courseName.toLowerCase().includes(subLower) ? 1 : 0;
          const bMatch = b.courseName.toLowerCase().includes(subLower) ? 1 : 0;
          return bMatch - aMatch;
        });
      }

      return jsonResponse({
        configured: true,
        keyPopulated: Boolean(info.key),
        envVarName: info.envVarName,
        keyLength: info.keyLength,
        maskedKey: info.maskedKey,
        upstreamStatus,
        upstreamError,
        matches: matchedList,
      });
    }

    // 5. POST /api/osm/course-geometry
    if (pathname === '/api/osm/course-geometry' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return jsonResponse({ error: 'Invalid coordinates' }, 400);
      }

      const ql = `
[out:json][timeout:6];
(
  way["leisure"="golf_course"](around:1000,${lat.toFixed(6)},${lng.toFixed(6)});
  relation["leisure"="golf_course"](around:1000,${lat.toFixed(6)},${lng.toFixed(6)});
  way["golf"](around:2800,${lat.toFixed(6)},${lng.toFixed(6)});
  relation["golf"](around:2800,${lat.toFixed(6)},${lng.toFixed(6)});
  way["natural"="water"](around:1800,${lat.toFixed(6)},${lng.toFixed(6)});
);
out geom;
`.trim();

      try {
        const { elements, endpoint } = await queryOverpassServer(ql, 5500);
        if (elements.length > 0) {
          return jsonResponse({ elements, source: endpoint });
        }
      } catch {
        // Fallback to OSM v0.6 map.json
      }

      try {
        const elements = await fetchViaOsmMapApi(lat, lng);
        return jsonResponse({ elements, source: 'openstreetmap-v0.6' });
      } catch {
        return jsonResponse({ elements: [], source: 'empty-fallback' });
      }
    }

    // 6. GET /api/osm/nearby
    if (pathname === '/api/osm/nearby' && request.method === 'GET') {
      let lat = Number(searchParams.get('lat'));
      let lng = Number(searchParams.get('lng'));
      const radius = Math.min(80000, Math.max(5000, Number(searchParams.get('radius')) || 45000));

      // Cloudflare provides request.cf.latitude / longitude automatically if GPS wasn't passed
      const cf = (request as Request & { cf?: { latitude?: string; longitude?: string } }).cf;
      if ((Number.isNaN(lat) || Number.isNaN(lng)) && cf?.latitude && cf?.longitude) {
        lat = Number(cf.latitude);
        lng = Number(cf.longitude);
      }

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return jsonResponse({ courses: [] });
      }

      const ql = `
[out:json][timeout:6];
(
  nwr["leisure"="golf_course"](around:${radius},${lat.toFixed(6)},${lng.toFixed(6)});
);
out center 30;
`.trim();

      const photonParams = new URLSearchParams({
        q: 'golf course',
        lat: lat.toFixed(4),
        lon: lng.toFixed(4),
        limit: '18',
      });

      const [arcResult, photonResult, osmResult] = await Promise.allSettled([
        queryArcGisGolfCourses('', { lat, lng }, 20),
        fetchWithTimeout(
          `https://photon.komoot.io/api/?${photonParams.toString()}`,
          { headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json' } },
          6000
        ).then(async (r) => (r.ok ? r.json() : { features: [] })),
        queryOverpassServer(ql, 5500),
      ]);

      const combined: UnifiedCourseCandidate[] = [];
      if (arcResult.status === 'fulfilled') {
        combined.push(...arcResult.value);
      }

      if (photonResult.status === 'fulfilled') {
        const features = (
          photonResult.value as {
            features?: Array<{
              geometry?: { coordinates?: [number, number] };
              properties?: {
                osm_id?: number;
                osm_type?: string;
                osm_key?: string;
                osm_value?: string;
                name?: string;
                city?: string;
                state?: string;
                country?: string;
              };
            }>;
          }
        )?.features;
        for (const f of features ?? []) {
          const p = f.properties;
          const coords = f.geometry?.coordinates;
          if (!p || !coords || !p.name) continue;
          if (
            p.osm_value === 'disc_golf_course' ||
            p.osm_value === 'miniature_golf' ||
            isDiscGolfCourse(p.name, p.osm_value, p.osm_key)
          ) {
            continue;
          }
          const isGolf =
            p.osm_value === 'golf_course' ||
            p.name.toLowerCase().includes('golf') ||
            p.name.toLowerCase().includes('country club');
          if (!isGolf) continue;
          const addr = [p.city, p.state, p.country].filter(Boolean).join(', ');
          combined.push({
            placeId: p.osm_id
              ? `osm_p_${p.osm_type ?? 'n'}_${p.osm_id}`
              : `photon_${coords[1]}_${coords[0]}`,
            name: p.name,
            formattedAddress: addr || undefined,
            lat: coords[1],
            lng: coords[0],
            source: 'OpenStreetMap',
            score: 83,
          });
        }
      }

      if (osmResult.status === 'fulfilled') {
        for (const el of osmResult.value.elements) {
          const elLat = el.center?.lat ?? el.lat;
          const elLng = el.center?.lon ?? el.lon;
          if (elLat === undefined || elLng === undefined) continue;
          const name = el.tags?.name?.trim();
          if (!name) continue;
          if (
            el.tags?.sport === 'disc_golf' ||
            el.tags?.sport === 'footgolf' ||
            el.tags?.leisure === 'disc_golf_course' ||
            el.tags?.leisure === 'miniature_golf' ||
            el.tags?.golf === 'disc_golf' ||
            el.tags?.golf === 'miniature' ||
            isDiscGolfCourse(
              name,
              el.tags?.description,
              el.tags?.sport,
              el.tags?.leisure,
              el.tags?.golf
            )
          ) {
            continue;
          }
          const addr = [
            el.tags?.['addr:city'] || el.tags?.['addr:town'] || el.tags?.['addr:village'],
            el.tags?.['addr:state'],
          ]
            .filter(Boolean)
            .join(', ');
          combined.push({
            placeId: `osm_${el.type}_${el.id}`,
            name,
            formattedAddress: addr || undefined,
            lat: elLat,
            lng: elLng,
            source: 'OpenStreetMap',
            score: 86,
          });
        }
      }

      const deduped = deduplicateCourses(
        combined.filter((c) => !isDiscGolfCourse(c.name, c.formattedAddress))
      )
        .map((c) => {
          const meters = haversineMeters(lat, lng, c.lat, c.lng);
          const miles = (meters / 1609.344).toFixed(1);
          return {
            ...c,
            distMeters: meters,
            formattedAddress: c.formattedAddress
              ? `${miles} mi · ${c.formattedAddress}`
              : `${miles} mi away`,
          };
        })
        .filter((c) => c.distMeters <= radius * 1.35)
        .sort((a, b) => a.distMeters - b.distMeters)
        .slice(0, 18);

      return jsonResponse({ courses: deduped });
    }

    // 7. GET /api/osm/search
    if (pathname === '/api/osm/search' && request.method === 'GET') {
      const q = (searchParams.get('q') ?? '').trim();
      const nearLat = searchParams.get('lat') ? Number(searchParams.get('lat')) : NaN;
      const nearLng = searchParams.get('lng') ? Number(searchParams.get('lng')) : NaN;
      const near =
        !Number.isNaN(nearLat) && !Number.isNaN(nearLng)
          ? { lat: nearLat, lng: nearLng }
          : null;
      const viewbox = searchParams.get('viewbox') ?? '';

      if (!q) {
        return jsonResponse({ courses: [] });
      }

      const nomQuery = q.toLowerCase().includes('golf') ? q : `${q} golf course`;
      const nomParams = new URLSearchParams({
        format: 'jsonv2',
        q: nomQuery,
        limit: '10',
        addressdetails: '1',
      });
      if (viewbox) nomParams.set('viewbox', viewbox);

      const photonParams = new URLSearchParams({
        q: nomQuery,
        limit: '10',
      });
      if (near) {
        photonParams.set('lat', near.lat.toFixed(4));
        photonParams.set('lon', near.lng.toFixed(4));
      }

      const info = getApiKeyInfo(env);

      const [arcRes, nomRes, photonRes, ogaRes, gcaRes] = await Promise.allSettled([
        queryArcGisGolfCourses(q, near, 12),
        fetchWithTimeout(
          `https://nominatim.openstreetmap.org/search?${nomParams.toString()}`,
          { headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json' } },
          8000
        ).then(async (r) => (r.ok ? r.json() : [])),
        fetchWithTimeout(
          `https://photon.komoot.io/api/?${photonParams.toString()}`,
          { headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json' } },
          8000
        ).then(async (r) => (r.ok ? r.json() : { features: [] })),
        searchOpenGolfApi(q),
        info.key ? searchGolfCourseApiWithDebug(q, env) : Promise.resolve({ courses: [] }),
      ]);

      const combined: UnifiedCourseCandidate[] = [];

      if (ogaRes.status === 'fulfilled') {
        for (const c of ogaRes.value) {
          if (!c.location) continue;
          if (isDiscGolfCourse(c.displayName, c.clubName, c.courseName)) continue;
          const addr = [c.address, c.city, c.state, c.country].filter(Boolean).join(', ');
          combined.push({
            placeId: c.id,
            name: c.displayName,
            formattedAddress: addr || undefined,
            lat: c.location.lat,
            lng: c.location.lng,
            source: 'OpenGolfAPI',
            score: 96,
            golfCourseApiId: c.id,
            clubName: c.clubName,
            courseName: c.courseName,
          });
        }
      }

      if (gcaRes.status === 'fulfilled') {
        for (const c of gcaRes.value.courses) {
          if (!c.location) continue;
          if (isDiscGolfCourse(c.displayName, c.clubName, c.courseName)) continue;
          const addr = [c.address, c.city, c.state, c.country].filter(Boolean).join(', ');
          combined.push({
            placeId: `gca_${c.id}`,
            name: c.displayName,
            formattedAddress: addr || undefined,
            lat: c.location.lat,
            lng: c.location.lng,
            source: 'GolfCourseAPI',
            score: 94,
            golfCourseApiId: c.id,
            clubName: c.clubName,
            courseName: c.courseName,
          });
        }
      }

      if (arcRes.status === 'fulfilled') {
        combined.push(...arcRes.value);
      }

      if (nomRes.status === 'fulfilled' && Array.isArray(nomRes.value)) {
        for (const item of nomRes.value as Array<{
          place_id: number;
          osm_type?: string;
          osm_id?: number;
          lat: string;
          lon: string;
          name?: string;
          display_name: string;
          class?: string;
          type?: string;
        }>) {
          if (
            item.type === 'disc_golf_course' ||
            item.type === 'miniature_golf' ||
            isDiscGolfCourse(item.name, item.display_name, item.type)
          ) {
            continue;
          }
          const isGolf =
            item.type === 'golf_course' ||
            item.class === 'leisure' ||
            item.display_name.toLowerCase().includes('golf') ||
            item.display_name.toLowerCase().includes('country club');
          if (!isGolf) continue;
          const lat = Number(item.lat);
          const lng = Number(item.lon);
          if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
          combined.push({
            placeId: item.osm_id
              ? `osm_${item.osm_type ?? 'n'}_${item.osm_id}`
              : `nom_${item.place_id}`,
            name: item.name || item.display_name.split(',')[0],
            formattedAddress: item.display_name,
            lat,
            lng,
            source: 'OpenStreetMap',
            score: 85,
          });
        }
      }

      if (photonRes.status === 'fulfilled') {
        const features = (
          photonRes.value as {
            features?: Array<{
              geometry?: { coordinates?: [number, number] };
              properties?: {
                osm_id?: number;
                osm_type?: string;
                osm_key?: string;
                osm_value?: string;
                name?: string;
                city?: string;
                state?: string;
                country?: string;
              };
            }>;
          }
        )?.features;
        for (const f of features ?? []) {
          const p = f.properties;
          const coords = f.geometry?.coordinates;
          if (!p || !coords || !p.name) continue;
          if (
            p.osm_value === 'disc_golf_course' ||
            p.osm_value === 'miniature_golf' ||
            isDiscGolfCourse(p.name, p.osm_value, p.osm_key)
          ) {
            continue;
          }
          const isGolf =
            p.osm_value === 'golf_course' ||
            p.name.toLowerCase().includes('golf') ||
            p.name.toLowerCase().includes('country club');
          if (!isGolf) continue;
          const addr = [p.city, p.state, p.country].filter(Boolean).join(', ');
          combined.push({
            placeId: p.osm_id
              ? `osm_p_${p.osm_type ?? 'n'}_${p.osm_id}`
              : `photon_${coords[1]}_${coords[0]}`,
            name: p.name,
            formattedAddress: addr || undefined,
            lat: coords[1],
            lng: coords[0],
            source: 'OpenStreetMap',
            score: 82,
          });
        }
      }

      const deduped = deduplicateCourses(
        combined.filter((c) => !isDiscGolfCourse(c.name, c.formattedAddress))
      );

      if (near) {
        const sorted = deduped
          .map((c) => {
            const distMeters = haversineMeters(near.lat, near.lng, c.lat, c.lng);
            const miles = (distMeters / 1609.344).toFixed(1);
            return {
              ...c,
              distMeters,
              formattedAddress: c.formattedAddress
                ? `${miles} mi · ${c.formattedAddress}`
                : `${miles} mi away`,
            };
          })
          .sort((a, b) => a.distMeters - b.distMeters)
          .slice(0, 15);
        return jsonResponse({ courses: sorted });
      }

      const sortedByScore = deduped.sort((a, b) => b.score - a.score).slice(0, 15);
      return jsonResponse({ courses: sortedByScore });
    }

    // Fallback to static assets binding for SPA routes
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

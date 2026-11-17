import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const OSM_USER_AGENT = 'CaddieLineGolfTracker/1.0 (+https://caddieline.app)';

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

const geometryCache = new Map<string, { timestamp: number; elements: OverpassElement[]; source: string }>();
const nearbyCache = new Map<string, { timestamp: number; courses: unknown[] }>();
const golfCourseSearchCache = new Map<string, { timestamp: number; courses: ServerGolfCourseDetail[] }>();
const golfCourseDetailCache = new Map<string, { timestamp: number; course: ServerGolfCourseDetail }>();
const openGolfSearchCache = new Map<string, { timestamp: number; courses: ServerGolfCourseDetail[] }>();
const openGolfDetailCache = new Map<string, { timestamp: number; course: ServerGolfCourseDetail }>();

const CACHE_TTL_MS = 1000 * 60 * 30;
const NEARBY_CACHE_TTL_MS = 1000 * 60 * 15;
const GOLFCOURSE_CACHE_TTL_MS = 1000 * 60 * 60;
const OPENGOLF_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

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
  phone?: string;
  website?: string;
  address?: string;
  scorecard?: Array<{ hole: number; par: number }>;
}

interface OpenGolfHoleItem {
  number: number;
  par: number;
  handicap_index?: number;
  yardages?: Record<string, number>;
}

const GOLF_API_ENV_VARS = [
  'GOLFCOURSE_API_KEY',
  'GOLF_COURSE_API_KEY',
  'GOLF_API_KEY',
  'GOLFAPI_KEY',
  'VITE_GOLFCOURSE_API_KEY',
  'VITE_GOLF_API_KEY',
  'VITE_GOLFAPI_KEY',
];

function getGolfApiKeyDiagnostic() {
  const matched = GOLF_API_ENV_VARS.find((name) => Boolean(process.env[name]?.trim()));
  const rawKey = matched ? process.env[matched]!.trim() : '';
  const masked = rawKey
    ? rawKey.length <= 8
      ? `${rawKey.slice(0, 2)}••••${rawKey.slice(-2)} (${rawKey.length} chars)`
      : `${rawKey.slice(0, 4)}••••${rawKey.slice(-4)} (${rawKey.length} chars)`
    : 'NOT_SET';

  return {
    configured: Boolean(rawKey),
    source: matched ?? null,
    masked,
    preview: rawKey ? `${rawKey.slice(0, 4)}...` : '',
    length: rawKey.length,
    envVarsChecked: GOLF_API_ENV_VARS,
  };
}

function getGolfCourseApiKey(): string {
  for (const name of GOLF_API_ENV_VARS) {
    const val = process.env[name]?.trim();
    if (val) return val;
  }
  return '';
}

function isDiscGolfCourse(...parts: Array<string | undefined | null>): boolean {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  return /\b(disc\s*[-/]?\s*golf|disk\s*[-/]?\s*golf|discgolf|diskgolf|frisbee(\s*golf)?|frolf|disc\s*park|disc\s*course|dgc|d\.g\.c\.|dg\s*course|pdga|foot\s*golf|footgolf|soccer\s*golf|mini\s*[-/]?\s*golf|miniature\s*golf|putt\s*[-/]?\s*putt|crazy\s*golf)\b/i.test(text);
}

function getTeeColor(teeName: string): string | undefined {
  const norm = teeName.toLowerCase();
  if (norm.includes('black')) return '#1e293b';
  if (norm.includes('blue')) return '#2563eb';
  if (norm.includes('white') || norm.includes('regular') || norm.includes('standard')) return '#f8fafc';
  if (norm.includes('gold') || norm.includes('yellow')) return '#eab308';
  if (norm.includes('red') || norm.includes('forward')) return '#ef4444';
  if (norm.includes('green')) return '#16a34a';
  if (norm.includes('silver') || norm.includes('gray')) return '#94a3b8';
  return undefined;
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

async function searchOpenGolfApi(query: string): Promise<ServerGolfCourseDetail[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = trimmed.toLowerCase();
  const cached = openGolfSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < OPENGOLF_CACHE_TTL_MS) {
    return cached.courses;
  }

  try {
    const res = await fetchWithTimeout(
      `https://api.opengolfapi.org/v1/courses/search?q=${encodeURIComponent(trimmed)}`,
      { headers: { Accept: 'application/json' } },
      7500
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { courses?: OpenGolfCourseItem[] };
    const courses = (data.courses ?? [])
      .filter((c) => !isDiscGolfCourse(c.name, c.course_name, c.city, c.state))
      .map((c) => convertOpenGolfToDetail(c));

    if (courses.length > 0) {
      openGolfSearchCache.set(cacheKey, { timestamp: Date.now(), courses });
      for (const c of courses) {
        if (!openGolfDetailCache.has(c.id)) {
          openGolfDetailCache.set(c.id, { timestamp: Date.now(), course: c });
        }
      }
    }
    return courses;
  } catch {
    return [];
  }
}

async function fetchOpenGolfDetail(id: string): Promise<ServerGolfCourseDetail | null> {
  const rawId = id.replace(/^oga_/, '').trim();
  if (!rawId) return null;

  const cacheKey = `oga_${rawId}`;
  const cached = openGolfDetailCache.get(cacheKey);
  if (
    cached &&
    cached.course.tees.some((t) => t.holes.length > 0) &&
    Date.now() - cached.timestamp < OPENGOLF_CACHE_TTL_MS
  ) {
    return cached.course;
  }

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
    const holesData = hRes.ok ? ((await hRes.json()) as { holes?: OpenGolfHoleItem[] }) : undefined;
    const detail = convertOpenGolfToDetail(courseData, holesData?.holes);
    openGolfDetailCache.set(cacheKey, { timestamp: Date.now(), course: detail });
    return detail;
  } catch {
    return cached?.course ?? null;
  }
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
    const list = Array.isArray(teesRaw[gender]) ? (teesRaw[gender] as Array<Record<string, unknown>>) : [];
    list.forEach((t, idx) => {
      const teeName = String(t.tee_name ?? t.teeName ?? `Tee ${idx + 1}`).trim();
      const rawHoles = Array.isArray(t.holes) ? (t.holes as Array<Record<string, unknown>>) : [];
      const holes: ServerGolfCourseTeeHole[] = rawHoles
        .map((h, hIdx) => {
          const holeNumber = Number(h.hole_number ?? h.holeNumber ?? hIdx + 1);
          const par = Number(h.par ?? 4);
          const yardage = Number(
            h.yardage ?? h.yards ?? (h.meters !== undefined ? Math.round(Number(h.meters) * 1.09361) : 0)
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
        totalYards: t.total_yards !== undefined
          ? Number(t.total_yards)
          : t.yardage_total !== undefined
            ? Number(t.yardage_total)
            : undefined,
        totalMeters: t.total_meters !== undefined ? Number(t.total_meters) : undefined,
        numberOfHoles: t.number_of_holes !== undefined ? Number(t.number_of_holes) : holes.length || undefined,
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
        errors.push(`${endpoint}: non-JSON response`);
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
          {
            headers: {
              'User-Agent': OSM_USER_AGENT,
              Accept: 'application/json',
            },
          },
          15000
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/osm/course-geometry', async (req, res) => {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const forceRefresh = Boolean(req.body?.forceRefresh);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'Invalid coordinates' });
      return;
    }

    const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    if (!forceRefresh) {
      const cached = geometryCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        res.json({ elements: cached.elements, source: `${cached.source} (cached)` });
        return;
      }
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
      const { elements, endpoint } = await Promise.race([
        queryOverpassServer(ql, 5500),
        new Promise<{ elements: OverpassElement[]; endpoint: string }>((_, reject) =>
          setTimeout(() => reject(new Error('Overpass geometry timeout')), 7000)
        ),
      ]);
      if (elements.length > 0) {
        geometryCache.set(cacheKey, { timestamp: Date.now(), elements, source: endpoint });
        res.json({ elements, source: endpoint });
        return;
      }
      throw new Error('Overpass returned 0 golf elements');
    } catch {
      try {
        const elements = await fetchViaOsmMapApi(lat, lng);
        if (elements.length > 0) {
          geometryCache.set(cacheKey, {
            timestamp: Date.now(),
            elements,
            source: 'openstreetmap-v0.6',
          });
        }
        res.json({ elements, source: 'openstreetmap-v0.6' });
        return;
      } catch {
        // Return 200 with empty elements instead of 502 so client continues gracefully
        res.json({ elements: [], source: 'empty-fallback' });
      }
    }
  });

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

  async function searchGolfCourseApi(query: string): Promise<ServerGolfCourseDetail[]> {
    const apiKey = getGolfCourseApiKey();
    const trimmed = query.trim();
    if (!apiKey || !trimmed) return [];

    const cacheKey = trimmed.toLowerCase();
    const cached = golfCourseSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < GOLFCOURSE_CACHE_TTL_MS) {
      return cached.courses;
    }

    try {
      const res = await fetchWithTimeout(
        `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(trimmed)}`,
        {
          headers: {
            Authorization: `Key ${apiKey}`,
            Accept: 'application/json',
          },
        },
        7500
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { courses?: Array<Record<string, unknown>> };
      const courses = (data.courses ?? [])
        .map(normalizeGolfCourseRecord)
        .filter((c): c is ServerGolfCourseDetail => Boolean(c))
        .filter((c) => !isDiscGolfCourse(c.displayName, c.clubName, c.courseName));
      if (courses.length > 0) {
        golfCourseSearchCache.set(cacheKey, { timestamp: Date.now(), courses });
        for (const c of courses) {
          if (c.tees.some((t) => t.holes.length > 0)) {
            golfCourseDetailCache.set(c.id, { timestamp: Date.now(), course: c });
          }
        }
      }
      return courses;
    } catch {
      return [];
    }
  }

  async function fetchGolfCourseApiDetail(id: string): Promise<ServerGolfCourseDetail | null> {
    const apiKey = getGolfCourseApiKey();
    if (!apiKey || !id) return null;

    const cached = golfCourseDetailCache.get(id);
    if (cached && Date.now() - cached.timestamp < GOLFCOURSE_CACHE_TTL_MS) {
      return cached.course;
    }

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
      const record = (raw.course && typeof raw.course === 'object'
        ? raw.course
        : raw) as Record<string, unknown>;
      const normalized = normalizeGolfCourseRecord(record);
      if (normalized) {
        golfCourseDetailCache.set(id, { timestamp: Date.now(), course: normalized });
      }
      return normalized;
    } catch {
      return null;
    }
  }

  app.get('/api/golfcourse/status', (_req, res) => {
    const diag = getGolfApiKeyDiagnostic();
    res.json({
      configured: true,
      openGolfApi: true,
      golfCourseApi: diag.configured,
      apiKeyStatus: diag,
    });
  });

  app.get('/api/golfcourse/search', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json({ configured: true, courses: [] });
      return;
    }

    // Query OpenGolfAPI first (keyless, 32k+ courses), plus GolfCourseAPI if configured
    const [ogaCourses, gcaCourses] = await Promise.all([
      searchOpenGolfApi(q),
      getGolfCourseApiKey() ? searchGolfCourseApi(q) : Promise.resolve([]),
    ]);

    const combined = [...ogaCourses, ...gcaCourses];
    res.json({ configured: true, courses: combined });
  });

  app.get('/api/golfcourse/course/:id', async (req, res) => {
    const id = req.params.id;
    if (id.startsWith('oga_')) {
      const course = await fetchOpenGolfDetail(id);
      if (!course) {
        res.status(404).json({ error: 'Course not found in OpenGolfAPI' });
        return;
      }
      res.json({ course });
      return;
    }

    const course = (await fetchGolfCourseApiDetail(id)) ?? (await fetchOpenGolfDetail(id));
    if (!course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    res.json({ course });
  });

  app.post('/api/golfcourse/match', async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const subCourseName = String(req.body?.subCourseName ?? '').trim();
    const golfCourseApiId = req.body?.golfCourseApiId ? String(req.body.golfCourseApiId) : '';
    const lat = req.body?.lat !== undefined ? Number(req.body.lat) : NaN;
    const lng = req.body?.lng !== undefined ? Number(req.body.lng) : NaN;

    const matchedList: ServerGolfCourseDetail[] = [];

    if (golfCourseApiId) {
      if (golfCourseApiId.startsWith('oga_')) {
        const direct = await fetchOpenGolfDetail(golfCourseApiId);
        if (direct) matchedList.push(direct);
      } else {
        const direct =
          (await fetchGolfCourseApiDetail(golfCourseApiId)) ??
          (await fetchOpenGolfDetail(golfCourseApiId));
        if (direct) matchedList.push(direct);
      }
    }

    const rawClean = name
      .split('—')[0]
      .replace(/\b(golf\s*(course|club|links)|country\s*club|resort)\b/gi, '')
      .trim();
    const strippedClean = rawClean.replace(/^(the|a|an)\s+/i, '').trim();
    const queryTerms = Array.from(
      new Set([rawClean, strippedClean, name.split('—')[0].trim()])
    ).filter((t) => t.length >= 3);

    const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng);
    const MAX_MATCH_DIST_METERS = 25000;

    for (const queryTerm of queryTerms) {
      const targetNorm = normalizeCourseName(name.split('—')[0]);

      // 1. Search OpenGolfAPI (keyless, 32k+ courses)
      const ogaHits = await searchOpenGolfApi(queryTerm);
      let ogaRelevant = ogaHits.filter((c) => !matchedList.some((m) => m.id === c.id));
      if (hasCoords) {
        ogaRelevant = ogaRelevant
          .map((c) => ({
            course: c,
            dist: c.location ? haversineMeters(lat, lng, c.location.lat, c.location.lng) : Infinity,
          }))
          .filter((item) => item.dist <= MAX_MATCH_DIST_METERS)
          .sort((a, b) => a.dist - b.dist)
          .map((item) => item.course);
      } else {
        ogaRelevant = ogaRelevant.filter((c) => {
          const clubNorm = normalizeCourseName(c.clubName);
          return Boolean(
            targetNorm && clubNorm && (clubNorm.includes(targetNorm) || targetNorm.includes(clubNorm))
          );
        });
      }

      const ogaHydrated = await Promise.all(
        ogaRelevant.slice(0, 4).map(async (c) => {
          if (c.tees.some((t) => t.holes.length > 0)) return c;
          return (await fetchOpenGolfDetail(c.id)) ?? c;
        })
      );
      for (const h of ogaHydrated) {
        if (!matchedList.some((m) => m.id === h.id)) {
          matchedList.push(h);
        }
      }

      // 2. If GolfCourseAPI key is also configured, check it
      if (getGolfCourseApiKey()) {
        const searchHits = await searchGolfCourseApi(queryTerm);
        let relevant = searchHits.filter((c) => !matchedList.some((m) => m.id === c.id));
        if (hasCoords) {
          relevant = relevant
            .map((c) => ({
              course: c,
              dist: c.location ? haversineMeters(lat, lng, c.location.lat, c.location.lng) : Infinity,
            }))
            .filter((item) => item.dist <= MAX_MATCH_DIST_METERS)
            .sort((a, b) => a.dist - b.dist)
            .map((item) => item.course);
        } else {
          relevant = relevant.filter((c) => {
            const clubNorm = normalizeCourseName(c.clubName);
            return Boolean(
              targetNorm && clubNorm && (clubNorm.includes(targetNorm) || targetNorm.includes(clubNorm))
            );
          });
        }

        const hydrated = await Promise.all(
          relevant.slice(0, 4).map(async (c) => {
            if (c.tees.some((t) => t.holes.length > 0)) return c;
            return (await fetchGolfCourseApiDetail(c.id)) ?? c;
          })
        );
        for (const h of hydrated) {
          if (!matchedList.some((m) => m.id === h.id)) {
            matchedList.push(h);
          }
        }
      }
    }

    // If a specific subCourseName was requested, rank matching course first
    if (subCourseName && matchedList.length > 1) {
      const subLower = subCourseName.toLowerCase();
      matchedList.sort((a, b) => {
        const aMatch = a.courseName.toLowerCase().includes(subLower) ? 1 : 0;
        const bMatch = b.courseName.toLowerCase().includes(subLower) ? 1 : 0;
        return bMatch - aMatch;
      });
    }

    res.json({ configured: true, matches: matchedList });
  });

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
    if (text.trim()) {
      params.set('SingleLine', text.trim());
    }
    if (near) {
      params.set('location', `${near.lng.toFixed(5)},${near.lat.toFixed(5)}`);
    }

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
        if (isDiscGolfCourse(name, c.address, c.attributes?.Place_addr, c.attributes?.Type)) {
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

  app.get('/api/osm/nearby', async (req, res) => {
    let lat = Number(req.query.lat);
    let lng = Number(req.query.lng);
    const radius = Math.min(80000, Math.max(5000, Number(req.query.radius) || 45000));

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      try {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const ipStr = Array.isArray(clientIp) ? clientIp[0] : String(clientIp).split(',')[0].trim();
        const ipQuery = ipStr && ipStr !== '127.0.0.1' && ipStr !== '::1' ? ipStr : '';
        const ipRes = await fetchWithTimeout(`http://ip-api.com/json/${ipQuery}`, {}, 4000);
        if (ipRes.ok) {
          const ipData = (await ipRes.json()) as { lat?: number; lon?: number };
          if (typeof ipData.lat === 'number' && typeof ipData.lon === 'number') {
            lat = ipData.lat;
            lng = ipData.lon;
          }
        }
      } catch {}
    }

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'Invalid coordinates' });
      return;
    }

    const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}_${radius}`;
    const cachedNearby = nearbyCache.get(cacheKey);
    if (cachedNearby && Date.now() - cachedNearby.timestamp < NEARBY_CACHE_TTL_MS) {
      res.json({ courses: cachedNearby.courses });
      return;
    }

    try {
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

      const overpassWithCap = Promise.race([
        queryOverpassServer(ql, 5500),
        new Promise<{ elements: OverpassElement[]; endpoint: string }>((_, reject) =>
          setTimeout(() => reject(new Error('Overpass nearby timeout')), 6500)
        ),
      ]);

      const [arcResult, photonResult, osmResult] = await Promise.allSettled([
        queryArcGisGolfCourses('', { lat, lng }, 20),
        fetchWithTimeout(
          `https://photon.komoot.io/api/?${photonParams.toString()}`,
          { headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json' } },
          6000
        ).then(async (r) => (r.ok ? r.json() : { features: [] })),
        overpassWithCap,
      ]);

      const combined: UnifiedCourseCandidate[] = [];
      if (arcResult.status === 'fulfilled') {
        combined.push(...arcResult.value);
      }

      if (photonResult.status === 'fulfilled') {
        const features = (photonResult.value as {
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
        })?.features;
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
            placeId: p.osm_id ? `osm_p_${p.osm_type ?? 'n'}_${p.osm_id}` : `photon_${coords[1]}_${coords[0]}`,
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
            isDiscGolfCourse(name, el.tags?.description, el.tags?.sport, el.tags?.leisure, el.tags?.golf)
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
            formattedAddress: c.formattedAddress ? `${miles} mi · ${c.formattedAddress}` : `${miles} mi away`,
          };
        })
        .filter((c) => c.distMeters <= radius * 1.35)
        .sort((a, b) => a.distMeters - b.distMeters)
        .slice(0, 18);

      if (deduped.length > 0) {
        nearbyCache.set(cacheKey, { timestamp: Date.now(), courses: deduped });
      }

      res.json({ courses: deduped });
    } catch (err) {
      res.status(502).json({
        error: `Nearby golf course search failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.get('/api/osm/search', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const nearLat = req.query.lat !== undefined ? Number(req.query.lat) : NaN;
    const nearLng = req.query.lng !== undefined ? Number(req.query.lng) : NaN;
    const near = !Number.isNaN(nearLat) && !Number.isNaN(nearLng) ? { lat: nearLat, lng: nearLng } : null;
    const viewbox = typeof req.query.viewbox === 'string' ? req.query.viewbox : '';

    if (!q) {
      res.json({ courses: [] });
      return;
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
      getGolfCourseApiKey() ? searchGolfCourseApi(q) : Promise.resolve([]),
    ]);

    const combined: UnifiedCourseCandidate[] = [];

    // OpenGolfAPI hits
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

    // GolfCourseAPI hits if configured
    if (gcaRes.status === 'fulfilled') {
      for (const c of gcaRes.value) {
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
          placeId: item.osm_id ? `osm_${item.osm_type ?? 'n'}_${item.osm_id}` : `nom_${item.place_id}`,
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
      const features = (photonRes.value as {
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
      })?.features;
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
          placeId: p.osm_id ? `osm_p_${p.osm_type ?? 'n'}_${p.osm_id}` : `photon_${coords[1]}_${coords[0]}`,
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
            formattedAddress: c.formattedAddress ? `${miles} mi · ${c.formattedAddress}` : `${miles} mi away`,
          };
        })
        .sort((a, b) => a.distMeters - b.distMeters)
        .slice(0, 15);
      res.json({ courses: sorted });
      return;
    }

    const sortedByScore = deduped.sort((a, b) => b.score - a.score).slice(0, 15);
    res.json({ courses: sortedByScore });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        ws: { server: httpServer },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    const diag = getGolfApiKeyDiagnostic();
    console.log(`CaddieLine server listening on http://0.0.0.0:${PORT}`);
    console.log(
      `[Deployment Check] GolfCourseAPI Key: ${
        diag.configured
          ? `CONFIGURED via ${diag.source} (${diag.masked})`
          : 'NOT CONFIGURED (checked: ' + GOLF_API_ENV_VARS.join(', ') + ')'
      }`
    );
    console.log('[Deployment Check] OpenGolfAPI: ENABLED (keyless, 32,000+ courses)');
  });
}

void startServer();

import {
  CourseInfo,
  HolePinData,
  LatLngLiteral,
  OsmCourseGeometry,
  OsmCourseSummary,
  OsmFeatureKind,
  OsmHoleFeature,
  OsmPolygonFeature,
  OsmSubCourse,
} from '../types/golf';
import {
  DEFAULT_PAR_LAYOUT,
  computeDistanceMeters,
  computeDistanceYards,
  computePolygonCentroid,
  isPointInPolygon,
  pointToPolylineMinDistanceMeters,
} from '../utils/golfMath';

const GEOMETRY_CACHE_PREFIX = 'caddieline_osm_geom_v5_';
const METERS_TO_YARDS = 1.0936133;

interface OverpassPoint {
  lat: number;
  lon: number;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
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

interface UnifiedCourseResponseItem {
  placeId: string;
  name: string;
  formattedAddress?: string;
  lat: number;
  lng: number;
  source: string;
  score?: number;
  distMeters?: number;
  golfCourseApiId?: string;
  clubName?: string;
  courseName?: string;
}

export function isDiscGolfCourse(...parts: Array<string | undefined | null>): boolean {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  return /\b(disc\s*[-/]?\s*golf|disk\s*[-/]?\s*golf|discgolf|diskgolf|frisbee(\s*golf)?|frolf|disc\s*park|disc\s*course|dgc|d\.g\.c\.|dg\s*course|pdga|foot\s*golf|footgolf|soccer\s*golf|mini\s*[-/]?\s*golf|miniature\s*golf|putt\s*[-/]?\s*putt|crazy\s*golf)\b/i.test(text);
}

function mapCandidateToCourseInfo(item: UnifiedCourseResponseItem): CourseInfo {
  const attributions =
    item.source && item.source !== 'OpenStreetMap'
      ? [item.source, 'OpenStreetMap']
      : ['OpenStreetMap'];
  return {
    placeId: item.placeId,
    name: item.name,
    formattedAddress: item.formattedAddress,
    location: { lat: item.lat, lng: item.lng },
    attributions,
    golfCourseApiId: item.golfCourseApiId,
    clubName: item.clubName,
    courseName: item.courseName,
  };
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function queryDirectCourseDirectories(
  text: string,
  near?: LatLngLiteral | null,
  radiusMeters = 45000
): Promise<CourseInfo[]> {
  const arcParams = new URLSearchParams({
    category: 'Golf Course',
    outFields: 'PlaceName,Place_addr,City,Region,Type',
    f: 'json',
    maxLocations: '18',
  });
  if (text.trim()) arcParams.set('SingleLine', text.trim());
  if (near) arcParams.set('location', `${near.lng.toFixed(5)},${near.lat.toFixed(5)}`);

  const photonParams = new URLSearchParams({
    q: text.trim()
      ? text.toLowerCase().includes('golf')
        ? text.trim()
        : `${text.trim()} golf course`
      : 'golf course',
    limit: '18',
  });
  if (near) {
    photonParams.set('lat', near.lat.toFixed(4));
    photonParams.set('lon', near.lng.toFixed(4));
  }

  const [arcRes, photonRes] = await Promise.allSettled([
    fetchJsonWithTimeout<{
      candidates?: Array<{
        address?: string;
        score?: number;
        location?: { x: number; y: number };
        attributes?: { PlaceName?: string; Place_addr?: string; City?: string; Region?: string; Type?: string };
      }>;
    }>(
      `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${arcParams.toString()}`,
      7500
    ),
    fetchJsonWithTimeout<{
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
          osm_id?: number;
          osm_type?: string;
          osm_value?: string;
          name?: string;
          city?: string;
          state?: string;
          country?: string;
        };
      }>;
    }>(`https://photon.komoot.io/api/?${photonParams.toString()}`, 7500),
  ]);

  const items: UnifiedCourseResponseItem[] = [];

  if (arcRes.status === 'fulfilled') {
    for (const c of arcRes.value.candidates ?? []) {
      if (!c.location) continue;
      const name = (c.attributes?.PlaceName || c.address || '').trim();
      if (!name) continue;
      if (isDiscGolfCourse(name, c.address, c.attributes?.Place_addr, c.attributes?.Type)) continue;
      const addr =
        c.attributes?.Place_addr ||
        [c.attributes?.City, c.attributes?.Region].filter(Boolean).join(', ') ||
        undefined;
      items.push({
        placeId: `arcgis_${c.location.y.toFixed(6)}_${c.location.x.toFixed(6)}`,
        name,
        formattedAddress: addr,
        lat: Number(c.location.y.toFixed(6)),
        lng: Number(c.location.x.toFixed(6)),
        source: 'ArcGIS Golf Directory',
        score: c.score ?? 80,
      });
    }
  }

  if (photonRes.status === 'fulfilled') {
    for (const f of photonRes.value.features ?? []) {
      const p = f.properties;
      const coords = f.geometry?.coordinates;
      if (!p || !coords || !p.name) continue;
      if (p.osm_value === 'disc_golf_course' || p.osm_value === 'miniature_golf' || isDiscGolfCourse(p.name, p.osm_value)) continue;
      const isGolf =
        p.osm_value === 'golf_course' ||
        p.name.toLowerCase().includes('golf') ||
        p.name.toLowerCase().includes('country club');
      if (!isGolf) continue;
      const addr = [p.city, p.state, p.country].filter(Boolean).join(', ');
      items.push({
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

  if (arcRes.status === 'rejected' && photonRes.status === 'rejected') {
    throw new Error('Unable to reach golf course directories');
  }

  const deduped: UnifiedCourseResponseItem[] = [];
  for (const item of items) {
    const dup = deduped.some(
      (prev) => computeDistanceMeters({ lat: prev.lat, lng: prev.lng }, { lat: item.lat, lng: item.lng }) < 650
    );
    if (!dup) deduped.push(item);
  }

  if (near) {
    const withDistances = deduped.map((c) => {
      const meters = computeDistanceMeters(near, { lat: c.lat, lng: c.lng });
      const miles = (meters / 1609.344).toFixed(1);
      return {
        ...c,
        distMeters: meters,
        formattedAddress: c.formattedAddress ? `${miles} mi · ${c.formattedAddress}` : `${miles} mi away`,
      };
    });

    const filtered = !text.trim()
      ? withDistances.filter((c) => (c.distMeters ?? 0) <= radiusMeters * 1.35)
      : withDistances;

    return filtered
      .sort((a, b) => (a.distMeters ?? 0) - (b.distMeters ?? 0))
      .slice(0, 18)
      .map(mapCandidateToCourseInfo);
  }

  return deduped.slice(0, 15).map(mapCandidateToCourseInfo);
}

export async function findNearbyCoursesOsm(
  center?: LatLngLiteral | null,
  radiusMeters = 45000
): Promise<CourseInfo[]> {
  const params = new URLSearchParams({
    radius: String(radiusMeters),
  });
  if (center) {
    params.set('lat', center.lat.toFixed(6));
    params.set('lng', center.lng.toFixed(6));
  }

  try {
    const data = await fetchJsonWithTimeout<{ courses?: UnifiedCourseResponseItem[] }>(
      `/api/osm/nearby?${params.toString()}`,
      10000
    );
    if (data.courses && data.courses.length > 0) {
      return data.courses
        .filter((c) => !isDiscGolfCourse(c.name, c.formattedAddress))
        .map(mapCandidateToCourseInfo);
    }
  } catch (err) {
    console.warn('Backend /api/osm/nearby unavailable, using direct directory fallback:', err);
  }

  if (center) {
    return queryDirectCourseDirectories('', center, radiusMeters);
  }
  return [];
}

export async function searchCoursesOsm(
  rawQuery: string,
  near?: LatLngLiteral | null
): Promise<CourseInfo[]> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
  });

  if (near) {
    const d = 1.5;
    params.set('lat', near.lat.toFixed(6));
    params.set('lng', near.lng.toFixed(6));
    params.set(
      'viewbox',
      `${(near.lng - d).toFixed(3)},${(near.lat + d).toFixed(3)},${(near.lng + d).toFixed(3)},${(near.lat - d).toFixed(3)}`
    );
  }

  try {
    const data = await fetchJsonWithTimeout<{ courses?: UnifiedCourseResponseItem[] }>(
      `/api/osm/search?${params.toString()}`,
      10000
    );
    if (data.courses && data.courses.length > 0) {
      return data.courses
        .filter((c) => !isDiscGolfCourse(c.name, c.formattedAddress))
        .map(mapCandidateToCourseInfo);
    }
  } catch (err) {
    console.warn('Backend /api/osm/search unavailable, using direct directory fallback:', err);
  }

  return queryDirectCourseDirectories(trimmed, near);
}

function toLatLngs(points?: OverpassPoint[]): LatLngLiteral[] {
  if (!points || points.length === 0) return [];
  return points.map((p) => ({ lat: p.lat, lng: p.lon }));
}

function cleanRing(pts: LatLngLiteral[]): LatLngLiteral[] {
  if (
    pts.length > 3 &&
    Math.abs(pts[0].lat - pts[pts.length - 1].lat) < 1e-7 &&
    Math.abs(pts[0].lng - pts[pts.length - 1].lng) < 1e-7
  ) {
    return pts.slice(0, -1);
  }
  return pts;
}

function stitchWaySegments(segments: LatLngLiteral[][]): LatLngLiteral[][] {
  const remaining = segments.map((s) => [...s]);
  const rings: LatLngLiteral[][] = [];

  while (remaining.length > 0) {
    const merged: LatLngLiteral[] = remaining.shift()!;
    let safety = 0;
    while (remaining.length > 0 && safety < 64) {
      safety += 1;
      const tail = merged[merged.length - 1];
      let matchedIdx = -1;
      let reverse = false;
      for (let i = 0; i < remaining.length; i += 1) {
        const seg = remaining[i];
        if (computeDistanceMeters(tail, seg[0]) < 3) {
          matchedIdx = i;
          reverse = false;
          break;
        }
        if (computeDistanceMeters(tail, seg[seg.length - 1]) < 3) {
          matchedIdx = i;
          reverse = true;
          break;
        }
      }
      if (matchedIdx === -1) break;
      const seg = remaining.splice(matchedIdx, 1)[0];
      const ordered = reverse ? [...seg].reverse() : seg;
      merged.push(...ordered.slice(1));
    }
    const cleaned = cleanRing(merged);
    if (cleaned.length >= 3) rings.push(cleaned);
  }

  return rings;
}

function extractPolygonRingsFromElement(el: OverpassElement): LatLngLiteral[][] {
  if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
    return [cleanRing(toLatLngs(el.geometry))];
  }

  if (el.type === 'relation' && el.members) {
    const outerWays = el.members
      .filter((m) => (m.role === 'outer' || m.role === '') && m.geometry && m.geometry.length >= 2)
      .map((m) => toLatLngs(m.geometry));
    if (outerWays.length === 0) return [];
    return stitchWaySegments(outerWays);
  }

  return [];
}

function extractPolygonFromElement(el: OverpassElement): LatLngLiteral[] {
  const rings = extractPolygonRingsFromElement(el);
  return rings[0] ?? [];
}

function parseHoleNumber(ref?: string, name?: string): number | null {
  const candidates = [ref, name].filter((v): v is string => Boolean(v));
  for (const val of candidates) {
    const match = val.match(/\b([1-9]|1[0-8])\b/);
    if (match) {
      const n = Number(match[1]);
      if (n >= 1 && n <= 18) return n;
    }
  }
  return null;
}

function toTitleCase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function cleanLoopLabel(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed || /^(yes|no|true|false|golf|hole)$/i.test(trimmed)) return null;
  return toTitleCase(trimmed);
}

function parseSubCoursePrefix(name?: string): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  const sepMatch = trimmed.match(/^([a-z][a-z\s&'.-]{1,28}?)\s*[-–:#]\s*(?:hole\s*)?\d+\b/i);
  if (sepMatch) {
    const raw = sepMatch[1].trim();
    if (!/^(hole|no|number|par)$/i.test(raw)) {
      return cleanLoopLabel(raw);
    }
  }
  const spaceMatch = trimmed.match(/^([a-z][a-z\s]{1,24}?)\s+(?:hole\s*#?\s*)?\d+\b/i);
  if (spaceMatch) {
    const raw = spaceMatch[1].trim();
    if (!/^(hole|no|number|green|tee|par)$/i.test(raw)) {
      return cleanLoopLabel(raw);
    }
  }
  return null;
}

function extractExplicitLoopName(tags: Record<string, string>): string | null {
  const candidates = [
    tags['golf:course:name'],
    tags['golf:course'],
    tags['course:name'],
    tags['golf:loop'],
    tags['loop'],
    tags['golf:subcourse'],
    tags['subcourse'],
    tags['section'],
    tags['course'],
  ];
  for (const cand of candidates) {
    const cleaned = cleanLoopLabel(cand);
    if (cleaned) return cleaned;
  }
  return null;
}

function parseRefLoopCode(ref?: string): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  const prefixLetter = trimmed.match(/^([A-Za-z]{1,4})[-\s]?(\d{1,2})$/);
  if (prefixLetter) {
    const n = Number(prefixLetter[2]);
    if (n >= 1 && n <= 18) return toTitleCase(prefixLetter[1]);
  }
  const suffixLetter = trimmed.match(/^(\d{1,2})([A-Za-z])$/);
  if (suffixLetter) {
    const n = Number(suffixLetter[1]);
    if (n >= 1 && n <= 18) return `Loop ${suffixLetter[2].toUpperCase()}`;
  }
  return null;
}

function parseOsmYardage(tags: Record<string, string> | undefined, path: LatLngLiteral[]): number | undefined {
  let pathMeters = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    pathMeters += computeDistanceMeters(path[i], path[i + 1]);
  }
  const pathYards = pathMeters > 30 ? Math.round(pathMeters * METERS_TO_YARDS) : undefined;

  const raw = tags?.dist || tags?.distance || tags?.yardage;
  if (!raw) return pathYards;

  const numMatch = raw.match(/(\d{2,4})/);
  if (!numMatch) return pathYards;
  const val = Number(numMatch[1]);
  const lower = raw.toLowerCase();

  if (lower.includes('yd') || lower.includes('y')) {
    return val;
  }
  if (lower.includes('m')) {
    return Math.round(val * METERS_TO_YARDS);
  }
  // If unitless, compare with path length to distinguish meters vs yards
  if (pathYards && pathMeters > 40) {
    const asYards = val;
    const asMetersInYards = Math.round(val * METERS_TO_YARDS);
    return Math.abs(asMetersInYards - pathYards) < Math.abs(asYards - pathYards)
      ? asMetersInYards
      : asYards;
  }
  return val;
}

function polygonDiagonalMeters(poly: LatLngLiteral[]): number {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of poly) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return computeDistanceMeters({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng });
}

function dedupeHolesList(
  candidates: OsmHoleFeature[],
  courseCenter: LatLngLiteral
): OsmHoleFeature[] {
  const holesMap = new Map<number, OsmHoleFeature>();
  for (const candidate of candidates) {
    const existing = holesMap.get(candidate.holeNumber);
    if (!existing) {
      holesMap.set(candidate.holeNumber, candidate);
      continue;
    }
    const sameHoleVariant =
      existing.greenCenterLatLng &&
      candidate.greenCenterLatLng &&
      computeDistanceMeters(existing.greenCenterLatLng, candidate.greenCenterLatLng) < 120;
    if (sameHoleVariant) {
      const winner = (candidate.yardage ?? 0) > (existing.yardage ?? 0) ? candidate : existing;
      const other = winner === candidate ? existing : candidate;
      holesMap.set(candidate.holeNumber, {
        ...winner,
        par: winner.par ?? other.par,
        handicap: winner.handicap ?? other.handicap,
      });
    } else {
      const candMid = candidate.path[Math.floor(candidate.path.length / 2)] ?? candidate.teeLatLng;
      const existMid = existing.path[Math.floor(existing.path.length / 2)] ?? existing.teeLatLng;
      const candDist = candMid ? computeDistanceMeters(courseCenter, candMid) : Infinity;
      const existDist = existMid ? computeDistanceMeters(courseCenter, existMid) : Infinity;
      if (candDist < existDist) {
        holesMap.set(candidate.holeNumber, candidate);
      }
    }
  }
  return Array.from(holesMap.values()).sort((a, b) => a.holeNumber - b.holeNumber);
}

function matchFeaturesToHoles(
  holes: OsmHoleFeature[],
  greens: OsmPolygonFeature[],
  bunkers: OsmPolygonFeature[],
  waters: OsmPolygonFeature[],
  fairways: OsmPolygonFeature[],
  tees: OsmPolygonFeature[]
): {
  holes: OsmHoleFeature[];
  greens: OsmPolygonFeature[];
  bunkers: OsmPolygonFeature[];
  waters: OsmPolygonFeature[];
  fairways: OsmPolygonFeature[];
  tees: OsmPolygonFeature[];
} {
  const clonedHoles = holes.map((h) => ({ ...h }));
  const clonedGreens = greens.map((g) => ({ ...g }));
  const clonedBunkers = bunkers.map((b) => ({ ...b }));
  const clonedWaters = waters.map((w) => ({ ...w }));

  for (const green of clonedGreens) {
    let bestHole: OsmHoleFeature | null = null;
    let bestDist = 75;
    for (const h of clonedHoles) {
      const refPt = h.greenCenterLatLng ?? h.path[h.path.length - 1];
      if (!refPt) continue;
      const d = computeDistanceMeters(green.center, refPt);
      if (d < bestDist) {
        bestDist = d;
        bestHole = h;
      }
    }
    if (bestHole) {
      green.holeNumber = bestHole.holeNumber;
      green.label = `Hole ${bestHole.holeNumber} Green`;
      bestHole.greenCenterLatLng = green.center;
    }
  }

  const assignHazards = (items: OsmPolygonFeature[]) => {
    for (const item of items) {
      let bestHoleNum: number | undefined;
      let bestDist = 95;
      for (const h of clonedHoles) {
        const dLine = pointToPolylineMinDistanceMeters(item.center, h.path);
        const dGreen = h.greenCenterLatLng
          ? computeDistanceMeters(item.center, h.greenCenterLatLng)
          : Infinity;
        const d = Math.min(dLine, dGreen);
        if (d < bestDist) {
          bestDist = d;
          bestHoleNum = h.holeNumber;
        }
      }
      if (bestHoleNum !== undefined) {
        item.holeNumber = bestHoleNum;
      }
    }
  };

  assignHazards(clonedBunkers);
  assignHazards(clonedWaters);

  return {
    holes: clonedHoles,
    greens: clonedGreens,
    bunkers: clonedBunkers,
    waters: clonedWaters,
    fairways,
    tees,
  };
}

export function getCachedOsmCourseGeometry(courseId: string): OsmCourseGeometry | null {
  try {
    const raw = localStorage.getItem(`${GEOMETRY_CACHE_PREFIX}${courseId}`);
    if (!raw) return null;
    return JSON.parse(raw) as OsmCourseGeometry;
  } catch {
    return null;
  }
}

export function saveCachedOsmCourseGeometry(geometry: OsmCourseGeometry): void {
  try {
    localStorage.setItem(`${GEOMETRY_CACHE_PREFIX}${geometry.courseId}`, JSON.stringify(geometry));
  } catch {
    // Ignore storage quota errors
  }
}

function shiftHoleNumber<T extends { holeNumber?: number }>(item: T, offset: number): T {
  if (item.holeNumber === undefined) return item;
  return { ...item, holeNumber: item.holeNumber + offset };
}

export function filterGeometryForSubCourse(
  geometry: OsmCourseGeometry,
  subCourseId?: string
): OsmCourseGeometry {
  if (!subCourseId || !geometry.subCourses?.length) return geometry;

  if (subCourseId.startsWith('combo__')) {
    const [, frontId, backId] = subCourseId.split('__');
    const front = geometry.subCourses.find((s) => s.id === frontId);
    const back = geometry.subCourses.find((s) => s.id === backId);
    if (front && back) {
      return {
        ...geometry,
        holes: [
          ...front.holes.filter((h) => h.holeNumber <= 9),
          ...back.holes
            .filter((h) => h.holeNumber <= 9)
            .map((h) => ({ ...h, holeNumber: h.holeNumber + 9 })),
        ],
        greens: [
          ...front.greens.filter((g) => !g.holeNumber || g.holeNumber <= 9),
          ...back.greens
            .filter((g) => !g.holeNumber || g.holeNumber <= 9)
            .map((g) => {
              const shifted = shiftHoleNumber(g, 9);
              return shifted.holeNumber
                ? { ...shifted, label: `Hole ${shifted.holeNumber} Green` }
                : shifted;
            }),
        ],
        bunkers: [
          ...front.bunkers.filter((b) => !b.holeNumber || b.holeNumber <= 9),
          ...back.bunkers
            .filter((b) => !b.holeNumber || b.holeNumber <= 9)
            .map((b) => shiftHoleNumber(b, 9)),
        ],
        waters: [
          ...front.waters.filter((w) => !w.holeNumber || w.holeNumber <= 9),
          ...back.waters
            .filter((w) => !w.holeNumber || w.holeNumber <= 9)
            .map((w) => shiftHoleNumber(w, 9)),
        ],
        fairways: front.fairways,
        tees: front.tees,
      };
    }
  }

  const sub = geometry.subCourses.find((s) => s.id === subCourseId);
  if (!sub) return geometry;
  return {
    ...geometry,
    holes: sub.holes,
    greens: sub.greens,
    bunkers: sub.bunkers,
    waters: sub.waters,
    fairways: sub.fairways,
    tees: sub.tees,
  };
}

export async function fetchCourseGolfGeometry(
  course: CourseInfo,
  forceRefresh = false
): Promise<OsmCourseGeometry> {
  const baseCourseId = course.placeId.split('__')[0];

  if (!forceRefresh) {
    const cached = getCachedOsmCourseGeometry(baseCourseId);
    if (cached && Date.now() - cached.fetchedAt < 1000 * 60 * 60 * 24 * 14) {
      return course.subCourseId ? filterGeometryForSubCourse(cached, course.subCourseId) : cached;
    }
  }

  let elements: OverpassElement[] = [];
  try {
    const res = await fetch('/api/osm/course-geometry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lat: course.location.lat,
        lng: course.location.lng,
        forceRefresh,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { elements?: OverpassElement[] };
      elements = Array.isArray(data.elements) ? data.elements : [];
    }
  } catch (err) {
    console.warn('Could not sync live OSM geometry, checking cache or using empty geometry:', err);
  }

  if (elements.length === 0) {
    const cached = getCachedOsmCourseGeometry(baseCourseId);
    if (cached) {
      return course.subCourseId ? filterGeometryForSubCourse(cached, course.subCourseId) : cached;
    }
  }

  // 1. Identify course boundary multipolygon rings (leisure=golf_course) & parent course relations
  const wayRelationLoopName = new Map<number, string>();
  const courseBoundaries: Array<{
    id: string;
    rawName: string;
    name: string;
    rings: LatLngLiteral[][];
    containsCoursePoint: boolean;
  }> = [];

  for (const el of elements) {
    if (
      el.type === 'relation' &&
      (el.tags?.golf === 'course' || el.tags?.leisure === 'golf_course') &&
      el.tags?.name &&
      el.members
    ) {
      const relLabel = cleanLoopLabel(el.tags.name);
      if (relLabel) {
        for (const m of el.members) {
          if (m.type === 'way' && (m.role === '' || m.role === 'hole')) {
            wayRelationLoopName.set(m.ref, relLabel);
          }
        }
      }
    }

    if (el.tags?.leisure !== 'golf_course') continue;
    const rings = extractPolygonRingsFromElement(el);
    if (rings.length === 0) continue;
    courseBoundaries.push({
      id: `osm_${el.type}_${el.id}`,
      rawName: (el.tags?.name ?? '').trim(),
      name: (el.tags?.name ?? '').toLowerCase(),
      rings,
      containsCoursePoint: rings.some((poly) => isPointInPolygon(course.location, poly)),
    });
  }

  let selectedBoundaries: typeof courseBoundaries = [];
  if (courseBoundaries.length > 0) {
    const exactId = courseBoundaries.find((b) => b.id === baseCourseId);
    const targetNameLower = course.name
      .split('—')[0]
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/golf (course|club|links)/g, '')
      .trim();
    const firstWord = targetNameLower.split(/\s+/).find((w) => w.length >= 4);

    const byPointAndName = courseBoundaries.find(
      (b) => b.containsCoursePoint && targetNameLower && b.name.includes(targetNameLower)
    );
    const byName = targetNameLower
      ? courseBoundaries.find((b) => b.name.includes(targetNameLower))
      : undefined;
    const byPoint = courseBoundaries.find((b) => b.containsCoursePoint);

    let closestNearEdge: (typeof courseBoundaries)[number] | undefined;
    if (!exactId && !byPointAndName && !byName && !byPoint) {
      let bestDist = 450;
      for (const b of courseBoundaries) {
        for (const poly of b.rings) {
          const ring = [...poly, poly[0]];
          const d = pointToPolylineMinDistanceMeters(course.location, ring);
          if (d <= bestDist) {
            bestDist = d;
            closestNearEdge = b;
          }
        }
      }
    }

    const primary = exactId ?? byPointAndName ?? byName ?? byPoint ?? closestNearEdge;
    if (primary) {
      selectedBoundaries = [primary];
      // Include sibling facility polygons that share the facility prefix (e.g. Championship + Par 3)
      if (firstWord) {
        for (const b of courseBoundaries) {
          if (b.id !== primary.id && b.name.includes(firstWord)) {
            selectedBoundaries.push(b);
          }
        }
      }
    }
  }

  const courseBoundaryRings: LatLngLiteral[][] | null =
    selectedBoundaries.length > 0 ? selectedBoundaries.flatMap((b) => b.rings) : null;

  const isInsideSelectedCourse = (pt: LatLngLiteral): boolean => {
    if (!courseBoundaryRings || courseBoundaryRings.length === 0) return true;
    return courseBoundaryRings.some((poly) => isPointInPolygon(pt, poly));
  };

  const findBoundaryNameForPoint = (pt: LatLngLiteral): string | null => {
    if (selectedBoundaries.length < 2) return null;
    for (const b of selectedBoundaries) {
      if (b.rings.some((poly) => isPointInPolygon(pt, poly)) && b.rawName) {
        return cleanLoopLabel(b.rawName);
      }
    }
    return null;
  };

  const rawHoleCandidates: Array<{
    loopName: string | null;
    refLoopName: string | null;
    hole: OsmHoleFeature;
  }> = [];
  const greens: OsmPolygonFeature[] = [];
  const bunkers: OsmPolygonFeature[] = [];
  const waters: OsmPolygonFeature[] = [];
  const fairways: OsmPolygonFeature[] = [];
  const tees: OsmPolygonFeature[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    if (tags.leisure === 'golf_course') continue;
    const golfTag = tags.golf;

    if (golfTag === 'hole' && el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const holeNumber = parseHoleNumber(tags.ref, tags.name);
      if (!holeNumber) continue;

      const path = toLatLngs(el.geometry);
      const teeLatLng = path[0];
      const greenCenterLatLng = path[path.length - 1];
      const midPt = path[Math.floor(path.length / 2)];
      if (
        courseBoundaryRings &&
        !isInsideSelectedCourse(teeLatLng) &&
        !isInsideSelectedCourse(greenCenterLatLng) &&
        !isInsideSelectedCourse(midPt)
      ) {
        continue;
      }

      const parNum = Number(tags.par);
      const hcpNum = Number(tags.handicap);
      const yardage = parseOsmYardage(tags, path);
      const loopName =
        extractExplicitLoopName(tags) ??
        wayRelationLoopName.get(el.id) ??
        parseSubCoursePrefix(tags.name) ??
        findBoundaryNameForPoint(midPt);
      const refLoopName = parseRefLoopCode(tags.ref);

      rawHoleCandidates.push({
        loopName,
        refLoopName,
        hole: {
          holeNumber,
          par: parNum >= 3 && parNum <= 6 ? parNum : undefined,
          handicap: hcpNum >= 1 && hcpNum <= 18 ? hcpNum : undefined,
          yardage,
          name: tags.name,
          path,
          teeLatLng,
          greenCenterLatLng,
        },
      });
      continue;
    }

    const polygon = extractPolygonFromElement(el);
    if (polygon.length < 3) continue;

    // Skip massive non-course lakes/rivers/bays tagged natural=water
    if (!golfTag && tags.natural === 'water' && polygonDiagonalMeters(polygon) > 450) {
      continue;
    }

    const center = computePolygonCentroid(polygon);
    if (courseBoundaryRings && !isInsideSelectedCourse(center)) {
      continue;
    }
    const id = `osm_${el.type}_${el.id}`;
    const holeRef = parseHoleNumber(tags.ref, tags.name) ?? undefined;

    let kind: OsmFeatureKind | null = null;
    let label = 'Feature';

    if (golfTag === 'green') {
      kind = 'green';
      label = holeRef ? `Hole ${holeRef} Green` : 'Green';
      greens.push({ id, kind, label, holeNumber: holeRef, polygon, center });
    } else if (golfTag === 'bunker') {
      kind = 'bunker';
      label = tags.name || 'Bunker';
      bunkers.push({ id, kind, label, holeNumber: holeRef, polygon, center });
    } else if (
      golfTag === 'water_hazard' ||
      golfTag === 'lateral_water_hazard' ||
      tags.natural === 'water'
    ) {
      kind = 'water';
      label = tags.name || (golfTag === 'lateral_water_hazard' ? 'Lateral Water' : 'Water');
      waters.push({ id, kind, label, holeNumber: holeRef, polygon, center });
    } else if (golfTag === 'fairway') {
      kind = 'fairway';
      label = tags.name || 'Fairway';
      fairways.push({ id, kind, label, holeNumber: holeRef, polygon, center });
    } else if (golfTag === 'tee') {
      kind = 'tee';
      label = tags.name || 'Tee';
      tees.push({ id, kind, label, holeNumber: holeRef, polygon, center });
    }
  }

  // Group holes by named sub-course loop (e.g. "Blue Spruce"/"White Birch"/"Red Pines" or "Gold"/"Silver")
  const loopGroups = new Map<string, OsmHoleFeature[]>();
  for (const entry of rawHoleCandidates) {
    if (!entry.loopName) continue;
    const arr = loopGroups.get(entry.loopName) ?? [];
    arr.push(entry.hole);
    loopGroups.set(entry.loopName, arr);
  }

  let qualifyingLoops = Array.from(loopGroups.entries())
    .map(([name, list]) => ({
      name,
      holes: dedupeHolesList(list, course.location),
    }))
    .filter((loop) => loop.holes.length >= 6)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Fallback: check ref-letter loop prefixes (e.g. A1..A9 / B1..B9) if no named loops matched
  if (qualifyingLoops.length < 2) {
    const refGroups = new Map<string, OsmHoleFeature[]>();
    for (const entry of rawHoleCandidates) {
      if (!entry.refLoopName) continue;
      const arr = refGroups.get(entry.refLoopName) ?? [];
      arr.push(entry.hole);
      refGroups.set(entry.refLoopName, arr);
    }
    const refLoops = Array.from(refGroups.entries())
      .map(([name, list]) => ({
        name,
        holes: dedupeHolesList(list, course.location),
      }))
      .filter((loop) => loop.holes.length >= 6)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (refLoops.length >= 2) {
      qualifyingLoops = refLoops;
    }
  }

  let subCourses: OsmSubCourse[] | undefined;
  if (qualifyingLoops.length >= 2) {
    subCourses = qualifyingLoops.map((loop) => {
      const matched = matchFeaturesToHoles(
        loop.holes,
        greens,
        bunkers,
        waters,
        fairways,
        tees
      );
      return {
        id: loop.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        name: loop.name,
        ...matched,
      };
    });
  }

  const defaultHoles = dedupeHolesList(
    rawHoleCandidates.map((c) => c.hole),
    course.location
  );
  const matchedDefault = matchFeaturesToHoles(
    defaultHoles,
    greens,
    bunkers,
    waters,
    fairways,
    tees
  );

  const fullGeometry: OsmCourseGeometry = {
    courseId: baseCourseId,
    fetchedAt: Date.now(),
    ...matchedDefault,
    subCourses,
  };

  saveCachedOsmCourseGeometry(fullGeometry);
  return course.subCourseId
    ? filterGeometryForSubCourse(fullGeometry, course.subCourseId)
    : fullGeometry;
}

export function summarizeOsmGeometry(geometry: OsmCourseGeometry): OsmCourseSummary {
  return {
    holesMapped: geometry.holes.length,
    greens: geometry.greens.length,
    bunkers: geometry.bunkers.length,
    waters: geometry.waters.length,
  };
}

export function applyOsmGeometryToHoles(
  geometry: OsmCourseGeometry
): Record<number, HolePinData> {
  const holes: Record<number, HolePinData> = {};

  for (let i = 1; i <= 18; i += 1) {
    const def = DEFAULT_PAR_LAYOUT[i - 1];
    const osmHole = geometry.holes.find((h) => h.holeNumber === i);
    const osmGreen = geometry.greens.find((g) => g.holeNumber === i);

    const teeLatLng = osmHole?.teeLatLng;
    const greenCenterLatLng = osmGreen?.center ?? osmHole?.greenCenterLatLng;
    const computedYards =
      teeLatLng && greenCenterLatLng
        ? computeDistanceYards(teeLatLng, greenCenterLatLng)
        : undefined;

    holes[i] = {
      holeNumber: i,
      par: osmHole?.par ?? def.par,
      handicap: osmHole?.handicap ?? def.handicap,
      yardage: osmHole?.yardage ?? computedYards ?? def.yardage,
      teeLatLng,
      greenCenterLatLng,
      greenPolygon: osmGreen?.polygon,
      hazards: [],
    };
  }

  return holes;
}

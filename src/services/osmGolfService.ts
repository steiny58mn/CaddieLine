import {
  CourseInfo,
  HolePinData,
  LatLngLiteral,
  OsmCourseGeometry,
  OsmCourseSummary,
  OsmFeatureKind,
  OsmHoleFeature,
  OsmPolygonFeature,
} from '../types/golf';
import {
  DEFAULT_PAR_LAYOUT,
  computeDistanceMeters,
  computeDistanceYards,
  computePolygonCentroid,
  isPointInPolygon,
  pointToPolylineMinDistanceMeters,
} from '../utils/golfMath';

const GEOMETRY_CACHE_PREFIX = 'caddieline_osm_geom_v3_';
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
  };
}

export async function findNearbyCoursesOsm(
  center: LatLngLiteral,
  radiusMeters = 45000
): Promise<CourseInfo[]> {
  const params = new URLSearchParams({
    lat: center.lat.toFixed(6),
    lng: center.lng.toFixed(6),
    radius: String(radiusMeters),
  });
  const res = await fetch(`/api/osm/nearby?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Nearby search failed (HTTP ${res.status})`);
  }
  const { courses } = (await res.json()) as { courses?: UnifiedCourseResponseItem[] };
  return (courses ?? []).map(mapCandidateToCourseInfo);
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

  const res = await fetch(`/api/osm/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Course search failed (HTTP ${res.status})`);
  }

  const { courses } = (await res.json()) as { courses?: UnifiedCourseResponseItem[] };
  return (courses ?? []).map(mapCandidateToCourseInfo);
}

function toLatLngs(points?: OverpassPoint[]): LatLngLiteral[] {
  if (!points || points.length === 0) return [];
  return points.map((p) => ({ lat: p.lat, lng: p.lon }));
}

function extractPolygonFromElement(el: OverpassElement): LatLngLiteral[] {
  if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
    const pts = toLatLngs(el.geometry);
    // Remove closing duplicate vertex if present
    if (
      pts.length > 3 &&
      Math.abs(pts[0].lat - pts[pts.length - 1].lat) < 1e-7 &&
      Math.abs(pts[0].lng - pts[pts.length - 1].lng) < 1e-7
    ) {
      return pts.slice(0, -1);
    }
    return pts;
  }

  if (el.type === 'relation' && el.members) {
    const outerWays = el.members
      .filter((m) => (m.role === 'outer' || m.role === '') && m.geometry && m.geometry.length >= 2)
      .map((m) => toLatLngs(m.geometry));
    if (outerWays.length === 0) return [];
    // Pick the largest/first outer ring (stitch simple contiguous segments if split)
    if (outerWays.length === 1) {
      const pts = outerWays[0];
      return pts.length > 3 ? pts.slice(0, -1) : pts;
    }
    const merged: LatLngLiteral[] = [...outerWays[0]];
    const remaining = outerWays.slice(1);
    let safety = 0;
    while (remaining.length > 0 && safety < 32) {
      safety += 1;
      const tail = merged[merged.length - 1];
      let matchedIdx = -1;
      let reverse = false;
      for (let i = 0; i < remaining.length; i += 1) {
        const seg = remaining[i];
        if (computeDistanceMeters(tail, seg[0]) < 2) {
          matchedIdx = i;
          reverse = false;
          break;
        }
        if (computeDistanceMeters(tail, seg[seg.length - 1]) < 2) {
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
    if (merged.length >= 3) return merged;
  }

  return [];
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

export async function fetchCourseGolfGeometry(
  course: CourseInfo,
  forceRefresh = false
): Promise<OsmCourseGeometry> {
  if (!forceRefresh) {
    const cached = getCachedOsmCourseGeometry(course.placeId);
    if (cached && Date.now() - cached.fetchedAt < 1000 * 60 * 60 * 24 * 14) {
      return cached;
    }
  }

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

  if (!res.ok) {
    throw new Error(`OSM sync failed (HTTP ${res.status})`);
  }

  const { elements } = (await res.json()) as { elements: OverpassElement[] };

  // 1. Identify the selected course boundary polygon (leisure=golf_course) so adjacent courses are excluded
  let courseBoundary: LatLngLiteral[] | null = null;
  const courseBoundaries: Array<{
    id: string;
    name: string;
    polygon: LatLngLiteral[];
    containsCoursePoint: boolean;
  }> = [];

  for (const el of elements) {
    if (el.tags?.leisure !== 'golf_course') continue;
    const poly = extractPolygonFromElement(el);
    if (poly.length < 3) continue;
    courseBoundaries.push({
      id: `osm_${el.type}_${el.id}`,
      name: (el.tags?.name ?? '').toLowerCase(),
      polygon: poly,
      containsCoursePoint: isPointInPolygon(course.location, poly),
    });
  }

  if (courseBoundaries.length > 0) {
    const exactId = courseBoundaries.find((b) => b.id === course.placeId);
    const targetNameLower = course.name
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/golf (course|club|links)/g, '')
      .trim();
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
        const ring = [...b.polygon, b.polygon[0]];
        const d = pointToPolylineMinDistanceMeters(course.location, ring);
        if (d <= bestDist) {
          bestDist = d;
          closestNearEdge = b;
        }
      }
    }

    courseBoundary = (exactId ?? byPointAndName ?? byName ?? byPoint ?? closestNearEdge)?.polygon ?? null;
  }

  const isInsideSelectedCourse = (pt: LatLngLiteral): boolean => {
    if (!courseBoundary) return true;
    return isPointInPolygon(pt, courseBoundary);
  };

  const holesMap = new Map<number, OsmHoleFeature>();
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
        courseBoundary &&
        !isInsideSelectedCourse(teeLatLng) &&
        !isInsideSelectedCourse(greenCenterLatLng) &&
        !isInsideSelectedCourse(midPt)
      ) {
        continue;
      }

      const parNum = Number(tags.par);
      const hcpNum = Number(tags.handicap);
      const yardage = parseOsmYardage(tags, path);

      const candidate: OsmHoleFeature = {
        holeNumber,
        par: parNum >= 3 && parNum <= 6 ? parNum : undefined,
        handicap: hcpNum >= 1 && hcpNum <= 18 ? hcpNum : undefined,
        yardage,
        name: tags.name,
        path,
        teeLatLng,
        greenCenterLatLng,
      };

      const existing = holesMap.get(holeNumber);
      if (!existing) {
        holesMap.set(holeNumber, candidate);
      } else {
        const sameHoleVariant =
          existing.greenCenterLatLng &&
          computeDistanceMeters(existing.greenCenterLatLng, greenCenterLatLng) < 120;
        if (sameHoleVariant) {
          if ((candidate.yardage ?? 0) > (existing.yardage ?? 0)) {
            holesMap.set(holeNumber, candidate);
          }
        } else {
          // Different holes with same number: prefer the one closer to the course center
          const candDist = computeDistanceMeters(course.location, midPt);
          const existMid = existing.path[Math.floor(existing.path.length / 2)] ?? existing.teeLatLng;
          const existDist = existMid ? computeDistanceMeters(course.location, existMid) : Infinity;
          if (candDist < existDist) {
            holesMap.set(holeNumber, candidate);
          }
        }
      }
      continue;
    }

    const polygon = extractPolygonFromElement(el);
    if (polygon.length < 3) continue;

    // Skip massive non-course lakes/rivers/bays tagged natural=water
    if (!golfTag && tags.natural === 'water' && polygonDiagonalMeters(polygon) > 450) {
      continue;
    }

    const center = computePolygonCentroid(polygon);
    if (courseBoundary && !isInsideSelectedCourse(center)) {
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

  const holes = Array.from(holesMap.values()).sort((a, b) => a.holeNumber - b.holeNumber);

  // Match greens to holes
  for (const green of greens) {
    if (green.holeNumber) continue;
    let bestHole: OsmHoleFeature | null = null;
    let bestDist = 75;
    for (const h of holes) {
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

  // Match bunkers & water hazards to nearest hole centerline / green
  const assignHazards = (items: OsmPolygonFeature[]) => {
    for (const item of items) {
      if (item.holeNumber) continue;
      let bestHoleNum: number | undefined;
      let bestDist = 95;
      for (const h of holes) {
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

  assignHazards(bunkers);
  assignHazards(waters);

  const geometry: OsmCourseGeometry = {
    courseId: course.placeId,
    fetchedAt: Date.now(),
    holes,
    greens,
    bunkers,
    waters,
    fairways,
    tees,
  };

  saveCachedOsmCourseGeometry(geometry);
  return geometry;
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

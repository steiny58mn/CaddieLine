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
const CACHE_TTL_MS = 1000 * 60 * 30;

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

async function queryOverpassServer(ql: string): Promise<{ elements: OverpassElement[]; endpoint: string }> {
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
        18000
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

// Fallback: fetch raw OSM v0.6 map.json tiles directly from openstreetmap.org and assemble way/relation geometries
async function fetchViaOsmMapApi(lat: number, lng: number): Promise<OverpassElement[]> {
  const halfSpanLat = 0.011;
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  const halfSpanLng = 0.011 / cosLat;

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
        // Ignore single tile failure so remaining tiles still render
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
[out:json][timeout:15];
(
  way["leisure"="golf_course"](around:500,${lat.toFixed(6)},${lng.toFixed(6)});
  relation["leisure"="golf_course"](around:500,${lat.toFixed(6)},${lng.toFixed(6)});
  way["golf"](around:2000,${lat.toFixed(6)},${lng.toFixed(6)});
  relation["golf"](around:2000,${lat.toFixed(6)},${lng.toFixed(6)});
  way["natural"="water"](around:1400,${lat.toFixed(6)},${lng.toFixed(6)});
);
out geom;
`.trim();

    try {
      const { elements, endpoint } = await queryOverpassServer(ql);
      geometryCache.set(cacheKey, { timestamp: Date.now(), elements, source: endpoint });
      res.json({ elements, source: endpoint });
      return;
    } catch (overpassErr) {
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
      } catch (fallbackErr) {
        const msg =
          overpassErr instanceof Error ? overpassErr.message : String(fallbackErr);
        res.status(502).json({ error: `OSM geometry unavailable: ${msg}` });
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
      .replace(/\b(golf|course|club|links|country|resort)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function deduplicateCourses(items: UnifiedCourseCandidate[]): UnifiedCourseCandidate[] {
    const out: UnifiedCourseCandidate[] = [];
    for (const item of items) {
      const norm = normalizeCourseName(item.name);
      const existingIdx = out.findIndex((prev) => {
        const dist = haversineMeters(prev.lat, prev.lng, item.lat, item.lng);
        if (dist < 650) return true;
        if (dist < 2200 && norm && norm === normalizeCourseName(prev.name)) return true;
        return false;
      });
      if (existingIdx === -1) {
        out.push(item);
      } else {
        const prev = out[existingIdx];
        const prevHasStreet = Boolean(prev.formattedAddress && /\d/.test(prev.formattedAddress));
        const itemHasStreet = Boolean(item.formattedAddress && /\d/.test(item.formattedAddress));
        if ((!prevHasStreet && itemHasStreet) || (prevHasStreet === itemHasStreet && item.score > prev.score)) {
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
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Math.min(80000, Math.max(5000, Number(req.query.radius) || 45000));

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'Invalid coordinates' });
      return;
    }

    const ql = `
[out:json][timeout:14];
(
  nwr["leisure"="golf_course"](around:${radius},${lat.toFixed(6)},${lng.toFixed(6)});
);
out center 35;
`.trim();

    const [arcResult, osmResult] = await Promise.allSettled([
      queryArcGisGolfCourses('', { lat, lng }, 20),
      queryOverpassServer(ql),
    ]);

    const combined: UnifiedCourseCandidate[] = [];
    if (arcResult.status === 'fulfilled') {
      combined.push(...arcResult.value);
    }

    if (osmResult.status === 'fulfilled') {
      for (const el of osmResult.value.elements) {
        const elLat = el.center?.lat ?? el.lat;
        const elLng = el.center?.lon ?? el.lon;
        if (elLat === undefined || elLng === undefined) continue;
        const name = el.tags?.name?.trim();
        if (!name) continue;
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
          score: 85,
        });
      }
    }

    const deduped = deduplicateCourses(combined)
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

    res.json({ courses: deduped });
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

    const [arcRes, nomRes, photonRes] = await Promise.allSettled([
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
    ]);

    const combined: UnifiedCourseCandidate[] = [];

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
        const isGolf =
          item.type === 'golf_course' ||
          item.class === 'leisure' ||
          item.display_name.toLowerCase().includes('golf');
        if (!isGolf) continue;
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
        const parts = item.display_name.split(',').map((s) => s.trim());
        combined.push({
          placeId:
            item.osm_type && item.osm_id
              ? `osm_${item.osm_type}_${item.osm_id}`
              : `osm_nom_${item.place_id}`,
          name: item.name?.trim() || parts[0] || 'Golf Course',
          formattedAddress: parts.slice(1, 4).join(', ') || undefined,
          lat,
          lng,
          source: 'OpenStreetMap',
          score: 88,
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

    const deduped = deduplicateCourses(combined)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    res.json({ courses: deduped });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
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
    console.log(`CaddieLine server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crosshair,
  Flag,
  Layers,
  MapPin,
  RefreshCw,
  Search,
  Sliders,
  Sparkles,
} from 'lucide-react';
import {
  Club,
  CourseInfo,
  DistanceUnit,
  HazardPinType,
  HoleHazardPin,
  HolePinData,
  HoleScoreState,
  LatLngLiteral,
  MapTapMode,
  OsmCourseGeometry,
  OsmPolygonFeature,
  RoundHoleMode,
  ShotRecord,
} from '../types/golf';
import {
  computeDistanceMeters,
  computeDistanceYards,
  computePolygonFrontCenterBack,
  formatDistanceValue,
  getNextHoleNumber,
  getPrevHoleNumber,
  getLieMeta,
  isHazardInPlayCorridor,
  recommendClub,
  unitSuffix,
} from '../utils/golfMath';

interface OpenGolfHoleMapProps {
  course: CourseInfo | null;
  courseGeometry: OsmCourseGeometry | null;
  isLoadingGeometry?: boolean;
  geometryError?: string | null;
  holeData: HolePinData;
  allHoles: Record<number, HolePinData>;
  allScores: Record<number, HoleScoreState>;
  shots: ShotRecord[];
  unit: DistanceUnit;
  holeMode?: RoundHoleMode;
  onToggleHoleMode?: (mode: RoundHoleMode) => void;
  bag: Club[];
  playerPosition: LatLngLiteral | null;
  gpsStatus?: string;
  gpsAccuracyMeters?: number | null;
  isManualPosition?: boolean;
  tapMode: MapTapMode;
  targetPin: LatLngLiteral | null;
  onSelectHole: (holeNumber: number) => void;
  onChangeTapMode: (mode: MapTapMode) => void;
  onSetTargetPin: (pin: LatLngLiteral | null) => void;
  onSetManualPlayerPos: (pos: LatLngLiteral) => void;
  onResumeLiveGps: () => void;
  onUpdateHolePins: (patch: Partial<HolePinData>) => void;
  onQuickLogFromMap: (pin: LatLngLiteral, startOrigin?: LatLngLiteral | null, distanceYards?: number | null) => void;
  onOpenCourseSearch?: () => void;
  onRefreshOsmCourse?: () => void;
  onFlipToStats?: () => void;
}

interface ComputedHazardDistance {
  id: string;
  kind: 'bunker' | 'water' | 'manual';
  label: string;
  carryYards: number;
  clearYards: number | null;
  frontPoint: LatLngLiteral;
  backPoint: LatLngLiteral;
  center?: LatLngLiteral;
}

const DEFAULT_MAP_CENTER: LatLngLiteral = { lat: 44.9778, lng: -93.265 }; // Default fallback

function toLatLngTuples(points: LatLngLiteral[]): L.LatLngTuple[] {
  return points.map((p) => [p.lat, p.lng]);
}

function createBadgeIcon(html: string, size: [number, number], anchor: [number, number]): L.DivIcon {
  return L.divIcon({
    className: 'custom-leaflet-badge',
    html,
    iconSize: size,
    iconAnchor: anchor,
  });
}

export const OpenGolfHoleMap: React.FC<OpenGolfHoleMapProps> = ({
  course,
  courseGeometry,
  isLoadingGeometry = false,
  geometryError = null,
  holeData,
  allHoles,
  allScores,
  shots,
  unit,
  holeMode = '18',
  onToggleHoleMode,
  bag,
  playerPosition,
  gpsStatus,
  gpsAccuracyMeters,
  isManualPosition = false,
  tapMode,
  targetPin,
  onSelectHole,
  onChangeTapMode,
  onSetTargetPin,
  onSetManualPlayerPos,
  onResumeLiveGps,
  onUpdateHolePins,
  onQuickLogFromMap,
  onOpenCourseSearch,
  onRefreshOsmCourse,
  onFlipToStats,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const osmLayerRef = useRef<L.TileLayer | null>(null);
  const vectorsLayerRef = useRef<L.LayerGroup | null>(null);
  const linesLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const targetLineFromOriginRef = useRef<L.Polyline | null>(null);
  const targetLineToGreenRef = useRef<L.Polyline | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const isDraggingTargetRef = useRef<boolean>(false);

  const [baseLayer, setBaseLayer] = useState<'satellite' | 'osm'>('satellite');
  const [hazardType, setHazardType] = useState<HazardPinType>('bunker');
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);
  const [isHazardsMenuOpen, setIsHazardsMenuOpen] = useState<boolean>(false);
  const [hazardsExpanded, setHazardsExpanded] = useState<boolean>(true);
  const [isHolePickerOpen, setIsHolePickerOpen] = useState<boolean>(false);
  const suffix = unitSuffix(unit);
  const lastFitKeyRef = useRef<string>('');

  const tapModeRef = useRef(tapMode);
  tapModeRef.current = tapMode;

  const currentOsmHole = useMemo(
    () => courseGeometry?.holes.find((h) => h.holeNumber === holeData.holeNumber) ?? null,
    [courseGeometry, holeData.holeNumber]
  );

  const activeTeeLatLng = useMemo(
    () => holeData.teeLatLng ?? currentOsmHole?.teeLatLng ?? null,
    [holeData.teeLatLng, currentOsmHole?.teeLatLng]
  );

  // Determine if real GPS is off-course (> 1200m from course) so remote viewing defaults cleanly to the course
  const isGpsOffCourse = useMemo(() => {
    if (!playerPosition || isManualPosition) return false;
    const refPoint = activeTeeLatLng ?? holeData.greenCenterLatLng ?? course?.location;
    if (!refPoint) return false;
    return computeDistanceMeters(playerPosition, refPoint) > 1200;
  }, [playerPosition, isManualPosition, activeTeeLatLng, holeData.greenCenterLatLng, course?.location]);

  // "Where I am standing" origin for all live green/bunker/water yardages
  const effectiveOrigin: LatLngLiteral | null = useMemo(() => {
    if (isManualPosition && playerPosition) return playerPosition;
    const lastShotWithEnd = [...shots].reverse().find((s) => s.endLatLng);
    if (lastShotWithEnd?.endLatLng) return lastShotWithEnd.endLatLng;
    if (playerPosition && !isGpsOffCourse) return playerPosition;
    if (activeTeeLatLng) return activeTeeLatLng;
    if (holeData.teeLatLng) return holeData.teeLatLng;
    if (playerPosition) return playerPosition;
    return course?.location ?? null;
  }, [
    isManualPosition,
    playerPosition,
    isGpsOffCourse,
    shots,
    activeTeeLatLng,
    holeData.teeLatLng,
    course?.location,
  ]);

  // Find active green polygon (matched to current hole, or nearest green on partial OSM courses)
  const { activeGreenPolygon, activeGreenCenter, isNearestFallbackGreen } = useMemo(() => {
    if (holeData.greenPolygon && holeData.greenPolygon.length >= 3) {
      return {
        activeGreenPolygon: holeData.greenPolygon,
        activeGreenCenter: holeData.greenCenterLatLng,
        isNearestFallbackGreen: false,
      };
    }

    if (courseGeometry) {
      const holeGreen = courseGeometry.greens.find((g) => g.holeNumber === holeData.holeNumber);
      if (holeGreen) {
        return {
          activeGreenPolygon: holeGreen.polygon,
          activeGreenCenter: holeData.greenCenterLatLng ?? holeGreen.center,
          isNearestFallbackGreen: false,
        };
      }

      if (currentOsmHole?.greenCenterLatLng) {
        return {
          activeGreenPolygon: undefined,
          activeGreenCenter: currentOsmHole.greenCenterLatLng,
          isNearestFallbackGreen: false,
        };
      }

      // If hole ways weren't mapped on OSM, snap to the nearest green within 600m
      if (!holeData.greenCenterLatLng && courseGeometry.greens.length > 0 && effectiveOrigin) {
        let best: OsmPolygonFeature | null = null;
        let bestDist = 650;
        for (const g of courseGeometry.greens) {
          const d = computeDistanceMeters(effectiveOrigin, g.center);
          if (d < bestDist) {
            bestDist = d;
            best = g;
          }
        }
        if (best) {
          return {
            activeGreenPolygon: best.polygon,
            activeGreenCenter: best.center,
            isNearestFallbackGreen: true,
          };
        }
      }
    }

    return {
      activeGreenPolygon: undefined,
      activeGreenCenter: holeData.greenCenterLatLng ?? currentOsmHole?.greenCenterLatLng,
      isNearestFallbackGreen: false,
    };
  }, [holeData.greenPolygon, holeData.greenCenterLatLng, holeData.holeNumber, courseGeometry, currentOsmHole, effectiveOrigin]);

  // Dynamic Front / Center / Back green distances from where player is standing
  const greenMetrics = useMemo(() => {
    if (!effectiveOrigin) {
      return {
        frontYards: null,
        centerYards: null,
        backYards: null,
        frontPoint: holeData.greenFrontLatLng ?? null,
        backPoint: holeData.greenBackLatLng ?? null,
      };
    }

    const polyResult =
      activeGreenPolygon && activeGreenPolygon.length >= 3
        ? computePolygonFrontCenterBack(effectiveOrigin, activeGreenPolygon, activeGreenCenter)
        : null;

    const frontYards = holeData.greenFrontLatLng
      ? computeDistanceYards(effectiveOrigin, holeData.greenFrontLatLng)
      : polyResult?.frontYards ?? null;

    const centerYards = activeGreenCenter
      ? computeDistanceYards(effectiveOrigin, activeGreenCenter)
      : polyResult?.centerYards ?? null;

    const backYards = holeData.greenBackLatLng
      ? computeDistanceYards(effectiveOrigin, holeData.greenBackLatLng)
      : polyResult?.backYards ?? null;

    return {
      frontYards,
      centerYards,
      backYards,
      frontPoint: holeData.greenFrontLatLng ?? polyResult?.frontPoint ?? null,
      backPoint: holeData.greenBackLatLng ?? polyResult?.backPoint ?? null,
    };
  }, [
    effectiveOrigin,
    activeGreenPolygon,
    activeGreenCenter,
    holeData.greenFrontLatLng,
    holeData.greenBackLatLng,
  ]);

  // Compute Carry & Clear distances to bunkers & water hazards from standing position
  const hazardDistances = useMemo<ComputedHazardDistance[]>(() => {
    if (!effectiveOrigin) return [];
    const items: ComputedHazardDistance[] = [];

    if (courseGeometry) {
      const osmHazards = [...courseGeometry.bunkers, ...courseGeometry.waters];
      for (const haz of osmHazards) {
        const assignedToThisHole = haz.holeNumber === holeData.holeNumber;
        const inCorridor =
          !haz.holeNumber && isHazardInPlayCorridor(effectiveOrigin, activeGreenCenter, haz.center);

        if (!assignedToThisHole && !inCorridor) continue;

        const polyRes = computePolygonFrontCenterBack(effectiveOrigin, haz.polygon, haz.center);
        if (!polyRes) continue;
        if (polyRes.frontYards > 420) continue;

        items.push({
          id: haz.id,
          kind: haz.kind === 'water' ? 'water' : 'bunker',
          label: haz.label,
          carryYards: polyRes.frontYards,
          clearYards: polyRes.backYards,
          frontPoint: polyRes.frontPoint,
          backPoint: polyRes.backPoint,
          center: haz.center,
        });
      }
    }

    for (const pin of holeData.hazards) {
      const dist = computeDistanceYards(effectiveOrigin, pin.latLng);
      if (dist > 420) continue;
      items.push({
        id: pin.id,
        kind: 'manual',
        label: pin.label,
        carryYards: dist,
        clearYards: null,
        frontPoint: pin.latLng,
        backPoint: pin.latLng,
        center: pin.latLng,
      });
    }

    items.sort((a, b) => a.carryYards - b.carryYards);
    return items;
  }, [effectiveOrigin, courseGeometry, holeData.holeNumber, holeData.hazards, activeGreenCenter]);

  const selectedHazard = useMemo(
    () => hazardDistances.find((h) => h.id === selectedHazardId) ?? null,
    [hazardDistances, selectedHazardId]
  );

  // User physically on the golf course? (Has active GPS fix within range of course)
  const isPlayerOnCourse = Boolean(playerPosition && !isGpsOffCourse && !isManualPosition);

  // Measurement origin when user taps the map to measure:
  // "assume I am looking for a distance to the point from where I am. Or, if I am not on the course, from where the tee point is"
  const measureOrigin: LatLngLiteral | null = useMemo(() => {
    if (isPlayerOnCourse && playerPosition) return playerPosition;
    if (isManualPosition && playerPosition) return playerPosition;
    if (activeTeeLatLng) return activeTeeLatLng;
    if (holeData.teeLatLng) return holeData.teeLatLng;
    if (playerPosition) return playerPosition;
    return course?.location ?? null;
  }, [isPlayerOnCourse, playerPosition, isManualPosition, activeTeeLatLng, holeData.teeLatLng, course?.location]);

  const distToTarget = useMemo(() => {
    if (!measureOrigin || !targetPin) return null;
    return computeDistanceYards(measureOrigin, targetPin);
  }, [measureOrigin, targetPin]);

  const distTargetToGreen = useMemo(() => {
    if (!targetPin || !activeGreenCenter) return null;
    return computeDistanceYards(targetPin, activeGreenCenter);
  }, [targetPin, activeGreenCenter]);

  const suggestedTargetClub = useMemo(
    () => recommendClub(distToTarget ?? greenMetrics.centerYards, bag),
    [distToTarget, greenMetrics.centerYards, bag]
  );

  // Refs for latest callbacks inside Leaflet event handlers
  const handleMapClickRef = useRef<(latLng: LatLngLiteral) => void>(() => {});
  handleMapClickRef.current = (clicked: LatLngLiteral) => {
    if (isDraggingTargetRef.current) return;
    switch (tapModeRef.current) {
      case 'measure':
        onSetTargetPin(clicked);
        break;
      case 'drop_ball':
        onSetManualPlayerPos(clicked);
        onChangeTapMode('measure');
        break;
      case 'log_shot': {
        const shotDist = effectiveOrigin ? computeDistanceYards(effectiveOrigin, clicked) : null;
        onQuickLogFromMap(clicked, effectiveOrigin, shotDist);
        onChangeTapMode('measure');
        break;
      }
      case 'set_tee':
        onUpdateHolePins({ teeLatLng: clicked });
        onSetTargetPin(null);
        onChangeTapMode('measure');
        break;
      case 'set_green':
        onUpdateHolePins({ greenCenterLatLng: clicked, greenPolygon: undefined });
        onSetTargetPin(null);
        onChangeTapMode('measure');
        break;
      case 'set_green_front':
        onUpdateHolePins({ greenFrontLatLng: clicked });
        onChangeTapMode('measure');
        break;
      case 'set_green_back':
        onUpdateHolePins({ greenBackLatLng: clicked });
        onChangeTapMode('measure');
        break;
      case 'add_hazard': {
        const labelMap: Record<HazardPinType, string> = {
          bunker: 'Bunker',
          water: 'Water',
          dogleg: 'Dogleg',
          layup: 'Layup',
        };
        const newHazard: HoleHazardPin = {
          id: `haz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: hazardType,
          label: labelMap[hazardType],
          latLng: clicked,
        };
        // Keep add_hazard selected so multiple hazards can be chosen/placed
        onUpdateHolePins({ hazards: [...holeData.hazards, newHazard] });
        break;
      }
    }
  };

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initial =
      activeTeeLatLng ?? holeData.teeLatLng ?? activeGreenCenter ?? course?.location ?? DEFAULT_MAP_CENTER;
    const map = L.map(mapContainerRef.current, {
      center: [initial.lat, initial.lng],
      zoom: activeTeeLatLng || holeData.teeLatLng || activeGreenCenter ? 17 : course ? 16 : 5,
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
    });

    const satLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 20,
        maxNativeZoom: 19,
        attribution: 'Imagery &copy; Esri · Course data &copy; OpenStreetMap',
      }
    );

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });

    satLayer.addTo(map);
    satLayerRef.current = satLayer;
    osmLayerRef.current = osmLayer;

    vectorsLayerRef.current = L.layerGroup().addTo(map);
    linesLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      handleMapClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch between Satellite & OpenStreetMap base layers
  useEffect(() => {
    const map = mapRef.current;
    const sat = satLayerRef.current;
    const osm = osmLayerRef.current;
    if (!map || !sat || !osm) return;

    if (baseLayer === 'satellite') {
      if (map.hasLayer(osm)) map.removeLayer(osm);
      if (!map.hasLayer(sat)) sat.addTo(map);
    } else {
      if (map.hasLayer(sat)) map.removeLayer(sat);
      if (!map.hasLayer(osm)) osm.addTo(map);
    }
  }, [baseLayer]);



  // Fit bounds tightly to ONLY the selected hole (tee, dogleg path, green polygon, and hole hazards)
  const fitMapToCurrentHole = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ pan: false });

    const holePoints: L.LatLngTuple[] = [];
    if (activeTeeLatLng) {
      holePoints.push([activeTeeLatLng.lat, activeTeeLatLng.lng]);
    } else if (holeData.teeLatLng) {
      holePoints.push([holeData.teeLatLng.lat, holeData.teeLatLng.lng]);
    }
    if (currentOsmHole?.path) {
      for (const p of currentOsmHole.path) {
        holePoints.push([p.lat, p.lng]);
      }
    }
    if (activeGreenCenter) {
      holePoints.push([activeGreenCenter.lat, activeGreenCenter.lng]);
    }
    if (activeGreenPolygon) {
      for (const p of activeGreenPolygon) {
        holePoints.push([p.lat, p.lng]);
      }
    }
    if (holePoints.length >= 2) {
      const bounds = L.latLngBounds(holePoints);
      const center = bounds.getCenter();
      const boundsZoom = map.getBoundsZoom(bounds, false, L.point(16, 66));
      const targetZoom = Math.min(19.5, Math.round((boundsZoom + 0.6) * 4) / 4);
      map.setView(center, targetZoom, { animate: true });
      return;
    }

    if (holePoints.length === 1) {
      map.setView(holePoints[0], 18, { animate: true });
      return;
    }

    if (courseGeometry && courseGeometry.greens.length > 0) {
      const bounds = L.latLngBounds(
        courseGeometry.greens.map((g) => [g.center.lat, g.center.lng] as L.LatLngTuple)
      );
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
      return;
    }

    if (course?.location) {
      map.setView([course.location.lat, course.location.lng], 16);
      return;
    }

    if (playerPosition) {
      map.setView([playerPosition.lat, playerPosition.lng], 17);
    }
  }, [
    activeTeeLatLng,
    holeData.teeLatLng,
    holeData.holeNumber,
    currentOsmHole,
    activeGreenCenter,
    activeGreenPolygon,
    courseGeometry,
    course?.location,
    playerPosition,
  ]);

  // Automatically center and zoom to the active hole whenever the hole changes
  useEffect(() => {
    setSelectedHazardId(null);
    fitMapToCurrentHole();
    const timer = setTimeout(() => {
      fitMapToCurrentHole();
    }, 60);
    return () => clearTimeout(timer);
  }, [
    holeData.holeNumber,
    course?.placeId,
    courseGeometry?.fetchedAt,
    activeTeeLatLng,
    activeGreenCenter,
    fitMapToCurrentHole,
  ]);

  // Render OSM course polygons (fairways, tees, water hazards, bunkers, greens)
  useEffect(() => {
    const layer = vectorsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (courseGeometry) {
      // 1. Fairways
      for (const fw of courseGeometry.fairways) {
        L.polygon(toLatLngTuples(fw.polygon), {
          color: '#34D399',
          weight: 1,
          opacity: 0.35,
          fillColor: '#10B981',
          fillOpacity: 0.14,
          interactive: false,
        }).addTo(layer);
      }

      // 2. Tee boxes
      for (const tee of courseGeometry.tees) {
        L.polygon(toLatLngTuples(tee.polygon), {
          color: '#E2E8F0',
          weight: 1,
          opacity: 0.55,
          fillColor: '#94A3B8',
          fillOpacity: 0.25,
          interactive: false,
        }).addTo(layer);
      }

      // 3. Water hazards
      for (const w of courseGeometry.waters) {
        const isSel = w.id === selectedHazardId;
        const poly = L.polygon(toLatLngTuples(w.polygon), {
          color: isSel ? '#FFFFFF' : '#38BDF8',
          weight: isSel ? 2.5 : 1.5,
          fillColor: '#0EA5E9',
          fillOpacity: isSel ? 0.52 : 0.34,
        }).addTo(layer);

        poly.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedHazardId((prev) => (prev === w.id ? null : w.id));
        });

        if (effectiveOrigin) {
          const res = computePolygonFrontCenterBack(effectiveOrigin, w.polygon, w.center);
          if (res && res.frontYards <= 450) {
            poly.bindTooltip(
              `<div style="font-family:monospace;font-size:11px;font-weight:700;color:#0369A1;">${w.label || 'Water'}: ${formatDistanceValue(res.frontYards, unit)}${suffix}</div>`,
              { sticky: true, direction: 'center', opacity: 0.92 }
            );
          }
        }
      }

      // 4. Sand Bunkers
      for (const b of courseGeometry.bunkers) {
        const isSel = b.id === selectedHazardId;
        const poly = L.polygon(toLatLngTuples(b.polygon), {
          color: isSel ? '#FFFFFF' : '#FCD34D',
          weight: isSel ? 2.5 : 1.25,
          fillColor: '#F59E0B',
          fillOpacity: isSel ? 0.65 : 0.42,
        }).addTo(layer);

        poly.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedHazardId((prev) => (prev === b.id ? null : b.id));
        });

        if (effectiveOrigin) {
          const res = computePolygonFrontCenterBack(effectiveOrigin, b.polygon, b.center);
          if (res && res.frontYards <= 420) {
            poly.bindTooltip(
              `<div style="font-family:monospace;font-size:11px;font-weight:700;color:#78350F;">${b.label || 'Bunker'}: ${formatDistanceValue(res.frontYards, unit)}${suffix}</div>`,
              { sticky: true, direction: 'center', opacity: 0.92 }
            );
          }
        }
      }

      // 5. Greens (Hole Green vs Other Greens)
      for (const g of courseGeometry.greens) {
        const isCurrentHoleGreen = g.holeNumber === holeData.holeNumber;
        const poly = L.polygon(toLatLngTuples(g.polygon), {
          color: isCurrentHoleGreen ? '#4ADE80' : '#86EFAC',
          weight: isCurrentHoleGreen ? 2.5 : 1,
          opacity: isCurrentHoleGreen ? 0.95 : 0.45,
          fillColor: '#22C55E',
          fillOpacity: isCurrentHoleGreen ? 0.45 : 0.18,
        }).addTo(layer);

        poly.on('click', () => {
          if (g.holeNumber && g.holeNumber !== holeData.holeNumber) {
            onSelectHole(g.holeNumber);
          } else {
            onSetTargetPin(g.center);
          }
        });
      }
    }

    // Custom user green polygon override for this hole
    if (holeData.greenPolygon && holeData.greenPolygon.length >= 3) {
      L.polygon(toLatLngTuples(holeData.greenPolygon), {
        color: '#22C55E',
        weight: 2.5,
        fillColor: '#16A34A',
        fillOpacity: 0.42,
      }).addTo(layer);
    }
  }, [
    courseGeometry,
    holeData.holeNumber,
    holeData.greenPolygon,
    selectedHazardId,
    effectiveOrigin,
    unit,
    suffix,
    onSelectHole,
    onSetTargetPin,
  ]);

  // Render connecting lines (Hole centerline, Shot history, Measurement lines)
  useEffect(() => {
    const layer = linesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    targetLineFromOriginRef.current = null;
    targetLineToGreenRef.current = null;

    // 1. Hole Guide Centerline: Tee -> Doglegs -> Green
    const guidePoints: L.LatLngTuple[] = [];
    if (activeTeeLatLng) guidePoints.push([activeTeeLatLng.lat, activeTeeLatLng.lng]);
    if (currentOsmHole?.path && currentOsmHole.path.length > 0) {
      for (const p of currentOsmHole.path) guidePoints.push([p.lat, p.lng]);
    }
    if (activeGreenCenter) guidePoints.push([activeGreenCenter.lat, activeGreenCenter.lng]);

    if (guidePoints.length >= 2) {
      L.polyline(guidePoints, {
        color: '#E2E8F0',
        weight: 1.5,
        dashArray: '3 6',
        opacity: 0.35,
        interactive: false,
      }).addTo(layer);
    }

    // 2. Shot History Polylines (Tee -> Shot 1 -> Shot 2 ...)
    const shotHistoryPoints: L.LatLngTuple[] = [];
    if (activeTeeLatLng) shotHistoryPoints.push([activeTeeLatLng.lat, activeTeeLatLng.lng]);
    for (const shot of shots) {
      if (shot.endLatLng) {
        shotHistoryPoints.push([shot.endLatLng.lat, shot.endLatLng.lng]);
      }
    }
    if (shotHistoryPoints.length >= 2) {
      L.polyline(shotHistoryPoints, {
        color: '#38BDF8',
        weight: 2.5,
        opacity: 0.85,
        interactive: false,
      }).addTo(layer);
    }

    // 3. Target Reticle Measurement Lines
    // Line A: Origin (standing ball or tee) -> Target Reticle
    if (targetPin && measureOrigin) {
      targetLineFromOriginRef.current = L.polyline(
        [
          [measureOrigin.lat, measureOrigin.lng],
          [targetPin.lat, targetPin.lng],
        ],
        {
          color: '#FCD34D',
          weight: 2.5,
          dashArray: '6 4',
          opacity: 0.95,
        }
      ).addTo(layer);
    }

    // Line B: Target Reticle -> Green Center
    if (targetPin && activeGreenCenter) {
      targetLineToGreenRef.current = L.polyline(
        [
          [targetPin.lat, targetPin.lng],
          [activeGreenCenter.lat, activeGreenCenter.lng],
        ],
        {
          color: '#4ADE80',
          weight: 2,
          dashArray: '4 4',
          opacity: 0.85,
        }
      ).addTo(layer);
    }

    // 4. Line from Origin -> Selected Hazard front point
    if (selectedHazard && measureOrigin) {
      L.polyline(
        [
          [measureOrigin.lat, measureOrigin.lng],
          [selectedHazard.frontPoint.lat, selectedHazard.frontPoint.lng],
        ],
        {
          color: selectedHazard.kind === 'water' ? '#38BDF8' : '#FBBF24',
          weight: 2.5,
          dashArray: '5 4',
          opacity: 0.95,
        }
      ).addTo(layer);
    }
  }, [
    activeTeeLatLng,
    holeData.teeLatLng,
    currentOsmHole?.path,
    shots,
    measureOrigin,
    targetPin,
    activeGreenCenter,
    selectedHazard,
  ]);

  const handleResetToDefaults = useCallback(() => {
    // Reset hole pins (tee, green center/front/back) to official OSM defaults
    const osmGreen = courseGeometry?.greens.find((g) => g.holeNumber === holeData.holeNumber);
    const greenCenter = currentOsmHole?.greenCenterLatLng ?? osmGreen?.center;
    const tee = currentOsmHole?.teeLatLng;
    onUpdateHolePins({
      teeLatLng: tee,
      greenCenterLatLng: greenCenter,
      greenFrontLatLng: undefined,
      greenBackLatLng: undefined,
    });
    // Clear manual target pin
    onSetTargetPin(null);
    // Reset manual ball position / resume live GPS
    onResumeLiveGps?.();
    // Reset tap mode
    onChangeTapMode('measure');
    // Refresh OSM polygons if available
    if (onRefreshOsmCourse) {
      onRefreshOsmCourse();
    }
    // Re-fit map to hole
    fitMapToCurrentHole();
  }, [
    currentOsmHole,
    onUpdateHolePins,
    onSetTargetPin,
    onResumeLiveGps,
    onChangeTapMode,
    onRefreshOsmCourse,
    fitMapToCurrentHole,
  ]);

  // Render interactive markers (Tee, Pin, F/B, Player Ball, Target Reticle, Shots, Manual Hazards)
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    
    // 1. Tee Marker (Only render if ball is not at the tee to avoid overlapping black rectangle under ball)
    const isBallAtTee =
      Boolean(activeTeeLatLng && effectiveOrigin && computeDistanceMeters(activeTeeLatLng, effectiveOrigin) < 15);

    if (activeTeeLatLng && !isBallAtTee) {
      const m = L.marker([activeTeeLatLng.lat, activeTeeLatLng.lng], {
        draggable: true,
        icon: createBadgeIcon(
          `<div style="padding:2px 6px;border-radius:6px;background:rgba(15,23,42,0.94);color:#fff;border:1px solid rgba(255,255,255,0.8);font-size:10px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.45);white-space:nowrap;">TEE</div>`,
          [34, 20],
          [17, 10]
        ),
      }).addTo(layer);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        onUpdateHolePins({ teeLatLng: { lat: ll.lat, lng: ll.lng } });
      });
    }

    // 2. Green Center Flag Marker
    if (activeGreenCenter) {
      const m = L.marker([activeGreenCenter.lat, activeGreenCenter.lng], {
        draggable: true,
        icon: createBadgeIcon(
          `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-8px);">
            <div style="width:24px;height:24px;border-radius:9999px;background:#E11D48;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;box-shadow:0 3px 8px rgba(0,0,0,0.45);">⛳</div>
            <div style="width:6px;height:6px;border-radius:9999px;background:#fff;margin-top:2px;box-shadow:0 1px 3px rgba(0,0,0,0.6);"></div>
          </div>`,
          [26, 32],
          [13, 28]
        ),
      }).addTo(layer);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        onUpdateHolePins({ greenCenterLatLng: { lat: ll.lat, lng: ll.lng } });
      });
    }

    // 3. Green Front / Back Edge Badges
    if (greenMetrics.frontPoint) {
      const fm = L.marker([greenMetrics.frontPoint.lat, greenMetrics.frontPoint.lng], {
        draggable: Boolean(holeData.greenFrontLatLng),
        interactive: Boolean(holeData.greenFrontLatLng),
        icon: createBadgeIcon(
          `<div style="padding:1px 4px;border-radius:4px;background:rgba(6,78,59,0.92);color:#A7F3D0;border:1px solid rgba(52,211,153,0.75);font-family:monospace;font-size:10px;font-weight:700;">F</div>`,
          [18, 16],
          [9, 8]
        ),
      }).addTo(layer);
      if (holeData.greenFrontLatLng) {
        fm.on('dragend', () => {
          const ll = fm.getLatLng();
          onUpdateHolePins({ greenFrontLatLng: { lat: ll.lat, lng: ll.lng } });
        });
      }
    }

    if (greenMetrics.backPoint) {
      const bm = L.marker([greenMetrics.backPoint.lat, greenMetrics.backPoint.lng], {
        draggable: Boolean(holeData.greenBackLatLng),
        interactive: Boolean(holeData.greenBackLatLng),
        icon: createBadgeIcon(
          `<div style="padding:1px 4px;border-radius:4px;background:rgba(6,78,59,0.92);color:#A7F3D0;border:1px solid rgba(52,211,153,0.75);font-family:monospace;font-size:10px;font-weight:700;">B</div>`,
          [18, 16],
          [9, 8]
        ),
      }).addTo(layer);
      if (holeData.greenBackLatLng) {
        bm.on('dragend', () => {
          const ll = bm.getLatLng();
          onUpdateHolePins({ greenBackLatLng: { lat: ll.lat, lng: ll.lng } });
        });
      }
    }

    // 4. Selected Hazard Carry/Clear Callout Marker
    if (selectedHazard) {
      const txt =
        selectedHazard.clearYards !== null
          ? `${selectedHazard.label}: ${formatDistanceValue(selectedHazard.carryYards, unit)}–${formatDistanceValue(selectedHazard.clearYards, unit)} ${suffix}`
          : `${selectedHazard.label}: ${formatDistanceValue(selectedHazard.carryYards, unit)} ${suffix}`;
      L.marker([selectedHazard.frontPoint.lat, selectedHazard.frontPoint.lng], {
        interactive: false,
        icon: createBadgeIcon(
          `<div style="padding:3px 7px;border-radius:6px;background:rgba(13,21,17,0.95);color:${selectedHazard.kind === 'water' ? '#7DD3FC' : '#FDE68A'};border:1px solid rgba(255,255,255,0.4);font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.5);transform:translate(-50%,-120%);">${txt}</div>`,
          [10, 10],
          [5, 5]
        ),
      }).addTo(layer);
    }

    // 5. Custom Manual Hazard Pins
    for (const haz of holeData.hazards) {
      const dist = effectiveOrigin ? computeDistanceYards(effectiveOrigin, haz.latLng) : null;
      const m = L.marker([haz.latLng.lat, haz.latLng.lng], {
        icon: createBadgeIcon(
          `<div style="padding:2px 6px;border-radius:5px;background:rgba(69,26,3,0.92);color:#FDE68A;border:1px solid rgba(251,191,36,0.75);font-family:monospace;font-size:10px;font-weight:600;white-space:nowrap;">${haz.label}${dist !== null ? ` · ${formatDistanceValue(dist, unit)}${suffix}` : ''}</div>`,
          [80, 20],
          [40, 10]
        ),
      }).addTo(layer);
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onUpdateHolePins({
          hazards: holeData.hazards.filter((h) => h.id !== haz.id),
        });
      });
    }

    // 6. Player Standing / Ball Position Marker (clean blue circle with white outline and inner dot)
    if (effectiveOrigin) {
      const m = L.marker([effectiveOrigin.lat, effectiveOrigin.lng], {
        draggable: true,
        zIndexOffset: 500,
        icon: L.divIcon({
          className: 'ball-position-marker',
          html: `<div style="width:22px;height:22px;border-radius:50%;background:#0284c7;border:2.5px solid #ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.35);"><div style="width:6px;height:6px;border-radius:50%;background:#ffffff;"></div></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).addTo(layer);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        onSetManualPlayerPos({ lat: ll.lat, lng: ll.lng });
      });
    }

    // 8. Logged Shot Markers
    for (const shot of shots) {
      if (!shot.endLatLng) continue;
      const lieMeta = getLieMeta(shot.lie);
      const m = L.marker([shot.endLatLng.lat, shot.endLatLng.lng], {
        icon: createBadgeIcon(
          `<div style="width:26px;height:26px;border-radius:9999px;background:${lieMeta.dotColor};border:2px solid #fff;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.45);">${shot.strokeNumber}</div>`,
          [26, 26],
          [13, 13]
        ),
      }).addTo(layer);
      m.bindPopup(
        `<div style="font-family:sans-serif;font-size:12px;">
          <strong>Shot ${shot.strokeNumber} · ${shot.clubName}</strong><br/>
          <span>${lieMeta.label}${shot.distanceYards !== null ? ` · ${formatDistanceValue(shot.distanceYards, unit)} ${suffix}` : ''}</span>
          ${shot.penaltyStrokes > 0 ? `<br/><span style="color:#E11D48;font-weight:600;">+${shot.penaltyStrokes} penalty stroke</span>` : ''}
        </div>`
      );
    }
  }, [
    unit,
    holeData.teeLatLng,
    holeData.greenFrontLatLng,
    holeData.greenBackLatLng,
    holeData.hazards,
    activeGreenCenter,
    greenMetrics.frontPoint,
    greenMetrics.backPoint,
    selectedHazard,
    effectiveOrigin,
    targetPin,
    distToTarget,
    distTargetToGreen,
    shots,
    activeTeeLatLng,
    onUpdateHolePins,
    onSetManualPlayerPos,
  ]);

  // Dedicated Target Reticle Effect: persistent marker, completely isolated from markersLayer.clearLayers()
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!targetPin) {
      if (targetMarkerRef.current) {
        targetMarkerRef.current.remove();
        targetMarkerRef.current = null;
      }
      return;
    }

    const originPrefix = isPlayerOnCourse ? 'From You' : 'From Tee';
    const label =
      distToTarget !== null
        ? `${originPrefix}: ${formatDistanceValue(distToTarget, unit)} ${suffix}${
            distTargetToGreen !== null
              ? ` · ${formatDistanceValue(distTargetToGreen, unit)} to Pin`
              : ''
          }`
        : 'Target';

    if (!targetMarkerRef.current) {
      const m = L.marker([targetPin.lat, targetPin.lng], {
        draggable: true,
        autoPan: true,
        autoPanPadding: [30, 30],
        zIndexOffset: 1000,
        icon: createBadgeIcon(
          `<div style="cursor:grab;touch-action:none;user-select:none;display:flex;flex-direction:column;align-items:center;transform:translateY(-22px);">
            <div id="target-reticle-badge" style="margin-bottom:4px;padding:2px 7px;border-radius:6px;background:rgba(13,21,17,0.95);color:#fff;border:1px solid rgba(255,255,255,0.35);font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,0.5);">${label}</div>
            <div style="width:36px;height:36px;border-radius:9999px;border:3px solid #FCD34D;background:rgba(251,191,36,0.35);display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px rgba(252,211,77,0.5);">
              <div style="width:8px;height:8px;border-radius:9999px;background:#FCD34D;"></div>
            </div>
          </div>`,
          [160, 64],
          [80, 46]
        ),
      }).addTo(map);

      m.on('dragstart', () => {
        isDraggingTargetRef.current = true;
        map.dragging.disable();
      });

      m.on('drag', () => {
        const ll = m.getLatLng();
        if (targetLineFromOriginRef.current && measureOrigin) {
          targetLineFromOriginRef.current.setLatLngs([
            [measureOrigin.lat, measureOrigin.lng],
            [ll.lat, ll.lng],
          ]);
        }
        if (targetLineToGreenRef.current && activeGreenCenter) {
          targetLineToGreenRef.current.setLatLngs([
            [ll.lat, ll.lng],
            [activeGreenCenter.lat, activeGreenCenter.lng],
          ]);
        }
        const badgeEl = m.getElement()?.querySelector('#target-reticle-badge');
        if (badgeEl && measureOrigin) {
          const originMeters = computeDistanceMeters(measureOrigin, { lat: ll.lat, lng: ll.lng });
          const originDist = Math.round(unit === 'meters' ? originMeters : originMeters * 1.0936133);
          let text = `${originPrefix}: ${originDist} ${suffix}`;
          if (activeGreenCenter) {
            const greenMeters = computeDistanceMeters({ lat: ll.lat, lng: ll.lng }, activeGreenCenter);
            const greenDist = Math.round(unit === 'meters' ? greenMeters : greenMeters * 1.0936133);
            text += ` · ${greenDist} to Pin`;
          }
          badgeEl.textContent = text;
        }
      });

      m.on('dragend', () => {
        map.dragging.enable();
        const ll = m.getLatLng();
        onSetTargetPin({ lat: ll.lat, lng: ll.lng });
        setTimeout(() => {
          isDraggingTargetRef.current = false;
        }, 200);
      });

      targetMarkerRef.current = m;
    } else {
      if (!isDraggingTargetRef.current) {
        targetMarkerRef.current.setLatLng([targetPin.lat, targetPin.lng]);
      }
      const badgeEl = targetMarkerRef.current.getElement()?.querySelector('#target-reticle-badge');
      if (badgeEl) {
        badgeEl.textContent = label;
      }
    }
  }, [
    targetPin,
    distToTarget,
    distTargetToGreen,
    isPlayerOnCourse,
    measureOrigin,
    activeGreenCenter,
    unit,
    suffix,
    onSetTargetPin,
  ]);

    const topHazards = hazardDistances.slice(0, 5);

  const tapModePrompt: Record<MapTapMode, string> = {
    measure: 'Tap anywhere to drop target reticle. Tap any bunker or water polygon for Carry/Clear.',
    drop_ball: 'Tap anywhere on the hole to move your standing ball position.',
    log_shot: 'Tap where your shot finished to capture GPS coordinates and yardage.',
    set_tee: 'Tap the tee box on the map to pin Hole Tee.',
    set_green: 'Tap the flag / center of the green to pin Hole Green.',
    set_green_front: 'Tap the front edge of the green.',
    set_green_back: 'Tap the back edge of the green.',
    add_hazard: `Tap anywhere on the map to add ${hazardType} hazards (multiple allowed). Click Done when finished.`,
  };

  return (
    <div className="relative isolate w-full h-full min-h-[380px] bg-[#0B140F] overflow-hidden select-none">
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Top-Left Hole Switcher & Live Distance HUD */}
      <div className="absolute top-3 left-3 z-[400] flex flex-col gap-2 w-auto max-w-[200px] sm:max-w-[230px]">
        {/* Quick Hole Picker Bar */}
        <div className="relative">
          <div className="rounded-2xl bg-[#0D1511]/94 backdrop-blur-md text-white border border-white/20 p-1.5 shadow-2xl flex items-center justify-between gap-1 min-h-[48px]">
            {(() => {
              const totalHolesCount = Math.max(18, Object.keys(allHoles).length);
              return (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setIsHolePickerOpen(false);
                      onSelectHole(getPrevHoleNumber(holeData.holeNumber, holeMode, totalHolesCount));
                    }}
                    className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/15 active:scale-95 transition-all text-slate-200 hover:text-white shrink-0 touch-manipulation"
                    aria-label="Previous Hole"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsHolePickerOpen((prev) => !prev);
                    }}
                    className="flex-1 h-10 px-2 rounded-xl flex items-center justify-center gap-1.5 hover:bg-white/10 transition-colors min-w-0"
                  >
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="font-display font-black text-sm sm:text-base tracking-tight text-emerald-400 whitespace-nowrap">
                        Hole {holeData.holeNumber}
                      </span>
                      <span className="text-[11px] sm:text-xs font-mono text-slate-300 whitespace-nowrap font-bold">
                        P{holeData.par}
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                        isHolePickerOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setIsHolePickerOpen(false);
                      onSelectHole(getNextHoleNumber(holeData.holeNumber, holeMode, totalHolesCount));
                    }}
                    className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/15 active:scale-95 transition-all text-slate-200 hover:text-white shrink-0 touch-manipulation"
                    aria-label="Next Hole"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              );
            })()}
          </div>

          {/* Expanded Hole Grid Modal */}
          {isHolePickerOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 p-2 rounded-xl bg-[#0D1511]/96 backdrop-blur-md border border-white/20 shadow-2xl z-[500] animate-in fade-in zoom-in-95 duration-100 min-w-[280px]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-1 flex items-center justify-between gap-1 flex-wrap">
                <span>Select Hole</span>
                {onToggleHoleMode && (
                  <div className="flex items-center gap-0.5 bg-black/60 p-0.5 rounded-lg border border-white/15">
                    <button
                      type="button"
                      onClick={() => onToggleHoleMode('18')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-colors ${
                        holeMode === '18' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      18H
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleHoleMode('front9')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-colors ${
                        holeMode === 'front9' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      F9
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleHoleMode('back9')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-colors ${
                        holeMode === 'back9' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      B9
                    </button>
                    {Object.keys(allHoles).length > 18 && (
                      <button
                        type="button"
                        onClick={() => onToggleHoleMode('all27')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-colors ${
                          holeMode === 'all27' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        27H
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-6 gap-1">
                {(holeMode === 'front9'
                  ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
                  : holeMode === 'back9'
                    ? [10, 11, 12, 13, 14, 15, 16, 17, 18]
                    : Array.from({ length: Math.max(18, Object.keys(allHoles).length) }, (_, i) => i + 1)
                ).map((num) => {
                  const h = allHoles[num];
                  const s = allScores[num];
                  const hasScore = s && (s.shots.length > 0 || (s.manualPutts || 0) > 0);
                  const isCurrent = num === holeData.holeNumber;

                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        onSelectHole(num);
                        setIsHolePickerOpen(false);
                      }}
                      className={`h-9 rounded-lg flex flex-col items-center justify-center text-xs font-bold transition-all relative ${
                        isCurrent
                          ? 'bg-emerald-500 text-slate-950 ring-2 ring-emerald-300'
                          : hasScore
                            ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-600/40 hover:bg-emerald-900'
                            : 'bg-white/5 text-slate-300 hover:bg-white/15'
                      }`}
                    >
                      <span>{num}</span>
                      <span className="text-[9px] font-mono opacity-70 leading-none">
                        p{h?.par ?? 4}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Live Distance HUD Badge */}
        <div className="rounded-xl bg-[#0D1511]/92 backdrop-blur-md text-white border border-white/15 p-2.5 shadow-xl">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-medium text-emerald-300 truncate">
              {isNearestFallbackGreen
                ? 'Nearest Green'
                : activeGreenCenter
                  ? 'To Green Center'
                  : 'Hole Distance'}
            </span>
            <span className="text-[11px] font-mono text-slate-300 tabular-nums shrink-0">
              {isManualPosition
                ? 'Pinned Ball'
                : !isPlayerOnCourse || isGpsOffCourse
                  ? 'From Tee'
                  : gpsStatus === 'watching' && gpsAccuracyMeters !== null
                    ? `GPS ±${gpsAccuracyMeters}m`
                    : 'GPS Wait'}
            </span>
          </div>

          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="font-display text-3xl font-bold tracking-tight tabular-nums leading-none">
              {greenMetrics.centerYards !== null
                ? formatDistanceValue(greenMetrics.centerYards, unit)
                : formatDistanceValue(holeData.yardage, unit)}
            </span>
            <span className="text-xs font-semibold text-slate-300">{suffix}</span>
            {suggestedTargetClub && (
              <span className="ml-auto text-xs font-mono font-semibold text-emerald-300 whitespace-nowrap">
                Rec: {suggestedTargetClub.shortName}
              </span>
            )}
          </div>

          {/* Front / Back Green Yardages */}
          {(greenMetrics.frontYards !== null || greenMetrics.backYards !== null) && (
            <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-white/10 text-[11px] font-mono text-slate-300">
              {greenMetrics.frontYards !== null && (
                <div>
                  <span className="text-slate-400 mr-1">F:</span>
                  <span className="font-bold text-white">
                    {formatDistanceValue(greenMetrics.frontYards, unit)}
                  </span>
                  <span className="text-[9px] ml-0.5">{suffix}</span>
                </div>
              )}
              {greenMetrics.backYards !== null && (
                <div>
                  <span className="text-slate-400 mr-1">B:</span>
                  <span className="font-bold text-white">
                    {formatDistanceValue(greenMetrics.backYards, unit)}
                  </span>
                  <span className="text-[9px] ml-0.5">{suffix}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top-Right Floating Controls (Layer toggle, Recenter hole, Course name, OSM Sync) */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#0D1511]/92 backdrop-blur-md border border-white/15 shadow-xl text-white">
          <button
            type="button"
            onClick={() => setBaseLayer((prev) => (prev === 'satellite' ? 'osm' : 'satellite'))}
            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold hover:bg-white/10 active:scale-95 transition-all"
            title="Toggle between Satellite Imagery and OpenStreetMap"
          >
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline capitalize">{baseLayer}</span>
          </button>

          <button
            type="button"
            onClick={() => fitMapToCurrentHole()}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 active:scale-95 text-slate-200 transition-all"
            title="Center map on current hole"
            aria-label="Fit hole"
          >
            <Crosshair className="w-4 h-4 text-emerald-400" />
          </button>

          <button
            type="button"
            onClick={handleResetToDefaults}
            disabled={isLoadingGeometry}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 active:scale-95 text-slate-200 disabled:opacity-40 transition-all"
            title="Reset tee, pin, and ball positions to course defaults"
            aria-label="Reset tee and pin to defaults"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-emerald-400 ${
                isLoadingGeometry ? 'animate-spin' : ''
              }`}
            />
          </button>

          {onOpenCourseSearch && (
            <button
              type="button"
              onClick={onOpenCourseSearch}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 active:scale-95 text-slate-200 transition-all"
              title="Search different course"
              aria-label="Search course"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}

        </div>

        {/* Dedicated Hazards Bar beneath Satellite / Reset / Center controls */}
        {topHazards.length > 0 && (
          <div className="flex items-center p-1 rounded-xl bg-[#0D1511]/92 backdrop-blur-md border border-white/15 shadow-xl text-white">
            <button
              type="button"
              onClick={() => setIsHazardsMenuOpen((prev) => !prev)}
              className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all ${
                isHazardsMenuOpen
                  ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-300'
                  : 'text-amber-400 hover:bg-white/10 active:scale-95'
              }`}
              title="Hole Hazards"
              aria-label="Toggle hazards menu"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Hazards ({topHazards.length})</span>
            </button>
          </div>
        )}

        {/* Collapsible Hazards Dropdown in Top Right */}
        {isHazardsMenuOpen && topHazards.length > 0 && (
          <div className="p-2 rounded-2xl bg-[#0D1511]/96 backdrop-blur-md border border-white/20 shadow-2xl flex flex-col gap-1.5 w-64 max-w-[85vw] animate-in fade-in zoom-in-95 duration-100 text-white z-[500]">
            <div className="flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-white/10 pb-1">
              <span>Hole {holeData.holeNumber} Hazards</span>
              <button
                type="button"
                onClick={() => setIsHazardsMenuOpen(false)}
                className="text-slate-400 hover:text-white text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-1 max-h-52 overflow-y-auto no-scrollbar">
              {topHazards.map((h) => {
                const isSel = selectedHazardId === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setSelectedHazardId((prev) => (prev === h.id ? null : h.id))}
                    className={`p-2 rounded-xl text-xs font-mono flex items-center justify-between gap-2 text-left transition-all ${
                      isSel
                        ? 'bg-amber-400 text-slate-950 font-bold ring-1 ring-amber-300 shadow-sm'
                        : h.kind === 'water'
                          ? 'bg-sky-950/70 text-sky-200 border border-sky-600/40 hover:bg-sky-900/80'
                          : 'bg-amber-950/70 text-amber-200 border border-amber-600/40 hover:bg-amber-900/80'
                    }`}
                  >
                    <span className="font-sans font-bold text-xs truncate">{h.label}</span>
                    <span className="font-bold shrink-0">
                      {formatDistanceValue(h.carryYards, unit)}
                      {h.clearYards !== null && `–${formatDistanceValue(h.clearYards, unit)}`}
                      <span className="text-[10px] opacity-75 ml-0.5">{suffix}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}



        {geometryError && (
          <div className="px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-500/40 text-[10px] font-medium text-rose-300 flex items-center gap-1 shadow-md max-w-[200px]">
            <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
            <span className="truncate">{geometryError}</span>
          </div>
        )}
      </div>

      {/* Floating Mode Prompt Banner */}
      {tapMode !== 'measure' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[400] max-w-[90%] px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 shadow-2xl font-semibold text-xs text-center border border-amber-300 animate-in fade-in slide-in-from-top-2">
          {tapModePrompt[tapMode]}
        </div>
      )}

      {/* Bottom Map Controls Bar & Overlays */}
      <div className="absolute bottom-2 md:bottom-3 left-3 right-3 z-[400] flex flex-col gap-1.5 max-w-xl mx-auto pointer-events-none">
        {/* Target Reticle Float (Cleanly above hazards and action toolbar) */}
        {targetPin && (
          <div className="pointer-events-auto w-full">
            <div className="p-2.5 rounded-2xl bg-[#0D1511]/95 backdrop-blur-md text-white border border-amber-400/50 shadow-2xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/60 flex items-center justify-center shrink-0">
                  <Crosshair className="w-4 h-4 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">
                    Target Reticle
                  </div>
                  <div className="text-xs font-mono font-bold truncate">
                    {distToTarget !== null ? `${formatDistanceValue(distToTarget, unit)} ${suffix}` : '--'}
                    {distTargetToGreen !== null && (
                      <span className="text-slate-400 ml-1.5 font-normal">
                        · {formatDistanceValue(distTargetToGreen, unit)} {suffix} to Pin
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onQuickLogFromMap(targetPin, effectiveOrigin, distToTarget);
                  }}
                  className="h-8 px-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1 shadow-sm transition-colors active:scale-95"
                >
                  <span>Log Shot Here</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSetTargetPin(null)}
                  className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold transition-colors"
                  aria-label="Clear Target"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}



        {/* Action Toolbar - Centered with snug fit (no right blank space) */}
        <div className="pointer-events-auto w-fit mx-auto self-center p-1 rounded-2xl bg-[#0D1511]/94 backdrop-blur-md text-white border border-white/15 shadow-2xl flex items-center justify-center max-w-[calc(100vw-1.5rem)] overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 py-0.5 shrink-0">
            {/* Ball Position */}
            <button
              type="button"
              onClick={() => onChangeTapMode(tapMode === 'drop_ball' ? 'measure' : 'drop_ball')}
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 ${
                tapMode === 'drop_ball'
                  ? 'bg-sky-400 text-slate-950 shadow-md ring-2 ring-sky-300'
                  : 'bg-white/5 hover:bg-white/10 text-slate-200'
              }`}
              title="Set or move ball position"
            >
              <MapPin className="w-3.5 h-3.5 text-sky-400" />
              <span>Ball</span>
            </button>

            {/* Pin Position */}
            <button
              type="button"
              onClick={() => onChangeTapMode(tapMode === 'set_green' ? 'measure' : 'set_green')}
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 ${
                tapMode === 'set_green'
                  ? 'bg-rose-500 text-white shadow-md ring-2 ring-rose-300'
                  : 'bg-white/5 hover:bg-white/10 text-slate-200'
              }`}
              title="Set flag / pin position"
            >
              <Flag className="w-3.5 h-3.5 text-rose-400" />
              <span>Pin</span>
            </button>

            {/* Front */}
            <button
              type="button"
              onClick={() => onChangeTapMode(tapMode === 'set_green_front' ? 'measure' : 'set_green_front')}
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 transition-all whitespace-nowrap shrink-0 ${
                tapMode === 'set_green_front'
                  ? 'bg-emerald-500 text-slate-950 shadow-md ring-2 ring-emerald-300'
                  : 'bg-white/5 hover:bg-white/10 text-slate-200'
              }`}
              title="Set green front edge"
            >
              <span>Front</span>
            </button>

            {/* Back */}
            <button
              type="button"
              onClick={() => onChangeTapMode(tapMode === 'set_green_back' ? 'measure' : 'set_green_back')}
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 transition-all whitespace-nowrap shrink-0 ${
                tapMode === 'set_green_back'
                  ? 'bg-emerald-500 text-slate-950 shadow-md ring-2 ring-emerald-300'
                  : 'bg-white/5 hover:bg-white/10 text-slate-200'
              }`}
              title="Set green back edge"
            >
              <span>Back</span>
            </button>

            {/* + Hazard */}
            <button
              type="button"
              onClick={() => onChangeTapMode(tapMode === 'add_hazard' ? 'measure' : 'add_hazard')}
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 ${
                tapMode === 'add_hazard'
                  ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-300'
                  : 'bg-white/5 hover:bg-white/10 text-slate-200'
              }`}
              title="Add hazard pin"
            >
              <span>+ Hazard</span>
            </button>

            {/* If add_hazard is active, show hazard type picker */}
            {tapMode === 'add_hazard' && (
              <div className="flex items-center gap-0.5 bg-black/60 p-0.5 rounded-xl border border-amber-400/50 shrink-0">
                {((['bunker', 'water', 'dogleg', 'layup'] as HazardPinType[])).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setHazardType(t)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold capitalize transition-all ${
                      hazardType === t ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onChangeTapMode('measure')}
                  className="px-2 py-1 rounded-lg bg-white/20 text-white text-[10px] font-bold ml-0.5 hover:bg-white/30"
                >
                  Done
                </button>
              </div>
            )}
          </div>


        </div>
      </div>
    </div>
  );
};

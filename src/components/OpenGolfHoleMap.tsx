import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crosshair,
  Flag,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Plus,
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
  computeBearingDegrees,
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

export interface OpenGolfHoleMapHandle {
  toggleBaseLayer: () => void;
  toggleOrientation: () => void;
  centerHole: () => void;
  resetDefaults: () => void;
}

export interface OpenGolfHoleMapProps {
  baseLayer?: 'satellite' | 'osm';
  onToggleBaseLayer?: () => void;
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

export const OpenGolfHoleMap = forwardRef<OpenGolfHoleMapHandle, OpenGolfHoleMapProps>(({
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
  baseLayer: controlledBaseLayer,
  onToggleBaseLayer,
}, ref) => {
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
  const isActivelyDraggingRef = useRef<boolean>(false);
  const wasRecentlyDraggedRef = useRef<boolean>(false);

  const [internalBaseLayer, setInternalBaseLayer] = useState<'satellite' | 'osm'>('satellite');
  const baseLayer = controlledBaseLayer ?? internalBaseLayer;
  const setBaseLayer = useCallback(
    (updater: 'satellite' | 'osm' | ((prev: 'satellite' | 'osm') => 'satellite' | 'osm')) => {
      if (onToggleBaseLayer) {
        onToggleBaseLayer();
      } else {
        setInternalBaseLayer((prev) => (typeof updater === 'function' ? updater(prev) : updater));
      }
    },
    [onToggleBaseLayer]
  );
  const [hazardType, setHazardType] = useState<HazardPinType>('bunker');
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);

  const [hazardsExpanded, setHazardsExpanded] = useState<boolean>(true);
  const [isHolePickerOpen, setIsHolePickerOpen] = useState<boolean>(false);
  const [isHudCollapsed, setIsHudCollapsed] = useState<boolean>(() => {
    try {
      return (localStorage.getItem('pocketcaddy_hud_collapsed') === 'true' || localStorage.getItem('caddieline_hud_collapsed') === 'true');
    } catch {
      return false;
    }
  });
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
    if (isActivelyDraggingRef.current || wasRecentlyDraggedRef.current) return;
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
      // @ts-expect-error leaflet-rotate extension option
      rotate: true,
      rotateControl: false,
      touchRotate: false,
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



  // Fit bounds and rotate so the hole is always vertical on the map (Ball at bottom, Pin at top)
  const fitMapToCurrentHole = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ pan: false });

    const origin = effectiveOrigin ?? activeTeeLatLng ?? holeData.teeLatLng;
    const target = activeGreenCenter ?? holeData.greenCenterLatLng;

    // Orient/Rotate map so hole is always vertical (Ball at bottom, Pin at top)
    if (origin && target) {
      const holeBearing = computeBearingDegrees(origin, target);
      try {
        (map as any).setBearing?.(holeBearing);
      } catch {}
    }

    const holePoints: L.LatLngTuple[] = [];
    if (origin) {
      holePoints.push([origin.lat, origin.lng]);
    } else if (activeTeeLatLng) {
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
      // Fit bounds so both pin and ball position markers are seen fairly close to the edges of the viewable screen
      // Top padding 54px (for hole pills & satellite button), bottom padding 68px (for bottom bar)
      map.fitBounds(bounds, {
        paddingTopLeft: [isHudCollapsed ? 60 : 130, 26],
        paddingBottomRight: [68, 26],
        maxZoom: 18.25,
        animate: true,
      });
      return;
    }

    if (holePoints.length === 1) {
      map.setView(holePoints[0], 17, { animate: true });
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
    effectiveOrigin,
    activeTeeLatLng,
    holeData.teeLatLng,
    currentOsmHole,
    activeGreenCenter,
    activeGreenPolygon,
    courseGeometry,
    course?.location,
    playerPosition,
  ]);

  // Track last fitted hole and course so we ONLY auto-fit when changing holes or courses,
  // NEVER when moving/dragging the pin or ball markers or setting coordinates.
  const lastFittedHoleRef = useRef<number | null>(null);
  const lastFittedCourseRef = useRef<string | null>(null);

  useEffect(() => {
    const holeNum = holeData.holeNumber;
    const courseId = course?.placeId ?? '';
    const isNewHoleOrCourse = lastFittedHoleRef.current !== holeNum || lastFittedCourseRef.current !== courseId;
    if (!isNewHoleOrCourse) return;

    lastFittedHoleRef.current = holeNum;
    lastFittedCourseRef.current = courseId;
    setSelectedHazardId(null);
    fitMapToCurrentHole();
    const timer = setTimeout(() => {
      fitMapToCurrentHole();
    }, 60);
    return () => clearTimeout(timer);
  }, [
    holeData.holeNumber,
    course?.placeId,
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

  const toggleOrientation = useCallback(() => {
    const origin = effectiveOrigin ?? activeTeeLatLng ?? holeData.teeLatLng;
    const target = activeGreenCenter ?? holeData.greenCenterLatLng;
    if (!origin || !target) return;
    const map = mapRef.current;
    if (!map) return;
    const currentBearing = (map as any).getBearing?.() ?? 0;
    const holeBearing = computeBearingDegrees(origin, target);
    const nextBearing = Math.abs(currentBearing - holeBearing) < 5 ? 0 : holeBearing;
    try {
      (map as any).setBearing?.(nextBearing);
    } catch {}
  }, [effectiveOrigin, activeTeeLatLng, holeData.teeLatLng, activeGreenCenter, holeData.greenCenterLatLng]);

  useImperativeHandle(ref, () => ({
    toggleBaseLayer: () => {
      setBaseLayer((prev) => (prev === 'satellite' ? 'osm' : 'satellite'));
    },
    toggleOrientation,
    centerHole: () => {
      fitMapToCurrentHole();
    },
    resetDefaults: () => {
      handleResetToDefaults();
    },
  }), [setBaseLayer, toggleOrientation, fitMapToCurrentHole, handleResetToDefaults]);

  // Render interactive markers (Tee, Pin, F/B, Player Ball, Target Reticle, Shots, Manual Hazards)
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    if (isActivelyDraggingRef.current) return;
    layer.clearLayers();
    
    // 1. Tee Marker (Only render if ball is not at the tee to avoid overlapping black rectangle under ball)
    const isBallAtTee =
      Boolean(activeTeeLatLng && effectiveOrigin && computeDistanceMeters(activeTeeLatLng, effectiveOrigin) < 15);

    if (activeTeeLatLng && !isBallAtTee) {
      const m = L.marker([activeTeeLatLng.lat, activeTeeLatLng.lng], {
        draggable: true,
        autoPan: false,
        icon: createBadgeIcon(
          `<div style="padding:2px 6px;border-radius:6px;background:rgba(15,23,42,0.94);color:#fff;border:1px solid rgba(255,255,255,0.8);font-size:10px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.45);white-space:nowrap;">TEE</div>`,
          [34, 20],
          [17, 10]
        ),
      }).addTo(layer);
      m.on('dragstart', () => {
        isActivelyDraggingRef.current = true;
        mapRef.current?.dragging?.disable();
      });
      m.on('dragend', () => {
        mapRef.current?.dragging?.enable();
        const ll = m.getLatLng();
        isActivelyDraggingRef.current = false;
        wasRecentlyDraggedRef.current = true;
        setTimeout(() => {
          wasRecentlyDraggedRef.current = false;
        }, 250);
        onUpdateHolePins({ teeLatLng: { lat: ll.lat, lng: ll.lng } });
      });
    }

    // 2. Green Center Flag Marker
    if (activeGreenCenter) {
      const pinMarker = L.marker([activeGreenCenter.lat, activeGreenCenter.lng], {
        draggable: true,
        autoPan: false,
        zIndexOffset: 600,
        icon: createBadgeIcon(
          `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-8px);cursor:grab;">
            <div style="width:26px;height:26px;border-radius:9999px;background:#E11D48;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:800;box-shadow:0 3px 8px rgba(0,0,0,0.45);">⛳</div>
            <div style="width:6px;height:6px;border-radius:9999px;background:#fff;margin-top:2px;box-shadow:0 1px 3px rgba(0,0,0,0.6);"></div>
          </div>`,
          [28, 34],
          [14, 30]
        ),
      }).addTo(layer);

      pinMarker.on('dragstart', () => {
        isActivelyDraggingRef.current = true;
        mapRef.current?.dragging?.disable();
      });

      pinMarker.on('dragend', () => {
        mapRef.current?.dragging?.enable();
        const ll = pinMarker.getLatLng();
        isActivelyDraggingRef.current = false;
        wasRecentlyDraggedRef.current = true;
        setTimeout(() => {
          wasRecentlyDraggedRef.current = false;
        }, 250);
        onUpdateHolePins({ greenCenterLatLng: { lat: ll.lat, lng: ll.lng } });
      });
    }

    // 3. Green Front / Back Edge Badges with Icons
    if (greenMetrics.frontPoint) {
      const fm = L.marker([greenMetrics.frontPoint.lat, greenMetrics.frontPoint.lng], {
        draggable: Boolean(holeData.greenFrontLatLng),
        autoPan: false,
        interactive: Boolean(holeData.greenFrontLatLng),
        icon: createBadgeIcon(
          `<div style="display:flex;align-items:center;gap:2px;padding:1px 5px;border-radius:4px;background:rgba(6,78,59,0.92);color:#A7F3D0;border:1px solid rgba(52,211,153,0.75);font-size:10px;font-weight:700;touch-action:none;user-select:none;cursor:grab;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>
            <span>F</span>
          </div>`,
          [26, 18],
          [13, 9]
        ),
      }).addTo(layer);
      if (holeData.greenFrontLatLng) {
        fm.on('dragstart', () => {
          isActivelyDraggingRef.current = true;
          mapRef.current?.dragging?.disable();
        });
        fm.on('dragend', () => {
          mapRef.current?.dragging?.enable();
          const ll = fm.getLatLng();
          isActivelyDraggingRef.current = false;
          wasRecentlyDraggedRef.current = true;
          setTimeout(() => {
            wasRecentlyDraggedRef.current = false;
          }, 250);
          onUpdateHolePins({ greenFrontLatLng: { lat: ll.lat, lng: ll.lng } });
        });
      }
    }

    if (greenMetrics.backPoint) {
      const bm = L.marker([greenMetrics.backPoint.lat, greenMetrics.backPoint.lng], {
        draggable: Boolean(holeData.greenBackLatLng),
        autoPan: false,
        interactive: Boolean(holeData.greenBackLatLng),
        icon: createBadgeIcon(
          `<div style="display:flex;align-items:center;gap:2px;padding:1px 5px;border-radius:4px;background:rgba(6,78,59,0.92);color:#A7F3D0;border:1px solid rgba(52,211,153,0.75);font-size:10px;font-weight:700;touch-action:none;user-select:none;cursor:grab;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 13-6-6-6 6"/><path d="M12 7v14"/><path d="M5 3h14"/></svg>
            <span>B</span>
          </div>`,
          [26, 18],
          [13, 9]
        ),
      }).addTo(layer);
      if (holeData.greenBackLatLng) {
        bm.on('dragstart', () => {
          isActivelyDraggingRef.current = true;
          mapRef.current?.dragging?.disable();
        });
        bm.on('dragend', () => {
          mapRef.current?.dragging?.enable();
          const ll = bm.getLatLng();
          isActivelyDraggingRef.current = false;
          wasRecentlyDraggedRef.current = true;
          setTimeout(() => {
            wasRecentlyDraggedRef.current = false;
          }, 250);
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
      const ballMarker = L.marker([effectiveOrigin.lat, effectiveOrigin.lng], {
        draggable: true,
        autoPan: false,
        zIndexOffset: 700,
        icon: L.divIcon({
          className: 'ball-position-marker',
          html: `<div style="width:24px;height:24px;border-radius:50%;background:#0284c7;border:2.5px solid #ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:grab;"><div style="width:7px;height:7px;border-radius:50%;background:#ffffff;"></div></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(layer);

      ballMarker.on('dragstart', () => {
        isActivelyDraggingRef.current = true;
        mapRef.current?.dragging?.disable();
      });

      ballMarker.on('dragend', () => {
        mapRef.current?.dragging?.enable();
        const ll = ballMarker.getLatLng();
        isActivelyDraggingRef.current = false;
        wasRecentlyDraggedRef.current = true;
        setTimeout(() => {
          wasRecentlyDraggedRef.current = false;
        }, 250);
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

    const wireCloseButton = (markerEl?: HTMLElement | null) => {
      const closeBtn = markerEl?.querySelector('#target-reticle-close') as HTMLElement | null;
      if (closeBtn) {
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          onSetTargetPin(null);
        };
      }
    };

    if (!targetMarkerRef.current) {
      const m = L.marker([targetPin.lat, targetPin.lng], {
        draggable: true,
        autoPan: false,
        zIndexOffset: 1000,
        icon: createBadgeIcon(
          `<div style="cursor:grab;touch-action:none;user-select:none;display:flex;flex-direction:column;align-items:center;transform:translateY(-22px);">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:2px 8px;border-radius:8px;background:rgba(13,21,17,0.96);color:#fff;border:1px solid rgba(255,255,255,0.4);box-shadow:0 3px 10px rgba(0,0,0,0.6);">
              <span id="target-reticle-badge" style="font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;">${label}</span>
              <span id="target-reticle-close" style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:9999px;background:rgba(255,255,255,0.25);color:#fff;font-size:10px;font-weight:bold;cursor:pointer;line-height:1;" title="Clear target">✕</span>
            </div>
            <div style="width:36px;height:36px;border-radius:9999px;border:3px solid #FCD34D;background:rgba(251,191,36,0.35);display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px rgba(252,211,77,0.5);">
              <div style="width:8px;height:8px;border-radius:9999px;background:#FCD34D;"></div>
            </div>
          </div>`,
          [180, 64],
          [90, 46]
        ),
      }).addTo(map);
      wireCloseButton(m.getElement());

      m.on('dragstart', () => {
        isActivelyDraggingRef.current = true;
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
        isActivelyDraggingRef.current = false;
        wasRecentlyDraggedRef.current = true;
        setTimeout(() => {
          wasRecentlyDraggedRef.current = false;
        }, 250);
        onSetTargetPin({ lat: ll.lat, lng: ll.lng });
      });

      targetMarkerRef.current = m;
    } else {
      if (!isActivelyDraggingRef.current) {
        targetMarkerRef.current.setLatLng([targetPin.lat, targetPin.lng]);
      }
      const badgeEl = targetMarkerRef.current.getElement()?.querySelector('#target-reticle-badge');
      if (badgeEl) {
        badgeEl.textContent = label;
      }
      wireCloseButton(targetMarkerRef.current.getElement());
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



  return (
    <div className="relative isolate w-full h-full min-h-[380px] bg-[#0B140F] overflow-hidden select-none">
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Top-Left Live Distance HUD Badge & Hole Switcher */}
      <div className="absolute top-3 left-3 z-[400] flex flex-col gap-1.5 w-auto max-w-[215px] sm:max-w-[235px]">
        {isHudCollapsed ? (
          /* Mode 2: Tap-to-Collapse / Ultra-Slim Minimal Pill */
          <div
            className="rounded-xl bg-black/40 backdrop-blur-md border border-white/15 text-white px-1.5 py-1 shadow-2xl flex items-center gap-1 transition-all"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsHolePickerOpen(false);
                const total = Math.max(18, Object.keys(allHoles).length);
                onSelectHole(getPrevHoleNumber(holeData.holeNumber, holeMode, total));
              }}
              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 flex items-center justify-center text-slate-200 active:scale-95 transition-all shrink-0 touch-manipulation"
              aria-label="Previous Hole"
              title="Previous Hole"
            >
              <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsHolePickerOpen((prev) => !prev);
              }}
              className="flex items-baseline gap-1 px-1 py-0.5 rounded hover:bg-white/10 active:scale-95 transition-all text-left"
              title={`Hole ${holeData.holeNumber} (Par ${holeData.par}) - Tap to select hole`}
            >
              <span className="font-display font-black text-xs text-emerald-400">
                H{holeData.holeNumber}
              </span>
              <span className="font-display text-sm font-black text-white tabular-nums">
                {greenMetrics.centerYards !== null
                  ? formatDistanceValue(greenMetrics.centerYards, unit)
                  : formatDistanceValue(holeData.yardage, unit)}
                <span className="text-[10px] text-slate-400 ml-0.5 font-sans font-medium">{suffix}</span>
              </span>
              {suggestedTargetClub && (
                <span className="text-[10px] font-mono font-bold text-emerald-300 ml-0.5 hidden xs:inline">
                  · {suggestedTargetClub.name}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsHolePickerOpen(false);
                const total = Math.max(18, Object.keys(allHoles).length);
                onSelectHole(getNextHoleNumber(holeData.holeNumber, holeMode, total));
              }}
              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 flex items-center justify-center text-slate-200 active:scale-95 transition-all shrink-0 touch-manipulation"
              aria-label="Next Hole"
              title="Next Hole"
            >
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>

            {/* Expand button */}
            <button
              type="button"
              onClick={() => setIsHudCollapsed(false)}
              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-all shrink-0 ml-0.5"
              title="Expand HUD details"
              aria-label="Expand HUD"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          /* Mode 1 & 3: Ghost Translucent HUD */
          <div className="rounded-2xl bg-black/40 backdrop-blur-md border border-white/15 text-white p-2.5 shadow-xl min-w-[190px] max-w-[220px]">
            {/* Row 1: Header - Status & Par + Minimize toggle */}
            <div className="flex items-center justify-between gap-1 text-[11px] pb-1 border-b border-white/10">
              <span className="font-semibold text-emerald-400 truncate">
                {isNearestFallbackGreen
                  ? 'Nearest'
                  : activeGreenCenter
                    ? 'To Green'
                    : 'Hole Dist'}
                {' · Par '}
                {holeData.par}
              </span>
              <button
                type="button"
                onClick={() => setIsHudCollapsed(true)}
                className="w-5 h-5 rounded hover:bg-white/15 text-slate-400 hover:text-white flex items-center justify-center transition-all shrink-0"
                title="Collapse to minimal pill"
                aria-label="Collapse HUD"
              >
                <Minimize2 className="w-3 h-3" />
              </button>
            </div>

            {/* Row 2: Big Distance */}
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-display text-2xl sm:text-3xl font-black tracking-tight tabular-nums leading-none text-white">
                {greenMetrics.centerYards !== null
                  ? formatDistanceValue(greenMetrics.centerYards, unit)
                  : formatDistanceValue(holeData.yardage, unit)}
              </span>
              <span className="text-xs font-semibold text-slate-400">{suffix}</span>
            </div>

            {/* Row 3: Club Rec & Front/Back yardages */}
            <div className="flex items-center justify-between gap-1 mt-1 pt-1 border-t border-white/10 text-xs font-mono">
              {suggestedTargetClub ? (
                <div className="font-bold text-emerald-300 flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-sans font-medium text-slate-400">Rec:</span>
                  <span className="truncate max-w-[75px]">{suggestedTargetClub.name}</span>
                </div>
              ) : (
                <div />
              )}
              {(greenMetrics.frontYards !== null || greenMetrics.backYards !== null) && (
                <div className="flex items-center gap-2 text-[10px] text-slate-300 shrink-0">
                  {greenMetrics.frontYards !== null && (
                    <span className="flex items-center gap-0.5" title="Front of green">
                      <ArrowDownToLine className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="font-bold text-white">
                        {formatDistanceValue(greenMetrics.frontYards, unit)}
                      </span>
                    </span>
                  )}
                  {greenMetrics.backYards !== null && (
                    <span className="flex items-center gap-0.5" title="Back of green">
                      <ArrowUpToLine className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="font-bold text-white">
                        {formatDistanceValue(greenMetrics.backYards, unit)}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Row 4: Hole Switcher & Arrows */}
            <div className="flex items-center justify-between gap-1 mt-1.5 pt-1.5 border-t border-white/10">
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
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-95 transition-all text-slate-200 hover:text-white shrink-0 touch-manipulation"
                      aria-label="Previous Hole"
                      title="Previous Hole"
                    >
                      <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsHolePickerOpen((prev) => !prev);
                      }}
                      className="h-8 px-2.5 rounded-lg flex items-center justify-center gap-1 bg-white/5 hover:bg-white/10 active:scale-95 text-white transition-all shrink-0"
                      title={`Hole ${holeData.holeNumber} (Par ${holeData.par}) - Tap to select hole`}
                      aria-label={`Hole ${holeData.holeNumber}`}
                    >
                      <span className="font-display font-black text-sm text-emerald-400 whitespace-nowrap">
                        Hole {holeData.holeNumber}
                      </span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
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
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-95 transition-all text-slate-200 hover:text-white shrink-0 touch-manipulation"
                      aria-label="Next Hole"
                      title="Next Hole"
                    >
                      <ChevronRight className="w-5 h-5 stroke-[2.5]" />
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* Hole Grid Picker Popover - positioned directly beneath HUD */}
        {isHolePickerOpen && (
          <div className="pointer-events-auto w-full p-2.5 rounded-2xl bg-black/85 backdrop-blur-md border border-white/20 shadow-2xl z-[500] animate-in fade-in zoom-in-95 duration-100">
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
                    className={`h-8 rounded-lg flex flex-col items-center justify-center text-xs font-bold transition-all relative ${
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

        {geometryError && (
          <div className="mt-1 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-500/40 text-[10px] font-medium text-rose-300 flex items-center gap-1 shadow-md max-w-[200px]">
            <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
            <span className="truncate">{geometryError}</span>
          </div>
        )}
      </div>

      {/* Bottom Floating Map Action Toolbar - Centered and Floating */}
      <div className="absolute bottom-3 left-0 right-0 z-[400] flex justify-center pointer-events-none px-3">
        <div className="pointer-events-auto w-fit p-1 rounded-2xl bg-[#0D1511]/94 backdrop-blur-md text-white border border-white/15 shadow-2xl flex items-center justify-center gap-1">
          {/* Ball Position */}
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onChangeTapMode(tapMode === 'drop_ball' ? 'measure' : 'drop_ball');
            }}
            className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all shrink-0 ${
              tapMode === 'drop_ball'
                ? 'bg-sky-400 text-slate-950 shadow-md ring-2 ring-sky-300'
                : 'bg-white/5 hover:bg-white/10 text-slate-200'
            }`}
            title="Set or move ball position"
          >
            <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Ball</span>
          </button>

          {/* Pin Position */}
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onChangeTapMode(tapMode === 'set_green' ? 'measure' : 'set_green');
            }}
            className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all shrink-0 ${
              tapMode === 'set_green'
                ? 'bg-rose-500 text-white shadow-md ring-2 ring-rose-300'
                : 'bg-white/5 hover:bg-white/10 text-slate-200'
            }`}
            title="Set flag / pin position"
          >
            <Flag className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>Pin</span>
          </button>

          {/* Front */}
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onChangeTapMode(tapMode === 'set_green_front' ? 'measure' : 'set_green_front');
            }}
            className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all shrink-0 ${
              tapMode === 'set_green_front'
                ? 'bg-emerald-500 text-slate-950 shadow-md ring-2 ring-emerald-300'
                : 'bg-white/5 hover:bg-white/10 text-slate-200'
            }`}
            title="Set green front edge"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Front</span>
          </button>

          {/* Back */}
          <button
            type="button"
            onClick={() => {
              setIsHolePickerOpen(false);
              onChangeTapMode(tapMode === 'set_green_back' ? 'measure' : 'set_green_back');
            }}
            className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all shrink-0 ${
              tapMode === 'set_green_back'
                ? 'bg-emerald-500 text-slate-950 shadow-md ring-2 ring-emerald-300'
                : 'bg-white/5 hover:bg-white/10 text-slate-200'
            }`}
            title="Set green back edge"
          >
            <ArrowUpToLine className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Back</span>
          </button>

          {/* Clear Target Reticle */}
          {targetPin && (
            <button
              type="button"
              onClick={() => onSetTargetPin(null)}
              className="h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 border border-amber-400/40 transition-all shrink-0 animate-in fade-in duration-100"
              title="Clear target marker"
            >
              <span>✕ Clear</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

OpenGolfHoleMap.displayName = 'OpenGolfHoleMap';

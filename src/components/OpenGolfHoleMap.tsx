import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Flag,
  Layers,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
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
  ShotRecord,
} from '../types/golf';
import {
  computeDistanceMeters,
  computeDistanceYards,
  computePolygonFrontCenterBack,
  formatDistanceValue,
  getHoleStrokes,
  getLieMeta,
  isHazardInPlayCorridor,
  recommendClub,
  unitSuffix,
} from '../utils/golfMath';
import { GpsStatus } from '../hooks/useGeolocation';

interface OpenGolfHoleMapProps {
  course: CourseInfo | null;
  courseGeometry: OsmCourseGeometry | null;
  isLoadingGeometry: boolean;
  geometryError: string | null;
  holeData: HolePinData;
  allHoles: Record<number, HolePinData>;
  allScores: Record<number, HoleScoreState>;
  shots: ShotRecord[];
  unit: DistanceUnit;
  bag: Club[];
  playerPosition: LatLngLiteral | null;
  gpsStatus: GpsStatus;
  gpsAccuracyMeters: number | null;
  isManualPosition: boolean;
  tapMode: MapTapMode;
  targetPin: LatLngLiteral | null;
  onSelectHole: (holeNumber: number) => void;
  onChangeTapMode: (mode: MapTapMode) => void;
  onSetTargetPin: (pos: LatLngLiteral | null) => void;
  onSetManualPlayerPos: (pos: LatLngLiteral) => void;
  onResumeLiveGps: () => void;
  onUpdateHolePins: (patch: Partial<HolePinData>) => void;
  onQuickLogFromMap: (
    endLatLng: LatLngLiteral,
    startLatLng: LatLngLiteral | null,
    yards: number | null
  ) => void;
  onOpenCourseSearch?: () => void;
  onRefreshOsmCourse: () => void;
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
  center: LatLngLiteral;
  polygon?: LatLngLiteral[];
}

const DEFAULT_MAP_CENTER: LatLngLiteral = { lat: 36.5683, lng: -121.9506 }; // Pebble Beach default fallback

function toLatLngTuples(pts: LatLngLiteral[]): L.LatLngTuple[] {
  return pts.map((p) => [p.lat, p.lng] as L.LatLngTuple);
}

function createBadgeIcon(html: string, size: [number, number], anchor: [number, number]): L.DivIcon {
  return L.divIcon({
    className: 'caddieline-div-icon',
    html,
    iconSize: size,
    iconAnchor: anchor,
  });
}

export const OpenGolfHoleMap: React.FC<OpenGolfHoleMapProps> = ({
  course,
  courseGeometry,
  isLoadingGeometry,
  geometryError,
  holeData,
  allHoles,
  allScores,
  shots,
  unit,
  bag,
  playerPosition,
  gpsStatus,
  gpsAccuracyMeters,
  isManualPosition,
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

  const [baseLayer, setBaseLayer] = useState<'satellite' | 'osm'>('satellite');
  const [hazardType, setHazardType] = useState<HazardPinType>('bunker');
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);
  const [hazardsExpanded, setHazardsExpanded] = useState<boolean>(true);
  const [isHolePickerOpen, setIsHolePickerOpen] = useState<boolean>(false);
  const lastFitKeyRef = useRef<string>('');

  const tapModeRef = useRef(tapMode);
  tapModeRef.current = tapMode;

  // Determine if real GPS is far away from the loaded course (> 5km) so remote viewing defaults cleanly to the course
  const isGpsOffCourse = useMemo(() => {
    if (!playerPosition || isManualPosition) return false;
    const refPoint = holeData.greenCenterLatLng ?? holeData.teeLatLng ?? course?.location;
    if (!refPoint) return false;
    return computeDistanceMeters(playerPosition, refPoint) > 5000;
  }, [playerPosition, isManualPosition, holeData.greenCenterLatLng, holeData.teeLatLng, course?.location]);

  // "Where I am standing" origin for all live green/bunker/water yardages
  const effectiveOrigin: LatLngLiteral | null = useMemo(() => {
    if (isManualPosition && playerPosition) return playerPosition;
    const lastShotWithEnd = [...shots].reverse().find((s) => s.endLatLng);
    if (playerPosition && !isGpsOffCourse) return playerPosition;
    if (lastShotWithEnd?.endLatLng) return lastShotWithEnd.endLatLng;
    if (holeData.teeLatLng) return holeData.teeLatLng;
    if (playerPosition) return playerPosition;
    return course?.location ?? null;
  }, [
    isManualPosition,
    playerPosition,
    isGpsOffCourse,
    shots,
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
      activeGreenCenter: holeData.greenCenterLatLng,
      isNearestFallbackGreen: false,
    };
  }, [holeData.greenPolygon, holeData.greenCenterLatLng, holeData.holeNumber, courseGeometry, effectiveOrigin]);

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
          polygon: haz.polygon,
        });
      }
    }

    // Include custom manual hazard pins
    for (const pin of holeData.hazards) {
      const dist = computeDistanceYards(effectiveOrigin, pin.latLng);
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
    if (holeData.teeLatLng) return holeData.teeLatLng;
    if (playerPosition) return playerPosition;
    return course?.location ?? null;
  }, [isPlayerOnCourse, playerPosition, isManualPosition, holeData.teeLatLng, course?.location]);

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
      holeData.teeLatLng ?? activeGreenCenter ?? course?.location ?? DEFAULT_MAP_CENTER;
    const map = L.map(mapContainerRef.current, {
      center: [initial.lat, initial.lng],
      zoom: holeData.teeLatLng || activeGreenCenter ? 17 : course ? 16 : 5,
      zoomControl: false,
      attributionControl: true,
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

  const currentOsmHole = useMemo(
    () => courseGeometry?.holes.find((h) => h.holeNumber === holeData.holeNumber) ?? null,
    [courseGeometry, holeData.holeNumber]
  );

  // Fit bounds tightly to ONLY the selected hole (tee, dogleg path, green polygon, and hole hazards)
  const fitMapToCurrentHole = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ pan: false });

    const holePoints: L.LatLngTuple[] = [];
    if (holeData.teeLatLng) {
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
    if (courseGeometry) {
      for (const haz of [...courseGeometry.bunkers, ...courseGeometry.waters]) {
        if (haz.holeNumber === holeData.holeNumber) {
          holePoints.push([haz.center.lat, haz.center.lng]);
        }
      }
    }

    if (holePoints.length >= 2) {
      const bounds = L.latLngBounds(holePoints);
      map.fitBounds(bounds, {
        paddingTopLeft: [48, 76],
        paddingBottomRight: [48, 88],
        maxZoom: 19,
        animate: true,
      });
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
    holeData.teeLatLng,
    holeData.holeNumber,
    currentOsmHole,
    activeGreenCenter,
    activeGreenPolygon,
    courseGeometry,
    course?.location,
    playerPosition,
  ]);

  useEffect(() => {
    setSelectedHazardId(null);
    const fitKey = `${course?.placeId ?? 'none'}_${holeData.holeNumber}_${Boolean(
      holeData.teeLatLng
    )}_${Boolean(activeGreenCenter)}_${courseGeometry?.fetchedAt ?? 0}`;
    if (lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey;
      fitMapToCurrentHole();
      const raf = requestAnimationFrame(() => fitMapToCurrentHole());
      return () => cancelAnimationFrame(raf);
    }
  }, [
    course?.placeId,
    holeData.holeNumber,
    holeData.teeLatLng,
    activeGreenCenter,
    courseGeometry?.fetchedAt,
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
              `${w.label}: ${formatDistanceValue(res.frontYards, unit)} carry · ${formatDistanceValue(res.backYards, unit)} clear ${unitSuffix(unit)}`,
              { sticky: true, direction: 'top' }
            );
          }
        }
      }

      // 4. Sand bunkers
      for (const b of courseGeometry.bunkers) {
        const isSel = b.id === selectedHazardId;
        const poly = L.polygon(toLatLngTuples(b.polygon), {
          color: isSel ? '#FFFFFF' : '#F59E0B',
          weight: isSel ? 2.5 : 1.5,
          fillColor: '#FDE68A',
          fillOpacity: isSel ? 0.7 : 0.48,
        }).addTo(layer);

        poly.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedHazardId((prev) => (prev === b.id ? null : b.id));
        });

        if (effectiveOrigin) {
          const res = computePolygonFrontCenterBack(effectiveOrigin, b.polygon, b.center);
          if (res && res.frontYards <= 450) {
            poly.bindTooltip(
              `${b.label}: ${formatDistanceValue(res.frontYards, unit)}–${formatDistanceValue(res.backYards, unit)} ${unitSuffix(unit)}`,
              { sticky: true, direction: 'top' }
            );
          }
        }
      }

      // 5. Greens
      for (const g of courseGeometry.greens) {
        const isCurrent = g.holeNumber === holeData.holeNumber;
        const poly = L.polygon(toLatLngTuples(g.polygon), {
          color: isCurrent ? '#FFFFFF' : '#86EFAC',
          weight: isCurrent ? 2.5 : 1.5,
          fillColor: '#22C55E',
          fillOpacity: isCurrent ? 0.42 : 0.28,
        }).addTo(layer);

        poly.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (tapModeRef.current === 'measure') {
            // Let player assign this green to the current hole if unmapped
            if (!isCurrent && g.holeNumber === undefined) {
              onUpdateHolePins({ greenCenterLatLng: g.center, greenPolygon: g.polygon });
            } else {
              onSetTargetPin({ lat: e.latlng.lat, lng: e.latlng.lng });
            }
          } else {
            handleMapClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
          }
        });
      }
    } else if (activeGreenPolygon && activeGreenPolygon.length >= 3) {
      L.polygon(toLatLngTuples(activeGreenPolygon), {
        color: '#FFFFFF',
        weight: 2,
        fillColor: '#22C55E',
        fillOpacity: 0.38,
      }).addTo(layer);
    }

    // Current hole centerline (follows OSM dogleg path when available)
    if (currentOsmHole?.path && currentOsmHole.path.length >= 2) {
      L.polyline(toLatLngTuples(currentOsmHole.path), {
        color: '#FFFFFF',
        weight: 1.75,
        opacity: 0.5,
        dashArray: '6 6',
        interactive: false,
      }).addTo(layer);
    } else if (holeData.teeLatLng && activeGreenCenter) {
      L.polyline(
        [
          [holeData.teeLatLng.lat, holeData.teeLatLng.lng],
          [activeGreenCenter.lat, activeGreenCenter.lng],
        ],
        {
          color: '#FFFFFF',
          weight: 1.5,
          opacity: 0.45,
          dashArray: '6 6',
          interactive: false,
        }
      ).addTo(layer);
    }
  }, [
    courseGeometry,
    currentOsmHole,
    activeGreenPolygon,
    activeGreenCenter,
    holeData.holeNumber,
    holeData.teeLatLng,
    selectedHazardId,
    effectiveOrigin,
    unit,
    onSetTargetPin,
    onUpdateHolePins,
  ]);

  // Render measurement lines & shot trails
  useEffect(() => {
    const layer = linesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    // Shot path
    const shotPathCoords: [number, number][] = [];
    if (holeData.teeLatLng && shots.some((s) => s.endLatLng)) {
      shotPathCoords.push([holeData.teeLatLng.lat, holeData.teeLatLng.lng]);
    }
    shots.forEach((s) => {
      if (s.startLatLng && shotPathCoords.length === 0) {
        shotPathCoords.push([s.startLatLng.lat, s.startLatLng.lng]);
      }
      if (s.endLatLng) {
        shotPathCoords.push([s.endLatLng.lat, s.endLatLng.lng]);
      }
    });
    if (shotPathCoords.length >= 2) {
      L.polyline(shotPathCoords, {
        color: '#10B981',
        weight: 3,
        opacity: 0.95,
      }).addTo(layer);
    }

    // Target reticle lines (when measuring)
    if (measureOrigin && targetPin) {
      // Line from player's location (or tee if off-course) to clicked target point
      L.polyline(
        [
          [measureOrigin.lat, measureOrigin.lng],
          [targetPin.lat, targetPin.lng],
        ],
        { color: '#FFFFFF', weight: 2.5, opacity: 0.95 }
      ).addTo(layer);

      // Line from clicked point to green
      if (activeGreenCenter) {
        L.polyline(
          [
            [targetPin.lat, targetPin.lng],
            [activeGreenCenter.lat, activeGreenCenter.lng],
          ],
          { color: '#FBBF24', weight: 2.5, opacity: 0.95 }
        ).addTo(layer);
      }
    } else if (holeData.teeLatLng && activeGreenCenter) {
      // Direct line from Tee to Green:
      // "When setting the Tee, don't keep tying it to my physical location. Just have a line from the tee to the green."
      L.polyline(
        [
          [holeData.teeLatLng.lat, holeData.teeLatLng.lng],
          [activeGreenCenter.lat, activeGreenCenter.lng],
        ],
        { color: '#34D399', weight: 2.2, opacity: 0.85 }
      ).addTo(layer);
    }

    // Highlighted hazard carry line
    if (effectiveOrigin && selectedHazard) {
      L.polyline(
        [
          [effectiveOrigin.lat, effectiveOrigin.lng],
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
    holeData.teeLatLng,
    shots,
    measureOrigin,
    targetPin,
    activeGreenCenter,
    selectedHazard,
  ]);

  // Render interactive markers (Tee, Pin, F/B, Player Ball, Target Reticle, Shots, Manual Hazards)
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const suffix = unitSuffix(unit);

    // 1. Tee Marker
    if (holeData.teeLatLng) {
      const m = L.marker([holeData.teeLatLng.lat, holeData.teeLatLng.lng], {
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

    // 6. Player Standing / Ball Position Marker (always draggable!)
    if (effectiveOrigin) {
      const m = L.marker([effectiveOrigin.lat, effectiveOrigin.lng], {
        draggable: true,
        zIndexOffset: 500,
        icon: createBadgeIcon(
          `<div style="width:20px;height:20px;border-radius:9999px;background:#0EA5E9;border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;">
            <div style="width:6px;height:6px;border-radius:9999px;background:#FFFFFF;"></div>
          </div>`,
          [20, 20],
          [10, 10]
        ),
      }).addTo(layer);
      m.bindTooltip('You / Ball (drag to move)', { direction: 'top', offset: [0, -10] });
      m.on('dragend', () => {
        const ll = m.getLatLng();
        onSetManualPlayerPos({ lat: ll.lat, lng: ll.lng });
      });
    }

    // 7. Target Reticle
    if (targetPin) {
      const originPrefix = isPlayerOnCourse ? 'From You' : 'From Tee';
      const label =
        distToTarget !== null
          ? `${originPrefix}: ${formatDistanceValue(distToTarget, unit)} ${suffix}${
              distTargetToGreen !== null
                ? ` · ${formatDistanceValue(distTargetToGreen, unit)} to Pin`
                : ''
            }`
          : 'Target';
      const m = L.marker([targetPin.lat, targetPin.lng], {
        draggable: true,
        zIndexOffset: 450,
        icon: createBadgeIcon(
          `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-22px);">
            <div style="margin-bottom:4px;padding:2px 7px;border-radius:6px;background:rgba(13,21,17,0.95);color:#fff;border:1px solid rgba(255,255,255,0.35);font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,0.5);">${label}</div>
            <div style="width:28px;height:28px;border-radius:9999px;border:2px solid #FCD34D;background:rgba(251,191,36,0.2);display:flex;align-items:center;justify-content:center;">
              <div style="width:7px;height:7px;border-radius:9999px;background:#FCD34D;"></div>
            </div>
          </div>`,
          [140, 56],
          [70, 42]
        ),
      }).addTo(layer);
      m.on('drag', () => {
        const ll = m.getLatLng();
        onSetTargetPin({ lat: ll.lat, lng: ll.lng });
      });
      m.on('dragend', () => {
        const ll = m.getLatLng();
        onSetTargetPin({ lat: ll.lat, lng: ll.lng });
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
    onUpdateHolePins,
    onSetManualPlayerPos,
    onSetTargetPin,
  ]);

  const suffix = unitSuffix(unit);
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
      <div className="absolute top-3 left-3 z-[400] flex flex-col gap-2 max-w-[285px] w-[calc(100%-84px)] sm:w-[285px]">
        {/* Quick Hole Picker Bar */}
        <div className="relative">
          <div className="rounded-xl bg-[#0D1511]/92 backdrop-blur-md text-white border border-white/15 p-1 shadow-xl flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => {
                setIsHolePickerOpen(false);
                onSelectHole(Math.max(1, holeData.holeNumber - 1));
              }}
              disabled={holeData.holeNumber <= 1}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 disabled:opacity-35 transition-colors"
              aria-label="Previous hole on map"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsHolePickerOpen((prev) => !prev)}
              className="flex-1 min-h-[36px] px-2 rounded-lg hover:bg-white/10 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors"
              aria-expanded={isHolePickerOpen}
              aria-label="Choose hole number"
            >
              <span className="font-display font-bold text-white">Hole {holeData.holeNumber}</span>
              <span className="text-slate-400">·</span>
              <span className="font-mono text-emerald-300 tabular-nums">Par {holeData.par}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-300 transition-transform ${
                  isHolePickerOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => {
                setIsHolePickerOpen(false);
                onSelectHole(Math.min(18, holeData.holeNumber + 1));
              }}
              disabled={holeData.holeNumber >= 18}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 disabled:opacity-35 transition-colors"
              aria-label="Next hole on map"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {isHolePickerOpen && (
            <div className="mt-1.5 rounded-2xl bg-[#0D1511]/96 backdrop-blur-md text-white border border-white/20 p-2.5 shadow-2xl">
              <div className="flex items-center justify-between mb-2 px-0.5">
                <span className="text-[11px] font-semibold text-slate-300">
                  Jump to Hole (zooms map)
                </span>
                <span className="text-[10px] font-mono text-emerald-300">
                  ● OSM Mapped
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {Array.from({ length: 18 }, (_, idx) => idx + 1).map((num) => {
                  const h = allHoles[num];
                  const strokes = allScores[num] ? getHoleStrokes(allScores[num]) : 0;
                  const active = num === holeData.holeNumber;
                  const isMapped = Boolean(h?.teeLatLng || h?.greenCenterLatLng);
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        onSelectHole(num);
                        setIsHolePickerOpen(false);
                      }}
                      className={`min-h-[42px] rounded-lg border text-center flex flex-col items-center justify-center transition-colors relative ${
                        active
                          ? 'bg-emerald-600 border-emerald-400 text-white font-bold'
                          : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/15'
                      }`}
                    >
                      <span className="text-xs font-mono leading-none">{num}</span>
                      <span className="text-[9px] text-slate-300 font-mono leading-none mt-1">
                        {strokes > 0 ? strokes : `P${h?.par ?? 4}`}
                      </span>
                      {isMapped && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1 right-1"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-[#0D1511]/92 backdrop-blur-md text-white border border-white/15 px-3.5 py-2.5 shadow-xl">
          <div className="flex items-center justify-between gap-2">
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
                : isGpsOffCourse
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

          {(greenMetrics.frontYards !== null || greenMetrics.backYards !== null) && (
            <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-white/10 text-[11px] font-mono text-slate-300 tabular-nums">
              <span>
                Front:{' '}
                <strong className="text-white">
                  {formatDistanceValue(greenMetrics.frontYards, unit)}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Back:{' '}
                <strong className="text-white">
                  {formatDistanceValue(greenMetrics.backYards, unit)}
                </strong>
              </span>
              {activeGreenPolygon && (
                <span className="ml-auto text-[10px] text-emerald-300/90">OSM Green</span>
              )}
            </div>
          )}

          {/* Target Reticle Readout */}
          {targetPin && distToTarget !== null && (
            <div className="mt-1.5 pt-1.5 border-t border-white/10 flex items-center justify-between gap-2 text-[11px]">
              <div className="font-mono tabular-nums text-amber-300">
                Target {formatDistanceValue(distToTarget, unit)}
                {suffix}
                {distTargetToGreen !== null
                  ? ` · Left ${formatDistanceValue(distTargetToGreen, unit)}${suffix}`
                  : ''}
              </div>
              <button
                type="button"
                onClick={() => onSetTargetPin(null)}
                className="text-slate-300 hover:text-white p-1"
                aria-label="Clear target reticle"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* In-Play Bunkers & Water Hazards from standing position */}
          {topHazards.length > 0 && (
            <div className="mt-2 pt-1.5 border-t border-white/10">
              <button
                type="button"
                onClick={() => setHazardsExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-300 hover:text-white py-0.5"
              >
                <span>Bunkers & Hazards ({hazardDistances.length})</span>
                {hazardsExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {hazardsExpanded && (
                <div className="mt-1 space-y-1 max-h-[124px] overflow-y-auto no-scrollbar">
                  {topHazards.map((haz) => {
                    const isSelected = haz.id === selectedHazardId;
                    const dotColor =
                      haz.kind === 'water'
                        ? '#38BDF8'
                        : haz.kind === 'bunker'
                          ? '#FBBF24'
                          : '#FB923C';
                    return (
                      <button
                        key={haz.id}
                        type="button"
                        onClick={() => {
                          setSelectedHazardId((prev) => (prev === haz.id ? null : haz.id));
                          mapRef.current?.panTo([haz.center.lat, haz.center.lng]);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-[11px] transition-colors text-left ${
                          isSelected
                            ? 'bg-white/15 text-white'
                            : 'hover:bg-white/10 text-slate-200'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="truncate">{haz.label}</span>
                        </span>
                        <span className="font-mono font-semibold tabular-nums shrink-0 text-white">
                          {haz.clearYards !== null && haz.clearYards !== haz.carryYards
                            ? `${formatDistanceValue(haz.carryYards, unit)}–${formatDistanceValue(haz.clearYards, unit)}${suffix}`
                            : `${formatDistanceValue(haz.carryYards, unit)}${suffix}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Course Prompt or Loading Banner */}
        {!course && onOpenCourseSearch && (
          <button
            type="button"
            onClick={onOpenCourseSearch}
            className="flex items-center gap-2 rounded-xl bg-white/95 text-[#0F1A14] px-3 py-2 text-xs font-semibold shadow-lg border border-slate-200 hover:bg-emerald-50 transition-colors"
          >
            <Search className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span className="truncate">Find Course (Free OSM Maps)</span>
          </button>
        )}

        {isLoadingGeometry && (
          <div className="rounded-xl bg-[#0D1511]/90 text-emerald-200 px-3 py-2 text-[11px] border border-emerald-400/30 shadow-lg">
            Loading OpenStreetMap greens & bunkers...
          </div>
        )}

        {geometryError && !isLoadingGeometry && (
          <div className="rounded-xl bg-amber-950/95 text-amber-100 px-3 py-2 text-[11px] border border-amber-400/30 shadow-lg flex items-center justify-between gap-2">
            <span className="truncate">{geometryError}</span>
            <button
              type="button"
              onClick={onRefreshOsmCourse}
              className="text-amber-300 hover:text-white font-semibold shrink-0"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Top-Right Quick Map Controls */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col gap-2">
        {onFlipToStats && (
          <button
            type="button"
            onClick={onFlipToStats}
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white border border-emerald-400/40 shadow-lg flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap"
            title="Flip to Stats & Shot Entry"
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>Stats</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setBaseLayer((prev) => (prev === 'satellite' ? 'osm' : 'satellite'))}
          className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#0D1511]/92 backdrop-blur-md text-white border border-white/15 shadow-lg flex items-center justify-center gap-1.5 text-xs font-semibold hover:bg-[#17261E] transition-colors"
          title="Switch Satellite / OpenStreetMap Course Layer"
        >
          <Layers className="w-4 h-4 text-emerald-400" />
          <span className="hidden sm:inline">{baseLayer === 'satellite' ? 'Satellite' : 'OSM Map'}</span>
        </button>

        <button
          type="button"
          onClick={fitMapToCurrentHole}
          className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#0D1511]/92 backdrop-blur-md text-white border border-white/15 shadow-lg flex items-center justify-center gap-1.5 text-xs font-semibold hover:bg-[#17261E] transition-colors"
          title="Center on Current Hole"
        >
          <LocateFixed className="w-4 h-4 text-sky-400" />
          <span className="hidden sm:inline">Center</span>
        </button>

        {course && (
          <button
            type="button"
            onClick={onRefreshOsmCourse}
            disabled={isLoadingGeometry}
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#0D1511]/92 backdrop-blur-md text-white border border-white/15 shadow-lg flex items-center justify-center gap-1.5 text-xs font-semibold hover:bg-[#17261E] disabled:opacity-50 transition-colors"
            title="Refresh OpenStreetMap greens & bunkers"
          >
            <RefreshCw className={`w-4 h-4 text-emerald-300 ${isLoadingGeometry ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Sync OSM</span>
          </button>
        )}

        {isManualPosition && (
          <button
            type="button"
            onClick={onResumeLiveGps}
            className="min-h-[44px] px-3 rounded-xl bg-sky-600/95 text-white border border-sky-300/40 shadow-lg flex items-center justify-center gap-1.5 text-xs font-semibold hover:bg-sky-700 transition-colors whitespace-nowrap"
            title="Resume live phone GPS tracking"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Live GPS</span>
          </button>
        )}
      </div>

      {/* Bottom Map Calibration & Measure Toolbar */}
      <div className="absolute bottom-3 left-3 right-3 z-[400] flex flex-col gap-1.5 pointer-events-none">
        <div className="self-start max-w-full rounded-xl bg-[#0D1511]/92 backdrop-blur-md text-white border border-white/15 p-1.5 shadow-xl pointer-events-auto flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => onChangeTapMode('measure')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              tapMode === 'measure' ? 'bg-emerald-600 text-white' : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Measure</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeTapMode('drop_ball')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              tapMode === 'drop_ball' ? 'bg-sky-600 text-white' : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Drop Ball</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeTapMode('log_shot')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              tapMode === 'log_shot' ? 'bg-emerald-600 text-white' : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Tap Shot End</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeTapMode('set_tee')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              tapMode === 'set_tee' ? 'bg-amber-500 text-slate-950' : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            Set Tee
          </button>
          <button
            type="button"
            onClick={() => onChangeTapMode('set_green')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
              tapMode === 'set_green' ? 'bg-rose-500 text-white' : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            <Flag className="w-3.5 h-3.5" />
            <span>Set Pin</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeTapMode('set_green_front')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              tapMode === 'set_green_front' ? 'bg-teal-500 text-slate-950' : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            Front
          </button>
          <button
            type="button"
            onClick={() => onChangeTapMode('set_green_back')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              tapMode === 'set_green_back' ? 'bg-teal-500 text-slate-950' : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => onChangeTapMode('add_hazard')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              tapMode === 'add_hazard' ? 'bg-amber-500 text-slate-950' : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            + Hazard
          </button>
        </div>

        <div className="self-start flex items-center gap-2 rounded-lg bg-[#0D1511]/88 backdrop-blur-sm text-slate-200 px-2.5 py-1 text-[11px] border border-white/10 pointer-events-auto">
          <span>{tapModePrompt[tapMode]}</span>
          {tapMode === 'add_hazard' && (
            <div className="flex items-center gap-1.5">
              <select
                value={hazardType}
                onChange={(e) => setHazardType(e.target.value as HazardPinType)}
                className="bg-slate-800 text-white rounded px-2 py-0.5 text-[11px] border border-amber-400 font-bold"
              >
                <option value="bunker">Bunker</option>
                <option value="water">Water</option>
                <option value="dogleg">Dogleg</option>
                <option value="layup">Layup</option>
              </select>
              <button
                type="button"
                onClick={() => onChangeTapMode('measure')}
                className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-colors shadow-xs"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

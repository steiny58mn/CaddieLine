import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ClipboardList, Map as MapIcon, Moon, Nfc, Ruler, Smartphone, SmartphoneCharging, Sun } from 'lucide-react';
import {
  AppViewTab,
  Club,
  CourseInfo,
  HolePinData,
  LatLngLiteral,
  MapTapMode,
  OsmCourseGeometry,
  RoundState,
  ShotDirection,
  ShotLie,
  ShotRecord,
} from './types/golf';
import {
  CLUB_PRESETS,
  ClubPreset,
  DEFAULT_CLUB_BAG,
  DEFAULT_PAR_LAYOUT,
  computeDistanceMeters,
  computeDistanceYards,
  createInitialRoundState,
  getHoleStrokes,
  getLieMeta,
  isHolePlayed,
  isShotPutt,
  resolveHoleShotsPutts,
} from './utils/golfMath';
import {
  applyOsmGeometryToHoles,
  fetchCourseGolfGeometry,
  filterGeometryForSubCourse,
  getCachedOsmCourseGeometry,
  summarizeOsmGeometry,
} from './services/osmGolfService';
import {
  applyTeeSetToHoles,
  fetchGolfCourseMatch,
  matchSubCourseNameToGca,
  pickDefaultTee,
} from './services/golfCourseApiService';
import { useGeolocation } from './hooks/useGeolocation';
import { NfcTapPayload, useWebNfc } from './hooks/useWebNfc';
import { OpenGolfHoleMap } from './components/OpenGolfHoleMap';
import { ShotLoggerPanel } from './components/ShotLoggerPanel';
import { ScorecardView } from './components/ScorecardView';
import { StatsView } from './components/StatsView';
import { BagNfcView } from './components/BagNfcView';
import { CourseLandingView } from './components/CourseLandingView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { GpsTapeMeasureModal } from './components/GpsTapeMeasureModal';
import { useWakeLock } from './hooks/useWakeLock';

const STORAGE_KEYS = {
  ROUND: 'caddieline_active_round_v1',
  SAVED_ROUNDS: 'caddieline_saved_rounds_v1',
  BAG: 'caddieline_club_bag_v2',
  AUTO_NFC: 'caddieline_auto_nfc_v1',
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppViewTab>('stats');
  const [statsSubTab, setStatsSubTab] = useState<'entry' | 'analytics'>('entry');
  const [roundJustSaved, setRoundJustSaved] = useState(false);

  // Dark Mode Theme State & Persistence
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('caddieline_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'light';
  });

  useEffect(() => {
    try {
      localStorage.setItem('caddieline_theme', theme);
    } catch {}
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Screen Wake Lock & GPS Tape Measure Modal State
  const wakeLock = useWakeLock();

  const [isTapeMeasureOpen, setIsTapeMeasureOpen] = useState(false);

  const [round, setRound] = useState<RoundState>(() =>
    loadFromStorage(STORAGE_KEYS.ROUND, createInitialRoundState())
  );
  const [savedRounds, setSavedRounds] = useState<RoundState[]>(() =>
    loadFromStorage(STORAGE_KEYS.SAVED_ROUNDS, [])
  );
  const [bag, setBag] = useState<Club[]>(() =>
    loadFromStorage(STORAGE_KEYS.BAG, DEFAULT_CLUB_BAG)
  );
  const [autoLogOnNfc, setAutoLogOnNfc] = useState<boolean>(() =>
    loadFromStorage(STORAGE_KEYS.AUTO_NFC, true)
  );

  // OpenStreetMap course geometry state (greens, bunkers, water hazards, holes)
  const [courseGeometry, setCourseGeometry] = useState<OsmCourseGeometry | null>(() => {
    if (!round.course) return null;
    const baseId = round.course.placeId.split('__')[0];
    const cached = getCachedOsmCourseGeometry(baseId);
    if (!cached) return null;
    return round.course.subCourseId
      ? filterGeometryForSubCourse(cached, round.course.subCourseId)
      : cached;
  });
  const [isLoadingGeometry, setIsLoadingGeometry] = useState(false);
  const [geometryError, setGeometryError] = useState<string | null>(null);

  // Shot logger working state
  const [selectedClubId, setSelectedClubId] = useState<string>('dr');
  const [selectedLie, setSelectedLie] = useState<ShotLie>('fairway');
  const [selectedDirection, setSelectedDirection] = useState<ShotDirection>('straight');
  const [pendingStartLatLng, setPendingStartLatLng] = useState<LatLngLiteral | null>(null);

  // Map interaction state
  const [tapMode, setTapMode] = useState<MapTapMode>('measure');
  const [targetPin, setTargetPin] = useState<LatLngLiteral | null>(null);

  // NFC pairing & toast feedback
  const [pairingTarget, setPairingTarget] = useState<ClubPreset | null>(null);
  const [lastNfcFeedback, setLastNfcFeedback] = useState<string | null>(null);

  const autoStartedCourseRef = useRef<string | null>(null);
  const syncedCourseHolesRef = useRef<string | null>(null);
  const roundRef = useRef<RoundState>(round);
  roundRef.current = round;
  const activeNfcPuttShotIdRef = useRef<string | null>(null);
  const geo = useGeolocation();

  // Keep selectedClubId aligned with saved bag clubs when bag changes
  useEffect(() => {
    if (bag.length === 0) return;
    if (!bag.some((c) => c.id === selectedClubId)) {
      const preferred = bag.find((c) => c.id === 'dr') ?? bag[0];
      setSelectedClubId(preferred.id);
    }
  }, [bag, selectedClubId]);

  // Clear saved confirmation badge after a brief moment
  useEffect(() => {
    if (!roundJustSaved) return;
    const timer = window.setTimeout(() => setRoundJustSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [roundJustSaved]);

  const applyGeometryToRoundHoles = useCallback((geom: OsmCourseGeometry) => {
    const populated = applyOsmGeometryToHoles(geom);
    setRound((prev) => {
      const mergedHoles: Record<number, HolePinData> = {};
      for (let i = 1; i <= 18; i += 1) {
        const existing = prev.holes[i];
        const fresh = populated[i];
        mergedHoles[i] = {
          ...fresh,
          hazards: existing?.hazards ?? [],
          greenFrontLatLng: existing?.greenFrontLatLng,
          greenBackLatLng: existing?.greenBackLatLng,
          teeLatLng: existing?.teeLatLng ?? fresh.teeLatLng,
          greenCenterLatLng: existing?.greenCenterLatLng ?? fresh.greenCenterLatLng,
          greenPolygon: fresh.greenPolygon ?? existing?.greenPolygon,
        };
      }
      const activeTee =
        prev.course?.availableTees?.find((t) => t.id === prev.course?.selectedTeeId) ??
        pickDefaultTee(prev.course?.availableTees ?? []);
      const holesWithTee = activeTee ? applyTeeSetToHoles(mergedHoles, activeTee) : mergedHoles;
      return {
        ...prev,
        holes: holesWithTee,
      };
    });
  }, []);

  // Ensure geometry & accurate OSM hole pars are loaded if resuming a saved round with a course
  useEffect(() => {
    const activeCourse = round.course;
    if (!activeCourse) {
      setCourseGeometry(null);
      syncedCourseHolesRef.current = null;
      return;
    }
    const baseCourseId = activeCourse.placeId.split('__')[0];

    if (courseGeometry?.courseId === baseCourseId) {
      if (syncedCourseHolesRef.current !== activeCourse.placeId && courseGeometry.holes.length > 0) {
        syncedCourseHolesRef.current = activeCourse.placeId;
        applyGeometryToRoundHoles(courseGeometry);
      }
      return;
    }

    const cached = getCachedOsmCourseGeometry(baseCourseId);
    if (cached) {
      const filtered = activeCourse.subCourseId
        ? filterGeometryForSubCourse(cached, activeCourse.subCourseId)
        : cached;
      setCourseGeometry(filtered);
      if (syncedCourseHolesRef.current !== activeCourse.placeId && filtered.holes.length > 0) {
        syncedCourseHolesRef.current = activeCourse.placeId;
        applyGeometryToRoundHoles(filtered);
      }
      return;
    }

    let cancelled = false;
    setIsLoadingGeometry(true);
    setGeometryError(null);
    fetchCourseGolfGeometry(activeCourse)
      .then((geom) => {
        if (!cancelled) {
          setCourseGeometry(geom);
          if (geom.holes.length > 0) {
            syncedCourseHolesRef.current = activeCourse.placeId;
            applyGeometryToRoundHoles(geom);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGeometryError('Could not load OSM course features');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingGeometry(false);
      });

    return () => {
      cancelled = true;
    };
  }, [round.course, courseGeometry, applyGeometryToRoundHoles]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ROUND, JSON.stringify(round));
    } catch {
      // Ignore storage quota errors
    }
  }, [round]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SAVED_ROUNDS, JSON.stringify(savedRounds));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedRounds]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.BAG, JSON.stringify(bag));
    } catch {
      // Ignore storage quota errors
    }
  }, [bag]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.AUTO_NFC, JSON.stringify(autoLogOnNfc));
    } catch {
      // Ignore storage quota errors
    }
  }, [autoLogOnNfc]);

  const currentHoleData = round.holes[round.currentHole] ?? {
    holeNumber: round.currentHole,
    par: 4,
    handicap: round.currentHole,
    yardage: 380,
    hazards: [],
  };
  const currentHoleScore = round.scores[round.currentHole] ?? {
    holeNumber: round.currentHole,
    shots: [],
    manualPutts: 0,
  };

  const roundTotals = useMemo(() => {
    const nums = Array.from({ length: 18 }, (_, i) => i + 1);
    const played = nums.filter((n) => isHolePlayed(round.scores[n]));
    const strokes = nums.reduce((acc, n) => acc + getHoleStrokes(round.scores[n]), 0);
    const parPlayed = played.reduce((acc, n) => acc + (round.holes[n]?.par ?? 4), 0);
    return {
      playedCount: played.length,
      relativeToPar: strokes - parPlayed,
    };
  }, [round]);

  // Previous shot (always shown cleanly on other shots' stat screens)
  const previousShot: ShotRecord | null = useMemo(() => {
    const shots = currentHoleScore.shots;
    const last = shots[shots.length - 1];
    const hasOpenNfc = Boolean(last && last.source === 'nfc' && !last.endLatLng);

    if (hasOpenNfc) {
      if (shots.length >= 2) return shots[shots.length - 2];
    } else if (shots.length >= 1) {
      return shots[shots.length - 1];
    }

    for (let h = round.currentHole - 1; h >= 1; h -= 1) {
      const hShots = round.scores[h]?.shots ?? [];
      if (hShots.length > 0) {
        return hShots[hShots.length - 1];
      }
    }
    return null;
  }, [currentHoleScore.shots, round.currentHole, round.scores]);

  // Auto-calculate shot distance from active open NFC shot, previous lie, or tee to current GPS or target pin
  const currentOriginLatLng: LatLngLiteral | null = useMemo(() => {
    if (pendingStartLatLng) return pendingStartLatLng;
    const shots = currentHoleScore.shots;
    const lastShot = shots[shots.length - 1];
    if (lastShot && !lastShot.endLatLng) {
      return lastShot.startLatLng ?? currentHoleData.teeLatLng ?? null;
    }
    const lastWithEnd = [...shots].reverse().find((s) => s.endLatLng);
    if (lastWithEnd?.endLatLng) return lastWithEnd.endLatLng;
    if (shots.length === 0 && currentHoleData.teeLatLng) return currentHoleData.teeLatLng;
    return null;
  }, [pendingStartLatLng, currentHoleScore.shots, currentHoleData.teeLatLng]);

  const autoDetectedDistanceYards = useMemo(() => {
    if (currentOriginLatLng && geo.position) {
      const dist = computeDistanceYards(currentOriginLatLng, geo.position);
      if (dist >= 0 && dist < 500) return dist;
    }
    if (currentOriginLatLng && targetPin) {
      const dist = computeDistanceYards(currentOriginLatLng, targetPin);
      if (dist >= 0 && dist < 500) return dist;
    }
    return null;
  }, [currentOriginLatLng, geo.position, targetPin]);

  const handleSelectLie = useCallback((lie: ShotLie) => {
    setSelectedLie(lie);

    const nfcPuttShotId = activeNfcPuttShotIdRef.current;
    if (!nfcPuttShotId) return;

    const currentRound = roundRef.current;
    const curHoleScore = currentRound.scores[currentRound.currentHole];
    if (!curHoleScore?.shots.some((s) => s.id === nfcPuttShotId)) return;

    const nextIsPutt = lie === 'green' || lie === 'holed';
    const lieMeta = getLieMeta(lie);

    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      if (!holeScore.shots.some((s) => s.id === nfcPuttShotId)) return prev;

      const prevLoggedPutts = holeScore.shots.filter(isShotPutt).length;
      const extraLegacyPutts = Math.max(0, holeScore.manualPutts - prevLoggedPutts);

      const updatedShots = holeScore.shots.map((s) =>
        s.id === nfcPuttShotId
          ? {
              ...s,
              lie,
              penaltyStrokes: lieMeta.penalty,
              isPutt: nextIsPutt,
            }
          : s
      );

      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            shots: updatedShots,
            manualPutts: updatedShots.filter(isShotPutt).length + extraLegacyPutts,
          },
        },
      };
    });

    setLastNfcFeedback(
      nextIsPutt
        ? `Putter NFC shot set to ${lieMeta.shortLabel} (counted as Putt)`
        : `Putter NFC shot changed to ${lieMeta.shortLabel} (kept as shot, removed from putts)`
    );
  }, []);

  const commitShot = useCallback(
    (params: {
      clubId: string;
      lie: ShotLie;
      direction: ShotDirection;
      distanceYards: number | null;
      startLatLng?: LatLngLiteral;
      endLatLng?: LatLngLiteral;
      source: 'manual' | 'nfc' | 'map';
      isPutt?: boolean;
    }) => {
      activeNfcPuttShotIdRef.current = null;
      const pool = bag.length > 0 ? bag : CLUB_PRESETS;
      const club = pool.find((c) => c.id === params.clubId) ?? pool[0];
      const lieMeta = getLieMeta(params.lie);
      const isPutter =
        club.category === 'putter' ||
        club.id === 'pt' ||
        club.name.toLowerCase().includes('putter');
      const resolvedIsPutt =
        params.isPutt ?? (isPutter && (params.lie === 'green' || params.lie === 'holed'));

      setRound((prev) => {
        const holeNum = prev.currentHole;
        const holeScore = prev.scores[holeNum];
        const nextStrokeNum = holeScore.shots.length + 1;
        const prevLoggedPutts = holeScore.shots.filter(isShotPutt).length;
        const extraLegacyPutts = Math.max(0, holeScore.manualPutts - prevLoggedPutts);

        const newShot: ShotRecord = {
          id: `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          holeNumber: holeNum,
          strokeNumber: nextStrokeNum,
          clubId: club.id,
          clubName: club.name,
          clubShortName: club.shortName,
          lie: params.lie,
          direction: params.direction,
          penaltyStrokes: lieMeta.penalty,
          distanceYards: params.distanceYards,
          startLatLng: params.startLatLng,
          endLatLng: params.endLatLng,
          timestamp: Date.now(),
          source: params.source,
          isPutt: resolvedIsPutt,
        };

        const nextShots = resolveHoleShotsPutts([...holeScore.shots, newShot]);
        const nextManualPutts = nextShots.filter((s) => s.isPutt).length;

        return {
          ...prev,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [holeNum]: {
              ...holeScore,
              shots: nextShots,
              manualPutts: nextManualPutts,
            },
          },
        };
      });

      // Suggest next club logically after logging a shot
      if (params.lie === 'green' || params.lie === 'holed') {
        const putter = pool.find((c) => c.category === 'putter' || c.id === 'pt');
        if (putter) setSelectedClubId(putter.id);
      } else if (club.id === 'dr' || club.category === 'wood') {
        const midIron = pool.find((c) => c.id === '7i') ?? pool[Math.min(5, pool.length - 1)];
        if (midIron) setSelectedClubId(midIron.id);
      }
      setSelectedDirection('straight');
    },
    [bag]
  );

  const handleLogShotManual = useCallback(() => {
    activeNfcPuttShotIdRef.current = null;
    const validDist =
      autoDetectedDistanceYards !== null &&
      !Number.isNaN(autoDetectedDistanceYards) &&
      autoDetectedDistanceYards > 0
        ? autoDetectedDistanceYards
        : null;

    const endPos = geo.position ?? targetPin ?? undefined;
    const lastShot = currentHoleScore.shots[currentHoleScore.shots.length - 1];

    // If an NFC-started shot is currently open, finish & record its outcome instead of duplicating
    if (lastShot && !lastShot.endLatLng) {
      const pool = bag.length > 0 ? bag : CLUB_PRESETS;
      const club = pool.find((c) => c.id === selectedClubId) ?? pool[0];
      const lieMeta = getLieMeta(selectedLie);
      const isPutter =
        club.category === 'putter' ||
        club.id === 'pt' ||
        club.name.toLowerCase().includes('putter');
      const resolvedIsPutt = isPutter && (selectedLie === 'green' || selectedLie === 'holed');
      const startPos = lastShot.startLatLng ?? currentHoleData.teeLatLng;
      const computedEndDist =
        validDist ?? (startPos && endPos ? computeDistanceYards(startPos, endPos) : null);

      setRound((prev) => {
        const holeNum = prev.currentHole;
        const holeScore = prev.scores[holeNum];
        const prevLoggedPutts = holeScore.shots.filter(isShotPutt).length;
        const extraLegacyPutts = Math.max(0, holeScore.manualPutts - prevLoggedPutts);

        const updatedShots = holeScore.shots.map((s, idx) =>
          idx === holeScore.shots.length - 1
            ? {
                ...s,
                clubId: club.id,
                clubName: club.name,
                clubShortName: club.shortName,
                lie: selectedLie,
                direction: selectedDirection,
                penaltyStrokes: lieMeta.penalty,
                distanceYards: computedEndDist,
                endLatLng: endPos,
                isPutt: resolvedIsPutt,
              }
            : s
        );

        const resolved = resolveHoleShotsPutts(updatedShots);
        return {
          ...prev,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [holeNum]: {
              ...holeScore,
              shots: resolved,
              manualPutts: resolved.filter((s) => s.isPutt).length,
            },
          },
        };
      });

      if (endPos) {
        setPendingStartLatLng(endPos);
      }
      setTargetPin(null);
      setSelectedDirection('straight');
      return;
    }

    const startPos =
      currentOriginLatLng ??
      (currentHoleScore.shots.length === 0 ? currentHoleData.teeLatLng : undefined);

    commitShot({
      clubId: selectedClubId,
      lie: selectedLie,
      direction: selectedDirection,
      distanceYards: validDist,
      startLatLng: startPos ?? undefined,
      endLatLng: endPos,
      source: 'manual',
    });

    if (endPos) {
      setPendingStartLatLng(endPos);
    }
    setTargetPin(null);
  }, [
    autoDetectedDistanceYards,
    geo.position,
    targetPin,
    currentOriginLatLng,
    currentHoleScore.shots,
    currentHoleData.teeLatLng,
    bag,
    commitShot,
    selectedClubId,
    selectedLie,
    selectedDirection,
  ]);

  // Add a Putt from the top Putter icon button (records directly in the Hole Shot Log and putts counter)
  const handleAddPutt = useCallback(() => {
    activeNfcPuttShotIdRef.current = null;
    const pool = bag.length > 0 ? bag : CLUB_PRESETS;
    const putter =
      pool.find((c) => c.category === 'putter' || c.id === 'pt') ??
      CLUB_PRESETS.find((c) => c.id === 'pt')!;
    const currentPos = geo.position ?? targetPin ?? undefined;

    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      const teeLatLng = prev.holes[holeNum]?.teeLatLng;
      const prevLoggedPutts = holeScore.shots.filter(isShotPutt).length;
      const extraLegacyPutts = Math.max(0, holeScore.manualPutts - prevLoggedPutts);
      let updatedShots = [...holeScore.shots];

      // Close open NFC approach shot if player walked onto green and tapped +Putt
      if (updatedShots.length > 0) {
        const last = updatedShots[updatedShots.length - 1];
        if (!last.endLatLng) {
          const origin = last.startLatLng ?? teeLatLng;
          const measured = origin && currentPos ? computeDistanceYards(origin, currentPos) : null;
          updatedShots = updatedShots.map((s, idx) =>
            idx === updatedShots.length - 1
              ? {
                  ...s,
                  lie: 'green',
                  endLatLng: currentPos,
                  distanceYards: measured,
                }
              : s
          );
        } else if (last.lie !== 'green' && !last.isPutt) {
          // If the golfer reached the green to putt, the previous approach shot ended on the green
          updatedShots = updatedShots.map((s, idx) =>
            idx === updatedShots.length - 1 ? { ...s, lie: 'green' } : s
          );
        }
      }

      const puttShot: ShotRecord = {
        id: `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        holeNumber: holeNum,
        strokeNumber: updatedShots.length + 1,
        clubId: putter.id,
        clubName: putter.name,
        clubShortName: putter.shortName,
        lie: 'green',
        direction: 'straight',
        penaltyStrokes: 0,
        distanceYards: null,
        startLatLng: currentPos,
        endLatLng: currentPos,
        timestamp: Date.now(),
        source: 'manual',
        isPutt: true,
        isPuttManualOverride: true,
      };

      const nextShots = resolveHoleShotsPutts([...updatedShots, puttShot]);
      const nextPutts = nextShots.filter((s) => s.isPutt).length;

      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            shots: nextShots,
            manualPutts: nextPutts,
          },
        },
      };
    });

    setSelectedClubId(putter.id);
    setSelectedLie('green');
    if (currentPos) {
      setPendingStartLatLng(currentPos);
    }
    setTargetPin(null);
  }, [bag, geo.position, targetPin]);

  // Track Shot manually (begins live walking tracking until next shot/putt/tag)
  const handleTrackShot = useCallback(() => {
    activeNfcPuttShotIdRef.current = null;
    const pool = bag.length > 0 ? bag : CLUB_PRESETS;
    const club = pool.find((c) => c.id === selectedClubId) ?? pool[0];
    const gpsFix = geo.position ?? targetPin ?? undefined;
    const newShotId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let closedShotClub: string | null = null;
    let closedShotYards: number | null = null;

    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      const teeLatLng = prev.holes[holeNum]?.teeLatLng;
      let updatedShots = [...holeScore.shots];

      // End previous open shot if player was tracking another shot
      if (updatedShots.length > 0) {
        const prevShot = updatedShots[updatedShots.length - 1];
        if (!prevShot.endLatLng) {
          const origin = prevShot.startLatLng ?? teeLatLng;
          closedShotClub = prevShot.clubShortName;
          closedShotYards = origin && gpsFix ? computeDistanceYards(origin, gpsFix) : null;
          updatedShots = updatedShots.map((s, idx) =>
            idx === updatedShots.length - 1
              ? {
                  ...s,
                  lie: s.lie === 'green' ? 'green' : selectedLie,
                  endLatLng: gpsFix ?? undefined,
                  distanceYards: closedShotYards,
                }
              : s
          );
        }
      }

      const newShotStart = gpsFix ?? (updatedShots.length === 0 ? teeLatLng : undefined);

      const nextShot: ShotRecord = {
        id: newShotId,
        holeNumber: holeNum,
        strokeNumber: updatedShots.length + 1,
        clubId: club.id,
        clubName: club.name,
        clubShortName: club.shortName,
        lie: selectedLie,
        direction: selectedDirection,
        penaltyStrokes: 0,
        distanceYards: null,
        startLatLng: newShotStart,
        endLatLng: undefined,
        timestamp: Date.now(),
        source: 'manual',
        isPutt: false,
      };

      const resolved = resolveHoleShotsPutts([...updatedShots, nextShot]);
      const nextPutts = resolved.filter((s) => s.isPutt).length;

      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            shots: resolved,
            manualPutts: nextPutts,
          },
        },
      };
    });

    setPendingStartLatLng(gpsFix ?? null);
    const closedSummary =
      closedShotClub !== null
        ? closedShotYards !== null
          ? `Ended ${closedShotClub} (${closedShotYards} yds) · `
          : `Ended ${closedShotClub} · `
        : '';
    setLastNfcFeedback(
      `${closedSummary}Tracking ${club.name} (${club.shortName})${
        gpsFix ? ' · Walking...' : ' · Waiting for GPS fix'
      }`
    );
  }, [bag, selectedClubId, selectedLie, selectedDirection, geo.position, targetPin]);

  const handleQuickLogFromMap = useCallback(
    (endLatLng: LatLngLiteral, startLatLng: LatLngLiteral | null, yards: number | null) => {
      activeNfcPuttShotIdRef.current = null;
      const lastShot = currentHoleScore.shots[currentHoleScore.shots.length - 1];
      if (lastShot && lastShot.source === 'nfc' && !lastShot.endLatLng) {
        const origin = lastShot.startLatLng ?? startLatLng ?? currentHoleData.teeLatLng;
        const computedYards = origin ? computeDistanceYards(origin, endLatLng) : yards;
        setRound((prev) => {
          const holeNum = prev.currentHole;
          const holeScore = prev.scores[holeNum];
          const updatedShots = holeScore.shots.map((s, idx) =>
            idx === holeScore.shots.length - 1
              ? { ...s, endLatLng, distanceYards: computedYards }
              : s
          );
          return {
            ...prev,
            updatedAt: Date.now(),
            scores: {
              ...prev.scores,
              [holeNum]: {
                ...holeScore,
                shots: updatedShots,
              },
            },
          };
        });
        setPendingStartLatLng(endLatLng);
        return;
      }

      commitShot({
        clubId: selectedClubId,
        lie: selectedLie,
        direction: selectedDirection,
        distanceYards: yards,
        startLatLng: startLatLng ?? undefined,
        endLatLng,
        source: 'map',
      });
      setPendingStartLatLng(endLatLng);
    },
    [
      currentHoleScore.shots,
      currentHoleData.teeLatLng,
      commitShot,
      selectedClubId,
      selectedLie,
      selectedDirection,
    ]
  );

  // GolfPad Web NFC Tag Handler
  const handleNfcTagDetected = useCallback(
    async (payload: NfcTapPayload) => {
      // 1. Pairing Mode: bind scanned hardware tag UID to selected/preset club
      if (pairingTarget) {
        const upperTagId = payload.tagId.toUpperCase();
        setBag((prev) => {
          const exists = prev.some((c) => c.id === pairingTarget.id);
          const clearedPrev = prev.map((c) =>
            c.nfcTagId?.toUpperCase() === upperTagId ? { ...c, nfcTagId: undefined } : c
          );
          if (exists) {
            return clearedPrev.map((c) =>
              c.id === pairingTarget.id ? { ...c, nfcTagId: upperTagId } : c
            );
          }
          return [
            ...clearedPrev,
            {
              ...pairingTarget,
              nfcTagId: upperTagId,
            },
          ];
        });
        setSelectedClubId((prevId) =>
          bag.some((c) => c.id === prevId) ? prevId : pairingTarget.id
        );
        setLastNfcFeedback(
          `Paired NFC tag ${upperTagId} to ${pairingTarget.name} (${pairingTarget.shortName}).`
        );
        setPairingTarget(null);
        return;
      }

      // 2. Active Round Mode: match tagId to club in bag
      const matchedClub = bag.find(
        (c) => c.nfcTagId && c.nfcTagId.toUpperCase() === payload.tagId.toUpperCase()
      );

      if (!matchedClub) {
        setLastNfcFeedback(
          `Unpaired NFC tag detected (${payload.tagId}). Open Bag & NFC to assign it to a club.`
        );
        return;
      }

      // Immediately reflect scanned club in the Club Selected dropdown
      setSelectedClubId(matchedClub.id);

      const gpsFix = (await geo.requestSingleFix()) ?? geo.position;

      const isPutter =
        matchedClub.category === 'putter' ||
        matchedClub.id === 'pt' ||
        matchedClub.name.toLowerCase().includes('putter');
      const isDriver =
        matchedClub.id === 'dr' ||
        matchedClub.shortName.toUpperCase() === 'D' ||
        matchedClub.name.toLowerCase().includes('driver');

      const currentRound = roundRef.current;
      const curHoleNum = currentRound.currentHole;
      const curHoleScore = currentRound.scores[curHoleNum];
      const hasExistingShotsOnHole =
        curHoleScore.shots.length > 0 || curHoleScore.manualPutts > 0;
      const shouldAdvanceHole = isDriver && hasExistingShotsOnHole && curHoleNum < 18;
      const targetHoleNum = shouldAdvanceHole ? curHoleNum + 1 : curHoleNum;

      let closedShotClub: string | null = null;
      let closedShotYards: number | null = null;
      if (!shouldAdvanceHole && curHoleScore.shots.length > 0) {
        const lastShot = curHoleScore.shots[curHoleScore.shots.length - 1];
        if (!lastShot.endLatLng) {
          const origin = lastShot.startLatLng ?? currentRound.holes[curHoleNum]?.teeLatLng;
          closedShotClub = lastShot.clubShortName;
          closedShotYards = origin && gpsFix ? computeDistanceYards(origin, gpsFix) : null;
        }
      }

      const newShotId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      if (isPutter) {
        setSelectedLie('green');
        activeNfcPuttShotIdRef.current = newShotId;
      } else {
        activeNfcPuttShotIdRef.current = null;
        if (shouldAdvanceHole) {
          setSelectedLie('fairway');
          setSelectedDirection('straight');
          setTargetPin(null);
        }
      }

      setRound((prev) => {
        const holeNum = shouldAdvanceHole ? Math.min(18, prev.currentHole + 1) : prev.currentHole;
        const holeScore = prev.scores[holeNum];
        const teeLatLng = prev.holes[holeNum]?.teeLatLng;
        const prevLoggedPutts = holeScore.shots.filter(isShotPutt).length;
        const extraLegacyPutts = Math.max(0, holeScore.manualPutts - prevLoggedPutts);
        let updatedShots = [...holeScore.shots];

        // End the active/previous shot at the GPS location of this newly scanned tag (same hole only)
        if (!shouldAdvanceHole && updatedShots.length > 0) {
          const prevShot = updatedShots[updatedShots.length - 1];
          if (!prevShot.endLatLng) {
            const origin = prevShot.startLatLng ?? teeLatLng;
            const measured = origin && gpsFix ? computeDistanceYards(origin, gpsFix) : null;
            updatedShots = updatedShots.map((s, idx) =>
              idx === updatedShots.length - 1
                ? {
                    ...s,
                    lie: isPutter ? 'green' : s.lie,
                    endLatLng: gpsFix ?? undefined,
                    distanceYards: measured,
                  }
                : s
            );
          }
        }

        // If Putter tag is scanned: counts as putt ONLY if previous shot ended on green
        if (isPutter) {
          const prevShot = updatedShots.length > 0 ? updatedShots[updatedShots.length - 1] : null;
          const isPutt = prevShot ? prevShot.lie === 'green' : true;

          const puttShot: ShotRecord = {
            id: newShotId,
            holeNumber: holeNum,
            strokeNumber: updatedShots.length + 1,
            clubId: matchedClub.id,
            clubName: matchedClub.name,
            clubShortName: matchedClub.shortName,
            lie: 'green',
            direction: 'straight',
            penaltyStrokes: 0,
            distanceYards: null,
            startLatLng: gpsFix ?? undefined,
            endLatLng: gpsFix ?? undefined,
            timestamp: Date.now(),
            source: 'nfc',
            isPutt,
          };
          const nextShots = resolveHoleShotsPutts([...updatedShots, puttShot]);
          const nextPutts = nextShots.filter((s) => s.isPutt).length;

          return {
            ...prev,
            currentHole: holeNum,
            updatedAt: Date.now(),
            scores: {
              ...prev.scores,
              [holeNum]: {
                ...holeScore,
                shots: nextShots,
                manualPutts: nextPutts,
              },
            },
          };
        }

        // Non-putter club: start tracking the newly scanned club shot from this GPS location
        const newShotStart = gpsFix ?? (updatedShots.length === 0 ? teeLatLng : undefined);

        const nextShot: ShotRecord = {
          id: newShotId,
          holeNumber: holeNum,
          strokeNumber: updatedShots.length + 1,
          clubId: matchedClub.id,
          clubName: matchedClub.name,
          clubShortName: matchedClub.shortName,
          lie: 'fairway',
          direction: 'straight',
          penaltyStrokes: 0,
          distanceYards: null,
          startLatLng: newShotStart,
          endLatLng: undefined,
          timestamp: Date.now(),
          source: 'nfc',
          isPutt: false,
        };

        return {
          ...prev,
          currentHole: holeNum,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [holeNum]: {
              ...holeScore,
              shots: [...updatedShots, nextShot],
            },
          },
        };
      });

      setPendingStartLatLng(gpsFix ?? null);

      const closedSummary =
        closedShotClub !== null
          ? closedShotYards !== null
            ? `Ended ${closedShotClub} (${closedShotYards} yds) · `
            : `Ended ${closedShotClub} · `
          : '';

      if (isPutter) {
        setLastNfcFeedback(`${closedSummary}Added 1 Putt via Putter NFC (Landed: Green)`);
      } else if (shouldAdvanceHole) {
        setLastNfcFeedback(
          `Moved to Hole ${targetHoleNum} · Started ${matchedClub.name}${
            gpsFix ? ' · Tracking live GPS distance' : ' · Waiting for GPS fix'
          }`
        );
      } else {
        setLastNfcFeedback(
          `${closedSummary}Started ${matchedClub.name}${
            gpsFix ? ' · Tracking live GPS distance' : ' · Waiting for GPS fix'
          }`
        );
      }
    },
    [pairingTarget, bag, geo]
  );

  const nfc = useWebNfc(handleNfcTagDetected);

  // Automatically enable Web NFC when actively on a course
  useEffect(() => {
    const courseId = round.course?.placeId ?? null;
    if (!courseId) {
      autoStartedCourseRef.current = null;
      return;
    }
    if (autoStartedCourseRef.current === courseId) return;
    autoStartedCourseRef.current = courseId;
    if (nfc.isSupported && nfc.status !== 'scanning') {
      void nfc.startScan();
    }
  }, [round.course?.placeId, nfc]);

  const handleStartPairClub = useCallback(
    (club: ClubPreset) => {
      setPairingTarget(club);
      if (nfc.status !== 'scanning') {
        void nfc.startScan();
      }
    },
    [nfc]
  );

  const handleChangeHole = useCallback(
    (holeNumber: number) => {
      activeNfcPuttShotIdRef.current = null;
      const clamped = Math.max(1, Math.min(18, holeNumber));
      setRound((prev) => ({
        ...prev,
        currentHole: clamped,
      }));
      if (geo.isManualOverride) {
        geo.resumeLiveGps();
      }
      setPendingStartLatLng(null);
      setTargetPin(null);
      const defaultClub =
        bag.length > 0 ? bag.find((c) => c.id === 'dr')?.id ?? bag[0].id : 'dr';
      setSelectedClubId(defaultClub);
      setSelectedLie('fairway');
      setSelectedDirection('straight');
    },
    [geo, bag]
  );

  const handleUpdateHoleMeta = useCallback((holeNumber: number, patch: Partial<HolePinData>) => {
    setRound((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      holes: {
        ...prev.holes,
        [holeNumber]: {
          ...prev.holes[holeNumber],
          ...patch,
        },
      },
    }));
  }, []);

  const handleUpdateShot = useCallback((shotId: string, updates: Partial<ShotRecord>) => {
    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      if (!holeScore) return prev;

      const updatedShots = holeScore.shots.map((s) => {
        if (s.id !== shotId) return s;
        const merged: ShotRecord = { ...s, ...updates };

        if (updates.lie !== undefined && updates.penaltyStrokes === undefined) {
          merged.penaltyStrokes = getLieMeta(merged.lie).penalty;
        }
        return merged;
      });

      // Sequential golf rule resolution:
      // Non-putters are never putts (regardless of landing lie).
      // Putter strokes count as putts only if the previous shot landed on the green.
      const resolved = resolveHoleShotsPutts(updatedShots);
      const nextPutts = resolved.filter((s) => s.isPutt).length;

      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            shots: resolved,
            manualPutts: nextPutts,
          },
        },
      };
    });
  }, []);

  const handleDeleteShot = useCallback((shotId: string) => {
    if (activeNfcPuttShotIdRef.current === shotId) {
      activeNfcPuttShotIdRef.current = null;
    }
    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      const prevLoggedPutts = holeScore.shots.filter(isShotPutt).length;
      const extraLegacyPutts = Math.max(0, holeScore.manualPutts - prevLoggedPutts);
      const filtered = holeScore.shots.filter((s) => s.id !== shotId);
      const resolved = resolveHoleShotsPutts(filtered);
      const remainingPutts = resolved.filter((s) => s.isPutt).length;
      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            shots: resolved,
            manualPutts: remainingPutts,
          },
        },
      };
    });
  }, []);

  const handleAddPenalty = useCallback(() => {
    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      if (!holeScore) return prev;

      if (holeScore.shots.length > 0) {
        const updated = holeScore.shots.map((s, idx) =>
          idx === holeScore.shots.length - 1
            ? { ...s, penaltyStrokes: (s.penaltyStrokes || 0) + 1 }
            : s
        );
        return {
          ...prev,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [holeNum]: {
              ...holeScore,
              shots: updated,
            },
          },
        };
      }

      const penShot: ShotRecord = {
        id: `shot_${Date.now()}_pen`,
        holeNumber: holeNum,
        strokeNumber: 1,
        clubId: 'pen',
        clubName: 'Penalty',
        clubShortName: 'PEN',
        lie: 'water',
        direction: 'straight',
        penaltyStrokes: 1,
        distanceYards: null,
        timestamp: Date.now(),
        source: 'manual',
        isPutt: false,
      };

      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            shots: [penShot],
          },
        },
      };
    });

    setLastNfcFeedback('Added +1 Penalty Stroke');
  }, []);

  const handleUndoLastShot = useCallback(() => {
    let nextOrigin: LatLngLiteral | null = null;
    const currentRound = roundRef.current;
    const curShots = currentRound.scores[currentRound.currentHole]?.shots ?? [];
    const lastBeforeUndo = curShots[curShots.length - 1];
    if (lastBeforeUndo && lastBeforeUndo.id === activeNfcPuttShotIdRef.current) {
      activeNfcPuttShotIdRef.current = null;
    }

    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];

      if (holeScore.shots.length > 0) {
        const remainingShots = resolveHoleShotsPutts(holeScore.shots.slice(0, -1));
        const remainingPutts = remainingShots.filter((s) => s.isPutt).length;
        const nextLast = remainingShots[remainingShots.length - 1];
        nextOrigin = nextLast?.endLatLng ?? nextLast?.startLatLng ?? null;

        return {
          ...prev,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [holeNum]: {
              ...holeScore,
              shots: remainingShots,
              manualPutts: remainingPutts,
            },
          },
        };
      }

      if (holeScore.manualPutts > 0) {
        return {
          ...prev,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [holeNum]: {
              ...holeScore,
              manualPutts: holeScore.manualPutts - 1,
            },
          },
        };
      }

      return prev;
    });
    setPendingStartLatLng(nextOrigin);
  }, []);

  const handleOverrideHoleScore = useCallback((holeNumber: number, score: number | undefined) => {
    setRound((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      scores: {
        ...prev.scores,
        [holeNumber]: {
          ...prev.scores[holeNumber],
          manualScoreOverride: score,
        },
      },
    }));
  }, []);

  const handleSelectCourse = useCallback(
    (course: CourseInfo, geometry: OsmCourseGeometry) => {
      setCourseGeometry(geometry);
      setGeometryError(null);
      syncedCourseHolesRef.current = course.placeId;
      const osmHoles = applyOsmGeometryToHoles(geometry);
      const selectedTee =
        course.availableTees?.find((t) => t.id === course.selectedTeeId) ??
        pickDefaultTee(course.availableTees ?? []);
      const populatedHoles = selectedTee ? applyTeeSetToHoles(osmHoles, selectedTee) : osmHoles;
      const hydratedCourse: CourseInfo = selectedTee
        ? { ...course, selectedTeeId: selectedTee.id }
        : course;

      // Ensure all 18 holes have baseline data
      for (let i = 1; i <= 18; i += 1) {
        if (!populatedHoles[i]) {
          const def = DEFAULT_PAR_LAYOUT[i - 1];
          populatedHoles[i] = {
            holeNumber: i,
            par: def.par,
            handicap: def.handicap,
            yardage: def.yardage,
            hazards: [],
          };
        }
      }

      // Determine starting hole: detect nearest tee if player is on the course (< 5km), else default to Hole #1
      let startingHole = 1;
      if (geo.position && hydratedCourse.location && computeDistanceMeters(geo.position, hydratedCourse.location) <= 5000) {
        let closestDist = 350;
        for (let num = 1; num <= 18; num += 1) {
          const tee = populatedHoles[num]?.teeLatLng;
          if (!tee) continue;
          const dist = computeDistanceMeters(geo.position, tee);
          if (dist < closestDist) {
            closestDist = dist;
            startingHole = num;
          }
        }
      }

      const freshRound = createInitialRoundState(hydratedCourse);
      freshRound.currentHole = startingHole;
      freshRound.holes = populatedHoles;
      setRound(freshRound);

      setPendingStartLatLng(null);
      setTargetPin(null);
      setLastNfcFeedback(null);
      setRoundJustSaved(false);
      setStatsSubTab('entry');
      setActiveTab('stats');

      if (nfc.isSupported && nfc.status !== 'scanning') {
        void nfc.startScan();
      }
    },
    [geo.position, nfc]
  );

  const handleSelectTee = useCallback((teeId: string) => {
    setRound((prev) => {
      const tee = prev.course?.availableTees?.find((t) => t.id === teeId);
      if (!tee || !prev.course) return prev;
      return {
        ...prev,
        updatedAt: Date.now(),
        course: {
          ...prev.course,
          selectedTeeId: tee.id,
        },
        holes: applyTeeSetToHoles(prev.holes, tee),
      };
    });
  }, []);

  const handleRefreshOsmCourse = useCallback(async () => {
    if (!round.course) return;
    setIsLoadingGeometry(true);
    setGeometryError(null);
    try {
      const [geometry, gcaMatchRes] = await Promise.all([
        fetchCourseGolfGeometry(round.course, true),
        !round.course.availableTees?.length
          ? fetchGolfCourseMatch(round.course)
          : Promise.resolve({ configured: true, matches: [] }),
      ]);
      setCourseGeometry(geometry);
      const summary = summarizeOsmGeometry(geometry);
      const populatedHoles = applyOsmGeometryToHoles(geometry);
      const matchedGca = gcaMatchRes.matches.length
        ? matchSubCourseNameToGca(round.course.subCourseName || round.course.courseName, gcaMatchRes.matches)
        : undefined;

      setRound((prev) => {
        const mergedHoles: Record<number, HolePinData> = {};
        for (let i = 1; i <= 18; i += 1) {
          const existing = prev.holes[i];
          const fresh = populatedHoles[i];
          mergedHoles[i] = {
            ...fresh,
            hazards: existing?.hazards ?? [],
            greenFrontLatLng: existing?.greenFrontLatLng,
            greenBackLatLng: existing?.greenBackLatLng,
            teeLatLng: existing?.teeLatLng ?? fresh.teeLatLng,
            greenCenterLatLng: existing?.greenCenterLatLng ?? fresh.greenCenterLatLng,
            greenPolygon: fresh.greenPolygon ?? existing?.greenPolygon,
          };
        }
        const nextTees = prev.course?.availableTees?.length
          ? prev.course.availableTees
          : matchedGca?.tees;
        const activeTee =
          nextTees?.find((t) => t.id === prev.course?.selectedTeeId) ??
          pickDefaultTee(nextTees ?? []);
        const holesWithTee = activeTee ? applyTeeSetToHoles(mergedHoles, activeTee) : mergedHoles;

        return {
          ...prev,
          course: prev.course
            ? {
                ...prev.course,
                osmSummary: summary,
                availableTees: nextTees,
                selectedTeeId: activeTee?.id ?? prev.course.selectedTeeId,
                golfCourseApiId: prev.course.golfCourseApiId ?? matchedGca?.id,
              }
            : prev.course,
          holes: holesWithTee,
          updatedAt: Date.now(),
        };
      });
    } catch {
      setGeometryError('Overpass sync failed');
    } finally {
      setIsLoadingGeometry(false);
    }
  }, [round.course]);

  const handleSaveRound = useCallback(() => {
    const snapshot: RoundState = {
      ...round,
      updatedAt: Date.now(),
    };
    setRound(snapshot);
    setSavedRounds((prev) => [snapshot, ...prev.filter((r) => r.id !== snapshot.id)].slice(0, 20));
    setRoundJustSaved(true);
  }, [round]);

  const handleResetRound = useCallback(() => {
    const hasData = Object.values(round.scores).some(
      (s) => s.shots.length > 0 || s.manualPutts > 0 || s.manualScoreOverride !== undefined
    );
    if (hasData) {
      const snapshot = { ...round, updatedAt: Date.now() };
      setSavedRounds((prev) => [snapshot, ...prev.filter((r) => r.id !== snapshot.id)].slice(0, 20));
    }
    setRound(createInitialRoundState(null));
    syncedCourseHolesRef.current = null;
    setPendingStartLatLng(null);
    setTargetPin(null);
    setLastNfcFeedback(null);
    setRoundJustSaved(false);
    setStatsSubTab('entry');
    setActiveTab('stats');
    nfc.stopScan();
  }, [round, nfc]);

  // If the user switches to Map while far away from the course with no manual position and no shots yet, focus Hole #1
  const handleSelectNavTab = useCallback(
    (tab: AppViewTab) => {
      if (
        tab === 'map' &&
        round.course &&
        !geo.isManualOverride &&
        (!geo.position || computeDistanceMeters(geo.position, round.course.location) > 5000) &&
        roundTotals.playedCount === 0
      ) {
        setRound((prev) => (prev.currentHole === 1 ? prev : { ...prev, currentHole: 1 }));
      }
      setActiveTab(tab);
    },
    [round.course, geo.isManualOverride, geo.position, roundTotals.playedCount]
  );

  const navItems: Array<{ id: AppViewTab; label: string; icon: React.ReactNode }> = [
    { id: 'stats', label: 'Stats', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'map', label: 'Map', icon: <MapIcon className="w-5 h-5" /> },
    { id: 'scorecard', label: 'Scorecard', icon: <ClipboardList className="w-5 h-5" /> },
    { id: 'bag', label: 'Bag & NFC', icon: <Nfc className="w-5 h-5" /> },
  ];

  const isCourseChosen = Boolean(round.course);
  const pairedClubsCount = bag.filter((c) => Boolean(c.nfcTagId)).length;

  return (
    <div className="h-full flex flex-col bg-[#F4F7F4] dark:bg-[#07100a] text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <header className="h-14 sm:h-16 px-3 sm:px-6 bg-white/90 dark:bg-[#0c160f]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2 sm:gap-4 shrink-0 z-30 transition-colors shadow-2xs">
        {/* Brand / Logo */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleSelectNavTab('stats')}
            className="flex items-center gap-2 group text-left transition-transform active:scale-95"
            aria-label="CaddieLine Home"
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-400 p-0.5 shadow-md shadow-emerald-500/25 flex items-center justify-center text-white">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M4 3v18h2v-7h11l-1.5-4.5L17 5H6V3H4z" />
              </svg>
            </div>
            <div className="hidden xs:block leading-none">
              <span className="font-display text-lg sm:text-xl font-black tracking-tight bg-gradient-to-r from-emerald-900 via-emerald-700 to-teal-700 dark:from-emerald-300 dark:via-emerald-400 dark:to-teal-300 bg-clip-text text-transparent">
                CaddieLine
              </span>
              <span className="block text-[9px] font-bold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/70 font-mono mt-0.5">
                GPS · NFC Caddie
              </span>
            </div>
          </button>
        </div>

        {/* Center Navigation Tabs for Desktop / Tablet */}
        {isCourseChosen && (
          <nav
            className="hidden md:flex items-center gap-1 p-1 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl border border-slate-200/60 dark:border-slate-700/60"
            aria-label="Primary navigation"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectNavTab(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    active
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30 scale-[1.02]'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/60'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Right Tools & Status Strip */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 min-w-0">
          {/* Live GPS Status Indicator */}
          {geo.position && (
            <div
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700/70 text-slate-600 dark:text-slate-300 text-[11px] font-mono tabular-nums shadow-2xs"
              title={`GPS Accuracy: ±${geo.accuracyMeters ? Math.round(geo.accuracyMeters * 3.28084) : '?'} ft`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>GPS</span>
              {geo.accuracyMeters && (
                <span className="text-slate-400 font-semibold">
                  ±{Math.round(geo.accuracyMeters * 3.28084)}ft
                </span>
              )}
            </div>
          )}

          {/* GPS Tape Measure icon button at the very top */}
          <button
            type="button"
            onClick={() => setIsTapeMeasureOpen(true)}
            className="h-9 w-9 rounded-xl border border-emerald-200/80 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/40 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 flex items-center justify-center shrink-0 transition-all shadow-2xs active:scale-95"
            title="GPS Tape Measure (Feet & Inches)"
            aria-label="Open GPS Tape Measure"
          >
            <Ruler className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          </button>

          {/* Screen Wake Lock button */}
          {wakeLock.isSupported && (
            <button
              type="button"
              onClick={() => {
                if (wakeLock.isWakeLockActive) {
                  void wakeLock.releaseWakeLock();
                } else {
                  void wakeLock.requestWakeLock();
                }
              }}
              className={`h-9 px-2.5 sm:px-3 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all shadow-2xs active:scale-95 ${
                wakeLock.isWakeLockActive
                  ? 'border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
              title={
                wakeLock.isWakeLockActive
                  ? 'Screen stays awake for continuous NFC scanning (Tap to allow sleep)'
                  : 'Keep screen awake to prevent phone sleep during round'
              }
              aria-label="Toggle screen wake lock"
            >
              {wakeLock.isWakeLockActive ? (
                <SmartphoneCharging className="w-4 h-4 text-white shrink-0 animate-pulse" />
              ) : (
                <Smartphone className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <span className="hidden sm:inline">
                {wakeLock.isWakeLockActive ? 'Screen ON' : 'Keep Awake'}
              </span>
            </button>
          )}

          {/* Dark Mode Toggle */}
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 transition-all shadow-2xs active:scale-95"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle dark mode"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            )}
          </button>

          {isCourseChosen ? (
            <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">{round.course?.name}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setActiveTab((prev) => (prev === 'bag' ? 'stats' : 'bag'))}
              className="h-9 px-3 sm:px-3.5 rounded-xl border border-emerald-200/80 dark:border-emerald-800/80 bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-[#0F1A14] dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors shadow-2xs"
            >
              <Nfc className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{activeTab === 'bag' ? 'Choose Course' : 'Bag & NFC'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
        {!isCourseChosen && activeTab !== 'bag' && (
          <CourseLandingView
            userPosition={geo.position}
            savedRounds={savedRounds}
            pairedClubsCount={pairedClubsCount}
            onSelectCourse={handleSelectCourse}
            onLoadSavedRound={(loaded) => {
              setRound(loaded);
              setStatsSubTab('entry');
              setActiveTab('stats');
            }}
            onDeleteSavedRound={(id) =>
              setSavedRounds((prev) => prev.filter((item) => item.id !== id))
            }
            onOpenBagNfc={() => setActiveTab('bag')}
          />
        )}

        {isCourseChosen && activeTab === 'stats' && (
          <div className="h-full flex flex-col lg:grid lg:grid-cols-[440px_1fr] pb-14 md:pb-0">
            {/* Mobile Sub-Switcher: Small toggle to switch between Hole Stats and Round Analytics (fully supports dark mode) */}
            <div className="lg:hidden px-3 py-1.5 bg-slate-50 dark:bg-[#0c160f] border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between shrink-0">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {statsSubTab === 'entry' ? `Hole ${round.currentHole} Log` : 'Round Stats'}
              </span>
              <div className="flex items-center gap-1 p-0.5 bg-slate-200/80 dark:bg-slate-800/80 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => setStatsSubTab('entry')}
                  className={`px-3 py-1 rounded-lg font-bold text-xs transition-all ${
                    statsSubTab === 'entry'
                      ? 'bg-white dark:bg-emerald-600 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Hole Stats
                </button>
                <button
                  type="button"
                  onClick={() => setStatsSubTab('analytics')}
                  className={`px-3 py-1 rounded-lg font-bold text-xs transition-all ${
                    statsSubTab === 'analytics'
                      ? 'bg-white dark:bg-emerald-600 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Analytics
                </button>
              </div>
            </div>

            {/* Left Column (Desktop) / Entry Tab (Mobile): Hole & Shot Stat Entry */}
            <div
              className={`${
                statsSubTab === 'entry' ? 'flex-1 min-h-0' : 'hidden'
              } lg:block lg:h-full lg:min-h-0 lg:overflow-hidden`}
            >
              <ShotLoggerPanel
                holeData={currentHoleData}
                allHoles={round.holes}
                allScores={round.scores}
                holeScore={currentHoleScore}
                previousShot={previousShot}
                subCourseName={round.course?.subCourseName}
                bag={bag}
                unit={round.unit}
                selectedClubId={selectedClubId}
                selectedLie={selectedLie}
                selectedDirection={selectedDirection}
                autoDetectedDistanceYards={autoDetectedDistanceYards}
                lastNfcFeedback={lastNfcFeedback}
                onSelectHole={handleChangeHole}
                onSelectClub={setSelectedClubId}
                onSelectLie={handleSelectLie}
                onSelectDirection={setSelectedDirection}
                onLogShot={handleLogShotManual}
                onAddPutt={handleAddPutt}
                onUpdateShot={handleUpdateShot}
                onAddPenalty={handleAddPenalty}
                onTrackShot={handleTrackShot}
                onDeleteShot={handleDeleteShot}
                onUndoLastShot={handleUndoLastShot}
                onPrevHole={() => handleChangeHole(round.currentHole - 1)}
                onNextHole={() => handleChangeHole(round.currentHole + 1)}
                onOpenBagNfc={() => setActiveTab('bag')}
              />
            </div>

            {/* Right Column (Desktop) / Analytics Tab (Mobile): Shot Dispersion & Club Analytics */}
            <div
              className={`${
                statsSubTab === 'analytics' ? 'flex-1 overflow-y-auto' : 'hidden'
              } lg:block lg:h-full lg:overflow-y-auto`}
            >
              <StatsView
                round={round}
                savedRounds={savedRounds}
                roundJustSaved={roundJustSaved}
                onSaveRound={handleSaveRound}
                onResetRound={handleResetRound}
                onLoadRound={(loaded) => {
                  setRound(loaded);
                  setStatsSubTab('entry');
                  setActiveTab('stats');
                }}
                onDeleteSavedRound={(id) =>
                  setSavedRounds((prev) => prev.filter((item) => item.id !== id))
                }
              />
            </div>
          </div>
        )}

        {isCourseChosen && activeTab === 'map' && (
          <div className="h-full relative isolate z-0 pb-14 md:pb-0">
            <OpenGolfHoleMap
              course={round.course}
              courseGeometry={courseGeometry}
              isLoadingGeometry={isLoadingGeometry}
              geometryError={geometryError}
              holeData={currentHoleData}
              allHoles={round.holes}
              allScores={round.scores}
              shots={currentHoleScore.shots}
              unit={round.unit}
              bag={bag}
              playerPosition={geo.position}
              gpsStatus={geo.status}
              gpsAccuracyMeters={geo.accuracyMeters}
              isManualPosition={geo.isManualOverride}
              tapMode={tapMode}
              targetPin={targetPin}
              onSelectHole={handleChangeHole}
              onChangeTapMode={setTapMode}
              onSetTargetPin={setTargetPin}
              onSetManualPlayerPos={geo.setManualPosition}
              onResumeLiveGps={geo.resumeLiveGps}
              onUpdateHolePins={(patch) => handleUpdateHoleMeta(round.currentHole, patch)}
              onQuickLogFromMap={handleQuickLogFromMap}
              onRefreshOsmCourse={() => void handleRefreshOsmCourse()}
              onFlipToStats={() => {
                setStatsSubTab('entry');
                setActiveTab('stats');
              }}
            />
          </div>
        )}

        {isCourseChosen && activeTab === 'scorecard' && (
          <div className="h-full overflow-y-auto">
            <ScorecardView
              round={round}
              roundJustSaved={roundJustSaved}
              onSelectHole={(num) => {
                handleChangeHole(num);
                setStatsSubTab('entry');
                setActiveTab('stats');
              }}
              onUpdateHoleMeta={handleUpdateHoleMeta}
              onOverrideHoleScore={handleOverrideHoleScore}
              onSelectTee={handleSelectTee}
              onSaveRound={handleSaveRound}
              onResetRound={handleResetRound}
            />
          </div>
        )}

        {activeTab === 'bag' && (
          <div className="h-full overflow-y-auto">
            <BagNfcView
              bag={bag}
              unit={round.unit}
              nfcSupported={nfc.isSupported}
              nfcStatus={nfc.status}
              nfcError={nfc.errorMessage}
              lastNfcTap={nfc.lastTap}
              pairingTarget={pairingTarget}
              autoLogOnNfc={autoLogOnNfc}
              onChangeUnit={(unit) => setRound((prev) => ({ ...prev, unit }))}
              onToggleAutoLogOnNfc={setAutoLogOnNfc}
              onStopNfcScan={nfc.stopScan}
              onStartPairClub={handleStartPairClub}
              onCancelPairing={() => setPairingTarget(null)}
              onUpdateClub={(clubId, patch) =>
                setBag((prev) => prev.map((c) => (c.id === clubId ? { ...c, ...patch } : c)))
              }
              onAddClub={(club) => setBag((prev) => [...prev, club])}
              onDeleteClub={(clubId) => setBag((prev) => prev.filter((c) => c.id !== clubId))}
              onSimulateTagTap={(tagId) => {
                nfc.simulateTap(tagId);
              }}
            />
          </div>
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb Navigation Bar (only active once a course is chosen) */}
      {isCourseChosen && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/90 dark:bg-[#0c160f]/90 backdrop-blur-lg border-t border-slate-200/80 dark:border-slate-800/80 px-2 grid grid-cols-4 items-center shadow-2xl"
          aria-label="Mobile navigation"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNavTab(item.id)}
                className={`h-12 mx-1 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${
                  active
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30 font-bold scale-[1.04]'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {item.icon}
                <span className="text-[10px] tracking-tight leading-none whitespace-nowrap font-bold">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      <OfflineIndicator />

      {/* GPS Tape Measure Modal (Feet & Inches) */}
      <GpsTapeMeasureModal
        isOpen={isTapeMeasureOpen}
        onClose={() => setIsTapeMeasureOpen(false)}
        userPosition={geo.position}
        accuracyMeters={geo.accuracyMeters}
      />

    </div>
  );
}

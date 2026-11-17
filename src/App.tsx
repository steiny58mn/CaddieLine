import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ClipboardList, Flag, Map as MapIcon, Moon, Nfc, Smartphone, SmartphoneCharging, Sun } from 'lucide-react';
import {
  AppViewTab,
  Club,
  CourseInfo,
  HolePinData,
  LatLngLiteral,
  MapTapMode,
  OsmCourseGeometry,
  RoundHoleMode,
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
  getNextHoleNumber,
  getPrevHoleNumber,
  isClubHigherThanPW,
  isHolePlayed,
  isPutterClub,
  isShotPutt,
  isUserAtGolfCourse,
  recalculateClubAverages,
  resolveHoleShotsPutts,
  sortGolfClubs,
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
import { useWakeLock } from './hooks/useWakeLock';
import { usePocketMode } from './hooks/usePocketMode';

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
  const pocketMode = usePocketMode();


  const [round, setRound] = useState<RoundState>(() =>
    loadFromStorage(STORAGE_KEYS.ROUND, createInitialRoundState())
  );
  const [savedRounds, setSavedRounds] = useState<RoundState[]>(() =>
    loadFromStorage(STORAGE_KEYS.SAVED_ROUNDS, [])
  );
  const [bag, setBag] = useState<Club[]>(() => {
    const loaded = loadFromStorage(STORAGE_KEYS.BAG, DEFAULT_CLUB_BAG);
    // Sanitize any corrupt values (> 999 yards) from prior testing and ensure automatic canonical ordering
    const sanitized = loaded.map((c: Club) => {
      if (typeof c.typicalYards !== 'number' || isNaN(c.typicalYards) || c.typicalYards > 999) {
        const preset = CLUB_PRESETS.find((p) => p.id === c.id);
        return { ...c, typicalYards: preset?.typicalYards ?? 150 };
      }
      return c;
    });
    return sortGolfClubs(sanitized);
  });
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

  // Keep club distance averages updated based on measured historical and active round shots
  useEffect(() => {
    if (bag.length === 0) return;
    setBag((prevBag) => {
      const updated = recalculateClubAverages(prevBag, [round, ...savedRounds]);
      const sorted = sortGolfClubs(updated);
      const hasChanged = sorted.some((c, i) => c.id !== prevBag[i]?.id || c.typicalYards !== prevBag[i]?.typicalYards);
      return hasChanged ? sorted : prevBag;
    });
  }, [round, savedRounds]);

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

  const currentOsmHole = useMemo(
    () => courseGeometry?.holes.find((h) => h.holeNumber === round.currentHole) ?? null,
    [courseGeometry, round.currentHole]
  );

  const isPhysicallyAtCourse = useMemo(() => {
    return isUserAtGolfCourse(geo.position, round.course?.location, courseGeometry, round.holes);
  }, [geo.position, round.course?.location, courseGeometry, round.holes]);

  const currentHoleTee = useMemo(() => {
    return currentHoleData.teeLatLng ?? currentOsmHole?.teeLatLng ?? null;
  }, [currentHoleData.teeLatLng, currentOsmHole?.teeLatLng]);

  // When not physically at the course, set the initial position to the tee of the hole selected rather than actual GPS position
  const effectivePlayerPosition: LatLngLiteral | null = useMemo(() => {
    if (geo.isManualOverride && geo.position) {
      return geo.position;
    }
    if (isPhysicallyAtCourse && geo.position) {
      return geo.position;
    }
    const shots = currentHoleScore.shots;
    const lastWithEnd = [...shots].reverse().find((s) => s.endLatLng);
    if (lastWithEnd?.endLatLng) {
      return lastWithEnd.endLatLng;
    }
    const lastShot = shots[shots.length - 1];
    if (lastShot?.startLatLng) {
      return lastShot.startLatLng;
    }
    if (currentHoleTee) {
      return currentHoleTee;
    }
    return (
      currentHoleData.greenCenterLatLng ??
      currentOsmHole?.greenCenterLatLng ??
      round.course?.location ??
      null
    );
  }, [
    geo.isManualOverride,
    geo.position,
    isPhysicallyAtCourse,
    currentHoleScore.shots,
    currentHoleTee,
    currentHoleData.greenCenterLatLng,
    currentOsmHole?.greenCenterLatLng,
    round.course?.location,
  ]);

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

  // Previous shot (always the last COMPLETED shot on the CURRENT hole only)
  // On the first shot of a hole, there is no previous shot for that hole
  const previousShot: ShotRecord | null = useMemo(() => {
    const shots = currentHoleScore.shots;
    if (!shots || shots.length === 0) return null;
    const last = shots[shots.length - 1];
    const hasOpenShot = Boolean(last && !last.endLatLng);

    if (hasOpenShot) {
      // If currently tracking an open shot (e.g. shot 2), the previous completed shot on this hole is shot 1
      // If we are on the first shot of the hole (open shot 1), there is no previous shot for this hole
      if (shots.length >= 2) return shots[shots.length - 2];
      return null;
    }

    // No open shot: if there are completed shots on this hole, return the last completed one
    if (shots.length >= 1) {
      return shots[shots.length - 1];
    }

    return null;
  }, [currentHoleScore.shots]);

  // Auto-calculate shot distance from active open NFC shot, previous lie, or tee to current GPS or target pin
  const currentOriginLatLng: LatLngLiteral | null = useMemo(() => {
    if (pendingStartLatLng) return pendingStartLatLng;
    const shots = currentHoleScore.shots;
    const lastShot = shots[shots.length - 1];
    if (lastShot && !lastShot.endLatLng) {
      return lastShot.startLatLng ?? currentHoleTee ?? null;
    }
    const lastWithEnd = [...shots].reverse().find((s) => s.endLatLng);
    if (lastWithEnd?.endLatLng) return lastWithEnd.endLatLng;
    if (shots.length === 0 && currentHoleTee) return currentHoleTee;
    return null;
  }, [pendingStartLatLng, currentHoleScore.shots, currentHoleTee]);

  const autoDetectedDistanceYards = useMemo(() => {
    if (currentOriginLatLng && effectivePlayerPosition) {
      const dist = computeDistanceYards(currentOriginLatLng, effectivePlayerPosition);
      if (dist >= 0 && dist < 500) {
        // Suppress stationary GPS jitter (distances under 4 yards return 0 until user begins walking)
        if (dist < 4) return 0;
        return dist;
      }
    }
    if (currentOriginLatLng && targetPin) {
      const dist = computeDistanceYards(currentOriginLatLng, targetPin);
      if (dist >= 0 && dist < 500) return dist;
    }
    return null;
  }, [currentOriginLatLng, effectivePlayerPosition, targetPin]);

  // Calibrate initial shot origin: if a shot was started while GPS accuracy was poor (>15m)
  // and a high-accuracy fix arrives within 15 seconds while still near the start, snap origin to accurate fix.
  useEffect(() => {
    if (!isPhysicallyAtCourse || !geo.position || !geo.accuracyMeters || geo.accuracyMeters > 10) return;
    const curHoleNum = round.currentHole;
    const holeScore = round.scores[curHoleNum];
    if (!holeScore || holeScore.shots.length === 0) return;
    const lastShot = holeScore.shots[holeScore.shots.length - 1];
    if (lastShot && !lastShot.endLatLng && lastShot.startLatLng) {
      const elapsedSec = (Date.now() - lastShot.timestamp) / 1000;
      if (elapsedSec < 15) {
        const drift = computeDistanceYards(lastShot.startLatLng, geo.position);
        if (drift > 2 && drift < 25) {
          setRound((prev) => {
            const h = prev.scores[curHoleNum];
            if (!h) return prev;
            return {
              ...prev,
              scores: {
                ...prev.scores,
                [curHoleNum]: {
                  ...h,
                  shots: h.shots.map((s, idx) =>
                    idx === h.shots.length - 1
                      ? { ...s, startLatLng: geo.position! }
                      : s
                  ),
                },
              },
            };
          });
          setPendingStartLatLng(geo.position);
        }
      }
    }
  }, [geo.position, geo.accuracyMeters, round.currentHole, round.scores]);

  const handleToggleHoleMode = useCallback((mode: RoundHoleMode) => {
    setRound((prev) => {
      let cur = prev.currentHole;
      if (mode === 'front9' && cur > 9) {
        cur = cur - 9;
      } else if (mode === 'back9' && cur <= 9) {
        cur = cur + 9;
      }
      return {
        ...prev,
        holeMode: mode,
        currentHole: cur,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const handleSelectLie = useCallback((lie: ShotLie) => {
    setSelectedLie(lie);
    const lieMeta = getLieMeta(lie);

    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      if (!holeScore || holeScore.shots.length === 0) return prev;

      const lastIdx = holeScore.shots.length - 1;
      const lastShot = holeScore.shots[lastIdx];
      const nextIsPutt =
        isShotPutt(lastShot) ||
        Boolean(lastShot.isPutt) ||
        lastShot.clubShortName === 'PT';

      const updatedShots = holeScore.shots.map((s, idx) =>
        idx === lastIdx
          ? {
              ...s,
              lie,
              penaltyStrokes: lieMeta.penalty,
              isPutt: nextIsPutt,
            }
          : s
      );

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

  const handleSelectDirection = useCallback((dir: ShotDirection) => {
    setSelectedDirection(dir);

    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      if (!holeScore || holeScore.shots.length === 0) return prev;

      const lastIdx = holeScore.shots.length - 1;
      const updatedShots = holeScore.shots.map((s, idx) =>
        idx === lastIdx ? { ...s, direction: dir } : s
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

    const endPos = effectivePlayerPosition ?? targetPin ?? undefined;
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
      const startPos = lastShot.startLatLng ?? currentHoleTee;
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
      (currentHoleScore.shots.length === 0 ? currentHoleTee : undefined);

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
    effectivePlayerPosition,
    targetPin,
    currentOriginLatLng,
    currentHoleScore.shots,
    currentHoleTee,
    bag,
    commitShot,
    selectedClubId,
    selectedLie,
    selectedDirection,
  ]);

  // Track Putt button: finishes approach shot on green and starts live tracking the putt
  const handleAddPutt = useCallback(() => {
    activeNfcPuttShotIdRef.current = null;
    const pool = bag.length > 0 ? bag : CLUB_PRESETS;
    const putter =
      pool.find((c) => c.category === 'putter' || c.id === 'pt') ??
      CLUB_PRESETS.find((c) => c.id === 'pt')!;
    const currentPos = effectivePlayerPosition ?? targetPin ?? undefined;
    const newShotId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let closedSummary = '';

    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      const teeLatLng = currentHoleTee ?? prev.holes[holeNum]?.teeLatLng;
      let updatedShots = [...holeScore.shots];

      // Close previous open shot (approach shot) when golfer reaches green and taps Track Putt
      if (updatedShots.length > 0) {
        const last = updatedShots[updatedShots.length - 1];
        if (!last.endLatLng) {
          const origin = last.startLatLng ?? teeLatLng;
          const rawM = origin && currentPos ? computeDistanceYards(origin, currentPos) : null;
          const measured = rawM !== null && rawM >= 0 && rawM <= 450 ? rawM : null;
          const endPos = currentPos ?? origin ?? teeLatLng ?? { lat: 0, lng: 0 };
          closedSummary = `Ended ${last.clubShortName}${measured !== null ? ` (${measured} yds)` : ''} · `;
          updatedShots = updatedShots.map((s, idx) =>
            idx === updatedShots.length - 1
              ? {
                  ...s,
                  lie: 'green',
                  endLatLng: endPos,
                  distanceYards: measured,
                }
              : s
          );
        } else if (last.lie !== 'green' && !last.isPutt) {
          updatedShots = updatedShots.map((s, idx) =>
            idx === updatedShots.length - 1 ? { ...s, lie: 'green' } : s
          );
        }
      }

      // Start tracking the putt with endLatLng: undefined so it stays open and live distance tracking displays!
      const puttShot: ShotRecord = {
        id: newShotId,
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
        endLatLng: undefined,
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
    setLastNfcFeedback(`${closedSummary}Tracking Live Putt · Walking...`);
  }, [bag, geo.position, targetPin]);

  // Track Shot manually (begins live walking tracking until next shot/putt/tag)
  const handleTrackShot = useCallback((chosenClubId?: string) => {
    activeNfcPuttShotIdRef.current = null;
    const pool = bag.length > 0 ? bag : CLUB_PRESETS;
    const targetClubId = chosenClubId ?? selectedClubId;
    const club = pool.find((c) => c.id === targetClubId) ?? pool[0];
    setSelectedClubId(club.id);
    const gpsFix = effectivePlayerPosition ?? targetPin ?? undefined;
    const newShotId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const curRound = roundRef.current;
    const curHoleNum = curRound.currentHole;
    const curHoleScore = curRound.scores[curHoleNum];
    const hasPutterBeenUsed =
      curHoleScore.manualPutts > 0 ||
      curHoleScore.shots.some((s) => s.isPutt || isPutterClub(s));
    const shouldAdvanceHole = hasPutterBeenUsed && isClubHigherThanPW(club);
    const mode = curRound.holeMode ?? '18';
    const totalHolesCount = Math.max(18, Object.keys(curRound.holes).length);
    const targetHoleNum = shouldAdvanceHole
      ? getNextHoleNumber(curHoleNum, mode, totalHolesCount)
      : curHoleNum;

    let closedShotClub: string | null = null;
    let closedShotYards: number | null = null;

    setRound((prev) => {
      const holeNum = targetHoleNum;
      const holeScore = prev.scores[holeNum];
      const targetTeeLatLng = currentHoleTee ?? prev.holes[holeNum]?.teeLatLng;
      const curHoleData = prev.scores[curHoleNum];
      let curHoleUpdatedShots = [...curHoleData.shots];

      // End previous open shot if player was tracking another shot on current hole
      if (curHoleUpdatedShots.length > 0) {
        const lastIdx = curHoleUpdatedShots.length - 1;
        const prevShot = curHoleUpdatedShots[lastIdx];
        if (!prevShot.endLatLng) {
          const origin = prevShot.startLatLng ?? (currentHoleTee ?? prev.holes[curHoleNum]?.teeLatLng);
          closedShotClub = prevShot.clubName;
          const rawClosed = origin && gpsFix ? computeDistanceYards(origin, gpsFix) : null;
          closedShotYards = rawClosed !== null && rawClosed >= 0 && rawClosed <= 450 ? rawClosed : null;
          const endPos = gpsFix ?? origin ?? targetTeeLatLng ?? { lat: 0, lng: 0 };
          curHoleUpdatedShots = curHoleUpdatedShots.map((s, idx) =>
            idx === lastIdx
              ? {
                  ...s,
                  lie: s.lie === 'green' ? 'green' : selectedLie,
                  direction: s.direction ?? selectedDirection,
                  endLatLng: endPos,
                  distanceYards: closedShotYards ?? s.distanceYards ?? null,
                }
              : s
          );
        }
      }

      if (shouldAdvanceHole) {
        // Close shot on previous hole, create new shot on targetHoleNum
        const nextHoleTee = prev.holes[targetHoleNum]?.teeLatLng;
        const nextShotStart = gpsFix ?? nextHoleTee;
        const targetHoleExistingShots = holeScore.shots;
        const nextShot: ShotRecord = {
          id: newShotId,
          holeNumber: targetHoleNum,
          strokeNumber: targetHoleExistingShots.length + 1,
          clubId: club.id,
          clubName: club.name,
          clubShortName: club.shortName,
          lie: 'fairway',
          direction: 'straight',
          penaltyStrokes: 0,
          distanceYards: null,
          startLatLng: nextShotStart,
          endLatLng: undefined,
          timestamp: Date.now(),
          source: 'manual',
          isPutt: false,
        };

        const resolvedTargetShots = resolveHoleShotsPutts([...targetHoleExistingShots, nextShot]);
        const nextPutts = resolvedTargetShots.filter((s) => s.isPutt).length;

        return {
          ...prev,
          currentHole: targetHoleNum,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [curHoleNum]: {
              ...curHoleData,
              shots: curHoleUpdatedShots,
            },
            [targetHoleNum]: {
              ...holeScore,
              shots: resolvedTargetShots,
              manualPutts: nextPutts,
            },
          },
        };
      }

      // Same hole
      const lastClosedShot = curHoleUpdatedShots[curHoleUpdatedShots.length - 1];
      const newShotStart = gpsFix ?? lastClosedShot?.endLatLng ?? targetTeeLatLng;
      const nextShot: ShotRecord = {
        id: newShotId,
        holeNumber: holeNum,
        strokeNumber: curHoleUpdatedShots.length + 1,
        clubId: club.id,
        clubName: club.name,
        clubShortName: club.shortName,
        lie: 'fairway',
        direction: 'straight',
        penaltyStrokes: 0,
        distanceYards: null,
        startLatLng: newShotStart,
        endLatLng: undefined,
        timestamp: Date.now(),
        source: 'manual',
        isPutt: false,
      };

      const resolved = resolveHoleShotsPutts([...curHoleUpdatedShots, nextShot]);
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

    setSelectedLie('fairway');
    setSelectedDirection('straight');
    if (shouldAdvanceHole) {
      setTargetPin(null);
    }
    setPendingStartLatLng(gpsFix ?? null);
    const closedSummary =
      closedShotClub !== null
        ? closedShotYards !== null
          ? `Ended ${closedShotClub} (${closedShotYards} yds) · `
          : `Ended ${closedShotClub} · `
        : '';
    if (shouldAdvanceHole) {
      setLastNfcFeedback(
        `${closedSummary}Moved to Hole ${targetHoleNum} · Tracking ${club.name}${
          gpsFix ? ' · Walking...' : ' · Waiting for GPS fix'
        }`
      );
    } else {
      setLastNfcFeedback(
        `${closedSummary}Tracking ${club.name}${
          gpsFix ? ' · Walking...' : ' · Waiting for GPS fix'
        }`
      );
    }
  }, [bag, selectedClubId, selectedLie, selectedDirection, targetPin, effectivePlayerPosition, currentHoleTee]);

  const handleQuickLogFromMap = useCallback(
    (endLatLng: LatLngLiteral, startLatLng?: LatLngLiteral | null, yards?: number | null) => {
      activeNfcPuttShotIdRef.current = null;
      const lastShot = currentHoleScore.shots[currentHoleScore.shots.length - 1];
      if (lastShot && lastShot.source === 'nfc' && !lastShot.endLatLng) {
        const origin = lastShot.startLatLng ?? startLatLng ?? currentHoleData.teeLatLng;
        const rawDist = origin ? computeDistanceYards(origin, endLatLng) : (yards ?? null);
        const computedYards = rawDist !== null && rawDist >= 0 && rawDist <= 450 ? rawDist : null;
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
        distanceYards: yards ?? null,
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
          `Paired NFC tag ${upperTagId} to ${pairingTarget.name}.`
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

      const gpsFix = isPhysicallyAtCourse ? ((await geo.requestSingleFix()) ?? geo.position) : effectivePlayerPosition;

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
      const hasPutterBeenUsed =
        curHoleScore.manualPutts > 0 ||
        curHoleScore.shots.some((s) => s.isPutt || isPutterClub(s));
      const mode = currentRound.holeMode ?? '18';
      const totalHolesCount = Math.max(18, Object.keys(currentRound.holes).length);
      const shouldAdvanceHole =
        (isDriver && hasExistingShotsOnHole) ||
        (hasPutterBeenUsed && isClubHigherThanPW(matchedClub));
      const targetHoleNum = shouldAdvanceHole
        ? getNextHoleNumber(curHoleNum, mode, totalHolesCount)
        : curHoleNum;

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
        const totalRoundHoles = Math.max(18, Object.keys(prev.holes).length);
        const holeNum = shouldAdvanceHole
          ? getNextHoleNumber(prev.currentHole, prev.holeMode ?? '18', totalRoundHoles)
          : prev.currentHole;
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
            const rawNfcDist = origin && gpsFix ? computeDistanceYards(origin, gpsFix) : null;
            const measured = rawNfcDist !== null && rawNfcDist >= 0 && rawNfcDist <= 450 ? rawNfcDist : null;
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

  const handleSelectClub = useCallback(
    (clubId: string) => {
      setSelectedClubId(clubId);
      const pool = bag.length > 0 ? bag : CLUB_PRESETS;
      const club = pool.find((c) => c.id === clubId);
      if (!club) return;
      setRound((prev) => {
        const holeNum = prev.currentHole;
        const holeScore = prev.scores[holeNum];
        if (!holeScore || holeScore.shots.length === 0) return prev;
        const lastIdx = holeScore.shots.length - 1;
        const lastShot = holeScore.shots[lastIdx];
        if (lastShot.endLatLng) return prev; // only update open/live shot
        const updatedShots = holeScore.shots.map((s, idx) =>
          idx === lastIdx
            ? {
                ...s,
                clubId: club.id,
                clubName: club.name,
                clubShortName: club.shortName,
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
            },
          },
        };
      });
    },
    [bag]
  );

  const handleChangeHole = useCallback(
    (holeNumber: number) => {
      activeNfcPuttShotIdRef.current = null;
      let targetHole = holeNumber;
      const totalRoundHoles = Math.max(18, Object.keys(roundRef.current.holes).length);
      if (targetHole < 1 || targetHole > totalRoundHoles) {
        targetHole =
          targetHole < 1
            ? getPrevHoleNumber(roundRef.current.currentHole, roundRef.current.holeMode ?? '18', totalRoundHoles)
            : getNextHoleNumber(roundRef.current.currentHole, roundRef.current.holeMode ?? '18', totalRoundHoles);
      }

      if (geo.isManualOverride) {
        geo.resumeLiveGps();
      }
      setTargetPin(null);

      const currentPos = effectivePlayerPosition ?? targetPin ?? undefined;

      setRound((prev) => {
        const fromHole = prev.currentHole;
        if (fromHole === targetHole) return prev;

        const updatedScores = { ...prev.scores };

        // 1. Finish open shot on previous hole (fromHole)
        const fromScore = prev.scores[fromHole];
        if (fromScore && fromScore.shots.length > 0) {
          const fromShots = [...fromScore.shots];
          const lastFromShot = fromShots[fromShots.length - 1];
          if (!lastFromShot.endLatLng) {
            const teePos = prev.holes[fromHole]?.teeLatLng;
            const greenPos = prev.holes[fromHole]?.greenCenterLatLng;
            const endPos = currentPos ?? greenPos ?? teePos;
            const startPos = lastFromShot.startLatLng ?? teePos;
            const closedDist =
              startPos && endPos ? computeDistanceYards(startPos, endPos) : null;

            fromShots[fromShots.length - 1] = {
              ...lastFromShot,
              endLatLng: endPos,
              distanceYards: closedDist,
            };

            const resolvedFrom = resolveHoleShotsPutts(fromShots);
            updatedScores[fromHole] = {
              ...fromScore,
              shots: resolvedFrom,
              manualPutts: resolvedFrom.filter((s) => s.isPutt).length,
            };
          }
        }

        // 2. Going to targetHole: if targetHole already has shots, automatically set the last shot as Live again!
        const targetScore = updatedScores[targetHole];
        if (targetScore && targetScore.shots.length > 0) {
          const targetShots = [...targetScore.shots];
          const lastTargetShot = { ...targetShots[targetShots.length - 1] };

          // Set that shot as Live again
          lastTargetShot.endLatLng = undefined;
          lastTargetShot.distanceYards = null;
          targetShots[targetShots.length - 1] = lastTargetShot;

          const resolvedTarget = resolveHoleShotsPutts(targetShots);
          updatedScores[targetHole] = {
            ...targetScore,
            shots: resolvedTarget,
            manualPutts: resolvedTarget.filter((s) => s.isPutt).length,
          };

          // Update UI state to match this reactivated live shot
          setSelectedClubId(lastTargetShot.clubId);
          setSelectedLie(lastTargetShot.lie);
          setSelectedDirection(lastTargetShot.direction ?? 'straight');
          setPendingStartLatLng(lastTargetShot.startLatLng ?? null);
          setLastNfcFeedback(`Tracking ${lastTargetShot.clubName} · Walking...`);
        } else {
          // No shots on target hole: set standard tee defaults
          const defaultClub =
            bag.length > 0 ? bag.find((c) => c.id === 'dr')?.id ?? bag[0].id : 'dr';
          setSelectedClubId(defaultClub);
          setSelectedLie('fairway');
          setSelectedDirection('straight');
          setPendingStartLatLng(null);
          setLastNfcFeedback(null);
        }

        return {
          ...prev,
          updatedAt: Date.now(),
          currentHole: targetHole,
          scores: updatedScores,
        };
      });
    },
    [geo.isManualOverride, geo.position, targetPin, geo.resumeLiveGps, bag]
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
        let remainingShots = [...holeScore.shots.slice(0, -1)];
        if (remainingShots.length > 0) {
          // Re-open the preceding shot so it becomes live again
          const lastRemaining = { ...remainingShots[remainingShots.length - 1] };
          lastRemaining.endLatLng = undefined;
          lastRemaining.distanceYards = null;
          remainingShots[remainingShots.length - 1] = lastRemaining;

          nextOrigin = lastRemaining.startLatLng ?? null;
          setSelectedClubId(lastRemaining.clubId);
          setSelectedLie(lastRemaining.lie);
          setSelectedDirection(lastRemaining.direction ?? 'straight');
          setLastNfcFeedback(`Tracking ${lastRemaining.clubName} · Walking...`);
        } else {
          const defaultClub =
            bag.length > 0 ? bag.find((c) => c.id === 'dr')?.id ?? bag[0].id : 'dr';
          setSelectedClubId(defaultClub);
          setSelectedLie('fairway');
          setSelectedDirection('straight');
          setLastNfcFeedback(null);
        }

        const resolved = resolveHoleShotsPutts(remainingShots);
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
  }, [bag]);

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

      const targetTotalHoles = Math.max(
        18,
        selectedTee?.numberOfHoles || 0,
        selectedTee?.holes.length || 0,
        ...Object.keys(populatedHoles).map(Number)
      );

      // Ensure all holes have baseline data
      for (let i = 1; i <= targetTotalHoles; i += 1) {
        if (!populatedHoles[i]) {
          const def = DEFAULT_PAR_LAYOUT[(i - 1) % DEFAULT_PAR_LAYOUT.length];
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
      if (geo.position && hydratedCourse.location && computeDistanceMeters(geo.position, hydratedCourse.location) <= 1200) {
        let closestDist = 350;
        for (let num = 1; num <= targetTotalHoles; num += 1) {
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
      if (targetTotalHoles >= 27) {
        freshRound.holeMode = 'all27';
      }
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

  const handleDiscardRound = useCallback(() => {
    setRound(createInitialRoundState(null));
    syncedCourseHolesRef.current = null;
    setPendingStartLatLng(null);
    setTargetPin(null);
    setLastNfcFeedback(null);
    setRoundJustSaved(false);
    setStatsSubTab('entry');
    setActiveTab('stats');
    nfc.stopScan();
  }, [nfc]);

  const handleSaveAndEndRound = useCallback(() => {
    const snapshot: RoundState = {
      ...round,
      updatedAt: Date.now(),
    };
    setSavedRounds((prev) => [snapshot, ...prev.filter((r) => r.id !== snapshot.id)].slice(0, 20));
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
        !isPhysicallyAtCourse &&
        roundTotals.playedCount === 0
      ) {
        setRound((prev) => (prev.currentHole === 1 ? prev : { ...prev, currentHole: 1 }));
      }
      setActiveTab(tab);
    },
    [round.course, geo.isManualOverride, geo.position, roundTotals.playedCount]
  );

  const navItems: Array<{ id: AppViewTab; label: string; icon: React.ReactNode }> = [
    { id: 'stats', label: 'Holes', icon: <Flag className="w-5 h-5" /> },
    { id: 'map', label: 'Map', icon: <MapIcon className="w-5 h-5" /> },
    { id: 'scorecard', label: 'Scorecard', icon: <ClipboardList className="w-5 h-5" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'bag', label: 'Bag & NFC', icon: <Nfc className="w-5 h-5" /> },
  ];

  const isCourseChosen = Boolean(round.course);
  const pairedClubsCount = bag.filter((c) => Boolean(c.nfcTagId)).length;

  return (
    <div className="h-full flex flex-col bg-[#F4F7F4] dark:bg-[#07100a] text-slate-900 dark:text-slate-100">
      {/* Pocket Mode Black Screen: Dims screen and blocks all touch interactions when phone is in pocket */}
      {pocketMode.inPocket && (
        <div
          className="fixed inset-0 z-[999999] bg-black pointer-events-auto touch-none select-none flex flex-col items-center justify-center cursor-none"
          style={{ touchAction: 'none' }}
          aria-hidden="true"
        />
      )}
      {/* Top Bar */}
      <header className="pt-[env(safe-area-inset-top,0px)] min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] sm:min-h-[calc(4rem+env(safe-area-inset-top,0px))] px-3 sm:px-6 bg-white/90 dark:bg-[#0c160f]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2 sm:gap-4 shrink-0 z-30 transition-colors shadow-2xs">
        {/* Brand / Logo */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleSelectNavTab('stats')}
            className="flex items-center gap-2 group text-left transition-transform active:scale-95"
            aria-label="PocketCaddie Home"
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
          {/* Live GPS Accuracy Status Pill (always next to GPS Tape Measure) */}
          <div
            className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700/70 text-slate-600 dark:text-slate-300 text-[11px] font-mono tabular-nums shadow-2xs shrink-0"
            title={
              geo.position
                ? `GPS Accuracy: ±${geo.accuracyMeters ? Math.round(geo.accuracyMeters * 3.28084) : '?'} ft`
                : geo.errorMessage
                  ? geo.errorMessage
                  : 'Acquiring GPS location...'
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                geo.position
                  ? 'bg-emerald-500 animate-pulse'
                  : geo.errorMessage
                    ? 'bg-rose-500'
                    : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-700 dark:text-slate-200">
              {geo.position && geo.accuracyMeters
                ? `±${Math.round(geo.accuracyMeters * 3.28084)}ft`
                : geo.position
                  ? 'GPS'
                  : '±--'}
            </span>
          </div>

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
      <main className={`flex-1 min-h-0 ${activeTab === 'map' ? 'overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0' : 'overflow-y-auto lg:overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0'}`}>

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
          <div className="h-full flex flex-col lg:grid lg:grid-cols-[440px_1fr]">
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
                playerPosition={effectivePlayerPosition}
                selectedClubId={selectedClubId}
                selectedLie={selectedLie}
                selectedDirection={selectedDirection}
                autoDetectedDistanceYards={autoDetectedDistanceYards}
                lastNfcFeedback={lastNfcFeedback}
                onSelectHole={handleChangeHole}
                onSelectClub={handleSelectClub}
                onSelectLie={handleSelectLie}
                onSelectDirection={handleSelectDirection}
                onLogShot={handleLogShotManual}
                onAddPutt={handleAddPutt}
                onUpdateShot={handleUpdateShot}
                onAddPenalty={handleAddPenalty}
                onTrackShot={handleTrackShot}
                onDeleteShot={handleDeleteShot}
                onUndoLastShot={handleUndoLastShot}
                holeMode={round.holeMode ?? '18'}
                onToggleHoleMode={handleToggleHoleMode}
                onPrevHole={() => handleChangeHole(getPrevHoleNumber(round.currentHole, round.holeMode ?? '18', Math.max(18, Object.keys(round.holes).length)))}
                onNextHole={() => handleChangeHole(getNextHoleNumber(round.currentHole, round.holeMode ?? '18', Math.max(18, Object.keys(round.holes).length)))}
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
          <div className="h-full w-full relative isolate z-0">
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
              playerPosition={effectivePlayerPosition}
              gpsStatus={geo.status}
              gpsAccuracyMeters={geo.accuracyMeters}
              isManualPosition={geo.isManualOverride || !isPhysicallyAtCourse}
              tapMode={tapMode}
              targetPin={targetPin}
              holeMode={round.holeMode ?? '18'}
              onToggleHoleMode={handleToggleHoleMode}
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


        {/* Round Analytics View (Own tab next to Scorecard) */}
        {isCourseChosen && activeTab === 'analytics' && (
          <div className="h-full overflow-y-auto pb-14 md:pb-0">
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
        )}

        {isCourseChosen && activeTab === 'scorecard' && (
          <div className="h-full overflow-y-auto">
            <ScorecardView
              round={round}
              holeMode={round.holeMode ?? '18'}
              onToggleHoleMode={handleToggleHoleMode}
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
              onSaveAndEndRound={handleSaveAndEndRound}
              onDiscardRound={handleDiscardRound}
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
                setBag((prev) => sortGolfClubs(prev.map((c) => (c.id === clubId ? { ...c, ...patch } : c))))
              }
              onAddClub={(club) =>
                setBag((prev) => sortGolfClubs(prev.some((c) => c.id === club.id) ? prev : [...prev, club]))
              }
              onAddMultipleClubs={(newClubs) => {
                setBag((prev) => {
                  const existingIds = new Set(prev.map((c) => c.id));
                  const toAdd = newClubs.filter((nc) => !existingIds.has(nc.id));
                  return sortGolfClubs([...prev, ...toAdd]);
                });
              }}
              onDeleteClub={(clubId) => setBag((prev) => prev.filter((c) => c.id !== clubId))}
            />
          </div>
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb Navigation Bar (only active once a course is chosen) */}
      {isCourseChosen && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom,0px)] h-[calc(4rem+env(safe-area-inset-bottom,0px))] bg-white/90 dark:bg-[#0c160f]/90 backdrop-blur-lg border-t border-slate-200/80 dark:border-slate-800/80 px-2 grid grid-cols-5 items-center shadow-2xl"
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

    </div>
  );
}

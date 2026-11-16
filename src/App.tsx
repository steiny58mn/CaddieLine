import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ClipboardList, Map as MapIcon, Nfc } from 'lucide-react';
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
  computeDistanceMeters,
  computeDistanceYards,
  createInitialRoundState,
  getHoleStrokes,
  getLieMeta,
  isHolePlayed,
} from './utils/golfMath';
import {
  applyOsmGeometryToHoles,
  fetchCourseGolfGeometry,
  getCachedOsmCourseGeometry,
  summarizeOsmGeometry,
} from './services/osmGolfService';
import { useGeolocation } from './hooks/useGeolocation';
import { NfcTapPayload, useWebNfc } from './hooks/useWebNfc';
import { OpenGolfHoleMap } from './components/OpenGolfHoleMap';
import { ShotLoggerPanel } from './components/ShotLoggerPanel';
import { ScorecardView } from './components/ScorecardView';
import { StatsView } from './components/StatsView';
import { BagNfcView } from './components/BagNfcView';
import { CourseLandingView } from './components/CourseLandingView';
import { OfflineIndicator } from './components/OfflineIndicator';

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
  const [courseGeometry, setCourseGeometry] = useState<OsmCourseGeometry | null>(() =>
    round.course ? getCachedOsmCourseGeometry(round.course.placeId) : null
  );
  const [isLoadingGeometry, setIsLoadingGeometry] = useState(false);
  const [geometryError, setGeometryError] = useState<string | null>(null);

  // Shot logger working state
  const [selectedClubId, setSelectedClubId] = useState<string>('dr');
  const [selectedLie, setSelectedLie] = useState<ShotLie>('fairway');
  const [selectedDirection, setSelectedDirection] = useState<ShotDirection>('straight');
  const [manualDistanceYards, setManualDistanceYards] = useState<string>('');
  const [pendingStartLatLng, setPendingStartLatLng] = useState<LatLngLiteral | null>(null);

  // Map interaction state
  const [tapMode, setTapMode] = useState<MapTapMode>('measure');
  const [targetPin, setTargetPin] = useState<LatLngLiteral | null>(null);

  // NFC pairing & toast feedback
  const [pairingTarget, setPairingTarget] = useState<ClubPreset | null>(null);
  const [lastNfcFeedback, setLastNfcFeedback] = useState<string | null>(null);

  const autoStartedCourseRef = useRef<string | null>(null);
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

  // Ensure geometry is loaded if resuming a saved round with a course
  useEffect(() => {
    const activeCourse = round.course;
    if (!activeCourse) {
      setCourseGeometry(null);
      return;
    }
    if (courseGeometry?.courseId === activeCourse.placeId) return;

    const cached = getCachedOsmCourseGeometry(activeCourse.placeId);
    if (cached) {
      setCourseGeometry(cached);
      return;
    }

    let cancelled = false;
    setIsLoadingGeometry(true);
    setGeometryError(null);
    fetchCourseGolfGeometry(activeCourse)
      .then((geom) => {
        if (!cancelled) {
          setCourseGeometry(geom);
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
  }, [round.course?.placeId, courseGeometry?.courseId]);

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

  const currentHoleData = round.holes[round.currentHole];
  const currentHoleScore = round.scores[round.currentHole];

  const roundTotals = useMemo(() => {
    const nums = Array.from({ length: 18 }, (_, i) => i + 1);
    const played = nums.filter((n) => isHolePlayed(round.scores[n]));
    const strokes = nums.reduce((acc, n) => acc + getHoleStrokes(round.scores[n]), 0);
    const parPlayed = played.reduce((acc, n) => acc + round.holes[n].par, 0);
    return {
      playedCount: played.length,
      relativeToPar: strokes - parPlayed,
    };
  }, [round]);

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
      if (dist > 0 && dist < 450) return dist;
    }
    if (currentOriginLatLng && targetPin) {
      const dist = computeDistanceYards(currentOriginLatLng, targetPin);
      if (dist > 0 && dist < 450) return dist;
    }
    return null;
  }, [currentOriginLatLng, geo.position, targetPin]);

  const handleSelectLie = useCallback((lie: ShotLie) => {
    setSelectedLie(lie);
    const meta = getLieMeta(lie);
    setSelectedDirection(meta.defaultDirection);
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
    }) => {
      const pool = bag.length > 0 ? bag : CLUB_PRESETS;
      const club = pool.find((c) => c.id === params.clubId) ?? pool[0];
      const lieMeta = getLieMeta(params.lie);

      setRound((prev) => {
        const holeNum = prev.currentHole;
        const holeScore = prev.scores[holeNum];
        const nextStrokeNum = holeScore.shots.length + 1;

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
        };

        const isPutter = club.category === 'putter' || club.id === 'pt';
        const nextManualPutts = isPutter
          ? Math.max(holeScore.manualPutts, holeScore.shots.filter((s) => s.clubId === 'pt').length + 1)
          : holeScore.manualPutts;

        return {
          ...prev,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [holeNum]: {
              ...holeScore,
              shots: [...holeScore.shots, newShot],
              manualPutts: nextManualPutts,
            },
          },
        };
      });

      // Suggest next club logically after logging a shot
      if (params.lie === 'green' || params.lie === 'holed') {
        const putter = pool.find((c) => c.category === 'putter');
        if (putter) setSelectedClubId(putter.id);
      } else if (club.id === 'dr' || club.category === 'wood') {
        const midIron = pool.find((c) => c.id === '7i') ?? pool[Math.min(5, pool.length - 1)];
        if (midIron) setSelectedClubId(midIron.id);
      }
      setManualDistanceYards('');
    },
    [bag]
  );

  const handleLogShotManual = useCallback(() => {
    const parsedDist = manualDistanceYards.trim()
      ? Number(manualDistanceYards)
      : autoDetectedDistanceYards;
    const validDist =
      parsedDist !== null && !Number.isNaN(parsedDist) && parsedDist > 0 ? parsedDist : null;

    const endPos = geo.position ?? targetPin ?? undefined;
    const lastShot = currentHoleScore.shots[currentHoleScore.shots.length - 1];

    // If an NFC-started shot is currently open, finish & record its outcome instead of duplicating
    if (lastShot && lastShot.source === 'nfc' && !lastShot.endLatLng) {
      const pool = bag.length > 0 ? bag : CLUB_PRESETS;
      const club = pool.find((c) => c.id === selectedClubId) ?? pool[0];
      const lieMeta = getLieMeta(selectedLie);
      const startPos = lastShot.startLatLng ?? currentHoleData.teeLatLng;
      const computedEndDist =
        validDist ?? (startPos && endPos ? computeDistanceYards(startPos, endPos) : null);

      setRound((prev) => {
        const holeNum = prev.currentHole;
        const holeScore = prev.scores[holeNum];
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

      if (endPos) {
        setPendingStartLatLng(endPos);
      }
      setManualDistanceYards('');
      setTargetPin(null);
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
    manualDistanceYards,
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

  const handleQuickLogFromMap = useCallback(
    (endLatLng: LatLngLiteral, startLatLng: LatLngLiteral | null, yards: number | null) => {
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

      let closedShotClub: string | null = null;
      let closedShotYards: number | null = null;

      setRound((prev) => {
        const holeNum = prev.currentHole;
        const holeScore = prev.scores[holeNum];
        const teeLatLng = prev.holes[holeNum]?.teeLatLng;
        let updatedShots = [...holeScore.shots];

        // End the active/previous shot at the GPS location of this newly scanned tag
        if (updatedShots.length > 0) {
          const prevShot = updatedShots[updatedShots.length - 1];
          if (!prevShot.endLatLng) {
            const origin = prevShot.startLatLng ?? teeLatLng;
            const measured = origin && gpsFix ? computeDistanceYards(origin, gpsFix) : null;
            closedShotClub = prevShot.clubShortName;
            closedShotYards = measured;
            updatedShots = updatedShots.map((s, idx) =>
              idx === updatedShots.length - 1
                ? {
                    ...s,
                    endLatLng: gpsFix ?? undefined,
                    distanceYards: measured,
                  }
                : s
            );
          }
        }

        // Start tracking the newly scanned club shot from this GPS location
        const isPutter = matchedClub.category === 'putter' || matchedClub.id === 'pt';
        const defaultLie: ShotLie = isPutter ? 'green' : 'fairway';
        const newShotStart = gpsFix ?? (updatedShots.length === 0 ? teeLatLng : undefined);

        const nextShot: ShotRecord = {
          id: `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          holeNumber: holeNum,
          strokeNumber: updatedShots.length + 1,
          clubId: matchedClub.id,
          clubName: matchedClub.name,
          clubShortName: matchedClub.shortName,
          lie: defaultLie,
          direction: 'straight',
          penaltyStrokes: 0,
          distanceYards: null,
          startLatLng: newShotStart,
          endLatLng: undefined,
          timestamp: Date.now(),
          source: 'nfc',
        };

        const nextPutts = isPutter
          ? Math.max(
              holeScore.manualPutts,
              updatedShots.filter((s) => s.clubId === 'pt').length + 1
            )
          : holeScore.manualPutts;

        return {
          ...prev,
          updatedAt: Date.now(),
          scores: {
            ...prev.scores,
            [holeNum]: {
              ...holeScore,
              shots: [...updatedShots, nextShot],
              manualPutts: nextPutts,
            },
          },
        };
      });

      setPendingStartLatLng(gpsFix ?? null);
      setManualDistanceYards('');

      const closedSummary =
        closedShotClub !== null
          ? closedShotYards !== null
            ? `Ended ${closedShotClub} (${closedShotYards} yds) · `
            : `Ended ${closedShotClub} · `
          : '';

      setLastNfcFeedback(
        `${closedSummary}Started ${matchedClub.name}${
          gpsFix ? ' · Tracking live GPS distance' : ' · Waiting for GPS fix'
        }`
      );
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
      setManualDistanceYards('');
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

  const handleDeleteShot = useCallback((shotId: string) => {
    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      const filtered = holeScore.shots
        .filter((s) => s.id !== shotId)
        .map((s, idx) => ({ ...s, strokeNumber: idx + 1 }));
      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            shots: filtered,
          },
        },
      };
    });
  }, []);

  const handleUndoLastShot = useCallback(() => {
    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      if (holeScore.shots.length === 0) return prev;
      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            shots: holeScore.shots.slice(0, -1),
          },
        },
      };
    });
  }, []);

  const handleUpdatePutts = useCallback((putts: number) => {
    setRound((prev) => {
      const holeNum = prev.currentHole;
      const holeScore = prev.scores[holeNum];
      return {
        ...prev,
        updatedAt: Date.now(),
        scores: {
          ...prev.scores,
          [holeNum]: {
            ...holeScore,
            manualPutts: Math.max(0, putts),
          },
        },
      };
    });
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
      const populatedHoles = applyOsmGeometryToHoles(geometry);

      // Determine starting hole: detect nearest tee if player is on the course (< 5km), else default to Hole #1
      let startingHole = 1;
      if (geo.position && computeDistanceMeters(geo.position, course.location) <= 5000) {
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

      const freshRound = createInitialRoundState(course);
      freshRound.currentHole = startingHole;
      freshRound.holes = populatedHoles;
      setRound(freshRound);

      setPendingStartLatLng(null);
      setTargetPin(null);
      setManualDistanceYards('');
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

  const handleRefreshOsmCourse = useCallback(async () => {
    if (!round.course) return;
    setIsLoadingGeometry(true);
    setGeometryError(null);
    try {
      const geometry = await fetchCourseGolfGeometry(round.course, true);
      setCourseGeometry(geometry);
      const summary = summarizeOsmGeometry(geometry);
      const populatedHoles = applyOsmGeometryToHoles(geometry);
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
        return {
          ...prev,
          course: prev.course ? { ...prev.course, osmSummary: summary } : prev.course,
          holes: mergedHoles,
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
    setPendingStartLatLng(null);
    setTargetPin(null);
    setManualDistanceYards('');
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
    <div className="h-full flex flex-col bg-[#F5F7F5]">
      {/* Top Bar */}
      <header className="h-[52px] md:h-14 px-4 sm:px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-6 shrink-0 z-30">
        <button
          type="button"
          onClick={() => handleSelectNavTab('stats')}
          className="font-display text-lg font-bold tracking-tight text-[#0F1A14] whitespace-nowrap shrink-0 text-left"
        >
          CaddieLine
        </button>

        {isCourseChosen && (
          <nav className="hidden md:flex items-center gap-6" aria-label="Primary navigation">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectNavTab(item.id)}
                  className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                    active
                      ? 'text-[#0F1A14] border-emerald-700 font-semibold'
                      : 'text-slate-600 border-transparent hover:text-[#0F1A14] hover:border-slate-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex items-center gap-3 shrink-0 min-w-0">
          {isCourseChosen ? (
            <span className="text-xs font-semibold text-emerald-800 truncate max-w-[180px] sm:max-w-[260px]">
              {round.course?.name}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setActiveTab((prev) => (prev === 'bag' ? 'stats' : 'bag'))}
              className="h-9 px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0F1A14] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <Nfc className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
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
            {/* Mobile Sub-Switcher: Enter Hole Stats vs Round Analytics */}
            <div className="lg:hidden px-3 py-2 bg-white border-b border-slate-200 shrink-0">
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setStatsSubTab('entry')}
                  className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    statsSubTab === 'entry'
                      ? 'bg-white text-[#0F1A14] shadow-xs'
                      : 'text-slate-600 hover:text-[#0F1A14]'
                  }`}
                >
                  Enter Hole Stats
                </button>
                <button
                  type="button"
                  onClick={() => setStatsSubTab('analytics')}
                  className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    statsSubTab === 'analytics'
                      ? 'bg-white text-[#0F1A14] shadow-xs'
                      : 'text-slate-600 hover:text-[#0F1A14]'
                  }`}
                >
                  Round Analytics
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
                totalScoreRelativeToPar={roundTotals.relativeToPar}
                holesPlayedCount={roundTotals.playedCount}
                bag={bag}
                unit={round.unit}
                selectedClubId={selectedClubId}
                selectedLie={selectedLie}
                selectedDirection={selectedDirection}
                manualDistanceYards={manualDistanceYards}
                autoDetectedDistanceYards={autoDetectedDistanceYards}
                lastNfcFeedback={lastNfcFeedback}
                onSelectHole={handleChangeHole}
                onSelectClub={setSelectedClubId}
                onSelectLie={handleSelectLie}
                onSelectDirection={setSelectedDirection}
                onChangeManualDistance={setManualDistanceYards}
                onLogShot={handleLogShotManual}
                onDeleteShot={handleDeleteShot}
                onUndoLastShot={handleUndoLastShot}
                onUpdatePutts={handleUpdatePutts}
                onUpdateHoleMeta={(patch) => handleUpdateHoleMeta(round.currentHole, patch)}
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
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-4 items-center"
          aria-label="Mobile navigation"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNavTab(item.id)}
                className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-emerald-700 font-semibold' : 'text-slate-500'
                }`}
              >
                {item.icon}
                <span className="text-[10px] tracking-tight whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      <OfflineIndicator />
    </div>
  );
}

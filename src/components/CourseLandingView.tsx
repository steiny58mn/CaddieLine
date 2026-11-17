import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Compass, Loader2, MapPin, Navigation, Search, Sparkles, Trash2, Zap } from 'lucide-react';
import {
  CourseInfo,
  GolfCourseDetail,
  LatLngLiteral,
  OsmCourseGeometry,
  OsmSubCourse,
  RoundState,
} from '../types/golf';
import {
  fetchCourseGolfGeometry,
  filterGeometryForSubCourse,
  findNearbyCoursesOsm,
  searchCoursesOsm,
  summarizeOsmGeometry,
  isDiscGolfCourse,
  deduplicateCoursesList,
} from '../services/osmGolfService';
import {
  checkGolfApiStatus,
  combineSubCourseTees,
  combine3SubCourseTees,
  fetchGolfCourseMatch,
  GolfApiStatus,
  matchSubCourseNameToGca,
  pickDefaultTee,
} from '../services/golfCourseApiService';
import {
  computeDistanceMeters,
  formatRelativeToPar,
  getHoleStrokes,
  isHolePlayed,
} from '../utils/golfMath';

interface PendingLoopOption {
  id: string;
  name: string;
  holeCount: number;
  parTotal: number;
  yardageTotal?: number;
  osmSub?: OsmSubCourse;
  gcaDetail?: GolfCourseDetail;
}

interface CourseLandingViewProps {
  userPosition: LatLngLiteral | null;
  savedRounds: RoundState[];
  pairedClubsCount?: number;
  onSelectCourse: (course: CourseInfo, geometry: OsmCourseGeometry) => void;
  onLoadSavedRound: (round: RoundState) => void;
  onDeleteSavedRound: (roundId: string) => void;
  onOpenBagNfc?: () => void;
}

function normalizeLoopCompare(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(the|golf|course|club|links|nine)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findExactOrCloseGcaMatch(
  loopName: string,
  matches: GolfCourseDetail[]
): GolfCourseDetail | undefined {
  const target = normalizeLoopCompare(loopName);
  if (!target) return undefined;
  return matches.find((m) => {
    const cNorm = normalizeLoopCompare(m.courseName);
    const dNorm = normalizeLoopCompare(m.displayName);
    return (
      cNorm === target ||
      (cNorm.length >= 3 && (cNorm.includes(target) || target.includes(cNorm))) ||
      (dNorm.length >= 3 && target.length >= 3 && dNorm.includes(target))
    );
  });
}

export const CourseLandingView: React.FC<CourseLandingViewProps> = ({
  userPosition,
  savedRounds,
  onSelectCourse,
  onLoadSavedRound,
  onDeleteSavedRound,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseInfo[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [loadingCourseId, setLoadingCourseId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [pendingMultiCourse, setPendingMultiCourse] = useState<{
    course: CourseInfo;
    geometry: OsmCourseGeometry;
    loops: PendingLoopOption[];
  } | null>(null);
  const [comboFrontId, setComboFrontId] = useState<string>('');
  const [comboBackId, setComboBackId] = useState<string>('');
  const [combo27Loop1Id, setCombo27Loop1Id] = useState<string>('');
  const [combo27Loop2Id, setCombo27Loop2Id] = useState<string>('');
  const [combo27Loop3Id, setCombo27Loop3Id] = useState<string>('');
  const [apiStatus, setApiStatus] = useState<GolfApiStatus | null>(null);
  const [showKeyDetails, setShowKeyDetails] = useState(false);
  const [customApiKey, setCustomApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('caddieline_golf_api_key') || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    void checkGolfApiStatus().then((status) => {
      setApiStatus(status);
    });
  }, []);

  const hasAutoSearchedRef = useRef(false);
  const lastSearchedPosRef = useRef<LatLngLiteral | null>(null);

  const handleNearbySearch = useCallback(async (pos?: LatLngLiteral | null) => {
    const targetPos = pos !== undefined ? pos : userPosition;
    setIsSearching(true);
    setErrorMessage(null);
    setHasSearched(true);

    try {
      const courses = await findNearbyCoursesOsm(targetPos, 45000);
      setResults(deduplicateCoursesList(courses));
    } catch {
      setErrorMessage('Could not reach nearby course directories. Try searching by name above.');
    } finally {
      setIsSearching(false);
    }
  }, [userPosition]);

  const runTextSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        void handleNearbySearch(userPosition);
        return;
      }
      setIsSearching(true);
      setErrorMessage(null);
      setHasSearched(true);
      setPendingMultiCourse(null);

      try {
        const courses = await searchCoursesOsm(trimmed, userPosition);
        setResults(deduplicateCoursesList(courses));
      } catch {
        setErrorMessage('Unable to complete course search right now. Check your connection.');
      } finally {
        setIsSearching(false);
      }
    },
    [userPosition, handleNearbySearch]
  );

  const handleTextSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await runTextSearch(query);
    },
    [query, runTextSearch]
  );

  const handlePickSubCourse = useCallback(
    (course: CourseInfo, fullGeometry: OsmCourseGeometry, loop: PendingLoopOption) => {
      const filtered = loop.osmSub
        ? filterGeometryForSubCourse(fullGeometry, loop.osmSub.id)
        : fullGeometry;
      const summary = summarizeOsmGeometry(filtered);
      const tees = loop.gcaDetail?.tees ?? [];
      const defaultTee = pickDefaultTee(tees);
      const apiSource = loop.gcaDetail?.id?.startsWith('oga_') ? 'OpenGolfAPI' : 'GolfCourseAPI';
      const attributions = Array.from(
        new Set([
          ...(course.attributions ?? []),
          ...(tees.length > 0 ? [apiSource] : []),
          'OpenStreetMap',
        ])
      );
      const subCourseInfo: CourseInfo = {
        ...course,
        placeId: `${course.placeId.split('__')[0]}__${loop.id}`,
        name: `${course.name.split('—')[0].trim()} — ${loop.name}`,
        subCourseId: loop.osmSub?.id ?? loop.id,
        subCourseName: loop.name,
        osmSummary: summary,
        attributions,
        golfCourseApiId: loop.gcaDetail?.id ?? course.golfCourseApiId,
        clubName: loop.gcaDetail?.clubName ?? course.clubName,
        courseName: loop.gcaDetail?.courseName ?? loop.name,
        availableTees: tees.length > 0 ? tees : undefined,
        selectedTeeId: defaultTee?.id,
      };
      onSelectCourse(subCourseInfo, filtered);
    },
    [onSelectCourse]
  );

  const handlePickComboLoops = useCallback(
    (
      course: CourseInfo,
      fullGeometry: OsmCourseGeometry,
      front: PendingLoopOption,
      back: PendingLoopOption
    ) => {
      const comboId = `combo__${front.id}__${back.id}`;
      const comboName = `${front.name} / ${back.name}`;
      const filtered =
        front.osmSub && back.osmSub
          ? filterGeometryForSubCourse(fullGeometry, `combo__${front.osmSub.id}__${back.osmSub.id}`)
          : fullGeometry;
      const summary = summarizeOsmGeometry(filtered);

      const combinedTees =
        front.gcaDetail && back.gcaDetail
          ? combineSubCourseTees(front.gcaDetail, back.gcaDetail)
          : front.gcaDetail?.tees ?? back.gcaDetail?.tees ?? [];
      const defaultTee = pickDefaultTee(combinedTees);
      const apiSource =
        front.gcaDetail?.id?.startsWith('oga_') || back.gcaDetail?.id?.startsWith('oga_')
          ? 'OpenGolfAPI'
          : 'GolfCourseAPI';
      const attributions = Array.from(
        new Set([
          ...(course.attributions ?? []),
          ...(combinedTees.length > 0 ? [apiSource] : []),
          'OpenStreetMap',
        ])
      );

      const subCourseInfo: CourseInfo = {
        ...course,
        placeId: `${course.placeId.split('__')[0]}__${comboId}`,
        name: `${course.name.split('—')[0].trim()} — ${comboName}`,
        subCourseId: front.osmSub && back.osmSub ? `combo__${front.osmSub.id}__${back.osmSub.id}` : comboId,
        subCourseName: comboName,
        osmSummary: summary,
        attributions,
        availableTees: combinedTees.length > 0 ? combinedTees : undefined,
        selectedTeeId: defaultTee?.id,
      };
      onSelectCourse(subCourseInfo, filtered);
    },
    [onSelectCourse]
  );

  const handlePick27ComboLoops = useCallback(
    (
      course: CourseInfo,
      fullGeometry: OsmCourseGeometry,
      loop1: PendingLoopOption,
      loop2: PendingLoopOption,
      loop3: PendingLoopOption
    ) => {
      const comboId = `combo27__${loop1.id}__${loop2.id}__${loop3.id}`;
      const comboName = `${loop1.name} / ${loop2.name} / ${loop3.name}`;
      const summary = summarizeOsmGeometry(fullGeometry);

      const combinedTees =
        loop1.gcaDetail && loop2.gcaDetail && loop3.gcaDetail
          ? combine3SubCourseTees(loop1.gcaDetail, loop2.gcaDetail, loop3.gcaDetail)
          : [];
      const defaultTee = pickDefaultTee(combinedTees);
      const attributions = Array.from(
        new Set([
          ...(course.attributions ?? []),
          ...(combinedTees.length > 0 ? ['GolfCourseAPI'] : []),
          'OpenStreetMap',
        ])
      );

      const subCourseInfo: CourseInfo = {
        ...course,
        placeId: `${course.placeId.split('__')[0]}__${comboId}`,
        name: `${course.name.split('—')[0].trim()} — ${comboName} (27 Holes)`,
        subCourseId: comboId,
        subCourseName: comboName,
        osmSummary: summary,
        attributions,
        availableTees: combinedTees.length > 0 ? combinedTees : undefined,
        selectedTeeId: defaultTee?.id,
      };
      onSelectCourse(subCourseInfo, fullGeometry);
    },
    [onSelectCourse]
  );

  const handleChooseCourse = useCallback(
    async (course: CourseInfo) => {
      setLoadingCourseId(course.placeId);
      setErrorMessage(null);
      try {
        const safeLocation = course.location && !Number.isNaN(course.location.lat)
          ? course.location
          : userPosition ?? { lat: 0, lng: 0 };
        const safeCourse: CourseInfo = { ...course, location: safeLocation };

        const [geomResult, gcaResult] = await Promise.allSettled([
          fetchCourseGolfGeometry(safeCourse, true),
          fetchGolfCourseMatch(safeCourse),
        ]);

        const gcaMatches =
          gcaResult.status === 'fulfilled' ? gcaResult.value.matches : [];

        const geometry: OsmCourseGeometry =
          geomResult.status === 'fulfilled'
            ? geomResult.value
            : {
                courseId: course.placeId.split('__')[0],
                fetchedAt: Date.now(),
                holes: [],
                greens: [],
                bunkers: [],
                waters: [],
                fairways: [],
                tees: [],
              };

        const osmSubs = geometry.subCourses ?? [];
        const loops: PendingLoopOption[] = [];

        if (osmSubs.length >= 2) {
          const matchedGcaIds = new Set<string>();
          for (const sub of osmSubs) {
            const gca = findExactOrCloseGcaMatch(sub.name, gcaMatches);
            if (gca) matchedGcaIds.add(gca.id);
            const gcaDefaultTee = gca ? pickDefaultTee(gca.tees) : undefined;
            const parTotal =
              gcaDefaultTee?.parTotal ??
              (gcaDefaultTee?.holes.length
                ? gcaDefaultTee.holes.reduce((acc, h) => acc + h.par, 0)
                : sub.holes.reduce((acc, h) => acc + (h.par ?? 4), 0));
            loops.push({
              id: sub.id,
              name: sub.name,
              holeCount: gcaDefaultTee?.numberOfHoles ?? sub.holes.length,
              parTotal,
              yardageTotal: gcaDefaultTee?.totalYards,
              osmSub: sub,
              gcaDetail: gca,
            });
          }

          // Include any extra courses at the club found in GolfCourseAPI that OSM missed (e.g. Par 3 course)
          for (const gca of gcaMatches) {
            if (matchedGcaIds.has(gca.id)) continue;
            const defaultTee = pickDefaultTee(gca.tees);
            const holeCount = defaultTee?.numberOfHoles ?? defaultTee?.holes.length ?? 18;
            const parTotal =
              defaultTee?.parTotal ??
              (defaultTee?.holes.reduce((acc, h) => acc + h.par, 0) || holeCount * 4);
            loops.push({
              id: `gca_${gca.id}`,
              name: gca.courseName || gca.displayName,
              holeCount,
              parTotal,
              yardageTotal: defaultTee?.totalYards,
              gcaDetail: gca,
            });
          }
        } else if (gcaMatches.length >= 2) {
          // Multiple courses at the SAME facility: ensure they are within 4000m of the selected course location
          const localGca = gcaMatches.filter((gca) => {
            if (!safeLocation || !gca.location) return false;
            return computeDistanceMeters(safeLocation, gca.location) <= 4000;
          });

          if (localGca.length >= 2) {
            for (const gca of localGca) {
              const defaultTee = pickDefaultTee(gca.tees);
              const holeCount = defaultTee?.numberOfHoles ?? defaultTee?.holes.length ?? 18;
              const parTotal =
                defaultTee?.parTotal ??
                (defaultTee?.holes.reduce((acc, h) => acc + h.par, 0) || holeCount * 4);
              loops.push({
                id: `gca_${gca.id}`,
                name: gca.courseName || gca.displayName,
                holeCount,
                parTotal,
                yardageTotal: defaultTee?.totalYards,
                gcaDetail: gca,
              });
            }
          }
        }

        if (loops.length >= 2) {
          setPendingMultiCourse({ course, geometry, loops });
          const nineLoops = loops.filter((l) => l.holeCount <= 9);
          if (nineLoops.length >= 2) {
            setComboFrontId(nineLoops[0].id);
            setComboBackId(nineLoops[1].id);
          } else {
            setComboFrontId('');
            setComboBackId('');
          }
          if (nineLoops.length >= 3) {
            setCombo27Loop1Id(nineLoops[0].id);
            setCombo27Loop2Id(nineLoops[1].id);
            setCombo27Loop3Id(nineLoops[2].id);
          } else {
            setCombo27Loop1Id('');
            setCombo27Loop2Id('');
            setCombo27Loop3Id('');
          }
          return;
        }

        const matchedGca =
          loops[0]?.gcaDetail ??
          matchSubCourseNameToGca(course.courseName || course.subCourseName, gcaMatches) ??
          (gcaMatches.length > 0 ? gcaMatches[0] : null);
        const tees = matchedGca?.tees ?? [];
        const defaultTee = pickDefaultTee(tees);
        const summary = summarizeOsmGeometry(geometry);
        const apiSource = matchedGca?.id?.startsWith('oga_') ? 'OpenGolfAPI' : 'GolfCourseAPI';
        const attributions = Array.from(
          new Set([
            ...(course.attributions ?? []),
            ...(tees.length > 0 ? [apiSource] : []),
            'OpenStreetMap',
          ])
        );

        onSelectCourse(
          {
            ...safeCourse,
            osmSummary: summary,
            attributions,
            golfCourseApiId: matchedGca?.id ?? course.golfCourseApiId,
            clubName: matchedGca?.clubName ?? course.clubName,
            courseName: matchedGca?.courseName ?? course.courseName,
            availableTees: tees.length > 0 ? tees : undefined,
            selectedTeeId: defaultTee?.id,
          },
          geometry
        );
      } catch (err) {
        console.error('Failed to load course details, attempting fallback:', err);
        try {
          const fallbackGeometry: OsmCourseGeometry = {
            courseId: course.placeId.split('__')[0],
            fetchedAt: Date.now(),
            holes: [],
            greens: [],
            bunkers: [],
            waters: [],
            fairways: [],
            tees: [],
          };
          onSelectCourse(course, fallbackGeometry);
        } catch (innerErr) {
          console.error('Critical failure starting round:', innerErr);
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          setErrorMessage(`Could not load hole & scorecard data for ${course.name}: ${msg}`);
        }
      } finally {
        setLoadingCourseId(null);
      }
    },
    [onSelectCourse]
  );

  // Automatically fetch nearest courses on initial render or when GPS position updates
  useEffect(() => {
    if (!hasAutoSearchedRef.current) {
      hasAutoSearchedRef.current = true;
      lastSearchedPosRef.current = userPosition;
      void handleNearbySearch(userPosition);
    } else if (
      userPosition &&
      (!lastSearchedPosRef.current ||
        computeDistanceMeters(userPosition, lastSearchedPosRef.current) > 2000)
    ) {
      if (!query.trim()) {
        lastSearchedPosRef.current = userPosition;
        void handleNearbySearch(userPosition);
      }
    }
  }, [userPosition, query, handleNearbySearch]);

  const sortedResults = useMemo(() => {
    const nonDisc = results.filter((c) => !isDiscGolfCourse(c.name, c.formattedAddress));
    if (!userPosition || nonDisc.length <= 1) return nonDisc;
    return [...nonDisc].sort(
      (a, b) =>
        computeDistanceMeters(userPosition, a.location) -
        computeDistanceMeters(userPosition, b.location)
    );
  }, [results, userPosition]);

  // When not searching text, automatically display the nearest 10 courses
  const displayedCourses = useMemo(() => {
    if (query.trim()) {
      return sortedResults;
    }
    return sortedResults.slice(0, 10);
  }, [query, sortedResults]);

  return (
    <div className="h-full overflow-y-auto bg-[#F4F7F4] dark:bg-[#07100a]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 pb-28">
        {/* Modern Vibrant Hero Banner */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900 text-white p-6 sm:p-8 shadow-xl shadow-emerald-950/20 text-center">
          <div className="absolute top-0 right-0 -mt-6 -mr-6 w-48 h-48 rounded-full bg-emerald-500/20 blur-2xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/3 -mb-8 w-40 h-40 rounded-full bg-teal-400/15 blur-xl pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center justify-center py-2 sm:py-4">
            <h1 className="font-display text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
              Pocket Caddy
            </h1>
          </div>
        </div>

        {/* Course Search & Finder Card */}
        <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-md shadow-slate-200/40 dark:shadow-none overflow-hidden">
          <form onSubmit={handleTextSearch} className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 space-y-3.5">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search course name, club, or city..."
                  className="w-full h-12 pl-10 pr-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 text-sm font-semibold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="h-12 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-bold shadow-md shadow-emerald-600/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap shrink-0 active:scale-95"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => void handleNearbySearch()}
                disabled={isSearching}
                className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 min-h-[38px] px-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60 hover:bg-emerald-100 disabled:opacity-50 transition-all whitespace-nowrap shadow-2xs"
              >
                <Compass className="w-4 h-4" />
                <span>{userPosition ? 'Refresh Nearest 10 Courses' : 'Refresh Nearby Courses'}</span>
              </button>
            </div>
          </form>

          {/* Results List */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-[500px] overflow-y-auto">
            {errorMessage && (
              <div className="p-4 m-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3 shadow-2xs">
                <span>{errorMessage}</span>
                <button
                  type="button"
                  onClick={() => void handleNearbySearch()}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-800 text-white font-bold whitespace-nowrap shrink-0 hover:bg-amber-900 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {isSearching && (
              <div className="p-12 flex flex-col items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                <span className="font-medium">
                  {query.trim() ? 'Searching golf courses...' : 'Detecting your GPS position & nearest courses...'}
                </span>
              </div>
            )}

            {!isSearching && hasSearched && displayedCourses.length === 0 && !errorMessage && (
              <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400 space-y-1">
                <div className="font-bold text-slate-800 dark:text-slate-200">No courses found</div>
                <div className="text-xs">
                  {query.trim()
                    ? 'No golf courses matched your query. Try adding a city, state, or club name.'
                    : 'No golf courses found nearby. Try searching by course name above.'}
                </div>
              </div>
            )}

            {!isSearching && displayedCourses.length > 0 && (
              <div className="px-5 py-2.5 bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold">
                <span>{query.trim() ? `Results for "${query.trim()}"` : 'Nearest Golf Courses'}</span>
                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/60 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-full shadow-2xs">
                  {query.trim()
                    ? `${displayedCourses.length} ${displayedCourses.length === 1 ? 'course' : 'courses'}`
                    : `Top ${displayedCourses.length}`}
                </span>
              </div>
            )}

            {displayedCourses.map((course) => {
              const isLoadingThis = loadingCourseId === course.placeId;
              const isMultiExpanded = pendingMultiCourse?.course.placeId === course.placeId;
              const loopOptions = isMultiExpanded ? pendingMultiCourse.loops : [];

              // Compute distance badge if GPS position is available
              const distM = userPosition ? computeDistanceMeters(userPosition, course.location) : null;
              const distBadge =
                distM !== null
                  ? distM >= 1609.34
                    ? `${(distM / 1609.34).toFixed(1)} mi`
                    : `${Math.round(distM * 1.09361)} yds`
                  : null;

              return (
                <div key={course.placeId} className="bg-white dark:bg-[#0c160f] transition-colors">
                  <button
                    type="button"
                    disabled={loadingCourseId !== null}
                    onClick={() => void handleChooseCourse(course)}
                    className="w-full text-left px-5 py-4 min-h-[72px] flex items-center justify-between gap-3 hover:bg-emerald-50/60 dark:hover:bg-slate-800/40 disabled:opacity-60 transition-colors group"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-md shadow-emerald-600/20 group-hover:scale-105 transition-transform">
                        {isLoadingThis ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <MapPin className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-[#0F1A14] dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors truncate">
                            {course.name}
                          </span>
                          {distBadge && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold font-mono bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                              {distBadge}
                            </span>
                          )}
                        </div>
                        {course.formattedAddress && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {course.formattedAddress}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                          {course.attributions?.length
                            ? course.attributions.join(' · ')
                            : 'OpenStreetMap'}
                        </div>
                      </div>
                    </div>

                    <span className="h-9 px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 group-hover:bg-emerald-700 group-hover:text-white dark:group-hover:bg-emerald-600 text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-all flex items-center gap-1 shadow-2xs">
                      {isLoadingThis ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Loading...</span>
                        </>
                      ) : isMultiExpanded ? (
                        <span>Select Loop ↓</span>
                      ) : (
                        <>
                          <span>Play</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </span>
                  </button>

                  {isMultiExpanded && loopOptions.length >= 2 && (
                    <div className="px-5 pb-5 pt-3 bg-emerald-50/50 dark:bg-emerald-950/20 border-t border-emerald-100 dark:border-emerald-900/50 space-y-3">
                      <div className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                        Multiple courses found at {course.name} — choose which course to play:
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {loopOptions.map((loop) => {
                          const displayName = /\b(course|links|nine)\b/i.test(loop.name)
                            ? loop.name
                            : `${loop.name} Course`;
                          return (
                            <button
                              key={loop.id}
                              type="button"
                              onClick={() =>
                                handlePickSubCourse(course, pendingMultiCourse.geometry, loop)
                              }
                              className="min-h-[52px] px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-600 dark:hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 text-left flex items-center justify-between gap-2 transition-all shadow-2xs"
                            >
                              <div>
                                <div className="text-xs font-bold text-[#0F1A14] dark:text-slate-100">
                                  {displayName}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                  {loop.holeCount} holes · Par {loop.parTotal}
                                  {loop.yardageTotal ? ` · ${loop.yardageTotal.toLocaleString()} yds` : ''}
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                            </button>
                          );
                        })}
                      </div>

                      {(() => {
                        const nineLoops = loopOptions.filter((l) => l.holeCount <= 9);
                        if (nineLoops.length < 2) return null;
                        const frontLoop = nineLoops.find((s) => s.id === comboFrontId) ?? nineLoops[0];
                        const backLoop = nineLoops.find((s) => s.id === comboBackId) ?? nineLoops[1];
                        return (
                          <div className="pt-3 border-t border-emerald-200/70 dark:border-emerald-800/70 space-y-2">
                            <div className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                              Or pair two 9-hole loops for an 18-hole round:
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={frontLoop.id}
                                onChange={(e) => setComboFrontId(e.target.value)}
                                aria-label="Front 9 loop"
                                className="h-10 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-xs font-bold text-[#0F1A14] dark:text-slate-100"
                              >
                                {nineLoops.map((loop) => (
                                  <option key={loop.id} value={loop.id}>
                                    Front 9: {loop.name}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={backLoop.id}
                                onChange={(e) => setComboBackId(e.target.value)}
                                aria-label="Back 9 loop"
                                className="h-10 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-xs font-bold text-[#0F1A14] dark:text-slate-100"
                              >
                                {nineLoops.map((loop) => (
                                  <option key={loop.id} value={loop.id}>
                                    Back 9: {loop.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() =>
                                  handlePickComboLoops(
                                    course,
                                    pendingMultiCourse.geometry,
                                    frontLoop,
                                    backLoop
                                  )
                                }
                                className="h-10 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold whitespace-nowrap shadow-sm transition-all"
                              >
                                Play 18 Holes →
                              </button>
                            </div>

                            {/* 27-Hole All-Nines Custom Order Selector */}
                            {nineLoops.length >= 3 && (() => {
                              const loop1 = nineLoops.find((s) => s.id === combo27Loop1Id) ?? nineLoops[0];
                              const loop2 = nineLoops.find((s) => s.id === combo27Loop2Id) ?? nineLoops[1];
                              const loop3 = nineLoops.find((s) => s.id === combo27Loop3Id) ?? nineLoops[2];
                              return (
                                <div className="pt-3 border-t border-emerald-200/70 dark:border-emerald-800/70 space-y-2">
                                  <div className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                                    Or select all 27 holes in your custom order:
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <select
                                      value={loop1.id}
                                      onChange={(e) => setCombo27Loop1Id(e.target.value)}
                                      aria-label="1st 9 loop"
                                      className="h-10 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-xs font-bold text-[#0F1A14] dark:text-slate-100"
                                    >
                                      {nineLoops.map((loop) => (
                                        <option key={loop.id} value={loop.id}>
                                          1st 9: {loop.name}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      value={loop2.id}
                                      onChange={(e) => setCombo27Loop2Id(e.target.value)}
                                      aria-label="2nd 9 loop"
                                      className="h-10 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-xs font-bold text-[#0F1A14] dark:text-slate-100"
                                    >
                                      {nineLoops.map((loop) => (
                                        <option key={loop.id} value={loop.id}>
                                          2nd 9: {loop.name}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      value={loop3.id}
                                      onChange={(e) => setCombo27Loop3Id(e.target.value)}
                                      aria-label="3rd 9 loop"
                                      className="h-10 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-xs font-bold text-[#0F1A14] dark:text-slate-100"
                                    >
                                      {nineLoops.map((loop) => (
                                        <option key={loop.id} value={loop.id}>
                                          3rd 9: {loop.name}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handlePick27ComboLoops(
                                          course,
                                          pendingMultiCourse.geometry,
                                          loop1,
                                          loop2,
                                          loop3
                                        )
                                      }
                                      className="h-10 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold whitespace-nowrap shadow-sm transition-all"
                                    >
                                      Play All 27 Holes →
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Saved Rounds Section (Local Storage) */}
        {savedRounds.length > 0 && (
          <div className="bg-white dark:bg-[#0c160f] rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-md shadow-slate-200/40 dark:shadow-none overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-[#0F1A14] dark:text-slate-100">Saved Rounds</h2>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-bold text-slate-500">
                  {savedRounds.length}
                </span>
              </div>
              <span className="text-xs text-slate-400">Stored on device</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {savedRounds.map((item) => {
                const holeNums = Object.keys(item.scores).map(Number);
                const played = holeNums.filter((n) => isHolePlayed(item.scores[n]));
                const strokes = holeNums.reduce((s, n) => s + getHoleStrokes(item.scores[n]), 0);
                const parPlayed = played.reduce((s, n) => s + (item.holes[n]?.par ?? 4), 0);
                const diff = strokes - parPlayed;
                return (
                  <div
                    key={item.id}
                    className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#0F1A14] dark:text-slate-100 truncate">
                        {item.course?.name ?? 'Saved Round'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-1">
                        <span>{new Date(item.startedAt).toLocaleDateString()}</span>
                        <span>·</span>
                        <span>{played.length} holes</span>
                        {strokes > 0 && (
                          <>
                            <span>·</span>
                            <span
                              className={`px-2 py-0.2 rounded-md font-bold text-[11px] ${
                                diff < 0
                                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                  : diff === 0
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                    : 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                              }`}
                            >
                              {strokes} ({formatRelativeToPar(diff)})
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onLoadSavedRound(item)}
                        className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-500 dark:hover:text-slate-950 text-xs font-bold text-slate-700 dark:text-slate-300 transition-all whitespace-nowrap shadow-2xs"
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedRound(item.id)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                        aria-label="Delete saved round"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Compass, Loader2, MapPin, Nfc, Search, Trash2 } from 'lucide-react';
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
} from '../services/osmGolfService';
import {
  combineSubCourseTees,
  fetchGolfCourseMatch,
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
  pairedClubsCount: number;
  onSelectCourse: (course: CourseInfo, geometry: OsmCourseGeometry) => void;
  onLoadSavedRound: (round: RoundState) => void;
  onDeleteSavedRound: (roundId: string) => void;
  onOpenBagNfc: () => void;
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
  pairedClubsCount,
  onSelectCourse,
  onLoadSavedRound,
  onDeleteSavedRound,
  onOpenBagNfc,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
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

  const handleNearbySearch = useCallback(async () => {
    if (!userPosition) return;
    setIsSearching(true);
    setErrorMessage(null);
    setHasSearched(true);

    try {
      const courses = await findNearbyCoursesOsm(userPosition, 45000);
      setResults(courses);
    } catch {
      setErrorMessage('Could not reach nearby course directories. Try searching by name above.');
    } finally {
      setIsSearching(false);
    }
  }, [userPosition]);

  const runTextSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setIsSearching(true);
      setErrorMessage(null);
      setHasSearched(true);
      setPendingMultiCourse(null);

      try {
        const courses = await searchCoursesOsm(trimmed, userPosition);
        setResults(courses);
      } catch {
        setErrorMessage('Unable to complete course search right now. Check your connection.');
      } finally {
        setIsSearching(false);
      }
    },
    [userPosition]
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
      const attributions = Array.from(
        new Set([
          ...(course.attributions ?? []),
          ...(tees.length > 0 ? ['GolfCourseAPI'] : []),
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

  const handleChooseCourse = useCallback(
    async (course: CourseInfo) => {
      setLoadingCourseId(course.placeId);
      setErrorMessage(null);
      try {
        const [geomResult, gcaResult] = await Promise.allSettled([
          fetchCourseGolfGeometry(course, true),
          fetchGolfCourseMatch(course),
        ]);

        const gcaMatches =
          gcaResult.status === 'fulfilled' ? gcaResult.value.matches : [];

        if (geomResult.status === 'rejected' && gcaMatches.length === 0) {
          throw new Error('Both OSM and GolfCourseAPI failed');
        }

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
          for (const gca of gcaMatches) {
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
          return;
        }

        const matchedGca =
          loops[0]?.gcaDetail ??
          matchSubCourseNameToGca(course.courseName || course.subCourseName, gcaMatches);
        const tees = matchedGca?.tees ?? [];
        const defaultTee = pickDefaultTee(tees);
        const summary = summarizeOsmGeometry(geometry);
        const attributions = Array.from(
          new Set([
            ...(course.attributions ?? []),
            ...(tees.length > 0 ? ['GolfCourseAPI'] : []),
            'OpenStreetMap',
          ])
        );

        onSelectCourse(
          {
            ...course,
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
      } catch {
        setErrorMessage(`Could not load hole & scorecard data for ${course.name}. Please try again.`);
      } finally {
        setLoadingCourseId(null);
      }
    },
    [onSelectCourse]
  );

  useEffect(() => {
    if (userPosition && !hasSearched && results.length === 0) {
      void handleNearbySearch();
    }
  }, [userPosition, hasSearched, results.length, handleNearbySearch]);

  const sortedResults = useMemo(() => {
    if (!userPosition || results.length <= 1) return results;
    return [...results].sort(
      (a, b) =>
        computeDistanceMeters(userPosition, a.location) -
        computeDistanceMeters(userPosition, b.location)
    );
  }, [results, userPosition]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6 pb-24">
        <div className="space-y-2">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#0F1A14] tracking-tight text-balance">
            Choose your golf course
          </h1>
          <p className="text-sm sm:text-base text-slate-600">
            Select a course to start your round, enable automatic NFC club tracking, and load hole GPS layouts.
          </p>
        </div>

        {/* Course Search Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <form onSubmit={handleTextSearch} className="p-4 sm:p-5 border-b border-slate-100 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search course name, city, or club..."
                  className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-300 text-sm text-[#0F1A14] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="h-11 px-5 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              {userPosition ? (
                <button
                  type="button"
                  onClick={() => void handleNearbySearch()}
                  disabled={isSearching}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 min-h-[36px] px-2 -ml-2 rounded-lg hover:bg-emerald-50 transition-colors whitespace-nowrap"
                >
                  <Compass className="w-4 h-4" />
                  <span>Refresh Nearby Courses</span>
                </button>
              ) : (
                <span className="text-xs text-slate-400">
                  Enable GPS to automatically list closest courses first
                </span>
              )}

              <button
                type="button"
                onClick={onOpenBagNfc}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#0F1A14] min-h-[36px] px-2 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap"
              >
                <Nfc className="w-3.5 h-3.5 text-emerald-700" />
                <span>
                  {pairedClubsCount > 0 ? `Bag & NFC (${pairedClubsCount})` : 'Pair Club Tags'}
                </span>
              </button>
            </div>
          </form>

          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {errorMessage && (
              <div className="p-4 m-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3">
                <span>{errorMessage}</span>
                {userPosition && (
                  <button
                    type="button"
                    onClick={() => void handleNearbySearch()}
                    className="px-3 py-1.5 rounded-lg bg-amber-900 text-white font-semibold whitespace-nowrap shrink-0 hover:bg-amber-950 transition-colors"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {isSearching && (
              <div className="p-10 flex items-center justify-center gap-2.5 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
                <span>Finding golf courses...</span>
              </div>
            )}

            {!isSearching && hasSearched && sortedResults.length === 0 && !errorMessage && (
              <div className="p-8 text-center text-sm text-slate-500">
                No golf courses matched your search. Try adding a city or state name.
              </div>
            )}

            {!isSearching && !hasSearched && sortedResults.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                <p>Search for any golf course name, city, or club above to begin your round.</p>
              </div>
            )}

            {sortedResults.map((course) => {
              const isLoadingThis = loadingCourseId === course.placeId;
              const isMultiExpanded = pendingMultiCourse?.course.placeId === course.placeId;
              const loopOptions = isMultiExpanded ? pendingMultiCourse.loops : [];

              return (
                <div key={course.placeId} className="bg-white">
                  <button
                    type="button"
                    disabled={loadingCourseId !== null}
                    onClick={() => void handleChooseCourse(course)}
                    className="w-full text-left px-5 py-3.5 min-h-[64px] flex items-center justify-between gap-3 hover:bg-emerald-50/60 disabled:opacity-60 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
                        {isLoadingThis ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <MapPin className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#0F1A14] truncate">
                          {course.name}
                        </div>
                        {course.formattedAddress && (
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {course.formattedAddress}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {course.attributions?.length
                            ? course.attributions.join(' · ')
                            : 'OpenStreetMap'}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
                      {isLoadingThis ? 'Loading...' : isMultiExpanded ? 'Select Loop ↓' : 'Start Round'}
                    </span>
                  </button>

                  {isMultiExpanded && loopOptions.length >= 2 && (
                    <div className="px-5 pb-4 pt-2 bg-emerald-50/50 border-t border-emerald-100 space-y-3">
                      <div className="text-xs font-semibold text-emerald-950">
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
                              className="min-h-[48px] px-4 py-2.5 rounded-xl bg-white border border-emerald-200 hover:border-emerald-600 hover:bg-emerald-50 text-left flex items-center justify-between gap-2 transition-colors shadow-2xs"
                            >
                              <div>
                                <div className="text-xs font-bold text-[#0F1A14]">
                                  {displayName}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                  {loop.holeCount} holes · Par {loop.parTotal}
                                  {loop.yardageTotal ? ` · ${loop.yardageTotal.toLocaleString()} yds` : ''}
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-emerald-700 shrink-0" />
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
                          <div className="pt-2 border-t border-emerald-200/70 space-y-2">
                            <div className="text-[11px] font-semibold text-emerald-900">
                              Or pair two 9-hole loops for 18 holes:
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={frontLoop.id}
                                onChange={(e) => setComboFrontId(e.target.value)}
                                aria-label="Front 9 loop"
                                className="h-10 px-2.5 rounded-xl border border-emerald-200 bg-white text-xs font-semibold text-[#0F1A14]"
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
                                className="h-10 px-2.5 rounded-xl border border-emerald-200 bg-white text-xs font-semibold text-[#0F1A14]"
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
                                className="h-10 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap transition-colors"
                              >
                                Play 18 Holes →
                              </button>
                            </div>
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
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#0F1A14]">Saved Rounds</h2>
              <span className="text-xs text-slate-500">Stored locally on this device</span>
            </div>
            <div className="divide-y divide-slate-100">
              {savedRounds.map((item) => {
                const holeNums = Object.keys(item.scores).map(Number);
                const played = holeNums.filter((n) => isHolePlayed(item.scores[n]));
                const strokes = holeNums.reduce((s, n) => s + getHoleStrokes(item.scores[n]), 0);
                const parPlayed = played.reduce((s, n) => s + (item.holes[n]?.par ?? 4), 0);
                return (
                  <div
                    key={item.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#0F1A14] truncate">
                        {item.course?.name ?? 'Saved Round'}
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        {new Date(item.startedAt).toLocaleDateString()} · {played.length} holes ·{' '}
                        {strokes > 0
                          ? `${strokes} (${formatRelativeToPar(strokes - parPlayed)})`
                          : 'No score'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onLoadSavedRound(item)}
                        className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedRound(item.id)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50"
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

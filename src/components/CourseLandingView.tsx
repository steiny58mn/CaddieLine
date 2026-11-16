import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Compass, Loader2, MapPin, Nfc, Search, Trash2 } from 'lucide-react';
import {
  CourseInfo,
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
  computeDistanceMeters,
  formatRelativeToPar,
  getHoleStrokes,
  isHolePlayed,
} from '../utils/golfMath';

interface CourseLandingViewProps {
  userPosition: LatLngLiteral | null;
  savedRounds: RoundState[];
  pairedClubsCount: number;
  onSelectCourse: (course: CourseInfo, geometry: OsmCourseGeometry) => void;
  onLoadSavedRound: (round: RoundState) => void;
  onDeleteSavedRound: (roundId: string) => void;
  onOpenBagNfc: () => void;
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
    (course: CourseInfo, fullGeometry: OsmCourseGeometry, sub: OsmSubCourse) => {
      const filtered = filterGeometryForSubCourse(fullGeometry, sub.id);
      const summary = summarizeOsmGeometry(filtered);
      const subCourseInfo: CourseInfo = {
        ...course,
        placeId: `${course.placeId.split('__')[0]}__${sub.id}`,
        name: `${course.name} — ${sub.name}`,
        subCourseId: sub.id,
        subCourseName: sub.name,
        osmSummary: summary,
      };
      onSelectCourse(subCourseInfo, filtered);
    },
    [onSelectCourse]
  );

  const handlePickComboLoops = useCallback(
    (course: CourseInfo, fullGeometry: OsmCourseGeometry, front: OsmSubCourse, back: OsmSubCourse) => {
      const comboId = `combo__${front.id}__${back.id}`;
      const comboName = `${front.name} / ${back.name}`;
      const filtered = filterGeometryForSubCourse(fullGeometry, comboId);
      const summary = summarizeOsmGeometry(filtered);
      const subCourseInfo: CourseInfo = {
        ...course,
        placeId: `${course.placeId.split('__')[0]}__${comboId}`,
        name: `${course.name} — ${comboName}`,
        subCourseId: comboId,
        subCourseName: comboName,
        osmSummary: summary,
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
        const geometry = await fetchCourseGolfGeometry(course, true);
        if (geometry.subCourses && geometry.subCourses.length >= 2) {
          setPendingMultiCourse({ course, geometry });
          const nineLoops = geometry.subCourses.filter((s) => s.holes.length <= 9);
          if (nineLoops.length >= 2) {
            setComboFrontId(nineLoops[0].id);
            setComboBackId(nineLoops[1].id);
          } else {
            setComboFrontId('');
            setComboBackId('');
          }
          return;
        }
        const summary = summarizeOsmGeometry(geometry);
        onSelectCourse({ ...course, osmSummary: summary }, geometry);
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
              const subCourses = isMultiExpanded ? pendingMultiCourse.geometry.subCourses ?? [] : [];

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

                  {isMultiExpanded && subCourses.length >= 2 && (
                    <div className="px-5 pb-4 pt-2 bg-emerald-50/50 border-t border-emerald-100 space-y-3">
                      <div className="text-xs font-semibold text-emerald-950">
                        Multiple courses found at {course.name} — choose which course to play:
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {subCourses.map((sub) => {
                          const totalPar = sub.holes.reduce((acc, h) => acc + (h.par ?? 4), 0);
                          const displayName = /\b(course|links|nine)\b/i.test(sub.name)
                            ? sub.name
                            : `${sub.name} Course`;
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() =>
                                handlePickSubCourse(course, pendingMultiCourse.geometry, sub)
                              }
                              className="min-h-[48px] px-4 py-2.5 rounded-xl bg-white border border-emerald-200 hover:border-emerald-600 hover:bg-emerald-50 text-left flex items-center justify-between gap-2 transition-colors shadow-2xs"
                            >
                              <div>
                                <div className="text-xs font-bold text-[#0F1A14]">
                                  {displayName}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                  {sub.holes.length} holes · Par {totalPar}
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-emerald-700 shrink-0" />
                            </button>
                          );
                        })}
                      </div>

                      {(() => {
                        const nineLoops = subCourses.filter((s) => s.holes.length <= 9);
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

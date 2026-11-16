import React, { useCallback, useEffect, useState } from 'react';
import { Compass, Loader2, MapPin, Search, X } from 'lucide-react';
import { CourseInfo, LatLngLiteral, OsmCourseGeometry } from '../types/golf';
import {
  fetchCourseGolfGeometry,
  findNearbyCoursesOsm,
  searchCoursesOsm,
  summarizeOsmGeometry,
} from '../services/osmGolfService';

interface CourseSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPosition: LatLngLiteral | null;
  currentCourse: CourseInfo | null;
  onSelectCourse: (course: CourseInfo, geometry: OsmCourseGeometry) => void;
}

const FEATURED_QUERIES = ['Pebble Beach Golf Links', 'Torrey Pines Golf', 'TPC Sawgrass'];

export const CourseSearchModal: React.FC<CourseSearchModalProps> = ({
  isOpen,
  onClose,
  userPosition,
  currentCourse,
  onSelectCourse,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingCourseId, setLoadingCourseId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleNearbySearch = useCallback(async () => {
    if (!userPosition) return;
    setIsSearching(true);
    setErrorMessage(null);
    setHasSearched(true);

    try {
      const courses = await findNearbyCoursesOsm(userPosition, 45000);
      setResults(courses);
    } catch {
      setErrorMessage('Could not reach OpenStreetMap nearby courses. Try searching by name below.');
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

      try {
        const courses = await searchCoursesOsm(trimmed, userPosition);
        setResults(courses);
      } catch {
        setErrorMessage('Unable to complete OpenStreetMap search right now. Check your connection.');
      } finally {
        setIsSearching(false);
      }
    },
    [userPosition]
  );

  const handleTextSearch = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      await runTextSearch(query);
    },
    [query, runTextSearch]
  );

  const handleChooseCourse = useCallback(
    async (course: CourseInfo) => {
      setLoadingCourseId(course.placeId);
      setErrorMessage(null);
      try {
        const geometry = await fetchCourseGolfGeometry(course);
        const summary = summarizeOsmGeometry(geometry);
        onSelectCourse({ ...course, osmSummary: summary }, geometry);
        onClose();
      } catch {
        setErrorMessage(
          `Loaded ${course.name}, but Overpass geometry timed out. You can still pin tee/green manually or tap Sync OSM.`
        );
        onSelectCourse(course, {
          courseId: course.placeId,
          fetchedAt: Date.now(),
          holes: [],
          greens: [],
          bunkers: [],
          waters: [],
          fairways: [],
          tees: [],
        });
        onClose();
      } finally {
        setLoadingCourseId(null);
      }
    },
    [onSelectCourse, onClose]
  );

  useEffect(() => {
    if (isOpen && userPosition && !hasSearched && results.length === 0) {
      void handleNearbySearch();
    }
  }, [isOpen, userPosition, hasSearched, results.length, handleNearbySearch]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end md:items-center justify-center bg-black/55 backdrop-blur-sm p-0 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-search-title"
    >
      <div className="w-full md:max-w-xl bg-white rounded-t-3xl md:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]">
        <div className="md:hidden w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3" />

        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 id="course-search-title" className="text-lg font-bold text-[#0F1A14]">
              Find Golf Course
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ArcGIS Golf Directory + OpenStreetMap · greens, bunkers & hazards
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            aria-label="Close course search"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleTextSearch} className="p-4 border-b border-slate-100 space-y-3">
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
              className="h-11 px-4 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
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
                <span>Courses Near My GPS</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                {FEATURED_QUERIES.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => {
                      setQuery(sample);
                      void runTextSearch(sample);
                    }}
                    className="text-[11px] font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            )}
            {currentCourse && (
              <span className="text-xs text-slate-500 truncate max-w-[210px]">
                Active: {currentCourse.name}
              </span>
            )}
          </div>
        </form>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
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
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
              <span>Searching golf course directories...</span>
            </div>
          )}

          {!isSearching && hasSearched && results.length === 0 && !errorMessage && (
            <div className="p-8 text-center text-sm text-slate-500">
              No golf courses matched your search. Try adding a city or state name.
            </div>
          )}

          {!isSearching && !hasSearched && results.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-500 space-y-2">
              <p>
                Search any golf course worldwide to load its OpenStreetMap holes, greens, sand
                bunkers, and water hazards — completely free with offline caching.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                {FEATURED_QUERIES.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => {
                      setQuery(sample);
                      void runTextSearch(sample);
                    }}
                    className="text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Try {sample}
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.map((course) => {
            const isSelected = currentCourse?.placeId === course.placeId;
            const isLoadingThis = loadingCourseId === course.placeId;
            return (
              <button
                key={course.placeId}
                type="button"
                disabled={loadingCourseId !== null}
                onClick={() => void handleChooseCourse(course)}
                className={`w-full text-left px-5 py-3.5 min-h-[60px] flex items-center justify-between gap-3 hover:bg-emerald-50/60 disabled:opacity-60 transition-colors ${
                  isSelected ? 'bg-emerald-50/80' : ''
                }`}
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
                      {(course.attributions?.length
                        ? course.attributions.join(' · ')
                        : 'OpenStreetMap')}{' '}
                      · Tap to load holes & hazards
                    </div>
                  </div>
                </div>
                <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
                  {isLoadingThis ? 'Loading...' : isSelected ? 'Reload' : 'Load Course'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export type LatLngLiteral = {
  lat: number;
  lng: number;
};

export type DistanceUnit = 'yards' | 'meters';

export type ShotLie =
  | 'fairway'
  | 'green'
  | 'fringe'
  | 'rough'
  | 'trees'
  | 'sand'
  | 'water'
  | 'ob'
  | 'holed'
  | 'left_rough'
  | 'right_rough'
  | 'left_trees'
  | 'right_trees';

export type ShotDirection = 'left' | 'straight' | 'right' | 'short' | 'long';

export type ClubCategory = 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';

export interface Club {
  id: string;
  name: string;
  shortName: string;
  category: ClubCategory;
  typicalYards: number;
  nfcTagId?: string;
}

export interface ShotRecord {
  id: string;
  holeNumber: number;
  strokeNumber: number;
  clubId: string;
  clubName: string;
  clubShortName: string;
  lie: ShotLie;
  direction: ShotDirection;
  penaltyStrokes: number;
  distanceYards: number | null;
  startLatLng?: LatLngLiteral;
  endLatLng?: LatLngLiteral;
  timestamp: number;
  source: 'manual' | 'nfc' | 'map';
  isPutt?: boolean;
}

export type HazardPinType = 'bunker' | 'water' | 'dogleg' | 'layup';

export interface HoleHazardPin {
  id: string;
  label: string;
  type: HazardPinType;
  latLng: LatLngLiteral;
}

export interface HolePinData {
  holeNumber: number;
  par: number;
  handicap: number;
  yardage: number;
  teeLatLng?: LatLngLiteral;
  greenCenterLatLng?: LatLngLiteral;
  greenFrontLatLng?: LatLngLiteral;
  greenBackLatLng?: LatLngLiteral;
  greenPolygon?: LatLngLiteral[];
  hazards: HoleHazardPin[];
}

export type OsmFeatureKind = 'green' | 'bunker' | 'water' | 'fairway' | 'tee';

export interface OsmPolygonFeature {
  id: string;
  kind: OsmFeatureKind;
  label: string;
  holeNumber?: number;
  polygon: LatLngLiteral[];
  center: LatLngLiteral;
}

export interface OsmHoleFeature {
  holeNumber: number;
  par?: number;
  handicap?: number;
  yardage?: number;
  name?: string;
  path: LatLngLiteral[];
  teeLatLng?: LatLngLiteral;
  greenCenterLatLng?: LatLngLiteral;
}

export interface OsmCourseSummary {
  holesMapped: number;
  greens: number;
  bunkers: number;
  waters: number;
}

export interface OsmSubCourse {
  id: string;
  name: string;
  holes: OsmHoleFeature[];
  greens: OsmPolygonFeature[];
  bunkers: OsmPolygonFeature[];
  waters: OsmPolygonFeature[];
  fairways: OsmPolygonFeature[];
  tees: OsmPolygonFeature[];
}

export interface OsmCourseGeometry {
  courseId: string;
  fetchedAt: number;
  holes: OsmHoleFeature[];
  greens: OsmPolygonFeature[];
  bunkers: OsmPolygonFeature[];
  waters: OsmPolygonFeature[];
  fairways: OsmPolygonFeature[];
  tees: OsmPolygonFeature[];
  subCourses?: OsmSubCourse[];
}

export interface HoleScoreState {
  holeNumber: number;
  shots: ShotRecord[];
  manualPutts: number;
  manualScoreOverride?: number;
}

export interface CourseInfo {
  placeId: string;
  name: string;
  formattedAddress?: string;
  location: LatLngLiteral;
  attributions?: string[];
  osmSummary?: OsmCourseSummary;
  subCourseId?: string;
  subCourseName?: string;
}

export interface RoundState {
  id: string;
  course: CourseInfo | null;
  startedAt: number;
  updatedAt: number;
  unit: DistanceUnit;
  currentHole: number;
  holes: Record<number, HolePinData>;
  scores: Record<number, HoleScoreState>;
}

export type MapTapMode =
  | 'measure'
  | 'log_shot'
  | 'drop_ball'
  | 'set_tee'
  | 'set_green'
  | 'set_green_front'
  | 'set_green_back'
  | 'add_hazard';

export type AppViewTab = 'stats' | 'map' | 'scorecard' | 'bag';


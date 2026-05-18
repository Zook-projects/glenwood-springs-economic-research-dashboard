export type GlenwoodVisitorType = 'Residents' | 'Inbound Commuters' | 'Out-of-Market Visitors';
export type GlenwoodDistanceBand = '0-25' | '25-50' | '50-100' | '100-250' | '250+';

export interface GlenwoodAnnualVisitMetric {
  year: number;
  visits: number;
  outOfMarketVisitors: number;
  avgDaysInMarket: number | null;
  avgDailyTimeMinutes: number | null;
  medianDailyTimeMinutes: number | null;
  yoyPct: number | null;
}

export interface GlenwoodVisitationFile {
  source: 'Placer.ai';
  lastBuilt: string;
  dataYearRange: [number, number] | null;
  dataDateRange: [string, string];
  dailyVisits: {
    byType: { date: string; type: GlenwoodVisitorType; value: number }[];
    byDistance: { date: string; distance: GlenwoodDistanceBand; value: number }[];
    byOvernight: { date: string; overnight: 1; value: number }[];
  };
  annualMetrics: GlenwoodAnnualVisitMetric[];
  avgDailyVisitors: Record<string, number>;
  visitorProfile: Record<string, number>;
}

export interface GlenwoodHubMetricYear {
  avgDwellMin: number | null;
  visitFrequency: number | null;
}

export interface GlenwoodOriginRow {
  year: number;
  month?: string | null;
  zip: string;
  lat?: number | null;
  lng?: number | null;
  visits: number;
  pctOfVisits: number | null;
  yoyPct: number | null;
}

export interface GlenwoodOriginLatLng {
  zip: string;
  lat: number;
  lng: number;
  totalVisits: number;
}

export type GlenwoodProfile = Record<string, Record<string, number> | number>;

export interface GlenwoodFeatureEntity {
  id: string;
  name: string;
  dailyVisits?: { date: string; value: number }[];
  monthlyVisits?: { date: string; value: number }[];
  metrics: Record<string, GlenwoodHubMetricYear>;
  origins: GlenwoodOriginRow[];
  originsLatLng?: GlenwoodOriginLatLng[];
  profile: GlenwoodProfile;
}

export interface GlenwoodHubsFile {
  source: 'Placer.ai';
  lastBuilt: string;
  dataYearRange: [number, number] | null;
  hubs: GlenwoodFeatureEntity[];
}

export interface GlenwoodPoisFile {
  source: 'Placer.ai';
  lastBuilt: string;
  dataMonthRange: [string, string];
  pois: GlenwoodFeatureEntity[];
}

export type GlenwoodFeatureKind = 'hub' | 'poi' | 'city-boundary';

export interface GlenwoodFeatureProperties {
  id: string;
  name: string;
  kind: GlenwoodFeatureKind;
}

export type GlenwoodFeatureGeometry =
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon
  | GeoJSON.Point;

export type GlenwoodFeatures = GeoJSON.FeatureCollection<
  GlenwoodFeatureGeometry,
  GlenwoodFeatureProperties
>;

export interface GlenwoodPlacerData {
  visitation: GlenwoodVisitationFile;
  hubs: GlenwoodHubsFile;
  pois: GlenwoodPoisFile;
  features: GlenwoodFeatures | null;
}

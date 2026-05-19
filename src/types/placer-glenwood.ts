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
  // Bucketed visitor demographics by distance band, sourced from the
  // Tourist_Profile sheet. Outer key is the distance label (e.g.,
  // "All", "0-25 mi", "Overnight"); inner keys are category names
  // ("Household Income", "Household Size", etc.); inner-inner keys are
  // bucket labels with share values in 0..1. The Demographics-mode
  // strip cards read from this — picking "All" by default and the
  // active distance when the user cross-filters via the ranking card.
  visitorProfileByDistance: Record<
    string,
    Record<string, Record<string, number>>
  >;
  // Latest reported year's Avg. Days in Market keyed by distance band
  // (e.g., "0-25 mi"), plus "Overnight" and "All" (the visits-weighted
  // average across the five distance bands). KPI block picks the right
  // entry based on the active visitation filter.
  daysInMarketByDistance: Record<string, number>;
  // Latest reported year's Family Households share (0..1) from the
  // Tourist Profile sheet, keyed by distance band and "All".
  familyHouseholdsPctByDistance: Record<string, number>;
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
  // Injected at runtime by GlenwoodMapCanvas — per-entity palette color.
  // Paint expressions read this via ['get', 'color'] to highlight a
  // selected hub/POI in the same color the ranking card legend uses.
  color?: string;
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

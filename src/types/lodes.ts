// Shared types for the LODES card-strip data emitted by scripts/build-data.py.
// Wire format for public/data/{rac,wac,od-summary}.json. Trend series cover
// 2002–2023 (22 vintages); breakdown blocks are latest-year only.

export interface TrendPoint {
  year: number;
  value: number;
}

// Dimensions emitted as 22-point sparklines on RAC/WAC entries + aggregate.
// Race, ethnicity, education, sex carry latest-year only (no trend).
// NAICS-20 sectors carry full 22-year series alongside the 3-bucket rollup —
// the keys match the Python NAICS_20_COLS values verbatim so the wire format
// aligns. Used by the Work Area Profile dashboard subsection's Trend mode.
export type Naics20Key =
  | 'naics11_agriculture' | 'naics21_mining' | 'naics22_utilities'
  | 'naics23_construction' | 'naics3133_manufacturing' | 'naics42_wholesale'
  | 'naics4445_retail' | 'naics4849_transportation' | 'naics51_information'
  | 'naics52_finance' | 'naics53_realEstate' | 'naics54_professional'
  | 'naics55_management' | 'naics56_admin' | 'naics61_education'
  | 'naics62_healthcare' | 'naics71_arts' | 'naics72_accommodation'
  | 'naics81_otherServices' | 'naics92_publicAdmin';

export type RacWacTrendDim =
  | 'totalJobs'
  | 'ageU29' | 'age30to54' | 'age55plus'
  | 'wageLow' | 'wageMid' | 'wageHigh'
  | 'naicsGoods' | 'naicsTradeTransUtil' | 'naicsAllOther'
  | Naics20Key;

// Dimensions emitted as 22-point sparklines on OD inflow/outflow + aggregate.
// OD pairs carry only the 3-bucket NAICS rollup — the 20-sector breakdown is
// WAC-only because LEHD doesn't publish per-sector OD pairs.
export type OdTrendDim =
  | 'totalJobs'
  | 'ageU29' | 'age30to54' | 'age55plus'
  | 'wageLow' | 'wageMid' | 'wageHigh'
  | 'naicsGoods' | 'naicsTradeTransUtil' | 'naicsAllOther';

export type RacWacTrend = Record<RacWacTrendDim, TrendPoint[]>;
export type OdTrend = Record<OdTrendDim, TrendPoint[]>;

// ---------------------------------------------------------------------------
// Latest-year breakdown blocks
// ---------------------------------------------------------------------------
export interface AgeBlock {
  u29: number;
  age30to54: number;
  age55plus: number;
}

export interface WageBlock {
  low: number;
  mid: number;
  high: number;
}

export interface Naics3Block {
  goods: number;
  tradeTransUtil: number;
  allOther: number;
}

// Latest-year breakdown across all 20 NAICS sectors. Drives the Work Area
// Profile dashboard chart and the Workforce map's Industry metric mode.
// Keys must stay in lock-step with Naics20Key + scripts/lodes.py NAICS_20_COLS.
export type Naics20Block = Record<Naics20Key, number>;

export interface RaceBlock {
  white: number;
  black: number;
  amInd: number;
  asian: number;
  nhpi: number;
  twoOrMore: number;
}

export interface EthnicityBlock {
  notHispanic: number;
  hispanic: number;
}

export interface EducationBlock {
  lessHs: number;
  hs: number;
  someCol: number;
  bachPlus: number;
}

export interface SexBlock {
  male: number;
  female: number;
}

// Latest-year RAC/WAC breakdown — 10 dimensions, mirrors the bottom-card panels
// plus the Work Area Profile dashboard subsection's per-sector NAICS-20 view.
export interface RacWacLatest {
  totalJobs: number;
  age: AgeBlock;
  wage: WageBlock;
  naics3: Naics3Block;
  naics20: Naics20Block;
  race: RaceBlock;
  ethnicity: EthnicityBlock;
  education: EducationBlock;
  sex: SexBlock;
}

// OD records carry only the dimensions LEHD publishes on OD pairs:
// totalJobs, age, wage, naics3.
export interface OdLatest {
  totalJobs: number;
  age: AgeBlock;
  wage: WageBlock;
  naics3: Naics3Block;
}

// ---------------------------------------------------------------------------
// Per-ZIP entries (rac.json / wac.json / od-summary.json)
// ---------------------------------------------------------------------------
export interface RacEntry {
  zip: string;
  place: string;
  latestYear: number;
  latest: RacWacLatest;
  trend: RacWacTrend;
}

export interface WacEntry extends RacEntry {}

export interface OdPartner {
  zip: string;
  place: string;
  workers: number;
  // Full ZIP set rolled into this partner row. Multi-ZIP places (e.g.,
  // Eagle 81631 + 81637, Grand Junction 81501 + 81504) carry every member
  // ZIP here so the UI can match a row's exact universe to a selectedPartner
  // payload of the same shape. Empty for the ALL_OTHER residual.
  zips: string[];
  // Year-by-year worker totals (2002–latest) for this partner→anchor (or
  // anchor→partner, on the outflow side) flow. Sums across all member ZIPs
  // at each year. Drives the partner-scoped sparkline rendered in the
  // Workforce Flows card when a partner is selected.
  trend: TrendPoint[];
}

export interface OdSummaryEntry {
  zip: string;
  place: string;
  latestYear: number;
  inflow: {
    latest: OdLatest | null;
    trend: OdTrend;
  };
  outflow: {
    latest: OdLatest | null;
    trend: OdTrend;
  };
  // Within-ZIP commuters (h_zip == w_zip) — workers who live AND work in this
  // ZIP. Excluded from inflow/outflow above so those reflect only cross-ZIP
  // commuters; surfaced separately here as a "live and work" metric.
  // Latest carries the full OdLatest shape so the within-ZIP card can
  // recompute under a segment filter; trend mirrors OdTrend so each per-bucket
  // sparkline can re-aggregate from the same per-year per-bucket series.
  withinZip: {
    latest: OdLatest | null;
    trend: OdTrend;
  };
  topPartners: {
    inflow: OdPartner[];
    outflow: OdPartner[];
  };
}

// ---------------------------------------------------------------------------
// Aggregate roll-ups — emitted alongside per-zip entries in the same JSON.
// ---------------------------------------------------------------------------
export interface RacWacAggregate {
  latestYear: number;
  latest: RacWacLatest | null;
  trend: RacWacTrend;
}

export interface OdAggregate {
  latestYear: number;
  inflow: {
    latest: OdLatest | null;
    trend: OdTrend;
  };
  outflow: {
    latest: OdLatest | null;
    trend: OdTrend;
  };
  withinZip: {
    latest: OdLatest | null;
    trend: OdTrend;
  };
}

// Wire-format envelopes — match the JSON shape emitted by build-data.py.
export interface RacFile {
  latestYear: number;
  aggregate: RacWacAggregate;
  entries: RacEntry[];
}

export interface WacFile {
  latestYear: number;
  aggregate: RacWacAggregate;
  entries: WacEntry[];
}

export interface OdSummaryFile {
  latestYear: number;
  aggregate: OdAggregate;
  entries: OdSummaryEntry[];
}

// ---------------------------------------------------------------------------
// Block-level heatmap (od-blocks.json) — 2023 only, visual-only layer driving
// the workplace/residential density heatmap painted under the flow arcs.
// ---------------------------------------------------------------------------
export interface BlockSegments {
  age: AgeBlock;
  wage: WageBlock;
  naics3: Naics3Block;
}

export interface BlockPartner extends BlockSegments {
  zip: string;
  total: number;
}

export interface AnchorBlock extends BlockSegments {
  block: string;
  lat: number;
  lng: number;
  // Containing-anchor ZIP — used by the heatmap direction filter to evaluate
  // each partner's bearing against the block's own anchor centroid (uniform
  // logic in regional and per-anchor views).
  anchorZip: string;
  total: number;
  partners: BlockPartner[];
}

export interface OdBlocksAnchor {
  workplaceBlocks: AnchorBlock[];
  homeBlocks: AnchorBlock[];
}

export interface OdBlocksFile {
  latestYear: number;
  anchors: Record<string, OdBlocksAnchor>;
}

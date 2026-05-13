// workforceCountyScopes — shared lookup tables and scoping helpers for the
// sidebar's County filter. Used by HousingMarketSection (ZHVI subsection +
// Affordability cards), DemographicsSection, and any other dashboard surface
// that needs to narrow its geography list by county.
//
// The county filter is "global" — it scopes Workforce flows, Demographics,
// and the Housing → ZHVI subsection. For sections that don't have data for a
// chosen county (Eagle in particular — no anchor places in Eagle except
// Basalt), the scope helper returns the unscoped list so the section still
// renders. Mirrors the ANCHOR_COUNTY mapping in flowQueries.ts where Basalt
// (81621) lives in Eagle by ZIP centroid even though its Census Place
// primary-county is Pitkin.

import type { WorkforceCountyFilter } from '../types/flow';

// 5-digit Census GEOID per county. Matches the keys used in
// public/data/context/*.json's `counties[]` entries.
export const COUNTY_GEOID_BY_FILTER: Record<
  Exclude<WorkforceCountyFilter, 'all'>,
  string
> = {
  garfield: '08045',
  pitkin: '08097',
  eagle: '08037',
};

// Human-readable county labels for use in subtitles, tooltips, etc.
// 'all' returns an empty string so callers can string-template without a
// special-case check.
export const COUNTY_LABEL_BY_FILTER: Record<WorkforceCountyFilter, string> = {
  all: '',
  garfield: 'Garfield',
  pitkin: 'Pitkin',
  eagle: 'Eagle',
};

// Anchor ZIP membership per county filter. Matches ANCHOR_COUNTY in
// flowQueries.ts: Basalt (81621) is filed under Eagle by ZIP centroid even
// though Census Place data files it under Pitkin.
export const PLACE_ZIPS_BY_FILTER: Record<
  Exclude<WorkforceCountyFilter, 'all'>,
  ReadonlyArray<string>
> = {
  garfield: ['81601', '81623', '81635', '81647', '81650', '81652'],
  pitkin: ['81611', '81615', '81654'],
  eagle: ['81621'],
};

// Minimal shape that scopeGeographies needs from each item in the list.
// `id` follows the convention used by HousingMarketSection / DemographicsSection
// ('place:{zip}' | 'county:{geoid}' | 'state:{...}' | 'region:study-area' |
// 'national:US'). `kind` is the discriminator used by the existing
// deriveGeographies() helpers.
export interface CountyScopable {
  id: string;
  kind: 'place' | 'county' | 'state' | 'national';
}

// Filter a list of geography-like records to the user's selected county.
//   - 'all' (or filter omitted) returns the input unchanged.
//   - For a specific county: state + national + that county + the county's
//     anchor places.
//   - If the resulting set has no place- or county-level entries (e.g.,
//     Eagle in a section that lacks Eagle data), falls back to the original
//     list so the section keeps rendering instead of going blank.
export function scopeGeographies<T extends CountyScopable>(
  geographies: ReadonlyArray<T>,
  filter: WorkforceCountyFilter,
): T[] {
  if (filter === 'all') return geographies.slice();
  const placeZips = PLACE_ZIPS_BY_FILTER[filter];
  const countyGeoid = COUNTY_GEOID_BY_FILTER[filter];

  const scoped = geographies.filter((g) => {
    if (g.kind === 'national') return true;
    if (g.kind === 'state') return true;
    if (g.kind === 'county') return g.id === `county:${countyGeoid}`;
    if (g.kind === 'place') {
      const zip = g.id.startsWith('place:') ? g.id.slice('place:'.length) : g.id;
      return placeZips.includes(zip);
    }
    return false;
  });

  // Eagle-graceful: if the filter produced no place- or county-level matches,
  // treat as 'all' (no-op) so the section continues to render rather than
  // showing only state/national benchmarks.
  const hasLocalData = scoped.some(
    (g) => g.kind === 'place' || g.kind === 'county',
  );
  if (!hasLocalData) return geographies.slice();
  return scoped;
}

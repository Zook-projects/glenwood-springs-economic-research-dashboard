// subjectColorRamps — per-subject sequential color ramps for choropleth
// fills and proportional-symbol coloring. One ramp per subject so the maps
// don't visually collide if viewed side-by-side. All ramps are 5-stop
// sequential (light → dark) and quintile-binned at render time.

import type { SubjectId } from '../config/subjects';

export interface ColorRamp {
  // 5 colors, light → dark. Index = quintile (0 = lowest, 4 = highest).
  palette: readonly string[];
  // Used as the fallback fill for features with no data for the active metric.
  noData: string;
  // Used as the active-feature stroke / hover ring.
  accent: string;
}

// Demographics — green/teal sequential
const DEMOGRAPHICS: ColorRamp = {
  palette: ['#0f3a35', '#1b5d4f', '#2c8674', '#3fb59a', '#7ddcc1'],
  noData: 'rgba(255,255,255,0.06)',
  accent: '#7ddcc1',
};

// Housing — magenta/violet sequential
const HOUSING: ColorRamp = {
  palette: ['#3a0e3a', '#641555', '#962168', '#c63575', '#e58fb6'],
  noData: 'rgba(255,255,255,0.06)',
  accent: '#e58fb6',
};

// Commerce — amber sequential (matches existing app accent color family)
const COMMERCE: ColorRamp = {
  palette: ['#3d2300', '#664010', '#9c6418', '#d18b1a', '#f5b942'],
  noData: 'rgba(255,255,255,0.06)',
  accent: '#f5b942',
};

// Workforce ramp present for completeness; the workforce map uses its own
// LODES-specific corridor coloring and does not consume this map.
const WORKFORCE: ColorRamp = {
  palette: ['#1f1402', '#3d2900', '#735109', '#b27e1c', '#f0a932'],
  noData: 'rgba(255,255,255,0.06)',
  accent: '#f0a932',
};

export const RAMPS: Record<SubjectId, ColorRamp> = {
  workforce: WORKFORCE,
  demographics: DEMOGRAPHICS,
  housing: HOUSING,
  commerce: COMMERCE,
  economic: WORKFORCE, // unused but keeps the record total
};

// Quintile-bin a value within a sorted distribution. Returns 0..4.
// `sortedValues` must be sorted ascending and contain only non-null numerics.
export function quintileIndex(value: number, sortedValues: readonly number[]): number {
  if (sortedValues.length === 0) return 0;
  const n = sortedValues.length;
  // Find the largest index i such that sortedValues[i] <= value
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedValues[mid] <= value) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo is the number of values <= value; convert to a quintile bucket 0..4
  const rank = Math.max(0, lo - 1);
  const q = Math.floor((rank / Math.max(1, n - 1)) * 5);
  return Math.min(4, q);
}

// Convenience: produce the 5 quintile breakpoints from a sorted distribution.
// Returns the 4 cut points (between bins 0|1, 1|2, 2|3, 3|4) so callers can
// render legends.
export function quintileBreaks(sortedValues: readonly number[]): number[] {
  if (sortedValues.length === 0) return [0, 0, 0, 0];
  const n = sortedValues.length;
  return [0.2, 0.4, 0.6, 0.8].map((q) => {
    const idx = Math.min(n - 1, Math.floor(q * n));
    return sortedValues[idx];
  });
}

// Categorical palette for multi-series trend lines (when multi-select is
// active in the strip). Colors picked for distinct hue separation on the
// near-black map background. Cycles via index modulo length.
export const SERIES_PALETTE: readonly string[] = [
  '#7ddcc1', // teal
  '#e58fb6', // magenta
  '#f5b942', // amber
  '#7ac4d8', // cyan
  '#c8b273', // wheat
  '#9cc479', // sage
  '#b79cc4', // mauve
  '#c47979', // brick
  '#94c4b7', // mint
  '#a8c49c', // celadon
];

export function seriesColor(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

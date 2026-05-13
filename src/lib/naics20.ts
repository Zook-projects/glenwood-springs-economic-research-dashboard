// naics20 — single source of truth for the 20-sector NAICS breakdown shared
// between the Work Area Profile dashboard subsection, the Workforce map's
// Industry metric mode, and the bubble legend. Keys must stay in lock-step
// with Naics20Key in src/types/lodes.ts and NAICS_20_COLS in scripts/lodes.py.
//
// Palette: distinct categorical colors picked to read clearly against the
// dark app background. Sectors are ordered by NAICS code (low → high) so the
// dashboard's "Latest" sort-by-value still preserves a deterministic tie-break.

import type { Naics20Key } from '../types/lodes';

export interface NaicsSector {
  key: Naics20Key;
  label: string;       // Full label for chart axes and tooltips
  shortLabel: string;  // Compact label for chips and legends
  color: string;
}

export const NAICS20_SECTORS: readonly NaicsSector[] = [
  { key: 'naics11_agriculture',     label: 'Agriculture, Forestry, Fishing & Hunting', shortLabel: 'Agriculture',     color: '#8bc34a' },
  { key: 'naics21_mining',          label: 'Mining, Quarrying, Oil & Gas',             shortLabel: 'Mining',          color: '#795548' },
  { key: 'naics22_utilities',       label: 'Utilities',                                shortLabel: 'Utilities',       color: '#ffb74d' },
  { key: 'naics23_construction',    label: 'Construction',                             shortLabel: 'Construction',    color: '#ff7043' },
  { key: 'naics3133_manufacturing', label: 'Manufacturing',                            shortLabel: 'Manufacturing',   color: '#c62828' },
  { key: 'naics42_wholesale',       label: 'Wholesale Trade',                          shortLabel: 'Wholesale',       color: '#ad1457' },
  { key: 'naics4445_retail',        label: 'Retail Trade',                             shortLabel: 'Retail',          color: '#e91e63' },
  { key: 'naics4849_transportation',label: 'Transportation & Warehousing',             shortLabel: 'Transportation', color: '#9c27b0' },
  { key: 'naics51_information',     label: 'Information',                              shortLabel: 'Information',     color: '#673ab7' },
  { key: 'naics52_finance',         label: 'Finance & Insurance',                      shortLabel: 'Finance',         color: '#3949ab' },
  { key: 'naics53_realEstate',      label: 'Real Estate, Rental & Leasing',            shortLabel: 'Real Estate',     color: '#1976d2' },
  { key: 'naics54_professional',    label: 'Professional, Scientific & Technical',     shortLabel: 'Professional',    color: '#0288d1' },
  { key: 'naics55_management',      label: 'Management of Companies & Enterprises',    shortLabel: 'Management',      color: '#0097a7' },
  { key: 'naics56_admin',           label: 'Administrative, Support & Waste Mgmt',     shortLabel: 'Admin & Support', color: '#00897b' },
  { key: 'naics61_education',       label: 'Educational Services',                     shortLabel: 'Education',       color: '#388e3c' },
  { key: 'naics62_healthcare',      label: 'Health Care & Social Assistance',          shortLabel: 'Healthcare',      color: '#558b2f' },
  { key: 'naics71_arts',            label: 'Arts, Entertainment & Recreation',         shortLabel: 'Arts',            color: '#827717' },
  { key: 'naics72_accommodation',   label: 'Accommodation & Food Services',            shortLabel: 'Accommodation',   color: '#f5b942' },
  { key: 'naics81_otherServices',   label: 'Other Services (except Public Admin)',     shortLabel: 'Other Services',  color: '#90a4ae' },
  { key: 'naics92_publicAdmin',     label: 'Public Administration',                    shortLabel: 'Public Admin',    color: '#546e7a' },
];

// Lookup-by-key for components that already have a Naics20Key in hand.
export const NAICS20_BY_KEY: Record<Naics20Key, NaicsSector> = Object.fromEntries(
  NAICS20_SECTORS.map((s) => [s.key, s]),
) as Record<Naics20Key, NaicsSector>;

// Sum every NAICS-20 field on a Naics20Block. Equivalent to totalJobs at the
// same vintage (modulo per-row rounding from the build's int cast) — kept as
// a helper so both the dashboard chart and the map bubble layer can derive
// "all sectors" totals from the same primitive.
export function sumNaics20(block: { [K in Naics20Key]: number }): number {
  let total = 0;
  for (const s of NAICS20_SECTORS) total += block[s.key];
  return total;
}

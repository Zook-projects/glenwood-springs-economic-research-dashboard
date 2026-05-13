// Type-ahead + chip list for the 11 anchor ZIPs, plus a free-text search that
// lets you select any ZIP in the dataset (workplace OR residence side).

import { useMemo, useState } from 'react';
import type { WorkforceCountyFilter, ZipMeta } from '../types/flow';
import { ANCHOR_ZIPS, isAnchorInCounty } from '../lib/flowQueries';

interface Props {
  zips: ZipMeta[];
  selectedZip: string | null;
  onSelectZip: (zip: string | null) => void;
  // When true, the type-ahead search input + dropdown are hidden so only
  // the anchor-chip row renders. Used by the dashboard's inline filter card
  // where space is tighter and the search is redundant with the chip list.
  hideSearch?: boolean;
  // Optional county filter scoped to the chip row. When provided, the chip
  // row narrows to the selected county's anchors and a county chip row
  // renders directly below the workplace chip row. Defaults to 'all' / no
  // filter when omitted, preserving existing callers (CommuteView's
  // DashboardTile) without changes.
  selectedCounty?: WorkforceCountyFilter;
  onSelectCounty?: (county: WorkforceCountyFilter) => void;
}

const COUNTY_OPTIONS: ReadonlyArray<{ key: WorkforceCountyFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'garfield', label: 'Garfield' },
  { key: 'pitkin', label: 'Pitkin' },
  { key: 'eagle', label: 'Eagle' },
];

export function ZipSelector({
  zips,
  selectedZip,
  onSelectZip,
  hideSearch = false,
  selectedCounty = 'all',
  onSelectCounty,
}: Props) {
  const [query, setQuery] = useState('');
  const anchorZips = useMemo(
    () =>
      ANCHOR_ZIPS.map((z) => zips.find((x) => x.zip === z))
        .filter(Boolean)
        .filter((z) => isAnchorInCounty((z as ZipMeta).zip, selectedCounty)) as ZipMeta[],
    [zips, selectedCounty],
  );

  const queryLower = query.trim().toLowerCase();
  // Search results dedupe by place name so multi-ZIP places (e.g. Eagle
  // 81631+81637, Grand Junction 81501+81505) surface as a single row instead
  // of stacking duplicates. The clicked entry passes one ZIP through; App.tsx
  // is responsible for resolving sibling ZIPs into a bundle when the place
  // is a non-anchor.
  const matches = useMemo(() => {
    if (!queryLower) return [];
    const filtered = zips
      .filter((z) => !z.isSynthetic)
      .filter(
        (z) =>
          z.zip.includes(queryLower) || z.place.toLowerCase().includes(queryLower),
      );
    // Group by place name; keep the smallest ZIP as the click target so the
    // sub-label ZIP list is sorted predictably.
    const byPlace = new Map<string, { primary: ZipMeta; zips: string[] }>();
    for (const z of filtered) {
      const existing = byPlace.get(z.place);
      if (!existing) {
        byPlace.set(z.place, { primary: z, zips: [z.zip] });
      } else {
        existing.zips.push(z.zip);
        if (z.zip < existing.primary.zip) existing.primary = z;
      }
    }
    for (const v of byPlace.values()) v.zips.sort();
    return Array.from(byPlace.values()).slice(0, 6);
  }, [zips, queryLower]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          className="block text-[10px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          Workplaces - Zip Codes
        </label>
        {selectedZip && (
          <button
            type="button"
            onClick={() => onSelectZip(null)}
            aria-label="Reset workplace selection"
            className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors focus:outline-none focus-visible:ring-1"
            style={{ color: 'var(--accent)' }}
            title="Clear the selected workplace"
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Workplace ZIPs">
        {anchorZips.map((z) => {
          const active = selectedZip === z.zip;
          return (
            <button
              key={z.zip}
              type="button"
              aria-pressed={active}
              aria-label={`${z.place}, ZIP ${z.zip}${active ? ' (selected)' : ''}`}
              onClick={() => onSelectZip(active ? null : z.zip)}
              className="text-[11px] px-2 py-1 rounded-md border transition-colors focus:outline-none focus-visible:ring-1"
              style={{
                background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                color: active ? '#1a1207' : 'var(--text-h)',
                borderColor: active ? 'var(--accent)' : 'var(--panel-border)',
              }}
              title={`${z.place} (${z.zip})`}
            >
              {z.place}
            </button>
          );
        })}
      </div>
      {onSelectCounty && (
        <div className="pt-1">
          <label
            className="block text-[10px] font-medium uppercase tracking-wider mb-1"
            style={{ color: 'var(--text-dim)' }}
          >
            County
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Workforce county filter">
            {COUNTY_OPTIONS.map((opt) => {
              const active = selectedCounty === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Filter workplaces by ${opt.label} county${active ? ' (selected)' : ''}`}
                  onClick={() => onSelectCounty(opt.key)}
                  className="text-[11px] px-2 py-1 rounded-md border transition-colors focus:outline-none focus-visible:ring-1"
                  style={{
                    background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                    color: active ? '#1a1207' : 'var(--text-h)',
                    borderColor: active ? 'var(--accent)' : 'var(--panel-border)',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!hideSearch && (
      <div className="relative pt-1">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ZIP or place…"
          aria-label="Search any ZIP code or place name"
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          className="w-full text-xs px-2.5 py-1.5 rounded-md outline-none"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--panel-border)',
            color: 'var(--text-h)',
          }}
        />
        {matches.length > 0 && (
          <ul
            role="listbox"
            aria-label="Matching ZIPs"
            className="absolute left-0 right-0 mt-1 rounded-md overflow-hidden z-20 shadow-lg"
            style={{
              background: 'rgba(20,22,28,0.95)',
              border: '1px solid var(--panel-border)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            {matches.map((m) => {
              const z = m.primary;
              const zipLabel =
                m.zips.length === 1 ? z.zip : m.zips.join(' · ');
              return (
                <li
                  key={z.place}
                  role="option"
                  aria-selected={selectedZip === z.zip}
                >
                  <button
                    type="button"
                    aria-label={`Select ${z.place}, ZIP ${zipLabel}`}
                    className="w-full text-left text-xs px-2.5 py-1.5 hover:bg-white/5 flex justify-between"
                    onClick={() => {
                      onSelectZip(z.zip);
                      setQuery('');
                    }}
                  >
                    <span style={{ color: 'var(--text-h)' }}>{z.place}</span>
                    <span style={{ color: 'var(--text-dim)' }}>{zipLabel}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}

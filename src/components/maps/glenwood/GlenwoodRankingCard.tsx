// GlenwoodRankingCard — reusable ranking card for the Glenwood Activity
// bottom strips. Supports two shapes:
//   - single-section: pass `rows`
//   - multi-section: pass `sections`, where each section has its own title
//     and its own internal max for bar scaling.
//
// Each row renders: optional color swatch, label, scaled bar track, the
// formatted value (tabular nums), and an optional signed-percent YoY chip.

import { useMemo } from 'react';
import { fmtCount } from './glenwoodMetrics';

export interface RankingRow {
  key: string;
  label: string;
  color?: string;
  value: number;
  yoyPct?: number | null;
  // When true, render this row at reduced opacity. Used by the cross-filter
  // pattern: when the user has selected a subset of hubs/POIs via chips,
  // non-selected rows dim out but stay visible for context.
  dim?: boolean;
}

export interface RankingSection {
  title: string;
  rows: RankingRow[];
  // Optional per-section sort override. When omitted, the card-level
  // `sort` prop applies. Use this to preserve a domain-specific order
  // (e.g., distance bands sorted near-to-far rather than by value).
  sort?: RankingSort;
}

export type RankingSort = 'value-desc' | 'yoy-signed-desc' | 'none';

interface Props {
  title: string;
  subtitle?: string;
  // Single-section variant
  rows?: RankingRow[];
  // Multi-section variant
  sections?: RankingSection[];
  // Number formatter for the value column. Defaults to fmtCount.
  valueFormat?: (v: number) => string;
  // How to sort rows within each section.
  sort?: RankingSort;
  // When provided, used to format the YoY chip value (e.g., add unit). The
  // chip color (green/red) is driven off the signed value directly.
  yoyFormat?: (pct: number) => string;
  // When true, omit the YoY chip column entirely (visits-only cards).
  hideYoy?: boolean;
  // Rows whose `key` is in this set render with an active background and
  // accent text. Used to surface the current cross-filter selection.
  selectedKeys?: Set<string>;
  // When supplied, every row becomes a button and clicks call back with
  // the row key. Caller is responsible for translating that into the
  // appropriate selection state.
  onRowClick?: (key: string) => void;
  // Section titles in this set render with an active background. Used
  // when the caller treats a section header as a selection target
  // ("select the whole category").
  selectedSections?: Set<string>;
  // When supplied, section headers become buttons and clicks call back
  // with the section title.
  onSectionClick?: (title: string) => void;
}

function sortRows(rows: RankingRow[], sort: RankingSort): RankingRow[] {
  if (sort === 'none') return rows;
  const out = rows.slice();
  if (sort === 'value-desc') {
    out.sort((a, b) => b.value - a.value);
  } else if (sort === 'yoy-signed-desc') {
    out.sort((a, b) => {
      const ay = a.yoyPct ?? -Infinity;
      const by = b.yoyPct ?? -Infinity;
      return by - ay;
    });
  }
  return out;
}

function defaultYoy(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function GlenwoodRankingCard({
  title,
  subtitle,
  rows,
  sections,
  valueFormat = fmtCount,
  sort = 'value-desc',
  yoyFormat = defaultYoy,
  hideYoy = false,
  selectedKeys,
  onRowClick,
  selectedSections,
  onSectionClick,
}: Props) {
  // Normalize the input to a sections-array form; the renderer always works
  // off `effectiveSections`.
  const effectiveSections = useMemo<RankingSection[]>(() => {
    if (sections && sections.length) return sections;
    if (rows && rows.length) return [{ title: '', rows }];
    return [];
  }, [sections, rows]);

  if (effectiveSections.length === 0) {
    return (
      <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between"
          style={{ color: 'var(--text-dim)' }}
        >
          <span>{title}</span>
          {subtitle && <span className="text-[9px]">{subtitle}</span>}
        </div>
        <div
          className="text-[10px] uppercase tracking-wider opacity-60"
          style={{ color: 'var(--text-dim)' }}
        >
          No data in this window
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-md p-3 flex flex-col gap-2 min-w-0">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider flex items-baseline justify-between gap-2"
        style={{ color: 'var(--text-dim)' }}
      >
        <span className="truncate">{title}</span>
        {subtitle && (
          <span
            className="text-[9px] truncate normal-case font-normal"
            style={{ color: 'var(--text-dim)' }}
          >
            {subtitle}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {effectiveSections.map((section, sIdx) => {
          const sorted = sortRows(section.rows, section.sort ?? sort);
          // Per-section bar scale: use the max absolute value so bars in a
          // YoY section read symmetrically for both positive and negative
          // entries. For value-based sections, this collapses to the
          // straight max.
          const maxAbs = Math.max(1, ...sorted.map((r) => Math.abs(r.value)));
          return (
            <div key={`sec-${sIdx}-${section.title}`} className="flex flex-col gap-0.5">
              {section.title && (() => {
                const isSectionSelected = selectedSections?.has(section.title) ?? false;
                const clickable = onSectionClick != null;
                if (!clickable) {
                  return (
                    <div
                      className="text-[9px] uppercase tracking-wider"
                      style={{ color: 'var(--text-dim)', opacity: 0.85 }}
                    >
                      {section.title}
                    </div>
                  );
                }
                return (
                  <button
                    type="button"
                    aria-pressed={isSectionSelected}
                    onClick={() => onSectionClick!(section.title)}
                    className="text-[9px] uppercase tracking-wider text-left px-1 py-0.5 rounded transition-colors cursor-pointer hover:bg-white/[0.04]"
                    style={{
                      color: isSectionSelected ? 'var(--text-h)' : 'var(--text-dim)',
                      opacity: isSectionSelected ? 1 : 0.85,
                      background: isSectionSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                      outline: isSectionSelected ? '1px solid var(--accent)' : 'none',
                      outlineOffset: -1,
                      border: 'none',
                    }}
                  >
                    {section.title}
                  </button>
                );
              })()}
              <div className="flex flex-col gap-0.5">
                {sorted.map((row) => {
                  const widthPct = (Math.abs(row.value) / maxAbs) * 100;
                  const yoy = row.yoyPct;
                  const isSelected = selectedKeys?.has(row.key) ?? false;
                  const clickable = onRowClick != null;
                  const handleClick = clickable
                    ? () => onRowClick!(row.key)
                    : undefined;
                  const RowTag = (clickable ? 'button' : 'div') as 'button' | 'div';
                  return (
                    <RowTag
                      key={row.key}
                      type={clickable ? 'button' : undefined}
                      onClick={handleClick}
                      aria-pressed={clickable ? isSelected : undefined}
                      className={
                        'flex items-center gap-2 px-1 py-0.5 rounded text-left transition-colors' +
                        (clickable ? ' cursor-pointer hover:bg-white/[0.04]' : '')
                      }
                      style={{
                        opacity: row.dim ? 0.45 : 1,
                        background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                        outline: isSelected
                          ? `1px solid ${row.color ?? 'var(--accent)'}`
                          : undefined,
                        outlineOffset: -1,
                        border: 'none',
                      }}
                    >
                      {row.color && (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: row.color }}
                        />
                      )}
                      <span
                        className="text-[10px] truncate min-w-0 flex-1"
                        style={{ color: 'var(--text-h)' }}
                        title={row.label}
                      >
                        {row.label}
                      </span>
                      <div
                        className="relative shrink-0 rounded-sm overflow-hidden"
                        style={{
                          width: 36,
                          height: 5,
                          background: 'rgba(255,255,255,0.06)',
                        }}
                      >
                        <div
                          className="absolute inset-y-0 left-0"
                          style={{
                            width: `${widthPct}%`,
                            background: row.color ?? 'var(--accent)',
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <span
                        className="text-[10px] tabular-nums shrink-0 text-right"
                        style={{
                          color: 'var(--text-h)',
                          minWidth: 44,
                        }}
                      >
                        {valueFormat(row.value)}
                      </span>
                      {!hideYoy && (
                        <span
                          className="text-[9px] tabular-nums shrink-0 text-right px-1 rounded"
                          style={{
                            minWidth: 44,
                            color:
                              yoy == null
                                ? 'var(--text-dim)'
                                : yoy > 0
                                  ? '#34d399'
                                  : yoy < 0
                                    ? '#f87171'
                                    : 'var(--text-dim)',
                            background:
                              yoy == null
                                ? 'transparent'
                                : yoy > 0
                                  ? 'rgba(52, 211, 153, 0.12)'
                                  : yoy < 0
                                    ? 'rgba(248, 113, 113, 0.12)'
                                    : 'transparent',
                          }}
                        >
                          {yoy == null ? '—' : yoyFormat(yoy)}
                        </span>
                      )}
                    </RowTag>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

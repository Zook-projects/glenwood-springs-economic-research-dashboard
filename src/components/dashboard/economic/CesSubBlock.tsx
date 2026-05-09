// CesSubBlock — first sub-block of the Economic Research section. Renders
// the BLS Consumer Expenditure Survey Table 1300 narrative as three rows:
// Income, Income Tax, Spending. Each row pairs a stacked-bar chart (most
// recent year, one bar per age cohort) with a multi-year trend chart for
// the same categories.
//
// The structure is intentionally repeatable so the section shell can drop
// in BeaPersonalIncomeSubBlock, QcewNationalSubBlock, etc. later as
// siblings without touching this file.

import { useState } from 'react';
import type { CesBlock } from '../../../types/context';
import { ChartFrame } from '../HousingMarketSection';
import {
  CesAgeStackedBars,
  type CesCategorySpec,
} from './CesAgeStackedBars';
import {
  CesCategoryTrendChart,
  type CesCategoryPath,
  type CesTrendMode,
} from './CesCategoryTrendChart';

// ---------------------------------------------------------------------------
// Palettes — built from existing CSS tokens (--accent, --corridor-2) plus
// hex values already in use in DemographicsSection's GEO_PALETTE so the
// section feels visually consistent with the rest of the dashboard. No new
// CSS tokens introduced.
// ---------------------------------------------------------------------------
const ACCENT = 'var(--accent)';
const CORR_2 = 'var(--corridor-2)';
const CORR_1 = 'var(--corridor-1)';
const CORR_3 = 'var(--corridor-3)';

const INCOME_COLORS = {
  wagesBusiness: ACCENT,
  socSecRetirement: CORR_3,
  dividendsInterestRent: CORR_1,
};
const INCOME_TAX_COLORS = {
  federal: ACCENT,
  stateLocal: CORR_2,
};
const SPENDING_COLORS = {
  food: ACCENT,
  housing: '#C8B273',          // wheat
  transportation: '#7AC4D8',   // cyan
  healthcare: '#4FB3A9',       // teal
  entertainment: '#9CC479',    // sage
  insurancePensions: '#9FB3C8', // periwinkle
  other: CORR_2,
};

interface RowProps {
  ces: CesBlock;
  trendModeKey: string;
  title: string;
  snapshotSubtitle: string;
  trendSubtitle: string;
  bars: CesCategorySpec[];
  trendCategories: CesCategoryPath[];
  showYAxis?: boolean;
}

function CesRow({
  ces,
  trendModeKey,
  title,
  snapshotSubtitle,
  trendSubtitle,
  bars,
  trendCategories,
  showYAxis = true,
}: RowProps) {
  const [mode, setMode] = useState<CesTrendMode>('total');
  return (
    <div className="flex flex-col gap-2">
      <h4
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-h)' }}
      >
        {title}
      </h4>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] grid-cols-1 items-stretch">
        <ChartFrame title={`${title} by Cohort (${ces.latest.year})`} subtitle={snapshotSubtitle}>
          <CesAgeStackedBars categories={bars} showYAxis={showYAxis} />
        </ChartFrame>
        <ChartFrame
          title={`${title} Trend`}
          subtitle={trendSubtitle}
        >
          <div className="flex flex-col gap-2 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--text-dim)' }}
              >
                View
              </span>
              <div
                className="inline-flex rounded-md overflow-hidden"
                style={{ border: '1px solid var(--panel-border)' }}
                role="tablist"
                aria-label={`${title} trend view`}
              >
                {(['total', 'per-cohort'] as CesTrendMode[]).map((m) => {
                  const isActive = mode === m;
                  return (
                    <button
                      key={`${trendModeKey}-${m}`}
                      type="button"
                      onClick={() => setMode(m)}
                      role="tab"
                      aria-selected={isActive}
                      className="text-[10px] px-2 py-0.5 transition-colors"
                      style={{
                        color: isActive ? 'var(--accent)' : 'var(--text)',
                        background: isActive
                          ? 'rgba(245, 158, 11, 0.16)'
                          : 'transparent',
                      }}
                    >
                      {m === 'total' ? 'Total' : 'Per cohort'}
                    </button>
                  );
                })}
              </div>
            </div>
            <CesCategoryTrendChart
              trend={ces.trend}
              categories={trendCategories}
              mode={mode}
            />
          </div>
        </ChartFrame>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About-this-data tile for the CES sub-block. Mirrors the look of
// HousingDataSetTile / DemographicsDataSetTile.
// ---------------------------------------------------------------------------
function CesAboutTile({ ces }: { ces: CesBlock }) {
  const coverage = `${ces.vintageRange.start} → ${ces.vintageRange.end}`;
  return (
    <div
      className="rounded-md p-3 flex flex-col gap-2"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            About this data
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            BLS Consumer Expenditure Survey · Table 1300
          </div>
        </div>
        {ces.seeded && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
            style={{
              color: 'var(--accent)',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
            }}
            title="Values are illustrative reference figures. Drop the real BLS Table 1300 XLSX into data/context-cache/bls/cex/ and re-run python3 scripts/build-context.py to refresh."
          >
            Seeded values
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
        Table 1300 is the Bureau of Labor Statistics' annual cross-tab of
        consumer-unit income, taxes, and spending broken out by the age of
        the reference person. It's the source the NWCCOG Economic Summit
        uses to argue that aging will reshape labor markets, erode the
        income-tax base, and rotate consumer spending toward healthcare and
        housing. Data is national; CES does not publish age-cohort
        detail at the state, metro, or county level for areas the size of
        Garfield County.
      </p>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-1">
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Source
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            U.S. BLS · CES Table 1300
          </span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Geography
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            U.S. national
          </span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Cadence
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            Annual · Sept release
          </span>
        </li>
        <li className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Coverage
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-h)' }}>
            {coverage} · nominal USD
          </span>
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-block container
// ---------------------------------------------------------------------------
export function CesSubBlock({ ces }: { ces: CesBlock | null }) {
  if (!ces) {
    return (
      <div
        className="text-[11px] rounded-md p-3"
        style={{
          color: 'var(--text-dim)',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--panel-border)',
        }}
      >
        Loading Consumer Expenditure Survey data…
      </div>
    );
  }

  const incomeBars: CesCategorySpec[] = [
    {
      key: 'wagesBusiness',
      label: 'Wages, salaries & business income',
      color: INCOME_COLORS.wagesBusiness,
      values: ces.latest.income.wagesBusiness,
    },
    {
      key: 'socSecRetirement',
      label: 'Social Security & retirement',
      color: INCOME_COLORS.socSecRetirement,
      values: ces.latest.income.socSecRetirement,
    },
    {
      key: 'dividendsInterestRent',
      label: 'Dividends, interest, rent',
      color: INCOME_COLORS.dividendsInterestRent,
      values: ces.latest.income.dividendsInterestRent,
    },
  ];
  const incomeTrend: CesCategoryPath[] = [
    { path: 'income.wagesBusiness', label: 'Wages & business', color: INCOME_COLORS.wagesBusiness },
    { path: 'income.socSecRetirement', label: 'Social Security & retirement', color: INCOME_COLORS.socSecRetirement },
    { path: 'income.dividendsInterestRent', label: 'Dividends, interest, rent', color: INCOME_COLORS.dividendsInterestRent },
  ];

  const taxBars: CesCategorySpec[] = [
    {
      key: 'federal',
      label: 'Federal income tax',
      color: INCOME_TAX_COLORS.federal,
      values: ces.latest.incomeTax.federal,
    },
    {
      key: 'stateLocal',
      label: 'State & local income tax',
      color: INCOME_TAX_COLORS.stateLocal,
      values: ces.latest.incomeTax.stateLocal,
    },
  ];
  const taxTrend: CesCategoryPath[] = [
    { path: 'incomeTax.federal', label: 'Federal income tax', color: INCOME_TAX_COLORS.federal },
    { path: 'incomeTax.stateLocal', label: 'State & local income tax', color: INCOME_TAX_COLORS.stateLocal },
  ];

  const spendBars: CesCategorySpec[] = [
    { key: 'food', label: 'Food', color: SPENDING_COLORS.food, values: ces.latest.spending.food },
    { key: 'housing', label: 'Housing', color: SPENDING_COLORS.housing, values: ces.latest.spending.housing },
    { key: 'transportation', label: 'Transportation', color: SPENDING_COLORS.transportation, values: ces.latest.spending.transportation },
    { key: 'healthcare', label: 'Healthcare', color: SPENDING_COLORS.healthcare, values: ces.latest.spending.healthcare },
    { key: 'entertainment', label: 'Entertainment', color: SPENDING_COLORS.entertainment, values: ces.latest.spending.entertainment },
    { key: 'insurancePensions', label: 'Personal insurance & pensions', color: SPENDING_COLORS.insurancePensions, values: ces.latest.spending.insurancePensions },
    { key: 'other', label: 'All other', color: SPENDING_COLORS.other, values: ces.latest.spending.other },
  ];
  const spendTrend: CesCategoryPath[] = [
    { path: 'spending.food', label: 'Food', color: SPENDING_COLORS.food },
    { path: 'spending.housing', label: 'Housing', color: SPENDING_COLORS.housing },
    { path: 'spending.transportation', label: 'Transportation', color: SPENDING_COLORS.transportation },
    { path: 'spending.healthcare', label: 'Healthcare', color: SPENDING_COLORS.healthcare },
    { path: 'spending.entertainment', label: 'Entertainment', color: SPENDING_COLORS.entertainment },
    { path: 'spending.insurancePensions', label: 'Insurance & pensions', color: SPENDING_COLORS.insurancePensions },
    { path: 'spending.other', label: 'All other', color: SPENDING_COLORS.other },
  ];

  return (
    <div className="flex flex-col gap-3">
      <CesAboutTile ces={ces} />

      <CesRow
        ces={ces}
        trendModeKey="income"
        title="Average U.S. Income"
        snapshotSubtitle="Income before taxes by component · USD per consumer unit"
        trendSubtitle="Component totals · sum across cohorts (Total) or one line per cohort (Per cohort)"
        bars={incomeBars}
        trendCategories={incomeTrend}
      />

      <CesRow
        ces={ces}
        trendModeKey="incomeTax"
        title="Average U.S. Income Tax"
        snapshotSubtitle="Federal vs. state & local income tax paid · USD per consumer unit"
        trendSubtitle="Component totals · stacks shrink as cohorts retire and the tax base contracts"
        bars={taxBars}
        trendCategories={taxTrend}
      />

      <CesRow
        ces={ces}
        trendModeKey="spending"
        title="Average U.S. Consumer Spending"
        snapshotSubtitle="Annual expenditures by category · USD per consumer unit"
        trendSubtitle="Watch the rotation: transportation and entertainment soften, healthcare and housing carry more weight"
        bars={spendBars}
        trendCategories={spendTrend}
      />
    </div>
  );
}

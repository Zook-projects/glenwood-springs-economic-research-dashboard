// commerceMetrics — single source of truth for Commerce map measures.
// Commerce uses three "variant" metrics (gross / retail / taxable) instead of
// the broader metric set Demographics and Housing expose; the variant choice
// drives both the map symbol/choropleth and the bottom-strip trend chart.

import type { ContextLatest } from '../../types/context';

export type CommerceVariantId = 'gross' | 'retail' | 'taxable';
export type CommerceCadence = 'annual' | 'monthly';

export interface CommerceMetric {
  id: CommerceVariantId;
  label: string;
  shortLabel: string;
  // Key on the `latest` block.
  latestField: 'cdorGrossSales' | 'cdorRetailSales' | 'cdorNetTaxableSales';
  // Key on annual/monthly trend rows.
  trendField: 'gross' | 'retail' | 'taxable';
  format: (v: number | null | undefined) => string;
  extract: (latest: ContextLatest | null) => number | null;
}

const fmtMoneyB = (v: number | null | undefined) => {
  if (v == null) return '—';
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${Math.round(v)}`;
};

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

export const COMMERCE_METRICS: ReadonlyArray<CommerceMetric> = [
  {
    id: 'gross',
    label: 'Gross Sales',
    shortLabel: 'Gross',
    latestField: 'cdorGrossSales',
    trendField: 'gross',
    format: fmtMoneyB,
    extract: (l) => num(l?.cdorGrossSales),
  },
  {
    id: 'retail',
    label: 'Retail Sales',
    shortLabel: 'Retail',
    latestField: 'cdorRetailSales',
    trendField: 'retail',
    format: fmtMoneyB,
    extract: (l) => num(l?.cdorRetailSales),
  },
  {
    id: 'taxable',
    label: 'Net Taxable Sales',
    shortLabel: 'Taxable',
    latestField: 'cdorNetTaxableSales',
    trendField: 'taxable',
    format: fmtMoneyB,
    extract: (l) => num(l?.cdorNetTaxableSales),
  },
];

export const COMMERCE_METRIC_BY_ID: Record<CommerceVariantId, CommerceMetric> =
  COMMERCE_METRICS.reduce(
    (acc, m) => {
      acc[m.id] = m;
      return acc;
    },
    {} as Record<CommerceVariantId, CommerceMetric>,
  );

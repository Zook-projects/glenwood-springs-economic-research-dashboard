// EconomicResearchSection — section shell for the dashboard's Economic
// Research sidebar item. Houses one sub-block per dataset; today the only
// sub-block is BLS Consumer Expenditure Survey (CES) Table 1300. Future
// sub-blocks (BEA personal income, QCEW national, LAUS national) drop in
// as additional siblings under the same key-takeaways callout without
// altering this file's structure.

import type { EconomicBundle } from '../../types/context';
import { CesSubBlock } from './economic/CesSubBlock';

function SectionIntro() {
  return (
    <div
      className="rounded-md p-3 flex flex-col gap-2"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-h)' }}
      >
        About this section
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text)' }}>
        Economic Research collects national datasets that frame the
        long-arc forces shaping local economic-development strategy:
        consumer expenditure patterns, personal income, occupational
        wages, and labor-force structure. Today the section opens with
        the BLS Consumer Expenditure Survey. Additional national
        datasets (BEA personal income, QCEW, LAUS) will appear as
        sibling sub-blocks here.
      </p>
    </div>
  );
}

function KeyTakeawaysCallout() {
  return (
    <div
      className="rounded-md p-3 flex flex-col gap-2"
      style={{
        background: 'var(--accent-soft)',
        border: '1px solid var(--accent)',
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--accent)' }}
      >
        Why this matters
      </div>
      <ul className="flex flex-col gap-1.5 text-[11px]" style={{ color: 'var(--text)' }}>
        <li className="flex items-start gap-2">
          <span
            className="inline-block rounded-full mt-1.5 shrink-0"
            style={{ width: 6, height: 6, background: 'var(--accent)' }}
          />
          <span>
            <strong style={{ color: 'var(--text-h)' }}>
              Aging will impact our labor markets.
            </strong>{' '}
            Wages and business income peak in the 35–54 cohorts and
            collapse past 65 — workforce supply contracts as the population
            shifts older.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span
            className="inline-block rounded-full mt-1.5 shrink-0"
            style={{ width: 6, height: 6, background: 'var(--accent)' }}
          />
          <span>
            <strong style={{ color: 'var(--text-h)' }}>
              Aging will impact our tax base.
            </strong>{' '}
            Federal and state income tax payments for 65+ cohorts run a
            fraction of mid-career payments — a structural drag on
            government revenues.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span
            className="inline-block rounded-full mt-1.5 shrink-0"
            style={{ width: 6, height: 6, background: 'var(--accent)' }}
          />
          <span>
            <strong style={{ color: 'var(--text-h)' }}>
              Aging will shift consumer spending.
            </strong>{' '}
            Healthcare and housing carry more weight in older cohorts;
            transportation and entertainment soften — a rotation local
            retail and service businesses can plan against.
          </span>
        </li>
      </ul>
    </div>
  );
}

export function EconomicResearchSection({
  bundle,
}: {
  bundle: EconomicBundle | null;
}) {
  if (!bundle) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
        Loading economic research data…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] grid-cols-1">
        <SectionIntro />
        <KeyTakeawaysCallout />
      </div>

      {/* CES sub-block (first dataset). Add additional sub-blocks below
          this one — each gets its own thin top border so the section reads
          as a list of datasets. */}
      <CesSubBlock ces={bundle.ces} />
    </div>
  );
}

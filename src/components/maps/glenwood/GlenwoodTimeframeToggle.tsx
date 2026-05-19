// GlenwoodTimeframeToggle — Annual / YTD / Monthly segmented control.
// Drives the timeframe filter that applies to the map, left-panel stats,
// bottom row cards, and ranking cards in the Glenwood-scoped Activity view.
//
// Annual:  trends show annual rollups across full history; KPIs/cards/
//          rankings reflect trailing 12 months; YoY = last 12 vs prior 12
//          months.
// YTD:     trends show one annual rollup per year for Jan–latest-reported-
//          month; KPIs/cards/rankings reflect current-year YTD;
//          YoY = current-year YTD vs prior-year same-months window.
// Monthly: trends show monthly points for the last full year + current
//          YTD; KPIs/cards/rankings reflect the latest reported month;
//          YoY = latest month vs same month prior year.

import { MapToggleSegmented } from '../MapToggleSegmented';

export type GlenwoodTimeframe = 'annual' | 'ytd' | 'monthly';

interface Props {
  value: GlenwoodTimeframe;
  onChange: (next: GlenwoodTimeframe) => void;
}

const OPTIONS = [
  { value: 'ytd' as const, label: 'YTD' },
  { value: 'annual' as const, label: 'Annual' },
  { value: 'monthly' as const, label: 'Monthly' },
];

export function GlenwoodTimeframeToggle({ value, onChange }: Props) {
  return (
    <MapToggleSegmented<GlenwoodTimeframe>
      options={OPTIONS}
      value={value}
      onChange={onChange}
      accent="var(--accent)"
      ariaLabel="Glenwood timeframe"
    />
  );
}

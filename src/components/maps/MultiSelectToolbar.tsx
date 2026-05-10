// MultiSelectToolbar — small toolbar that sits above each subject map's
// bottom card strip. Hosts the multi-select toggle button and a Clear chip
// when one or more entities are selected. Aligned to the top-left of the
// strip per the design ask.

interface Props {
  multiSelect: boolean;
  onMultiSelectChange: (next: boolean) => void;
  totalSelected: number;
  onClearSelections: () => void;
  accent: string;
}

export function MultiSelectToolbar({
  multiSelect,
  onMultiSelectChange,
  totalSelected,
  onClearSelections,
  accent,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onMultiSelectChange(!multiSelect)}
        aria-pressed={multiSelect}
        title={
          multiSelect
            ? 'Multi-select on — click items to add or remove from the comparison.'
            : 'Click to compare multiple places or counties on the trend chart.'
        }
        className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded transition-colors flex items-center gap-1.5"
        style={{
          background: multiSelect ? accent : 'rgba(0,0,0,0.55)',
          color: multiSelect ? '#000' : 'var(--text-h)',
          border: `1px solid ${multiSelect ? accent : 'var(--panel-border)'}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: 2,
            border: `1.5px solid ${multiSelect ? '#000' : 'var(--text-h)'}`,
            background: multiSelect ? '#000' : 'transparent',
          }}
        />
        Multi-select{multiSelect ? ' · on' : ''}
      </button>
      {totalSelected > 0 && (
        <button
          type="button"
          onClick={onClearSelections}
          className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded transition-colors"
          style={{
            background: 'rgba(0,0,0,0.55)',
            color: 'var(--text-h)',
            border: '1px solid var(--panel-border)',
            backdropFilter: 'blur(8px)',
          }}
        >
          Clear {totalSelected}
        </button>
      )}
    </div>
  );
}

// MapSubjectTabs — horizontal tab strip rendered at the top of every map
// view. Lets the user switch between subject map views without going back
// to the dashboard. Mirrors TopBar's visual language (uppercase tracking,
// accent underline on active, dim text on inactive). Only iterates the
// four spatial subjects (MAP_SUBJECTS); Economic Research is dashboard-only.

import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MAP_SUBJECTS, type SubjectId } from '../config/subjects';

export function MapSubjectTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeId: SubjectId | null = (() => {
    const match = MAP_SUBJECTS.find((s) => location.pathname === s.mapPath);
    return match ? match.id : null;
  })();

  const focusTab = (id: SubjectId) => {
    buttonRefs.current[id]?.focus();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const order = MAP_SUBJECTS.map((s) => s.id);
    const idx = activeId ? order.indexOf(activeId) : 0;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = order[(idx + 1) % order.length];
      navigate(MAP_SUBJECTS[(idx + 1) % order.length].mapPath);
      focusTab(next);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = (idx - 1 + order.length) % order.length;
      navigate(MAP_SUBJECTS[prevIdx].mapPath);
      focusTab(order[prevIdx]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      navigate(MAP_SUBJECTS[0].mapPath);
      focusTab(order[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      const lastIdx = order.length - 1;
      navigate(MAP_SUBJECTS[lastIdx].mapPath);
      focusTab(order[lastIdx]);
    }
  };

  return (
    <div
      className="glass shrink-0 w-full"
      style={{ borderBottom: '1px solid var(--panel-border)' }}
    >
      <div
        role="tablist"
        aria-label="Map subject"
        className="flex items-stretch gap-0.5 overflow-x-auto px-3 md:px-4"
        onKeyDown={handleKey}
      >
        {MAP_SUBJECTS.map((s) => {
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              ref={(el) => { buttonRefs.current[s.id] = el; }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active || (!activeId && s.id === MAP_SUBJECTS[0].id) ? 0 : -1}
              onClick={() => navigate(s.mapPath)}
              className="relative px-3 md:px-4 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-1 shrink-0"
              style={{
                color: active ? 'var(--text-h)' : 'var(--text-dim)',
              }}
            >
              {s.label}
              <span
                aria-hidden="true"
                className="absolute left-2 right-2 -bottom-px h-[2px] rounded-t"
                style={{
                  background: active ? 'var(--accent)' : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

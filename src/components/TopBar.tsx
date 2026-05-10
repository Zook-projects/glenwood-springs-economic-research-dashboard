// TopBar — slim header strip with two view tabs (Dashboard / Map).
// Sticky to the top of the viewport. Active tab gets the warm-amber accent
// underline + bright text; inactive tabs are dim. Keyboard-accessible per
// the WAI-ARIA tabs pattern (left/right arrows + Home/End + Enter/Space).
//
// Active state is derived from the current URL: Dashboard is active on
// /dashboard, Map is active on any /map/* path. Clicking Map always lands
// on /map/workforce — keeps the URL as the single source of truth instead
// of silently remembering the last visited map.

import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type TabId = 'dashboard' | 'map';

interface Tab {
  id: TabId;
  label: string;
  path: string;
}

const TABS: ReadonlyArray<Tab> = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { id: 'map', label: 'Map', path: '/map/workforce' },
];

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const buttonRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    dashboard: null,
    map: null,
  });

  const activeId: TabId = location.pathname.startsWith('/map') ? 'map' : 'dashboard';

  const focusTab = (id: TabId) => {
    buttonRefs.current[id]?.focus();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const order: TabId[] = TABS.map((t) => t.id);
    const idx = order.indexOf(activeId);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = order[(idx + 1) % order.length];
      navigate(TABS[(idx + 1) % order.length].path);
      focusTab(next);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = (idx - 1 + order.length) % order.length;
      navigate(TABS[prevIdx].path);
      focusTab(order[prevIdx]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      navigate(TABS[0].path);
      focusTab(order[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = order.length - 1;
      navigate(TABS[last].path);
      focusTab(order[last]);
    }
  };

  return (
    <header
      className="sticky top-0 z-50 w-full glass"
      style={{
        borderBottom: '1px solid var(--panel-border)',
      }}
    >
      {/* Mobile: stack title above tabs (the desktop grid puts both on one
          row, but at narrow widths the title's letter-spacing collides with
          the tablist). md+ : three-column layout — title left, tabs at the
          true visual center, spacer right. */}
      <div className="flex flex-col items-center gap-0.5 py-1.5 px-3 md:grid md:grid-cols-3 md:items-center md:gap-0 md:py-0 md:h-12 md:px-4">
        <div
          className="text-[11px] md:text-[14px] font-semibold uppercase tracking-[0.16em] md:tracking-[0.18em] truncate text-center md:text-left max-w-full md:justify-self-start"
          style={{ color: 'var(--text-h)' }}
        >
          Glenwood Springs&nbsp;
          <span style={{ color: 'var(--text-dim)' }}>
            · Economic Research
          </span>
        </div>
        <div
          role="tablist"
          aria-label="View"
          className="flex items-stretch gap-0.5 md:justify-self-center"
          onKeyDown={handleKey}
        >
          {TABS.map((tab) => {
            const active = tab.id === activeId;
            return (
              <button
                key={tab.id}
                ref={(el) => { buttonRefs.current[tab.id] = el; }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => navigate(tab.path)}
                className="relative px-3 md:px-4 text-[11px] font-medium uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-1"
                style={{
                  color: active ? 'var(--text-h)' : 'var(--text-dim)',
                }}
              >
                {tab.label}
                {/* Active-tab underline. Sits flush with the bottom border so
                    the bar reads as a tabbed nav. */}
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
    </header>
  );
}

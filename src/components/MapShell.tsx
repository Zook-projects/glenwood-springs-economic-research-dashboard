// MapShell — layout wrapper for every map view. Renders the horizontal
// MapSubjectTabs strip on top and the map content below.
//
// Two usage modes:
//
// 1) Simple (Workforce):
//      <MapShell><CommuteView /></MapShell>
//    Children fill the full area below the subject tabs. CommuteView owns
//    its own DashboardTile + BottomCardStrip internally.
//
// 2) Slotted (Demographics / Housing / Commerce):
//      <MapShell leftPanel={<Tile/>} bottomStrip={<Strip/>}>
//        <MapArea />
//      </MapShell>
//    leftPanel renders as a fixed-width column on desktop (full-width
//    accordion-collapsible on mobile). bottomStrip docks below the map area
//    on the right side. Children become the map area itself.

import { type ReactNode } from 'react';
import { MapSubjectTabs } from './MapSubjectTabs';

interface Props {
  children: ReactNode;
  leftPanel?: ReactNode;
  bottomStrip?: ReactNode;
}

export function MapShell({ children, leftPanel, bottomStrip }: Props) {
  // Simple mode — preserves Workforce layout exactly.
  if (!leftPanel && !bottomStrip) {
    return (
      <div className="flex flex-col flex-1 min-h-0 w-full">
        <MapSubjectTabs />
        <div className="flex-1 min-h-0 flex flex-col relative">
          {children}
        </div>
      </div>
    );
  }

  // Slotted mode — left panel + map area; bottom strip (when provided)
  // overlays the map at the bottom with absolute positioning, mirroring the
  // Workforce BottomCardStrip pattern. Cards using the .glass class pick up
  // the map underneath via backdrop-filter.
  return (
    <div className="flex flex-col flex-1 min-h-0 w-full">
      <MapSubjectTabs />
      <div className="flex-1 min-h-0 flex flex-col md:flex-row relative">
        {leftPanel && (
          <aside
            className="glass shrink-0 w-full md:w-[320px] md:h-full md:overflow-y-auto"
            style={{ borderRight: '1px solid var(--panel-border)' }}
          >
            {leftPanel}
          </aside>
        )}
        <div className="flex-1 min-h-0 relative">
          {children}
          {bottomStrip && (
            <div
              className="absolute left-0 right-0 bottom-0 z-20 pointer-events-auto"
              style={{ paddingBottom: 12 }}
            >
              {bottomStrip}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

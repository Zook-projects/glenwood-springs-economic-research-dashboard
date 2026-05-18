// App — top-level layout route. Loads the LODES + corridor + context bundle
// once via useFlowData, renders the TopBar (Dashboard / Map), and yields
// the rest of the screen to whichever view the router matched.
//
// App also owns the *shared* map-subject state (geographic level, county
// filter, map layer, selected places, selected counties, multi-select mode)
// so a user's scope choices persist across the Demographics / Housing /
// Commerce views — switching subjects keeps the same county filter and
// selections in place. Subject-specific state (metric id, commerce variant
// + cadence) stays local to each view since each subject defines its own
// metric set.

import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { useFlowData } from './lib/useFlowData';
import type { FlowData } from './lib/useFlowData';
import { usePlacerData } from './lib/usePlacerData';
import { useGlenwoodPlacerData } from './lib/useGlenwoodPlacerData';
import type { PlacerData } from './types/placer';
import type { GlenwoodPlacerData } from './types/placer-glenwood';
import type { GeoLevel, MapLayerKind } from './components/maps/SubjectMapOverlay';

export interface MapSubjectState {
  geoLevel: GeoLevel;
  countyFilter: string | null;
  mapLayer: MapLayerKind;
  selectedZips: Set<string>;
  selectedCountyGeoids: Set<string>;
  multiSelect: boolean;
  setGeoLevel: (g: GeoLevel) => void;
  setCountyFilter: (c: string | null) => void;
  setMapLayer: (l: MapLayerKind) => void;
  setMultiSelect: (m: boolean) => void;
  // Map-symbol clicks. Respects multiSelect: when off, replaces selection;
  // when on, toggles in/out.
  handleSelectZip: (zip: string) => void;
  handleSelectCounty: (geoid: string) => void;
  // Ranked-list clicks. Always toggles regardless of multiSelect — the
  // ranked list is the canonical multi-select surface so each click in/out
  // of the list builds up a comparison set without requiring the toolbar
  // toggle.
  handleToggleZip: (zip: string) => void;
  handleToggleCounty: (geoid: string) => void;
  clearSelections: () => void;
}

export interface AppOutletContext {
  data: FlowData;
  placer: PlacerData | null;
  glenwoodPlacer: GlenwoodPlacerData | null;
  mapState: MapSubjectState;
}

export default function App() {
  const { data, isLoading, error } = useFlowData();
  // Placer.ai zip-origin bundle — fail-open. The hook returns null until the
  // four metric JSONs + summary exist under public/data/placer/; in that
  // state the Activity surfaces render a friendly notice instead of failing
  // the whole shell.
  const { data: placer } = usePlacerData();
  const { data: glenwoodPlacer } = useGlenwoodPlacerData();

  // Shared map-subject state — kept in App so it survives Demographics ↔
  // Housing ↔ Commerce route changes (App is a layout route, never unmounts
  // on those navigations).
  const [geoLevel, setGeoLevelRaw] = useState<GeoLevel>('place');
  const [countyFilter, setCountyFilterRaw] = useState<string | null>(null);
  const [mapLayer, setMapLayer] = useState<MapLayerKind>('symbols');
  const [selectedZips, setSelectedZips] = useState<Set<string>>(() => new Set());
  const [selectedCountyGeoids, setSelectedCountyGeoids] = useState<Set<string>>(() => new Set());
  const [multiSelect, setMultiSelect] = useState(false);

  const clearSelections = () => {
    setSelectedZips(new Set());
    setSelectedCountyGeoids(new Set());
  };

  // GeoLevel switch clears the *other* selection axis so a stale county pin
  // doesn't linger when the user moves to place mode (and vice versa).
  const setGeoLevel = (g: GeoLevel) => {
    setGeoLevelRaw(g);
    if (g === 'place') setSelectedCountyGeoids(new Set());
    if (g === 'county') setSelectedZips(new Set());
  };

  // County filter switch clears all selections — the previously-selected
  // place may not exist in the new scope.
  const setCountyFilter = (c: string | null) => {
    setCountyFilterRaw(c);
    clearSelections();
  };

  const handleSelectZip = (zip: string) => {
    setSelectedZips((prev) => {
      const next = new Set(multiSelect ? prev : []);
      if (multiSelect) {
        if (next.has(zip)) next.delete(zip);
        else next.add(zip);
      } else {
        if (prev.has(zip) && prev.size === 1) return new Set();
        next.add(zip);
      }
      return next;
    });
    setSelectedCountyGeoids(new Set());
  };

  const handleSelectCounty = (geoid: string) => {
    setSelectedCountyGeoids((prev) => {
      const next = new Set(multiSelect ? prev : []);
      if (multiSelect) {
        if (next.has(geoid)) next.delete(geoid);
        else next.add(geoid);
      } else {
        if (prev.has(geoid) && prev.size === 1) return new Set();
        next.add(geoid);
      }
      return next;
    });
    setSelectedZips(new Set());
  };

  // Toggle-only variants for ranked-list clicks. The list always functions
  // as a multi-select comparison surface, so a click just flips the item's
  // membership in the set without clearing siblings.
  const handleToggleZip = (zip: string) => {
    setSelectedZips((prev) => {
      const next = new Set(prev);
      if (next.has(zip)) next.delete(zip);
      else next.add(zip);
      return next;
    });
    setSelectedCountyGeoids(new Set());
  };

  const handleToggleCounty = (geoid: string) => {
    setSelectedCountyGeoids((prev) => {
      const next = new Set(prev);
      if (next.has(geoid)) next.delete(geoid);
      else next.add(geoid);
      return next;
    });
    setSelectedZips(new Set());
  };

  if (error) {
    return (
      <div className="min-h-screen w-full md:w-screen md:h-screen flex items-center justify-center px-4">
        <div className="text-xs uppercase tracking-widest text-center" style={{ color: 'var(--text-dim)' }}>
          <div style={{ color: 'var(--accent)' }}>Data load failed</div>
          <div className="mt-2 normal-case">{error.message}</div>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="min-h-screen w-full md:w-screen md:h-screen flex items-center justify-center">
        <div className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
          Loading flow data…
        </div>
      </div>
    );
  }

  const ctx: AppOutletContext = {
    data,
    placer,
    glenwoodPlacer,
    mapState: {
      geoLevel,
      countyFilter,
      mapLayer,
      selectedZips,
      selectedCountyGeoids,
      multiSelect,
      setGeoLevel,
      setCountyFilter,
      setMapLayer,
      setMultiSelect,
      handleSelectZip,
      handleSelectCounty,
      handleToggleZip,
      handleToggleCounty,
      clearSelections,
    },
  };

  return (
    <div
      className="min-h-screen w-full flex flex-col md:h-screen md:overflow-hidden"
      style={{ background: 'var(--bg-base)' }}
    >
      <TopBar />
      {/* Routed view fills the space below the TopBar. The wrapper provides
          the same flex envelope CommuteView/DashboardView received before
          routing — flex-1 min-h-0 column with relative positioning so child
          absolute overlays (tooltips, etc.) anchor correctly. */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <Outlet context={ctx} />
      </div>
    </div>
  );
}

// Subjects — single source of truth for the five dashboard topic areas and
// which of them have a paired map view.
//
// The dashboard sidebar iterates the full SUBJECTS list (5 items). The map
// subject tab strip + the dashboard "View Map" buttons iterate MAP_SUBJECTS
// (4 items — Economic Research is national-only data, no map view).

export type SubjectId =
  | 'workforce'
  | 'activity'
  | 'demographics'
  | 'housing'
  | 'commerce'
  | 'economic';

export interface Subject {
  id: SubjectId;
  label: string;
  // Matches an existing <section id="..."> in DashboardView so the
  // IntersectionObserver and smooth-scroll behavior keep working unchanged.
  // For map-only subjects whose dashboard surface lives inside another
  // subject's section (e.g. Activity → Workforce), this can point at the
  // host section.
  dashboardSectionId: SubjectId;
  hasMap: boolean;
  // Only present when hasMap === true.
  mapPath?: string;
  // When false, the subject is hidden from the dashboard sidebar top-level
  // list (it still contributes a sub-anchor via the host section's
  // subSections). Defaults to true when omitted.
  hasDashboard?: boolean;
  // Optional dashboard sub-section anchors. Rendered as a nested link list
  // under each top-level entry in DashboardView's left sidebar. Anchors
  // must match `id="…"` attributes on the corresponding DOM wrappers.
  subSections?: ReadonlyArray<{ id: string; label: string }>;
}

export const SUBJECTS: ReadonlyArray<Subject> = [
  {
    id: 'workforce',
    label: 'Workforce',
    dashboardSectionId: 'workforce',
    hasMap: true,
    mapPath: '/map/workforce',
    subSections: [
      { id: 'workforce-overview', label: 'Workforce' },
      { id: 'workforce-wap', label: 'Work Area Profile' },
      { id: 'workforce-od', label: 'Origin–Destination Flows' },
      { id: 'workforce-activity', label: 'Activity (Placer)' },
    ],
  },
  {
    id: 'activity',
    label: 'GPS Activity',
    dashboardSectionId: 'workforce',
    hasMap: true,
    mapPath: '/map/activity',
    hasDashboard: false,
  },
  {
    id: 'demographics',
    label: 'Demographics',
    dashboardSectionId: 'demographics',
    hasMap: true,
    mapPath: '/map/demographics',
    subSections: [
      { id: 'demographics-us-census', label: 'U.S. Census' },
    ],
  },
  {
    id: 'housing',
    label: 'Housing',
    dashboardSectionId: 'housing',
    hasMap: true,
    mapPath: '/map/housing',
    subSections: [
      { id: 'housing-unit-trend', label: 'Unit Trend' },
      { id: 'housing-affordability', label: 'Affordability' },
      { id: 'housing-stock', label: 'Housing Stock' },
      { id: 'housing-zhvi', label: 'Home Values' },
    ],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    dashboardSectionId: 'commerce',
    hasMap: true,
    mapPath: '/map/commerce',
    subSections: [
      { id: 'commerce-cdor', label: 'Colorado Dept of Revenue' },
    ],
  },
  {
    id: 'economic',
    label: 'Economic Research',
    dashboardSectionId: 'economic',
    hasMap: false,
    subSections: [
      { id: 'economic-ces', label: 'Consumer Expenditure Survey' },
    ],
  },
];

export const MAP_SUBJECTS: ReadonlyArray<Subject & { mapPath: string }> =
  SUBJECTS.filter((s): s is Subject & { mapPath: string } => s.hasMap && !!s.mapPath);

// Subjects that appear in the dashboard sidebar's top-level list. Map-only
// subjects (hasDashboard: false) are excluded — their dashboard surface
// lives inside another subject's section as a sub-anchor.
export const DASHBOARD_SUBJECTS: ReadonlyArray<Subject> =
  SUBJECTS.filter((s) => s.hasDashboard !== false);

export const SUBJECT_BY_ID: Record<SubjectId, Subject> = SUBJECTS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<SubjectId, Subject>,
);

export function isSubjectId(value: string | undefined): value is SubjectId {
  return (
    value === 'workforce' ||
    value === 'activity' ||
    value === 'demographics' ||
    value === 'housing' ||
    value === 'commerce' ||
    value === 'economic'
  );
}

export function isMapSubjectId(value: string | undefined): value is SubjectId {
  if (!isSubjectId(value)) return false;
  return SUBJECT_BY_ID[value].hasMap;
}

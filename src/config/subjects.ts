// Subjects — single source of truth for the five dashboard topic areas and
// which of them have a paired map view.
//
// The dashboard sidebar iterates the full SUBJECTS list (5 items). The map
// subject tab strip + the dashboard "View Map" buttons iterate MAP_SUBJECTS
// (4 items — Economic Research is national-only data, no map view).

export type SubjectId =
  | 'workforce'
  | 'demographics'
  | 'housing'
  | 'commerce'
  | 'economic';

export interface Subject {
  id: SubjectId;
  label: string;
  // Matches the existing <section id="..."> in DashboardView so the
  // IntersectionObserver and smooth-scroll behavior keep working unchanged.
  dashboardSectionId: SubjectId;
  hasMap: boolean;
  // Only present when hasMap === true.
  mapPath?: string;
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
    ],
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

export const SUBJECT_BY_ID: Record<SubjectId, Subject> = SUBJECTS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<SubjectId, Subject>,
);

export function isSubjectId(value: string | undefined): value is SubjectId {
  return value === 'workforce' || value === 'demographics' || value === 'housing' || value === 'commerce' || value === 'economic';
}

export function isMapSubjectId(value: string | undefined): value is SubjectId {
  if (!isSubjectId(value)) return false;
  return SUBJECT_BY_ID[value].hasMap;
}

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
}

export const SUBJECTS: ReadonlyArray<Subject> = [
  { id: 'workforce', label: 'Workforce', dashboardSectionId: 'workforce', hasMap: true, mapPath: '/map/workforce' },
  { id: 'demographics', label: 'Demographics', dashboardSectionId: 'demographics', hasMap: true, mapPath: '/map/demographics' },
  { id: 'housing', label: 'Housing', dashboardSectionId: 'housing', hasMap: true, mapPath: '/map/housing' },
  { id: 'commerce', label: 'Commerce', dashboardSectionId: 'commerce', hasMap: true, mapPath: '/map/commerce' },
  { id: 'economic', label: 'Economic Research', dashboardSectionId: 'economic', hasMap: false },
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

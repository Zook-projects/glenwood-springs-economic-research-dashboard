// MapLinkButton — accent-bordered link styled to match CommuteView's
// "Corridor Export" button. Used in dashboard section headers to deep-link
// to that subject's map view. Renders nothing if the subject has no map
// view (defensive — callers should only pass spatial subjects).

import { Link } from 'react-router-dom';
import { SUBJECT_BY_ID, type SubjectId } from '../config/subjects';

interface Props {
  subjectId: SubjectId;
  // When set, appended to the map path as `?metric=<value>` so the linked
  // map view boots with that metric pre-selected. Each map view is
  // responsible for reading the param via useSearchParams and using it as
  // its initial state.
  metricParam?: string;
}

export function MapLinkButton({ subjectId, metricParam }: Props) {
  const subject = SUBJECT_BY_ID[subjectId];
  if (!subject.hasMap || !subject.mapPath) return null;

  const href = metricParam
    ? `${subject.mapPath}?metric=${encodeURIComponent(metricParam)}`
    : subject.mapPath;

  return (
    <Link
      to={href}
      aria-label={`View ${subject.label} map`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-1 shrink-0"
      style={{
        color: 'var(--accent)',
        border: '1px solid var(--accent)',
        background: 'transparent',
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 4l5-2 4 2 5-2v10l-5 2-4-2-5 2z" />
        <path d="M7 2v12" />
        <path d="M11 4v12" />
      </svg>
      View Map
    </Link>
  );
}

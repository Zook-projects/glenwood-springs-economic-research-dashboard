// MapStubView — placeholder for the three non-workforce map views
// (Demographics, Housing, Commerce). Renders a centered "coming soon"
// card inside the shared MapShell. Validates the :subject param against
// the spatial subjects in the config; unknown or non-spatial values
// (including 'economic') redirect to /dashboard.

import { Navigate, useParams } from 'react-router-dom';
import { MapShell } from '../../components/MapShell';
import { isMapSubjectId, SUBJECT_BY_ID } from '../../config/subjects';

export function MapStubView() {
  const { subject } = useParams<{ subject: string }>();
  if (!isMapSubjectId(subject)) {
    return <Navigate to="/dashboard" replace />;
  }
  const subjectMeta = SUBJECT_BY_ID[subject];

  return (
    <MapShell>
      <div className="flex-1 min-h-0 flex items-center justify-center px-4">
        <div
          className="rounded-md p-6 max-w-md w-full text-center flex flex-col gap-3"
          style={{
            background: 'var(--panel-surface)',
            border: '1px solid var(--panel-border)',
          }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--accent)' }}
          >
            Map View
          </div>
          <h1
            className="text-base font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-h)' }}
          >
            {subjectMeta.label}
          </h1>
          <p
            className="text-[12px] leading-relaxed"
            style={{ color: 'var(--text-dim)' }}
          >
            Map view coming soon. Spatial visualizations for the {subjectMeta.label.toLowerCase()} subject area
            are planned for a future release. In the meantime, see the {subjectMeta.label.toLowerCase()}{' '}
            section on the dashboard for the full data view.
          </p>
        </div>
      </div>
    </MapShell>
  );
}

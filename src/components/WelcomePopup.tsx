import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROFILE_URL = 'https://cogs.us/836/Interactive-Economic-Profile';

export function WelcomePopup({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  // Portal to <body> so the fixed-position overlay escapes the TopBar's
  // backdrop-filter containing block (which would otherwise clip the modal
  // to the header's 48px height).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-popup-heading"
      className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={{ background: 'rgba(8, 9, 12, 0.72)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass rounded-md p-5 md:p-6 w-full max-w-[520px]"
        style={{
          border: '1px solid var(--accent)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--accent)' }}
          >
            Research Sandbox
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close welcome notice"
            className="-mr-1 -mt-1 px-2 py-1 rounded text-xl hover:bg-white/10 shrink-0"
            style={{ color: 'var(--text-h)', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <h2
          id="welcome-popup-heading"
          className="text-base md:text-lg font-semibold leading-snug mb-3"
          style={{ color: 'var(--text-h)' }}
        >
          Welcome to the Glenwood Springs Economic Research Hub
        </h2>

        <div
          className="text-[13px] leading-relaxed space-y-3"
          style={{ color: 'var(--text)' }}
        >
          <p>
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>
              NOTICE:
            </span>{' '}
            my blue wires may be where the red ones go. This site is a research
            sandbox — an evolving space where we explore new ways to visualize
            and interpret movement patterns and economic activity across the
            valleys. You'll find experiments, prototypes, and works-in-progress
            here, and we're adding to and refining the content continuously, so
            what you see today may look a little different tomorrow.
          </p>
          <p>
            Because this is a research environment, everything on the map is
            exploratory and shouldn't be treated as official figures. For
            comprehensive, regularly maintained data on Glenwood Springs —
            including sales tax, lodging, demographic, and economic dashboards
            — please visit the City's Interactive Economic Profile, our
            authoritative public-facing data source.
          </p>
        </div>

        <div className="mt-5 flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2">
          <a
            href={PROFILE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center justify-center px-3 py-2 rounded text-[11px] font-medium uppercase tracking-wider transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-1"
            style={{
              color: 'var(--text-h)',
              border: '1px solid var(--panel-border)',
              background: 'transparent',
            }}
          >
            View the Interactive Economic Profile
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center px-3 py-2 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-1"
            style={{
              color: 'var(--bg-base)',
              background: 'var(--accent)',
              border: '1px solid var(--accent)',
            }}
          >
            Explore the Research Hub
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

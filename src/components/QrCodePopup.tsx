import { useEffect } from 'react';
import { useDraggable } from '../hooks/useDraggable';
import qrSrc from '../assets/qr-code-economic-research-dashboard.svg';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function QrCodePopup({ open, onClose }: Props) {
  const drag = useDraggable(open ? 'open' : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="QR code"
      className="glass rounded-md p-3 fixed"
      style={{
        top: 60,
        right: 16,
        zIndex: 60,
        width: 280,
        border: '1px solid var(--accent)',
        transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)`,
      }}
    >
      <div
        className="flex items-start justify-between gap-2 mb-2"
        style={{ cursor: 'move', userSelect: 'none' }}
        onMouseDown={drag.onMouseDown}
        title="Drag to reposition"
      >
        <div
          className="text-[9px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--accent)' }}
        >
          Scan to open dashboard
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close QR code"
          className="-mr-1 -mt-1 px-2 py-1 rounded text-xl hover:bg-white/10 shrink-0"
          style={{ color: 'var(--text-h)', lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      <div className="rounded bg-white p-2 flex items-center justify-center">
        <img
          src={qrSrc}
          alt="QR code linking to the Economic Research Dashboard"
          className="w-full h-auto"
        />
      </div>
    </div>
  );
}

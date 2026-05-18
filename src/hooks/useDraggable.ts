import { useEffect, useRef, useState } from 'react';

// Drag-to-move helper for pinned tooltip panels. Returns a transform
// offset that the caller applies via style, plus a mousedown handler
// to attach to the panel's drag handle (typically the header row).
// Resets the offset when `resetKey` changes — i.e., each new pin
// starts at its default position.
export function useDraggable(resetKey: string | null) {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [resetKey]);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Buttons inside the drag handle (e.g. close X) keep their own
    // click semantics — don't hijack them with a drag.
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
    const move = (mv: MouseEvent) => {
      if (!dragRef.current) return;
      setOffset({
        x: dragRef.current.ox + (mv.clientX - dragRef.current.sx),
        y: dragRef.current.oy + (mv.clientY - dragRef.current.sy),
      });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return { offset, onMouseDown };
}

// useEscapeKey — listens on window for an Escape keypress and fires the
// supplied callback. Used by the map/metrics views to clear sticky hover
// + pinned tooltips that linger after the user switches metrics or
// tooltips otherwise lose their dismiss trigger.

import { useEffect, useRef } from 'react';

export function useEscapeKey(onEscape: () => void): void {
  // Cache the latest callback in a ref so we can register the event
  // listener exactly once. Caller doesn't have to memoize the callback.
  const cbRef = useRef(onEscape);
  cbRef.current = onEscape;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cbRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

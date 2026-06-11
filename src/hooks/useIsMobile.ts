import { useEffect, useState } from 'react';

/**
 * Subscribes to a `(max-width: <breakpoint - 1>px)` media query so components
 * can branch render logic for mobile vs desktop. Default breakpoint is 768px,
 * matching Tailwind v4's `md` breakpoint, so `useIsMobile()` returns true on
 * `<md` viewports.
 *
 * SSR-safe: defaults to false when `window` is unavailable.
 *
 * @param breakpoint - Pixel width below which `isMobile` is true.
 * @returns Whether the viewport is below the breakpoint.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [breakpoint]);

  return isMobile;
}

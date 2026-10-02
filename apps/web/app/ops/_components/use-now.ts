"use client";

import * as React from "react";

/**
 * The browser's clock, ticking every `intervalMs` — but only while `active`.
 * Off, it returns `null` and holds no timer, so a healthy dashboard does not
 * re-render between polls just to count.
 */
export function useNow(active: boolean, intervalMs: number): number | null {
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, intervalMs]);

  return active ? now : null;
}

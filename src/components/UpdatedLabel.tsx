"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { updatedLabel, type RefreshStore } from "@/lib/refresh-status";

/** How often the age is looked at again. A minute is the finest the words go. */
const TICK_MS = 30_000;

/**
 * "Updated just now" / "Updated 5 min ago" / "Updating…", for the end of the summary's meta line. It is its own component, so
 * the clock and a refresh redraw these words and not the figures beside them. The age is of the data the screen shows (when the
 * server read it); until the browser has a clock of its own the words say "just now", as the server rendered them.
 */
export default function UpdatedLabel({ store, renderedAt }: { store: RefreshStore; renderedAt: number }) {
  const phase = useSyncExternalStore(store.subscribe, store.get, () => "idle" as const);
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const every = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [renderedAt]);
  return <span className="whitespace-nowrap"> · {updatedLabel(renderedAt, now, phase)}</span>;
}

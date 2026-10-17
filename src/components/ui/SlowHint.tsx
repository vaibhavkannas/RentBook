"use client";

import { useEffect, useState } from "react";
import { createDelayedFlag } from "@/lib/delayed-flag";
import { SLOW_HINT_MESSAGE, SLOW_HINT_MS } from "@/lib/request-copy";
import { LiveNotice } from "./Notice";

/**
 * "Still working. Google can take a few seconds." under a button, once a save has been going for a while. It is a status
 * region that is on the page from the start, empty, so a screen reader announces the words when they arrive; it takes
 * its box only while it has something to say.
 *
 * Put it last in a column whose children are spaced by `space-y-3`, right under the submit button. Empty, it pulls itself
 * up by that spacing (-mt-3), so a button that now has a sibling after it keeps the room it had; with the hint showing,
 * the column's own spacing is the gap.
 */
export function SlowHint({ busy }: { busy: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const flag = createDelayedFlag(SLOW_HINT_MS, setSlow);
    flag.start();
    // stop() also turns the hint off, so it never outlives the save
    return flag.stop;
  }, [busy]);
  return (
    <LiveNotice tone="warn" emptyClassName="-mt-3">
      {slow ? SLOW_HINT_MESSAGE : null}
    </LiveNotice>
  );
}

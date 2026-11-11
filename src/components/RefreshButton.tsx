"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { refreshLook, type RefreshStore } from "@/lib/refresh-status";
import { cx } from "@/lib/ui-classes";

/**
 * The round refresh button of the month screen's header. A press loads the page again from the server (router.refresh in a
 * transition, so the figures on the screen stay until the new ones are there), turns the icon once, and then shows a green check
 * for a moment. It keeps its 44 px square whatever it shows, so nothing moves. Its state lives in the store, so a press draws
 * this button (and the "Updated" words) and not the screen.
 */
export default function RefreshButton({ store }: { store: RefreshStore }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const phase = useSyncExternalStore(store.subscribe, store.get, () => "idle" as const);
  const wasPending = useRef(false);
  const look = refreshLook(phase);

  // The page is back when the transition ends. (A transition that ends is told to the store, which waits out the turn.)
  useEffect(() => {
    if (wasPending.current && !pending) store.finish();
    wasPending.current = pending;
  }, [pending, store]);

  return (
    <>
      <IconButton
        framed={look.frame}
        label="Refresh"
        aria-busy={phase === "updating"}
        onClick={() => {
          if (store.start()) startTransition(() => router.refresh());
        }}
      >
        <span className={cx("grid place-items-center", look.turning && "refresh-turn")}>
          <Icon name={look.icon} />
        </span>
      </IconButton>
      <span role="status" className="sr-only">
        {look.announcement}
      </span>
    </>
  );
}

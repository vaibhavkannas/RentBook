"use client";

import { useEffect, useRef, useState } from "react";
import {
  canGuardBack,
  EXIT_TOAST_MS,
  EXIT_TOAST_TEXT,
  guardEntryState,
  initialGuardState,
  isGuardEntry,
  stepGuard,
  type GuardEvent,
  type GuardState,
} from "@/lib/exit-guard";

/**
 * "Press back again to exit", for the installed app's home screen only. Everywhere else it renders
 * an empty status region and does nothing. All decisions, and the reasons for them (why a sentinel
 * history entry, why it goes on during a tap), are in src/lib/exit-guard.ts; this component only
 * reads the browser, asks it, and carries the answer out.
 *
 * It never traps the person: outside an installed app it does not listen to anything, and any
 * error switches it off for the rest of the visit.
 */
export default function ExitGuard() {
  const [showToast, setShowToast] = useState(false);
  const guard = useRef<GuardState>(initialGuardState());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function hideToast() {
      clearTimeout(timer);
      timer = undefined;
      setShowToast(false);
    }

    function switchOff() {
      guard.current = initialGuardState();
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("click", onTap, true);
      hideToast();
    }

    /** Runs a handler; if anything throws, the guard stops for good rather than risk a trap. */
    function safely(run: () => void) {
      try {
        run();
      } catch {
        switchOff();
      }
    }

    function apply(event: GuardEvent) {
      const step = stepGuard(guard.current, event);
      guard.current = step.state;
      switch (step.action) {
        case "arm":
        case "arm-and-hide-toast":
          // Same address, so nothing changes on screen; the state keeps what Next.js stored in it.
          // (The entry under the sentinel keeps the address the screen was opened on, so after
          // switching months the first Back can show the opening month with the toast: see
          // src/lib/exit-guard.ts.)
          window.history.pushState(guardEntryState(window.history.state), "", window.location.href);
          // A tap that came after the window but before the timer: the toast goes now, and the
          // timer with it, so it can never stay on screen.
          if (step.action === "arm-and-hide-toast") hideToast();
          break;
        case "warn":
          clearTimeout(timer);
          timer = setTimeout(() => safely(() => apply({ type: "toast-expired" })), EXIT_TOAST_MS);
          setShowToast(true);
          break;
        case "hide-toast":
          hideToast();
          break;
        case "leave":
          // The browser already took the person back; nothing is left to do but step aside.
          switchOff();
          break;
        case "none":
          break;
      }
    }

    function onPopState(event: PopStateEvent) {
      safely(() =>
        apply({ type: "back", now: Date.now(), landedOnGuardEntry: isGuardEntry(event.state) }),
      );
    }

    // A tap is when the sentinel goes on: Chrome's Back button skips entries a page adds without one.
    function onTap() {
      safely(() => apply({ type: "gesture", now: Date.now() }));
    }

    try {
      const start = stepGuard(initialGuardState(), {
        type: "mount",
        canGuard: canGuardBack(window),
        onGuardEntry: isGuardEntry(window.history.state),
      });
      guard.current = start.state;
      if (!start.state.active) return;
      window.addEventListener("popstate", onPopState);
      window.addEventListener("click", onTap, true);
    } catch {
      switchOff();
      return;
    }

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("click", onTap, true);
      clearTimeout(timer);
    };
  }, []);

  // Next.js drops the history state it does not know about whenever its router replaces the current
  // entry (switching month, or the refresh after saving a payment). Put the marker back after every
  // render, or a later visit to the home screen would not recognise the sentinel and push another.
  useEffect(() => {
    if (!guard.current.armed) return;
    try {
      if (!isGuardEntry(window.history.state)) {
        window.history.replaceState(guardEntryState(window.history.state), "");
      }
    } catch {
      // The marker only prevents an extra entry later; the guard itself still works.
    }
  });

  // The live region is always on the page, so screen readers announce text that appears in it. It sits
  // higher than the payment toast's region (bottom-4), so the two stack instead of covering each other.
  return (
    <div role="status" className="pointer-events-none fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md">
      {showToast && (
        <p className="rounded-xl bg-foreground px-4 py-3 text-center text-sm text-background">
          {EXIT_TOAST_TEXT}
        </p>
      )}
    </div>
  );
}

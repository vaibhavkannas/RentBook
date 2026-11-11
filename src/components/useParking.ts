"use client";

import { useEffect, useRef, useState } from "react";
import { ACTION_TOAST_MS } from "@/lib/toast";

/**
 * A sheet whose request is on the way goes out of sight (the card behind it already shows the change) but stays alive, so that
 * what the person typed is still there if the request fails. It is then `parked`. When the request fails the person is offered
 * Try again in a toast (`offerRetry`); pressing it brings the sheet back (`reopen`), and if they do not, the sheet is let go
 * (`onDiscard`) a moment after the toast has gone. A sheet that needs the person's attention (a duplicate warning, a retry of
 * the log entry) is simply `reopen`ed.
 */
export function useParking(onDiscard: () => void) {
  const [state, setState] = useState<"open" | "parked" | "retry">("open");
  const discard = useRef(onDiscard);
  useEffect(() => {
    discard.current = onDiscard;
  });
  useEffect(() => {
    if (state !== "retry") return;
    const timer = setTimeout(() => discard.current(), ACTION_TOAST_MS + 1000);
    return () => clearTimeout(timer);
  }, [state]);
  return {
    visible: state === "open",
    park: () => setState("parked"),
    offerRetry: () => setState("retry"),
    reopen: () => setState("open"),
  };
}

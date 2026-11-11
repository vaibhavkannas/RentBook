/**
 * The refresh button of the month screen and the "Updated" words beside the figures. A press turns the icon once while the page is
 * loaded again from the server, then shows a check for a moment. The store holds that, outside React, so the button and the
 * words each redraw by themselves and the rest of the screen does not.
 */

export type RefreshPhase = "idle" | "updating" | "done";

/** One turn of the icon, as long as its animation (`refresh-turn` in globals.css). An answer that comes sooner waits for it. */
export const MIN_SPIN_MS = 800;
/** How long the check stays. */
export const CHECK_MS = 1100;

/** "Updated just now", "Updated 5 min ago", "Updated 3 h ago", or "Updating…" while a refresh is on its way. */
export function updatedLabel(updatedAt: number, now: number, phase: RefreshPhase): string {
  if (phase === "updating") return "Updating…";
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Updated ${hours} h ago` : "Updated over a day ago";
}

export function createRefreshStore() {
  let phase: RefreshPhase = "idle";
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const set = (next: RefreshPhase) => {
    if (next === phase) return;
    phase = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => phase,
    /** A press. False when a refresh is already on its way (nothing is asked for twice). */
    start(): boolean {
      if (phase === "updating") return false;
      clearTimeout(timer);
      startedAt = Date.now();
      set("updating");
      return true;
    },
    /** The page came back. The check shows once the turn is over, and goes after CHECK_MS. */
    finish() {
      if (phase !== "updating") return;
      const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt));
      const check = () => {
        set("done");
        timer = setTimeout(() => set("idle"), CHECK_MS);
      };
      if (wait === 0) check();
      else timer = setTimeout(check, wait);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

export type RefreshStore = ReturnType<typeof createRefreshStore>;

/** What the button shows in each phase: its icon, whether the icon turns, its frame, and what a screen reader hears. */
export function refreshLook(phase: RefreshPhase) {
  return {
    icon: phase === "done" ? ("check" as const) : ("rotate" as const),
    turning: phase === "updating",
    frame: phase === "done" ? ("round-done" as const) : ("round" as const),
    announcement: phase === "updating" ? "Updating" : phase === "done" ? "Updated" : "",
  };
}

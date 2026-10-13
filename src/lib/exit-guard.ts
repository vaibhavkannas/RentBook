/**
 * Decisions for the "Press back again to exit" guard on the home screen. Pure: the component in
 * src/components/ExitGuard.tsx reads the browser, asks these functions what to do, and does it.
 *
 * Why a sentinel history entry. A web page cannot ask "leave this app?" when Back is pressed: browsers
 * give pages no confirm-on-back dialog (beforeunload is for leaving the document, and installed apps
 * and most mobile browsers ignore it). The usual way to get "press back again to exit" is to push one
 * extra history entry with the same address (the sentinel). The first Back then only moves from the
 * sentinel to the entry under it, which fires a popstate event the page can answer with a toast. If
 * the person presses Back again before the toast is gone, the page stays out of the way and the
 * browser (or the operating system, when there is nothing left to go back to) does the leaving.
 *
 * Two details decide whether that works on a phone.
 *
 * 1. The sentinel goes on during a tap, not when the screen appears. Chrome's history manipulation
 *    intervention makes the Back button skip entries that a page added without the person having
 *    touched it (same-document entries share one "skippable" state, and a new touch is needed again
 *    after any back or forward step). A sentinel pushed on load, or from a timer, can be skipped, which
 *    would silently turn the guard off. A sentinel pushed from a click handler is never skipped.
 *
 * 2. After the first Back the sentinel is NOT pushed again straight away. The first Back leaves the
 *    person on the entry under the sentinel. When the app was just opened that is the app's first
 *    entry, and a second Back there is what closes an installed app. If the sentinel were pushed
 *    again at once, the second Back would only land on that first entry again, and a page cannot close
 *    the app from there (history.back() with nothing before it does nothing), so leaving would take
 *    three presses. Leaving the entry bare while the toast shows lets the second Back do what it
 *    always does. The next tap, once the toast is gone, puts the sentinel back.
 *
 * So the guard never calls history.back() or history.go(): on a second Back inside the window the
 * browser has already done the leaving, and the guard only switches itself off.
 */

/** The key added to a history entry's state to mark it as the guard's sentinel. */
export const GUARD_MARKER = "rbExitGuard";

export const EXIT_TOAST_TEXT = "Press back again to exit";

/** How long a second Back counts as "again". */
export const EXIT_TOAST_MS = 3000;

/** True for the state of a history entry that the guard pushed (or marked). */
export function isGuardEntry(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[GUARD_MARKER] === true
  );
}

/**
 * The state for a sentinel entry: whatever the current entry's state holds (Next.js keeps its router
 * data there, and needs it to treat the entry as its own) plus the marker. Never changes its input.
 */
export function guardEntryState(current: unknown): Record<string, unknown> {
  const base =
    typeof current === "object" && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, [GUARD_MARKER]: true };
}

/**
 * Whether the guard may run here: only in an installed app (the standalone display mode, or the
 * flag older iPhones set on the navigator) and only when the history API is there. Anything else,
 * including a browser that throws while being asked, answers false: the guard fails open.
 */
export function canGuardBack(win: unknown): boolean {
  const w = win as
    | {
        matchMedia?: (query: string) => { matches: boolean };
        navigator?: { standalone?: unknown };
        history?: { pushState?: unknown };
      }
    | null
    | undefined;
  if (!w || typeof w.history?.pushState !== "function") return false;
  try {
    if (w.navigator?.standalone === true) return true;
  } catch {
    // fall through to the display mode
  }
  try {
    return typeof w.matchMedia === "function" && w.matchMedia("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

export type GuardState = {
  /** The guard is switched on: an installed app, and the person has not been let through yet. */
  active: boolean;
  /** The sentinel is the entry the person is on, so a Back will be answered with the toast. */
  armed: boolean;
  /** When the "press back again" window ends, or null while no toast is showing. */
  toastUntil: number | null;
};

export function initialGuardState(): GuardState {
  return { active: false, armed: false, toastUntil: null };
}

export type GuardEvent =
  /** The home screen appeared. `onGuardEntry`: the current history entry already carries the marker. */
  | { type: "mount"; canGuard: boolean; onGuardEntry: boolean }
  /** The person tapped (or pressed Enter on) something on the screen. */
  | { type: "gesture"; now: number }
  /** A popstate: `landedOnGuardEntry` says whether the entry now showing carries the marker. */
  | { type: "back"; now: number; landedOnGuardEntry: boolean }
  /** The toast's time ran out. */
  | { type: "toast-expired" };

export type GuardAction =
  | "none"
  /** Push the sentinel entry. */
  | "arm"
  /** Show the toast. */
  | "warn"
  /** Hide the toast. */
  | "hide-toast"
  /** A second Back inside the window, or one the guard has nothing to say about: stop guarding. */
  | "leave";

/** What to do for an event, and the state after it. */
export function stepGuard(
  state: GuardState,
  event: GuardEvent,
): { state: GuardState; action: GuardAction } {
  if (event.type === "mount") {
    return {
      state: {
        active: event.canGuard,
        armed: event.canGuard && event.onGuardEntry,
        toastUntil: null,
      },
      action: "none",
    };
  }

  if (!state.active) return { state, action: "none" };

  switch (event.type) {
    case "gesture": {
      if (state.armed) return { state, action: "none" };
      // While the toast shows, the person is one Back away from leaving: do not put the sentinel back yet.
      if (state.toastUntil !== null && event.now < state.toastUntil) return { state, action: "none" };
      return { state: { ...state, armed: true, toastUntil: null }, action: "arm" };
    }

    case "toast-expired":
      return state.toastUntil === null
        ? { state, action: "none" }
        : { state: { ...state, toastUntil: null }, action: "hide-toast" };

    case "back": {
      // The sentinel is under the person again (a forward step, or a return from another page).
      if (event.landedOnGuardEntry) {
        return {
          state: { ...state, armed: true, toastUntil: null },
          action: state.toastUntil === null ? "none" : "hide-toast",
        };
      }
      // Back from the sentinel: ask once.
      if (state.armed) {
        return {
          state: { ...state, armed: false, toastUntil: event.now + EXIT_TOAST_MS },
          action: "warn",
        };
      }
      // No sentinel was under the person (the second Back in the window, or a Back before the first
      // tap): the guard has nothing to answer, so it lets the browser go.
      return { state: { active: false, armed: false, toastUntil: null }, action: "leave" };
    }
  }
}

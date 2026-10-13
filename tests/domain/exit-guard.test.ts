import { describe, expect, it } from "vitest";
import {
  canGuardBack,
  EXIT_TOAST_MS,
  EXIT_TOAST_TEXT,
  GUARD_MARKER,
  guardEntryState,
  initialGuardState,
  isGuardEntry,
  stepGuard,
  type GuardEvent,
  type GuardState,
} from "@/lib/exit-guard";

/** Runs the events in order and returns the action taken for each, and the state at the end. */
function run(events: GuardEvent[], from: GuardState = initialGuardState()) {
  let state = from;
  const actions: string[] = [];
  for (const event of events) {
    const step = stepGuard(state, event);
    state = step.state;
    actions.push(step.action);
  }
  return { actions, state };
}

const mount = (overrides: Partial<Extract<GuardEvent, { type: "mount" }>> = {}): GuardEvent => ({
  type: "mount",
  canGuard: true,
  onGuardEntry: false,
  ...overrides,
});
const tap = (now: number): GuardEvent => ({ type: "gesture", now });
const back = (now: number, landedOnGuardEntry = false): GuardEvent => ({ type: "back", now, landedOnGuardEntry });
const expired: GuardEvent = { type: "toast-expired" };

describe("stepGuard on mount", () => {
  it("pushes nothing: the sentinel goes on with the first tap, because a page-initiated push can be skipped by Back", () => {
    const { actions, state } = run([mount()]);
    expect(actions).toEqual(["none"]);
    expect(state).toEqual({ active: true, armed: false, toastUntil: null });
  });

  it("knows the sentinel is already under the person when the entry carries the marker", () => {
    expect(run([mount({ onGuardEntry: true })]).state).toEqual({ active: true, armed: true, toastUntil: null });
  });

  it("does nothing when the app is not running as an installed app, now or later", () => {
    const { actions, state } = run([mount({ canGuard: false }), tap(100), back(1000), back(1500), expired]);
    expect(actions).toEqual(["none", "none", "none", "none", "none"]);
    expect(state.active).toBe(false);
  });

  it("does nothing for events that arrive before it was ever mounted", () => {
    expect(run([tap(1), back(1000), expired]).actions).toEqual(["none", "none", "none"]);
  });

  it("starts afresh on a new mount, whatever state it was in", () => {
    const left = run([mount(), tap(1), back(1000), back(1500)]).state;
    expect(left.active).toBe(false);
    expect(run([mount()], left).state).toEqual({ active: true, armed: false, toastUntil: null });
  });
});

describe("stepGuard: putting the sentinel on", () => {
  it("pushes one sentinel entry on the first tap", () => {
    const { actions, state } = run([mount(), tap(100)]);
    expect(actions).toEqual(["none", "arm"]);
    expect(state.armed).toBe(true);
  });

  it("pushes no more on later taps, so the entries never pile up", () => {
    expect(run([mount(), tap(100), tap(200), tap(300)]).actions).toEqual(["none", "arm", "none", "none"]);
  });

  it("pushes nothing when the current entry already carries the marker", () => {
    expect(run([mount({ onGuardEntry: true }), tap(100), tap(200)]).actions).toEqual(["none", "none", "none"]);
  });

  it("does not push the sentinel on a visit that comes back to a marked entry, again and again", () => {
    // a visit to Details and back: the home screen mounts again, on the sentinel
    const visits = Array.from({ length: 5 }, () => run([mount({ onGuardEntry: true }), tap(100)]).actions);
    expect(visits.flat().filter((action) => action === "arm")).toHaveLength(0);
  });
});

describe("stepGuard when Back is pressed on the sentinel", () => {
  it("shows the toast on the first Back", () => {
    const { actions, state } = run([mount(), tap(100), back(1000)]);
    expect(actions).toEqual(["none", "arm", "warn"]);
    expect(state).toEqual({ active: true, armed: false, toastUntil: 1000 + EXIT_TOAST_MS });
  });

  it("lets the person leave on a second Back while the toast is still showing", () => {
    const { actions, state } = run([mount(), tap(100), back(1000), back(1000 + EXIT_TOAST_MS - 1)]);
    expect(actions).toEqual(["none", "arm", "warn", "leave"]);
    // from here on the guard stays out of the way
    expect(state).toEqual({ active: false, armed: false, toastUntil: null });
  });

  it("does nothing after it let the person leave, whatever happens next", () => {
    const { actions } = run([mount(), tap(100), back(1000), back(1500), tap(1600), back(1700), back(1800, true), expired]);
    expect(actions).toEqual(["none", "arm", "warn", "leave", "none", "none", "none", "none"]);
  });

  it("does not put the sentinel back on a tap while the toast shows, so the second Back can leave", () => {
    const { actions } = run([mount(), tap(100), back(1000), tap(1500), tap(3999), back(3999)]);
    expect(actions).toEqual(["none", "arm", "warn", "none", "none", "leave"]);
  });

  it("shows the toast again on the next Back once a tap after the window put the sentinel back", () => {
    const { actions, state } = run([
      mount(),
      tap(100),
      back(1000),
      expired,
      tap(1000 + EXIT_TOAST_MS + 1),
      back(10_000),
    ]);
    expect(actions).toEqual(["none", "arm", "warn", "hide-toast", "arm", "warn"]);
    expect(state.toastUntil).toBe(10_000 + EXIT_TOAST_MS);
  });

  it("treats the exact end of the window as over for a tap, even if the timer has not fired yet", () => {
    const { actions } = run([mount(), tap(100), back(1000), tap(1000 + EXIT_TOAST_MS)]);
    expect(actions).toEqual(["none", "arm", "warn", "arm"]);
  });

  it("lets the person leave on a Back that comes with no sentinel under them (before the first tap, or after the window and no tap)", () => {
    expect(run([mount(), back(1000)]).actions).toEqual(["none", "leave"]);
    expect(run([mount(), tap(100), back(1000), expired, back(9000)]).actions).toEqual([
      "none",
      "arm",
      "warn",
      "hide-toast",
      "leave",
    ]);
  });

  it("goes round again and again: tap, Back, toast, tap, Back, toast, ...", () => {
    const { actions } = run([
      mount(),
      tap(100),
      back(1000),
      expired,
      tap(5000),
      back(6000),
      expired,
      tap(10_000),
      back(11_000),
      back(12_000),
    ]);
    expect(actions).toEqual([
      "none",
      "arm",
      "warn",
      "hide-toast",
      "arm",
      "warn",
      "hide-toast",
      "arm",
      "warn",
      "leave",
    ]);
  });

  it("is about three seconds", () => {
    expect(EXIT_TOAST_MS).toBe(3000);
  });

  it("has a short, plain message", () => {
    expect(EXIT_TOAST_TEXT).toBe("Press back again to exit");
  });
});

describe("stepGuard when the toast runs out", () => {
  it("hides the toast and pushes nothing", () => {
    const { actions, state } = run([mount(), tap(100), back(1000), expired]);
    expect(actions).toEqual(["none", "arm", "warn", "hide-toast"]);
    expect(state).toEqual({ active: true, armed: false, toastUntil: null });
  });

  it("ignores a timer that fires when no toast is showing", () => {
    expect(run([mount(), expired]).actions).toEqual(["none", "none"]);
    expect(run([mount(), tap(100), back(1000), expired, expired]).actions).toEqual([
      "none",
      "arm",
      "warn",
      "hide-toast",
      "none",
    ]);
  });
});

describe("stepGuard when a back or forward step lands on a sentinel entry", () => {
  it("does nothing when no toast is showing (for example, coming back from another page)", () => {
    const { actions, state } = run([mount(), back(1000, true)]);
    expect(actions).toEqual(["none", "none"]);
    expect(state.armed).toBe(true);
  });

  it("hides the toast and counts the sentinel as put back, pushing nothing", () => {
    const { actions, state } = run([mount(), tap(100), back(1000), back(1500, true), tap(1600), expired]);
    expect(actions).toEqual(["none", "arm", "warn", "hide-toast", "none", "none"]);
    expect(state).toEqual({ active: true, armed: true, toastUntil: null });
  });

  it("then answers the next Back with the toast", () => {
    expect(run([mount(), tap(100), back(1000), back(1500, true), back(2000)]).actions.at(-1)).toBe("warn");
  });
});

describe("guard marker helpers", () => {
  it("recognises only an entry whose state carries the marker", () => {
    expect(isGuardEntry({ [GUARD_MARKER]: true })).toBe(true);
    expect(isGuardEntry({ [GUARD_MARKER]: true, __NA: true })).toBe(true);
    expect(isGuardEntry(null)).toBe(false);
    expect(isGuardEntry(undefined)).toBe(false);
    expect(isGuardEntry({})).toBe(false);
    expect(isGuardEntry({ __NA: true })).toBe(false);
    expect(isGuardEntry({ [GUARD_MARKER]: "yes" })).toBe(false);
    expect(isGuardEntry({ [GUARD_MARKER]: false })).toBe(false);
    expect(isGuardEntry("rbExitGuard")).toBe(false);
    expect(isGuardEntry(7)).toBe(false);
  });

  it("keeps everything already in the history state and adds the marker", () => {
    const current = {
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["", {}], renderedSearch: "?month=2026-09" },
      other: 1,
    };
    const next = guardEntryState(current);
    expect(next).toEqual({ ...current, [GUARD_MARKER]: true });
    expect(isGuardEntry(next)).toBe(true);
  });

  it("does not change the state it was given", () => {
    const current = { __NA: true };
    guardEntryState(current);
    expect(current).toEqual({ __NA: true });
    expect(GUARD_MARKER in current).toBe(false);
  });

  it("starts from nothing when the current state is not an object", () => {
    for (const current of [null, undefined, "text", 5, ["a", "b"]]) {
      expect(guardEntryState(current)).toEqual({ [GUARD_MARKER]: true });
    }
  });

  it("is idempotent", () => {
    const once = guardEntryState({ __NA: true });
    expect(guardEntryState(once)).toEqual(once);
  });
});

describe("canGuardBack", () => {
  const standalone = (query: string) => ({ matches: query === "(display-mode: standalone)" });
  const browserTab = () => ({ matches: false });
  const history = { pushState: () => {} };

  it("is on in an installed app, by the display mode", () => {
    expect(canGuardBack({ matchMedia: standalone, history })).toBe(true);
  });

  it("is on in an installed app on iPhone, which reports it on the navigator", () => {
    expect(canGuardBack({ matchMedia: browserTab, navigator: { standalone: true }, history })).toBe(true);
    expect(canGuardBack({ navigator: { standalone: true }, history })).toBe(true);
  });

  it("is off in an ordinary browser tab", () => {
    expect(canGuardBack({ matchMedia: browserTab, navigator: { standalone: false }, history })).toBe(false);
    expect(canGuardBack({ matchMedia: browserTab, navigator: {}, history })).toBe(false);
  });

  it("is off when it cannot tell: no matchMedia, no navigator flag", () => {
    expect(canGuardBack({ history })).toBe(false);
    expect(canGuardBack({ navigator: {}, history })).toBe(false);
  });

  it("is off when matchMedia throws and there is no other sign of an installed app", () => {
    const broken = () => {
      throw new Error("no");
    };
    expect(canGuardBack({ matchMedia: broken, history })).toBe(false);
    expect(canGuardBack({ matchMedia: broken, navigator: { standalone: true }, history })).toBe(true);
  });

  it("is off unless the navigator flag is exactly true", () => {
    expect(canGuardBack({ navigator: { standalone: "true" }, history })).toBe(false);
    expect(canGuardBack({ navigator: { standalone: 1 }, history })).toBe(false);
  });

  it("is off when there is no history API to use", () => {
    expect(canGuardBack({ matchMedia: standalone })).toBe(false);
    expect(canGuardBack({ matchMedia: standalone, history: {} })).toBe(false);
    expect(canGuardBack({ matchMedia: standalone, history: { pushState: "no" } })).toBe(false);
  });

  it("is off with no window at all (the server)", () => {
    expect(canGuardBack(undefined)).toBe(false);
    expect(canGuardBack(null)).toBe(false);
  });

  it("calls matchMedia on the window, as the browser requires", () => {
    const win = {
      history,
      matchMedia(this: unknown, query: string) {
        if (this !== win) throw new TypeError("Illegal invocation");
        return { matches: query === "(display-mode: standalone)" };
      },
    };
    expect(canGuardBack(win)).toBe(true);
  });
});

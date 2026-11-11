import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_MS, createRefreshStore, MIN_SPIN_MS, updatedLabel } from "@/lib/refresh-status";

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

describe("the words that say how fresh the screen is", () => {
  const at = (ageMs: number) => updatedLabel(1_000_000, 1_000_000 + ageMs, "idle");

  it("says just now for the first minute", () => {
    expect(at(0)).toBe("Updated just now");
    expect(at(59_000)).toBe("Updated just now");
  });

  it("counts minutes, then hours, then says it has been over a day", () => {
    expect(at(60_000)).toBe("Updated 1 min ago");
    expect(at(5 * 60_000 + 20_000)).toBe("Updated 5 min ago");
    expect(at(59 * 60_000)).toBe("Updated 59 min ago");
    expect(at(60 * 60_000)).toBe("Updated 1 h ago");
    expect(at(3 * 3_600_000)).toBe("Updated 3 h ago");
    expect(at(24 * 3_600_000)).toBe("Updated over a day ago");
  });

  it("is never negative when the clocks differ a little", () => {
    expect(at(-5_000)).toBe("Updated just now");
  });

  it("says Updating while a refresh is on its way, whatever the age", () => {
    expect(updatedLabel(1_000_000, 1_000_000 + 9 * 60_000, "updating")).toBe("Updating…");
  });
});

describe("the refresh button's state", () => {
  function store() {
    const seen: string[] = [];
    const s = createRefreshStore();
    s.subscribe(() => seen.push(s.get()));
    return { s, seen };
  }

  it("starts idle, turns while it updates, shows a check, and is idle again", () => {
    const { s, seen } = store();
    expect(s.get()).toBe("idle");
    s.start();
    expect(s.get()).toBe("updating");
    vi.advanceTimersByTime(MIN_SPIN_MS);
    s.finish();
    expect(s.get()).toBe("done");
    vi.advanceTimersByTime(CHECK_MS);
    expect(s.get()).toBe("idle");
    expect(seen).toEqual(["updating", "done", "idle"]);
  });

  it("lets the turn finish: an answer that comes at once waits for the one turn to be over before the check", () => {
    const { s } = store();
    s.start();
    vi.advanceTimersByTime(200);
    s.finish();
    expect(s.get()).toBe("updating");
    vi.advanceTimersByTime(MIN_SPIN_MS - 200 - 1);
    expect(s.get()).toBe("updating");
    vi.advanceTimersByTime(1);
    expect(s.get()).toBe("done");
  });

  it("ignores a second press while it is updating, so the page is not asked for twice", () => {
    const { s, seen } = store();
    expect(s.start()).toBe(true);
    expect(s.start()).toBe(false);
    expect(seen).toEqual(["updating"]);
  });

  it("is idle after a check that is cut short by a new press and does not let the old timer end the new update", () => {
    const { s } = store();
    s.start();
    vi.advanceTimersByTime(MIN_SPIN_MS);
    s.finish();
    expect(s.start()).toBe(true);
    vi.advanceTimersByTime(CHECK_MS - 1);
    expect(s.get()).toBe("updating");
  });

  it("does nothing when told to finish without having started, and stops its timers on dispose", () => {
    const { s, seen } = store();
    s.finish();
    expect(seen).toEqual([]);
    s.start();
    s.finish();
    s.dispose();
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual(["updating"]);
  });
});

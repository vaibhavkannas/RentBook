import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { watchForeground, type VisibilityDocument } from "@/lib/foreground-refresh";

// The month screen loads itself again, quietly, when the app comes back to the front after a while: only when the page was hidden
// for more than 60 seconds, and at most once every 60 seconds. Fake timers drive the clock, a fake document the events.

function fakeDocument() {
  const listeners = new Set<() => void>();
  const doc: VisibilityDocument & { visibilityState: "visible" | "hidden"; set(state: "visible" | "hidden"): void } = {
    visibilityState: "visible",
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    set(state) {
      doc.visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
  };
  return { doc, listeners };
}

const SECOND = 1000;
let refresh: Mock<() => void>;
let screen: ReturnType<typeof fakeDocument>;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-11T06:00:00Z") });
  refresh = vi.fn<() => void>();
  screen = fakeDocument();
  watchForeground(screen.doc, refresh);
});
afterEach(() => vi.useRealTimers());

const away = (seconds: number) => {
  screen.doc.set("hidden");
  vi.advanceTimersByTime(seconds * SECOND);
  screen.doc.set("visible");
};

describe("returning to the foreground", () => {
  it("does nothing while the page is only being looked at", () => {
    vi.advanceTimersByTime(10 * 60 * SECOND);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does nothing for a short trip away (60 seconds or less)", () => {
    away(5);
    away(60);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once when the page comes back after more than 60 seconds", () => {
    away(61);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the page goes to the background, only when it comes back", () => {
    screen.doc.set("hidden");
    vi.advanceTimersByTime(10 * 60 * SECOND);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes at most once every 60 seconds, however often it is left and returned to", () => {
    away(61);
    expect(refresh).toHaveBeenCalledTimes(1);
    // hidden for 61 s again, but the refresh was only 61 s ago... the second one is allowed, a third inside 60 s of it is not
    away(61);
    expect(refresh).toHaveBeenCalledTimes(2);
    screen.doc.set("hidden");
    screen.doc.set("visible");
    screen.doc.set("hidden");
    screen.doc.set("visible");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("counts a long absence once, from when the page was first hidden, not from every hidden event", () => {
    screen.doc.set("hidden");
    vi.advanceTimersByTime(30 * SECOND);
    screen.doc.set("hidden");
    vi.advanceTimersByTime(40 * SECOND);
    screen.doc.set("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops listening when it is let go", () => {
    const { doc, listeners } = fakeDocument();
    const stop = watchForeground(doc, refresh);
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});

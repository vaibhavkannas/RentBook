import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDelayedFlag } from "@/lib/delayed-flag";

// A flag that turns on after a delay, unless it is stopped first: the "Still working" hint of a slow save.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createDelayedFlag", () => {
  it("turns on after the delay, and not before", () => {
    const seen: boolean[] = [];
    const flag = createDelayedFlag(8_000, (on) => seen.push(on));
    flag.start();
    vi.advanceTimersByTime(7_999);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true]);
  });

  it("never turns on when stopped in time, and says nothing when it was never on", () => {
    const seen: boolean[] = [];
    const flag = createDelayedFlag(8_000, (on) => seen.push(on));
    flag.start();
    vi.advanceTimersByTime(3_000);
    flag.stop();
    vi.advanceTimersByTime(60_000);
    expect(seen).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("turns off when stopped after it was on, and only then", () => {
    const seen: boolean[] = [];
    const flag = createDelayedFlag(100, (on) => seen.push(on));
    flag.start();
    vi.advanceTimersByTime(100);
    flag.stop();
    flag.stop();
    expect(seen).toEqual([true, false]);
  });

  it("starts the wait again when started again, so a second slow save gets its own delay", () => {
    const seen: boolean[] = [];
    const flag = createDelayedFlag(100, (on) => seen.push(on));
    flag.start();
    vi.advanceTimersByTime(60);
    flag.start();
    vi.advanceTimersByTime(60);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(40);
    expect(seen).toEqual([true]);
  });
});

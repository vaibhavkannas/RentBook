import { describe, expect, it, vi } from "vitest";
import { createSnapshotCache } from "@/lib/sheets/snapshot-cache";

function setup(ttlMs = 15_000) {
  let clock = 1_000;
  let calls = 0;
  const load = vi.fn(async () => ({ n: ++calls }));
  const cache = createSnapshotCache(load, ttlMs, () => clock);
  return { cache, load, advance: (ms: number) => (clock += ms), set: (t: number) => (clock = t) };
}

/** Loads that finish only when the test says so, so several can be in flight at once. */
function manual() {
  let clock = 1_000;
  const loads: Array<(n: number) => void> = [];
  const load = () => new Promise<number>((resolve) => void loads.push(resolve));
  const cache = createSnapshotCache(load, 15_000, () => clock);
  return { cache, loads, set: (t: number) => (clock = t) };
}

describe("createSnapshotCache", () => {
  it("serves the cached value inside the lifetime and reloads after it", async () => {
    const { cache, load, advance } = setup();
    expect((await cache.get()).n).toBe(1);
    advance(14_999);
    expect((await cache.get()).n).toBe(1);
    advance(1);
    // Exactly 15,000 ms after the load began, the value has expired.
    expect((await cache.get()).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent callers", async () => {
    const { cache, load } = setup();
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads when the data is older than the caller's minimum freshness", async () => {
    const { cache, load, advance, set } = setup();
    await cache.get();
    advance(1_000);
    const wroteAt = 2_000;
    set(2_500);
    expect((await cache.get(wroteAt)).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect((await cache.get(wroteAt)).n).toBe(2);
  });

  it("invalidate drops the value and any load already in flight", async () => {
    const { cache, load } = setup();
    const first = cache.get();
    cache.invalidate();
    await first;
    expect((await cache.get()).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a get right after invalidate starts a new load rather than joining one begun before the write", async () => {
    const { cache, loads } = manual();
    const before = cache.get();
    cache.invalidate();
    const after = cache.get();
    expect(loads).toHaveLength(2);
    loads[0](1);
    loads[1](2);
    expect(await before).toBe(1);
    expect(await after).toBe(2);
    // Only the load that began after the write is kept.
    expect(await cache.get()).toBe(2);
    expect(loads).toHaveLength(2);
  });

  it("does not join a load that began before the time the caller needs data from", async () => {
    const { cache, loads, set } = manual();
    const older = cache.get();
    set(2_000);
    const newer = cache.get(1_500);
    expect(loads).toHaveLength(2);
    loads[0](1);
    loads[1](2);
    expect(await older).toBe(1);
    expect(await newer).toBe(2);
  });

  it("joins a load already in flight when it began late enough", async () => {
    const { cache, loads, set } = manual();
    const first = cache.get();
    set(2_000);
    const second = cache.get(500);
    expect(loads).toHaveLength(1);
    loads[0](1);
    expect(await first).toBe(1);
    expect(await second).toBe(1);
  });

  it("does not cache a failed load", async () => {
    let fail = true;
    const cache = createSnapshotCache(async () => {
      if (fail) throw new Error("boom");
      return "ok";
    }, 15_000, () => 1);
    await expect(cache.get()).rejects.toThrow("boom");
    fail = false;
    expect(await cache.get()).toBe("ok");
  });
});

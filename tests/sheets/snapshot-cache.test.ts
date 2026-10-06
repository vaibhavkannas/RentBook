import { describe, expect, it, vi } from "vitest";
import { createSnapshotCache } from "@/lib/sheets/snapshot-cache";

function setup(ttlMs = 15_000) {
  let clock = 1_000;
  let calls = 0;
  const load = vi.fn(async () => ({ n: ++calls }));
  const cache = createSnapshotCache(load, ttlMs, () => clock);
  return { cache, load, advance: (ms: number) => (clock += ms), set: (t: number) => (clock = t) };
}

describe("createSnapshotCache", () => {
  it("serves the cached value inside the lifetime and reloads after it", async () => {
    const { cache, load, advance } = setup();
    expect((await cache.get()).n).toBe(1);
    advance(14_999);
    expect((await cache.get()).n).toBe(1);
    advance(2);
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

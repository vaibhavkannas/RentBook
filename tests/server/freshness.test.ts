import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn<(name: string, value: string, options?: unknown) => void>((name, value) => void store.set(name, value)),
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { markWritten, readWrittenAt } from "@/lib/server/freshness";

beforeEach(() => {
  jar.store.clear();
  jar.set.mockClear();
});

describe("freshness cookie", () => {
  it("round-trips the write time", async () => {
    await markWritten(123_456);
    expect(await readWrittenAt()).toBe(123_456);
  });

  it("is HTTP-only, lax, site-wide and short-lived", async () => {
    await markWritten(123_456);
    expect(jar.set).toHaveBeenCalledWith(
      "rb-wrote",
      "123456",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 120 }),
    );
  });

  it("returns undefined when absent or not a number", async () => {
    expect(await readWrittenAt()).toBeUndefined();
    jar.store.set("rb-wrote", "abc");
    expect(await readWrittenAt()).toBeUndefined();
  });

  it("ignores zero and negative values", async () => {
    jar.store.set("rb-wrote", "0");
    expect(await readWrittenAt()).toBeUndefined();
    jar.store.set("rb-wrote", "-5");
    expect(await readWrittenAt()).toBeUndefined();
    jar.store.set("rb-wrote", "");
    expect(await readWrittenAt()).toBeUndefined();
  });

  it("ignores a write time in the future, which a browser could forge to force uncached reads", async () => {
    jar.store.set("rb-wrote", String(Date.now() + 60_000));
    expect(await readWrittenAt()).toBeUndefined();
  });

  it("believes a write time a few seconds ahead, to allow for clock drift between servers", async () => {
    jar.store.set("rb-wrote", "10000");
    expect(await readWrittenAt(6_000)).toBe(10_000);
    expect(await readWrittenAt(4_999)).toBeUndefined();
  });
});

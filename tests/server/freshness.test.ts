import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn((name: string, value: string) => void store.set(name, value)),
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { markWritten, readWrittenAt } from "@/lib/server/freshness";

beforeEach(() => jar.store.clear());

describe("freshness cookie", () => {
  it("round-trips the write time", async () => {
    await markWritten(123_456);
    expect(await readWrittenAt()).toBe(123_456);
  });

  it("returns undefined when absent or not a number", async () => {
    expect(await readWrittenAt()).toBeUndefined();
    jar.store.set("rb-wrote", "abc");
    expect(await readWrittenAt()).toBeUndefined();
  });
});

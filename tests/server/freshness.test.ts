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

import { loadMonthView, markWritten, readWrittenAt } from "@/lib/server/freshness";
import { logPayment, withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

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

  it("does not throw when the cookie cannot be set, because the Sheet was already written", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jar.set.mockImplementationOnce(() => {
        throw new Error("cookies can only be set in a Route Handler or Server Function");
      });
      await expect(markWritten(123_456)).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
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

describe("loadMonthView", () => {
  const OCT = { year: 2026, month: 10 };
  const OPTIONS = { now: new Date("2026-10-05T04:30:00Z"), retryDelayMs: 0, loggedBy: "owner@example.com" };

  /** A cached context, plus a second context on the same Sheet that stands in for another server instance. */
  function setup() {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    const ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext);
    const other = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext;
    const logElsewhere = () =>
      logPayment(other, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    return { ctx, logElsewhere };
  }

  it("serves the cached view to someone who has not written", async () => {
    const { ctx, logElsewhere } = setup();
    await loadMonthView(ctx, OCT);
    await logElsewhere();
    expect((await loadMonthView(ctx, OCT)).cards[0].status).toBe("pending");
  });

  it("reloads when this person wrote after the cached copy was read", async () => {
    const { ctx, logElsewhere } = setup();
    await loadMonthView(ctx, OCT);
    await logElsewhere();
    await markWritten(Date.now() + 1);
    expect((await loadMonthView(ctx, OCT)).cards[0].status).toBe("paid");
  });

  it("keeps the cached view when this person wrote before it was read", async () => {
    const { ctx, logElsewhere } = setup();
    await markWritten(Date.now() - 10_000);
    await loadMonthView(ctx, OCT);
    await logElsewhere();
    expect((await loadMonthView(ctx, OCT)).cards[0].status).toBe("pending");
  });
});

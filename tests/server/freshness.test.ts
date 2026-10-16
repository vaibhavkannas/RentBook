import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { sign } from "@/lib/server/signing";
import { logPayment, withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const SECRET = "a-test-secret-that-is-at-least-32-characters-long";
const EMAIL = "member@example.com";
const NOW = 1_800_000_000_000;

/** A cookie value as the server would have written it, for any time and person. */
const cookieFor = (ts: number | string, email = EMAIL) => `${ts}.${sign(`${ts}:${email}`)}`;

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  jar.store.clear();
  jar.set.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("freshness cookie", () => {
  it("round-trips the write time for the same person", async () => {
    await markWritten(EMAIL, NOW);
    expect(await readWrittenAt(EMAIL, NOW + 1_000)).toBe(NOW);
  });

  it("holds the write time and a signature of the write time and the person's email", async () => {
    await markWritten(EMAIL, NOW);
    const value = jar.store.get("rb-wrote")!;
    expect(value).toBe(`${NOW}.${sign(`${NOW}:${EMAIL}`)}`);
    expect(value).not.toContain(EMAIL);
  });

  it("is HTTP-only, lax, site-wide and short-lived", async () => {
    await markWritten(EMAIL, NOW);
    expect(jar.set).toHaveBeenCalledWith(
      "rb-wrote",
      cookieFor(NOW),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 120 }),
    );
  });

  it("does not tell one person's cookie from another's by letter case in the address", async () => {
    await markWritten("Member@Example.com", NOW);
    expect(await readWrittenAt("MEMBER@example.com", NOW)).toBe(NOW);
  });

  it("does not throw when the cookie cannot be set, because the Sheet was already written", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jar.set.mockImplementationOnce(() => {
        throw new Error("cookies can only be set in a Route Handler or Server Function");
      });
      await expect(markWritten(EMAIL, NOW)).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("does not throw, and sets nothing, when AUTH_SECRET is not usable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      vi.stubEnv("AUTH_SECRET", "short");
      await expect(markWritten(EMAIL, NOW)).resolves.toBeUndefined();
      expect(jar.set).not.toHaveBeenCalled();
      expect(logged.mock.calls.flat().join(" ")).not.toContain("short");
    } finally {
      logged.mockRestore();
    }
  });

  it("returns undefined when absent, empty or not shaped like a signed time", async () => {
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
    for (const bad of ["", "abc", ".", "a.b.c", `${NOW}`, `${NOW}.`, `.${sign(`:${EMAIL}`)}`, `-5.${sign(`-5:${EMAIL}`)}`]) {
      jar.store.set("rb-wrote", bad);
      expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
    }
  });

  it("ignores the old unsigned cookie, which a browser could set to anything", async () => {
    jar.store.set("rb-wrote", String(NOW));
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
  });

  it("ignores a value whose time was changed, even to a better one", async () => {
    const [, mac] = cookieFor(NOW - 60_000).split(".");
    jar.store.set("rb-wrote", `${NOW}.${mac}`);
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
  });

  it("ignores a value with a wrong or cut signature", async () => {
    const [ts, mac] = cookieFor(NOW).split(".");
    for (const bad of [`${ts}.${mac.slice(0, -1)}`, `${ts}.${mac}A`, `${ts}.${mac.replace(/./, mac[0] === "A" ? "B" : "A")}`]) {
      jar.store.set("rb-wrote", bad);
      expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
    }
  });

  it("ignores a value made for another person", async () => {
    jar.store.set("rb-wrote", cookieFor(NOW, "owner@example.com"));
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
  });

  it("ignores a value signed with another secret", async () => {
    vi.stubEnv("AUTH_SECRET", "another-secret-that-is-also-32-characters-long");
    const foreign = cookieFor(NOW);
    vi.stubEnv("AUTH_SECRET", SECRET);
    jar.store.set("rb-wrote", foreign);
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
  });

  it("ignores a write time older than 120 seconds, but not one just inside that", async () => {
    jar.store.set("rb-wrote", cookieFor(NOW - 120_000));
    expect(await readWrittenAt(EMAIL, NOW)).toBe(NOW - 120_000);
    jar.store.set("rb-wrote", cookieFor(NOW - 120_001));
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
  });

  it("ignores a write time more than 5 seconds in the future, which would force uncached reads", async () => {
    jar.store.set("rb-wrote", cookieFor(NOW + 5_000));
    expect(await readWrittenAt(EMAIL, NOW)).toBe(NOW + 5_000); // clock drift between servers is believed
    jar.store.set("rb-wrote", cookieFor(NOW + 5_001));
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
  });

  it("ignores zero", async () => {
    jar.store.set("rb-wrote", cookieFor(0));
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
  });

  it("reads as undefined when AUTH_SECRET is not usable, instead of failing the page", async () => {
    jar.store.set("rb-wrote", cookieFor(NOW));
    vi.stubEnv("AUTH_SECRET", "");
    expect(await readWrittenAt(EMAIL, NOW)).toBeUndefined();
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
    await loadMonthView(ctx, OCT, EMAIL);
    await logElsewhere();
    expect((await loadMonthView(ctx, OCT, EMAIL)).cards[0].status).toBe("pending");
  });

  it("reloads when this person wrote after the cached copy was read", async () => {
    const { ctx, logElsewhere } = setup();
    await loadMonthView(ctx, OCT, EMAIL);
    await logElsewhere();
    await markWritten(EMAIL, Date.now() + 1);
    expect((await loadMonthView(ctx, OCT, EMAIL)).cards[0].status).toBe("paid");
  });

  it("keeps the cached view when this person wrote before it was read", async () => {
    const { ctx, logElsewhere } = setup();
    await markWritten(EMAIL, Date.now() - 10_000);
    await loadMonthView(ctx, OCT, EMAIL);
    await logElsewhere();
    expect((await loadMonthView(ctx, OCT, EMAIL)).cards[0].status).toBe("pending");
  });

  it("does not reload for another person's write: the cookie is only good for the person it was made for", async () => {
    const { ctx, logElsewhere } = setup();
    await loadMonthView(ctx, OCT, EMAIL);
    await logElsewhere();
    await markWritten("owner@example.com", Date.now() + 1);
    expect((await loadMonthView(ctx, OCT, EMAIL)).cards[0].status).toBe("pending");
  });
});

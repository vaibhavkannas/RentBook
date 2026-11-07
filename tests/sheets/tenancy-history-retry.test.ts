import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyLogRow } from "@/lib/domain/tenancy-log";
import { rateLimited } from "@/lib/errors";
import { getSettings, type SheetsContext } from "@/lib/sheets/service";
import { resetBootstrap } from "@/lib/sheets/settings-store";
import { TENANCY_LOG_HEADERS, TENANCY_LOG_TAB } from "@/lib/sheets/tenancy-log-store";
import { retryTenancyHistory, saveTenancy } from "@/lib/sheets/tenancy-service";
import { TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// The second chance for the rows of a save that did not reach the Tenancy Log. A retry can arrive twice, or after the first
// try landed although it said it failed, so it adds the rows only when no row of the tab holds them already.

const SAVED_AT = "2026-11-03T09:30:00.000Z";
const OWNER = "owner@example.com";
const ROWS: TenancyLogRow[] = [
  [SAVED_AT, "t-1", "p1", "Edited", "Phone", "", "", OWNER],
  [SAVED_AT, "t-1", "p1", "Edited", "Agreement end", "2027-01-14", "2027-03-31", OWNER],
];

class HistoryGateway extends FakeGateway {
  appendRowsFailures: unknown[] = [];
  appendRowsLands = false;
  async appendRows(tab: string, rows: unknown[][]) {
    const failure = this.appendRowsFailures.shift();
    if (failure === undefined) return super.appendRows(tab, rows);
    if (this.appendRowsLands) await super.appendRows(tab, rows);
    else this.calls.push("appendRows");
    throw failure;
  }
}

async function ready(fake = new HistoryGateway({ Schedule: baseSchedule() })) {
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getSettings(ctx);
  fake.calls = [];
  return { fake, ctx };
}

const logged = (fake: FakeGateway) => fake.tabs.get(TENANCY_LOG_TAB)!.slice(1);
const appendsOf = (fake: FakeGateway) => fake.calls.filter((call) => call === "appendRows").length;

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => vi.restoreAllMocks());

describe("retryTenancyHistory", () => {
  it("adds the rows, in one append, when the Tenancy Log does not hold them", async () => {
    const { fake, ctx } = await ready();
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(appendsOf(fake)).toBe(1);
    expect(logged(fake)).toEqual(ROWS);
  });

  it("adds nothing when the same retry arrives twice", async () => {
    const { fake, ctx } = await ready();
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(appendsOf(fake)).toBe(1);
    expect(logged(fake)).toHaveLength(2);
  });

  it("adds nothing when an earlier try landed although it said it failed", async () => {
    const { fake, ctx } = await ready();
    fake.appendRowsLands = true;
    fake.appendRowsFailures = [new Error("socket hang up")];
    // the try that "failed" (as appendTenancyHistory makes it) put the rows in
    await fake.appendRows(TENANCY_LOG_TAB, ROWS.map((row) => [...row])).catch(() => undefined);
    fake.calls = [];
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(appendsOf(fake)).toBe(0);
    expect(logged(fake)).toHaveLength(2);
  });

  it("knows the entry by its saved-at moment, tenancy, action and field: another field is a different entry", async () => {
    const { fake, ctx } = await ready();
    fake.tabs.get(TENANCY_LOG_TAB)!.push([SAVED_AT, "t-1", "p1", "Edited", "Move-in date", "", "", OWNER]);
    fake.tabs.get(TENANCY_LOG_TAB)!.push([SAVED_AT, "t-2", "p1", "Edited", "Phone", "", "", OWNER]);
    fake.tabs.get(TENANCY_LOG_TAB)!.push(["2026-11-03T09:31:00.000Z", "t-1", "p1", "Edited", "Phone", "", "", OWNER]);
    fake.tabs.get(TENANCY_LOG_TAB)!.push([SAVED_AT, "t-1", "p1", "Moved out", "Phone", "", "", OWNER]);
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(appendsOf(fake)).toBe(1);
    // and the same entry made by someone else, or with other values, is still the same entry
    fake.calls = [];
    fake.tabs.set(TENANCY_LOG_TAB, [[...TENANCY_LOG_HEADERS], [SAVED_AT, "t-1", "p1", "Edited", "Phone", "x", "y", "someone@example.com"]]);
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(appendsOf(fake)).toBe(0);
  });

  it("finds the entry wherever it sits in the tab, however many newer rows there are", async () => {
    const { fake, ctx } = await ready();
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(appendsOf(fake)).toBe(1);
    // 40 more rows of other saves, more than the 30 the retry once looked at, are added after the entry.
    const grid = fake.tabs.get(TENANCY_LOG_TAB)!;
    for (let index = 0; index < 40; index++) grid.push(["2026-11-04T00:00:00.000Z", `t-${index}`, "p2", "Added", "", "", "", OWNER]);
    fake.calls = [];
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(appendsOf(fake)).toBe(0);
    expect(logged(fake)).toHaveLength(42);
    // The same when the entry is the oldest row of a long tab, and when it is a row in the middle.
    for (const place of [1, 20, 41]) {
      const rows = [...logged(fake).filter((row) => row[0] !== SAVED_AT)];
      rows.splice(place - 1, 0, ROWS[0].slice(), ROWS[1].slice());
      fake.tabs.set(TENANCY_LOG_TAB, [[...TENANCY_LOG_HEADERS], ...rows]);
      fake.calls = [];
      expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
      expect(appendsOf(fake)).toBe(0);
    }
  });

  it("still adds the rows when nothing in a long tab is the same entry", async () => {
    const { fake, ctx } = await ready();
    const grid = fake.tabs.get(TENANCY_LOG_TAB)!;
    for (let index = 0; index < 60; index++) grid.push(["2026-11-04T00:00:00.000Z", `t-${index}`, "p2", "Added", "", "", "", OWNER]);
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(appendsOf(fake)).toBe(1);
    expect(logged(fake).slice(-2)).toEqual(ROWS);
  });

  it("adds nothing, and is false, when the Tenancy Log cannot be read, and says so in the log", async () => {
    const { fake, ctx } = await ready();
    const original = fake.getValues.bind(fake);
    fake.getValues = async (tab, a1, render) => {
      if (tab === TENANCY_LOG_TAB) throw new Error("read failed");
      return original(tab, a1, render);
    };
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(false);
    expect(appendsOf(fake)).toBe(0);
    expect(logged(fake)).toEqual([]);
    expect(loggedLines(logs.error)).toEqual([expect.objectContaining({ event: "tenancy-log-check-failed" })]);
  });

  it("is false, and keeps nothing from the failed try, when the rows still cannot be added", async () => {
    const { fake, ctx } = await ready();
    fake.appendRowsFailures = [rateLimited(), rateLimited()];
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(false);
    expect(appendsOf(fake)).toBe(2);
    expect(logged(fake)).toEqual([]);
    expect(loggedLines(logs.error).map((line) => line.event)).toEqual(["tenancy-log-append-failed", "tenancy-log-append-failed"]);
  });

  it("puts a missing Tenancy Log back before it adds the rows", async () => {
    const { fake, ctx } = await ready();
    fake.tabs.delete(TENANCY_LOG_TAB);
    resetBootstrap(fake);
    expect(await retryTenancyHistory(ctx, ROWS, 0)).toBe(true);
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([TENANCY_LOG_HEADERS, ...ROWS]);
  });

  it("takes its turn among the writes: two retries at once add the rows once", async () => {
    const fake = new HistoryGateway({ Schedule: baseSchedule() }, { delayMs: 2 });
    const { ctx } = await ready(fake);
    const [first, second] = await Promise.all([retryTenancyHistory(ctx, ROWS, 0), retryTenancyHistory(ctx, ROWS, 0)]);
    expect([first, second]).toEqual([true, true]);
    expect(logged(fake)).toEqual(ROWS);
  });

  it("throws the page caches away after a success and after a failure", async () => {
    for (const fail of [false, true]) {
      const { fake, ctx } = await ready();
      const invalidate = vi.fn();
      ctx.cache = { get: vi.fn(), invalidate } as never;
      ctx.activityCache = { get: vi.fn(), invalidate } as never;
      ctx.settingsCache = { get: vi.fn(), invalidate } as never;
      if (fail) fake.appendRowsFailures = [new Error("socket hang up")];
      await retryTenancyHistory(ctx, ROWS, 0);
      expect(invalidate).toHaveBeenCalledTimes(3);
    }
  });

  it("never puts a name, a phone number or a note in the log", async () => {
    const { fake, ctx } = await ready();
    fake.appendRowsFailures = [rateLimited(), new Error("socket hang up")];
    await retryTenancyHistory(ctx, [[SAVED_AT, "t-CANARY", "p1", "Edited", "Advance", 20000, 25000, OWNER]], 0);
    const all = [logs.info, logs.warn, logs.error].flatMap((spy) => spy.mock.calls.flat()).join("\n");
    expect(all).toContain("tenancy-log-append-failed");
    expect(all).not.toMatch(/CANARY|20000|25000/);
  });
});

describe("a save whose history failed, then the retry", () => {
  it("leaves the Tenants tab as the save made it, and the Tenancy Log with the rows exactly once", async () => {
    const fake = new HistoryGateway({ Schedule: baseSchedule() });
    const { ctx } = await ready(fake);
    fake.appendRowsFailures = [new Error("socket hang up")];
    const saved = await saveTenancy(
      ctx,
      { portionId: "p1", tenant: "Asha", fields: { moveIn: "2026-01-15", phone: "98765 43210" } },
      { now: new Date(SAVED_AT), updatedBy: OWNER, retryDelayMs: 0 },
    );
    expect(saved.historyWritten).toBe(false);
    const tenants = structuredClone(fake.tabs.get(TENANTS_TAB));
    expect(await retryTenancyHistory(ctx, saved.historyRows, 0)).toBe(true);
    expect(await retryTenancyHistory(ctx, saved.historyRows, 0)).toBe(true);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual(tenants);
    expect(logged(fake)).toEqual(saved.historyRows);
  });
});

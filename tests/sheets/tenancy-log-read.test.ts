import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_NEEDS_ATTENTION, configError, rateLimited, unavailable } from "@/lib/errors";
import { getSettings, withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
import { resetBootstrap } from "@/lib/sheets/settings-store";
import { HISTORY_READ_FAILED, loadTenancyLog, readTenancyHistory } from "@/lib/sheets/tenancy-log-read";
import { TENANCY_LOG_HEADERS, TENANCY_LOG_RANGE, TENANCY_LOG_TAB } from "@/lib/sheets/tenancy-log-store";
import { getPortionTenants, retryTenancyHistory, saveTenancy } from "@/lib/sheets/tenancy-service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// The History section reads the Tenancy Log on its own: one read of the tab, kept 15 seconds like the other page reads and thrown
// away by every write, and the snapshot of the Schedule, Settings and Tenants stays one read.

const OWNER = "owner@example.com";
const NOW = new Date("2026-11-03T09:30:00.000Z");

const logRow = (minute: number, portion: string, overrides: Partial<Record<number, unknown>> = {}) => {
  const row: unknown[] = [`2026-11-03T09:${String(minute).padStart(2, "0")}:00.000Z`, `t-${portion}`, portion, "Edited", "Phone", "", "", OWNER];
  for (const [index, value] of Object.entries(overrides)) row[Number(index)] = value;
  return row;
};

async function setup(rows: unknown[][] = []) {
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const plain: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getSettings(plain); // the tabs exist, the Tenancy Log among them
  fake.tabs.get(TENANCY_LOG_TAB)!.push(...rows);
  const ctx = withSnapshotCache({ ...plain });
  fake.calls = [];
  const reads = () => fake.calls.filter((call) => call === "getValues" || call === "getManyValues").length;
  return { fake, plain, ctx, reads };
}

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("loadTenancyLog", () => {
  it("reads A1:H of the Tenancy Log in one call and gives its rows oldest first", async () => {
    const { fake, plain } = await setup([logRow(1, "p1"), logRow(2, "p2")]);
    const spy = vi.spyOn(fake, "getValues");
    const log = await loadTenancyLog(plain);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(TENANCY_LOG_TAB, TENANCY_LOG_RANGE, "UNFORMATTED_VALUE");
    expect(log.problem).toBeUndefined();
    expect(log.items.map((item) => item.portionId)).toEqual(["p1", "p2"]);
  });

  it("says what is wrong with a header, and gives no rows", async () => {
    const { fake, plain } = await setup([logRow(1, "p1")]);
    fake.tabs.get(TENANCY_LOG_TAB)![0][3] = "What happened";
    const log = await loadTenancyLog(plain);
    expect(log.items).toEqual([]);
    expect(log.problem).toContain('must have "Action" in column D');
  });

  it("puts a missing Tenancy Log tab back before it reads it", async () => {
    const { fake, plain } = await setup();
    fake.tabs.delete(TENANCY_LOG_TAB);
    resetBootstrap(fake);
    expect(await loadTenancyLog(plain)).toEqual({ items: [] });
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([TENANCY_LOG_HEADERS]);
  });
});

describe("readTenancyHistory", () => {
  it("gives the rows of the portion asked for, newest first, and none of another portion's", async () => {
    const { ctx } = await setup([logRow(1, "p1"), logRow(2, "p2"), logRow(3, "p1"), logRow(4, "p2"), logRow(5, "p1")]);
    const { items, problem } = await readTenancyHistory(ctx, "p1");
    expect(problem).toBeUndefined();
    expect(items.map((item) => item.savedAt.slice(11, 16))).toEqual(["09:05", "09:03", "09:01"]);
    expect(items.every((item) => item.portionId === "p1")).toBe(true);
    expect((await readTenancyHistory(ctx, "p9")).items).toEqual([]);
  });

  it("matches a portion by its id exactly, not by a part of it", async () => {
    const { ctx } = await setup([logRow(1, "p1"), logRow(2, "p10"), logRow(3, "p1 ")]);
    expect((await readTenancyHistory(ctx, "p1")).items).toHaveLength(2); // the stored id is trimmed; "p10" is another portion
    expect((await readTenancyHistory(ctx, "p10")).items).toHaveLength(1);
  });

  it("is empty, with no problem, for a Tenancy Log with only its headers", async () => {
    const { ctx } = await setup();
    expect(await readTenancyHistory(ctx, "p1")).toEqual({ items: [] });
  });

  it("reads the tab once for repeated views, and again when the person's own write is newer than the copy", async () => {
    const { ctx, reads } = await setup([logRow(1, "p1")]);
    await readTenancyHistory(ctx, "p1");
    expect(reads()).toBe(1);
    await readTenancyHistory(ctx, "p1");
    await readTenancyHistory(ctx, "p2");
    expect(reads()).toBe(1);
    await readTenancyHistory(ctx, "p1", { minFetchedAt: Date.now() + 1_000 });
    expect(reads()).toBe(2);
  });

  it("keeps the copy for 15 seconds, then reads again", async () => {
    vi.useFakeTimers();
    const { ctx, reads } = await setup([logRow(1, "p1")]);
    await readTenancyHistory(ctx, "p1");
    await vi.advanceTimersByTimeAsync(14_000);
    await readTenancyHistory(ctx, "p1");
    expect(reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await readTenancyHistory(ctx, "p1");
    expect(reads()).toBe(2);
  });

  it("reads the tab each time when the context has no cache", async () => {
    const { plain, reads } = await setup([logRow(1, "p1")]);
    await readTenancyHistory(plain, "p1");
    await readTenancyHistory(plain, "p1");
    expect(reads()).toBe(2);
  });

  it("does not hand out the cached rows to be changed: the next view still has them all", async () => {
    const { ctx } = await setup([logRow(1, "p1"), logRow(2, "p1")]);
    const first = await readTenancyHistory(ctx, "p1");
    first.items.length = 0;
    expect((await readTenancyHistory(ctx, "p1")).items).toHaveLength(2);
  });

  it("shows a save made through the service on the next view: the write threw the copy away", async () => {
    const { ctx } = await setup();
    expect((await readTenancyHistory(ctx, "p1")).items).toEqual([]); // the empty log is now cached
    const { tenancy } = await saveTenancy(
      ctx,
      { portionId: "p1", tenant: "Asha", fields: { moveIn: "2026-01-15" } },
      { now: NOW, updatedBy: OWNER, retryDelayMs: 0 },
    );
    const { items } = await readTenancyHistory(ctx, "p1");
    expect(items).toEqual([
      { savedAt: NOW.toISOString(), tenancyId: tenancy.id, portionId: "p1", action: "Added", field: "", oldValue: "", newValue: "", changedBy: OWNER },
    ]);
  });

  it("shows the rows a retry added on the next view too", async () => {
    const { ctx } = await setup();
    await readTenancyHistory(ctx, "p1");
    const row = [NOW.toISOString(), "t-x", "p1", "Edited", "Agreement end", "2027-01-14", "2027-03-31", OWNER] as const;
    expect(await retryTenancyHistory(ctx, [[...row]], 0)).toBe(true);
    expect((await readTenancyHistory(ctx, "p1")).items.map((item) => item.field)).toEqual(["Agreement end"]);
  });

  it("costs the tenant page one read of its own beside the snapshot's one", async () => {
    const { fake, ctx } = await setup([logRow(1, "p1")]);
    await getPortionTenants(ctx, "p1");
    const { items } = await readTenancyHistory(ctx, "p1");
    expect(items).toHaveLength(1);
    expect(fake.calls.filter((call) => call === "getManyValues")).toHaveLength(1);
    expect(fake.calls.filter((call) => call === "getValues")).toHaveLength(1);
    // and nothing more for a second view within the 15 seconds
    fake.calls = [];
    await getPortionTenants(ctx, "p1");
    await readTenancyHistory(ctx, "p1");
    expect(fake.calls.filter((call) => call === "getManyValues" || call === "getValues")).toEqual([]);
  });

  it("is never part of the snapshot read: the tenant page's snapshot does not ask for the Tenancy Log", async () => {
    const { fake, ctx } = await setup([logRow(1, "p1")]);
    const spy = vi.spyOn(fake, "getManyValues");
    await getPortionTenants(ctx, "p1");
    expect(spy.mock.calls.flatMap(([requests]) => requests.map((request) => request.tab))).not.toContain(TENANCY_LOG_TAB);
  });
});

describe("readTenancyHistory, when the history cannot be shown", () => {
  it("answers with the reason, and no rows, for a wrong header", async () => {
    const { fake, ctx } = await setup([logRow(1, "p1")]);
    fake.tabs.get(TENANCY_LOG_TAB)![0][0] = "When";
    const { items, problem } = await readTenancyHistory(ctx, "p1");
    expect(items).toEqual([]);
    expect(problem).toBe(
      'The Tenancy Log tab must have "Saved at" in column A (found "When"). Put the headers back to see the history; saving changes still works.',
    );
    expect(logs.error).not.toHaveBeenCalled(); // the reason is for the person, not a fault of the server
  });

  it("answers with the reason, and no rows, when the read fails, and logs it without any value from the tab", async () => {
    const { fake, ctx } = await setup([logRow(1, "p1", { 7: "CANARY@example.com" })]);
    fake.failOn.add("getValues");
    const result = await readTenancyHistory(ctx, "p1");
    expect(result).toEqual({ items: [], problem: HISTORY_READ_FAILED });
    const lines = loggedLines(logs.error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", event: "tenancy-log-read-failed" });
    expect(JSON.stringify(lines)).not.toContain("CANARY");
  });

  it("tells a member and the owner what Google said when it is limiting requests or not responding", async () => {
    for (const error of [rateLimited(), unavailable()]) {
      const { fake, ctx } = await setup();
      fake.getValues = async () => {
        throw error;
      };
      expect(await readTenancyHistory(ctx, "p1")).toEqual({ items: [], problem: error.message });
    }
  });

  it("keeps the detail of a connection problem out of the page, as the other pages do", async () => {
    const { fake, ctx } = await setup();
    fake.getValues = async () => {
      throw configError("Google rejected the key; update GOOGLE_SERVICE_ACCOUNT_JSON.");
    };
    expect(await readTenancyHistory(ctx, "p1")).toEqual({ items: [], problem: CONNECTION_NEEDS_ATTENTION });
  });

  it("does not remember a failed read: the next view reads again and works", async () => {
    const { fake, ctx } = await setup([logRow(1, "p1")]);
    fake.failOn.add("getValues");
    expect((await readTenancyHistory(ctx, "p1")).problem).toBeDefined();
    fake.failOn.delete("getValues");
    expect((await readTenancyHistory(ctx, "p1")).items).toHaveLength(1);
  });

  it("never throws, whatever the gateway throws", async () => {
    const { fake, ctx } = await setup();
    fake.getValues = () => {
      throw new TypeError("odd");
    };
    expect((await readTenancyHistory(ctx, "p1")).problem).toBe(HISTORY_READ_FAILED);
  });
});

import { describe, expect, it } from "vitest";
import {
  getSettings,
  logPayment,
  readActivity,
  retryLogRow,
  saveSettings,
  undoPayment,
  withSnapshotCache,
  type LogRow,
  type SheetsContext,
} from "@/lib/sheets/service";
import { LOG_HEADERS, LOG_TAB, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { saveTenancy } from "@/lib/sheets/tenancy-service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid, TOTAL_HEADER } from "../support/fixtures";

// The Activity and Settings pages read the Payments Log and the Settings tab. Like the month view they are
// kept for 15 seconds, and every write on this server throws them away.

const OCT = { year: 2026, month: 10 };
const OPTIONS = { now: new Date("2026-10-05T04:30:00Z"), retryDelayMs: 0, loggedBy: "owner@example.com" };
const PAY = { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" };

function setup(logRows: unknown[][] = []) {
  const fake = new FakeGateway({
    Schedule: baseSchedule(),
    [SETTINGS_TAB]: settingsGrid(),
    [LOG_TAB]: [[...LOG_HEADERS], ...logRows],
  });
  const plain = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext;
  const ctx = withSnapshotCache({ ...plain });
  const reads = () => fake.calls.filter((c) => c === "getValues" || c === "getManyValues").length;
  /** Another server instance on the same Sheet: it never touches this one's caches. */
  const elsewhere = plain;
  return { fake, ctx, reads, elsewhere };
}

const logRow = (n: number) => [
  `2026-10-0${n}T04:30:00.000Z`, "2026-10", "First floor, single bedroom", "Asha", 5450, n, `2026-10-0${n}`, "owner@example.com", "Logged",
];

describe("the Activity page's cache", () => {
  it("reads the log once for repeated views", async () => {
    const { ctx, reads } = setup();
    await readActivity(ctx);
    const afterFirst = reads();
    await readActivity(ctx);
    await readActivity(ctx, 5);
    expect(reads()).toBe(afterFirst);
  });

  it("keeps its own cache, apart from the month view's", async () => {
    const { ctx, reads } = setup();
    await readActivity(ctx);
    const afterActivity = reads();
    await getSettings(ctx);
    expect(reads()).toBeGreaterThan(afterActivity); // the Settings read is not served by the Activity cache
  });

  it("applies the limit to the cached list, newest first", async () => {
    const { ctx, reads } = setup([logRow(1), logRow(2), logRow(3), logRow(4)]);
    const items = await readActivity(ctx, 2);
    expect(items.map((item) => item.count)).toEqual([4, 3]);
    const afterFirst = reads();
    expect((await readActivity(ctx, 3)).map((item) => item.count)).toEqual([4, 3, 2]);
    expect(reads()).toBe(afterFirst);
  });

  it("shows a logged payment straight away", async () => {
    const { ctx } = setup();
    expect(await readActivity(ctx)).toEqual([]);
    await logPayment(ctx, PAY, OPTIONS);
    expect((await readActivity(ctx)).map((item) => item.action)).toEqual(["Logged"]);
  });

  it("shows an undo straight away", async () => {
    const { ctx } = setup();
    await logPayment(ctx, PAY, OPTIONS);
    await readActivity(ctx);
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } }, OPTIONS);
    expect((await readActivity(ctx)).map((item) => item.action)).toEqual(["Undone", "Logged"]);
  });

  it("shows a retried log row straight away", async () => {
    const { ctx } = setup();
    await readActivity(ctx);
    const row: LogRow = ["2026-10-05T04:30:00.000Z", "2026-10", "First floor", "Asha", 5450, 4, "2026-10-05", "owner@example.com", "Logged"];
    expect(await retryLogRow(ctx, row, 0)).toBe(true);
    expect((await readActivity(ctx)).map((item) => item.portion)).toEqual(["First floor"]);
  });

  it("is thrown away by every other kind of write too", async () => {
    const { ctx, reads } = setup();
    const writes = [
      () => saveSettings(ctx, [{ id: "p1", name: "Renamed", cycleLength: 11, hikePercent: 5 }]),
      () => saveTenancy(ctx, { portionId: "p1", tenant: "Asha", fields: { moveIn: "2026-01-15" } }, { now: OPTIONS.now, updatedBy: "owner@example.com" }),
    ];
    for (const write of writes) {
      await readActivity(ctx);
      await write();
      const afterWrite = reads();
      await readActivity(ctx);
      expect(reads()).toBeGreaterThan(afterWrite);
    }
  });

  it("is not changed by a write on another server", async () => {
    const { ctx, elsewhere } = setup();
    await readActivity(ctx);
    await logPayment(elsewhere, PAY, OPTIONS);
    expect(await readActivity(ctx)).toEqual([]);
  });

  it("is not changed by a write on another server until its time is up, unless the person's own write time says so", async () => {
    const { ctx, elsewhere } = setup();
    await readActivity(ctx);
    await logPayment(elsewhere, PAY, OPTIONS);
    expect(await readActivity(ctx)).toEqual([]);
    // this person wrote after the cached copy was read
    expect(await readActivity(ctx, 50, { minFetchedAt: Date.now() + 1 })).toHaveLength(1);
  });

  it("is not a cache at all on a context without one", async () => {
    const { elsewhere } = setup();
    expect(await readActivity(elsewhere)).toEqual([]);
    await logPayment(elsewhere, PAY, OPTIONS);
    expect(await readActivity(elsewhere)).toHaveLength(1);
  });
});

describe("the Settings page's cache", () => {
  it("reads the Settings once for repeated views", async () => {
    const { ctx, reads } = setup();
    await getSettings(ctx);
    const afterFirst = reads();
    await getSettings(ctx);
    await getSettings(ctx);
    expect(reads()).toBe(afterFirst);
  });

  it("shows new settings straight away after they are saved", async () => {
    const { ctx } = setup();
    expect((await getSettings(ctx))[0].name).not.toBe("Renamed");
    await saveSettings(ctx, [{ id: "p1", name: "Renamed", cycleLength: 11, hikePercent: 5 }]);
    expect((await getSettings(ctx))[0].name).toBe("Renamed");
  });

  it("is thrown away by a payment too, since every write throws away every cache", async () => {
    const { ctx, reads } = setup();
    await getSettings(ctx);
    await logPayment(ctx, PAY, OPTIONS);
    const before = reads();
    await getSettings(ctx);
    expect(reads()).toBeGreaterThan(before);
  });

  it("reads again for a person who wrote after the cached copy was read", async () => {
    const { ctx, elsewhere } = setup();
    await getSettings(ctx);
    // another server renames a portion in the Sheet itself
    await saveSettings(elsewhere, [{ id: "p1", name: "Renamed elsewhere", cycleLength: 11, hikePercent: 5 }]);
    expect((await getSettings(ctx))[0].name).not.toBe("Renamed elsewhere");
    expect((await getSettings(ctx, { minFetchedAt: Date.now() + 1 }))[0].name).toBe("Renamed elsewhere");
  });

  it("does not keep a failed read: the next view tries again", async () => {
    const { ctx, fake } = setup();
    fake.failOn.add("getValues");
    fake.failOn.add("getManyValues");
    await expect(getSettings(ctx)).rejects.toThrow();
    fake.failOn.clear();
    expect((await getSettings(ctx)).length).toBeGreaterThan(0);
  });
});

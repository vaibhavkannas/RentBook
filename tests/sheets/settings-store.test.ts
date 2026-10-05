import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  ensureTabs,
  inferPortions,
  LOG_HEADERS,
  LOG_TAB,
  readSettings,
  SETTINGS_TAB,
  updateSettings,
} from "@/lib/sheets/settings-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS, SCHEDULE_HEADERS } from "../support/fixtures";

describe("inferPortions", () => {
  it("builds five portions with default names, cycle 11 and hike 5", () => {
    const portions = inferPortions(SCHEDULE_HEADERS);
    expect(portions).toHaveLength(5);
    expect(portions[0]).toEqual({
      id: "p1",
      name: "First floor, single bedroom",
      tenantHeader: "Tenant",
      countHeader: "Count",
      amountHeader: "Amount",
      cycleLength: 11,
      hikePercent: 5,
    });
    expect(portions[4]).toMatchObject({ id: "p5", tenantHeader: "Tenant5", amountHeader: "Amount5" });
  });

  it("refuses a Tenant column without Count and Amount after it", () => {
    expect(() => inferPortions(["Month", "Tenant", "Amount", "Count"])).toThrow(AppError);
  });

  it("refuses a header row with no Tenant columns", () => {
    expect(() => inferPortions(["Month", "Total"])).toThrow(/No "Tenant" columns/);
  });
});

describe("ensureTabs", () => {
  it("creates Settings and Payments Log once, seeded from the Schedule header", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    expect([...fake.tabs.keys()]).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    const portions = await readSettings(fake);
    expect(portions.map((p) => p.tenantHeader)).toEqual(PORTIONS.map((p) => p.tenantHeader));

    const callsBefore = fake.calls.length;
    await ensureTabs(fake, "Schedule");
    expect(fake.calls.length).toBe(callsBefore);
  });

  it("keeps existing Settings and only adds what is missing", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: [["Portion"], ["p1", "Ground", "Tenant", "Count", "Amount", 6, 8]],
    });
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.has(LOG_TAB)).toBe(true);
    const portions = await readSettings(fake);
    expect(portions).toHaveLength(1);
    expect(portions[0]).toMatchObject({ name: "Ground", cycleLength: 6, hikePercent: 8 });
  });

  it("fails clearly when the Schedule tab is missing", async () => {
    const fake = new FakeGateway({ Other: [] });
    await expect(ensureTabs(fake, "Schedule")).rejects.toThrow(/tab "Schedule" was not found/);
  });
});

describe("readSettings", () => {
  const withRow = (row: unknown[]) =>
    new FakeGateway({ [SETTINGS_TAB]: [["Portion"], row] });

  it("reads a blank cycle length as never resets", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", "", 5]);
    expect((await readSettings(fake))[0].cycleLength).toBeNull();
  });

  it("rejects a non-integer cycle length instead of guessing", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", 5.5, 5]);
    await expect(readSettings(fake)).rejects.toThrow(/cycle length must be a whole number/);
  });

  it("rejects a negative hike", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", 11, -1]);
    await expect(readSettings(fake)).rejects.toThrow(/hike % must be a number/);
  });
});

describe("updateSettings", () => {
  async function seeded() {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    return fake;
  }

  it("changes name, cycle length and hike percent only", async () => {
    const fake = await seeded();
    await updateSettings(fake, [
      { id: "p3", name: " Attic ", cycleLength: null, hikePercent: 7.5 },
    ]);
    const portions = await readSettings(fake);
    expect(portions[2]).toMatchObject({
      name: "Attic",
      cycleLength: null,
      hikePercent: 7.5,
      tenantHeader: "Tenant3",
    });
    expect(portions[0].cycleLength).toBe(11);
  });

  it("writes to the row a portion really sits on, even after a blank row", async () => {
    const fake = new FakeGateway({
      [SETTINGS_TAB]: [
        ["Portion"],
        ["p1", "One", "Tenant", "Count", "Amount", 11, 5],
        [],
        ["p2", "Two", "Tenant2", "Count2", "Amount2", 11, 5],
        ["p3", "Three", "Tenant3", "Count3", "Amount3", 11, 5],
      ],
    });
    await updateSettings(fake, [{ id: "p3", name: "Attic", cycleLength: 6, hikePercent: 8 }]);
    const grid = fake.tabs.get(SETTINGS_TAB)!;
    expect(grid[4]).toEqual(["p3", "Attic", "Tenant3", "Count3", "Amount3", 6, 8]);
    expect(grid[3]).toEqual(["p2", "Two", "Tenant2", "Count2", "Amount2", 11, 5]);
    expect(grid[2]).toEqual([]);
    const portions = await readSettings(fake);
    expect(portions.map((p) => p.name)).toEqual(["One", "Two", "Attic"]);
  });

  it("rejects bad values before writing anything", async () => {
    const fake = await seeded();
    const before = JSON.stringify([...fake.tabs.get(SETTINGS_TAB)!]);
    await expect(
      updateSettings(fake, [
        { id: "p1", name: "Fine", cycleLength: 12, hikePercent: 5 },
        { id: "p2", name: "", cycleLength: 12, hikePercent: 5 },
      ]),
    ).rejects.toThrow(/Portion name/);
    await expect(
      updateSettings(fake, [{ id: "p1", name: "A", cycleLength: 0, hikePercent: 5 }]),
    ).rejects.toThrow(/Cycle length/);
    await expect(
      updateSettings(fake, [{ id: "p1", name: "A", cycleLength: 11, hikePercent: 101 }]),
    ).rejects.toThrow(/Hike/);
    await expect(
      updateSettings(fake, [{ id: "zz", name: "A", cycleLength: 11, hikePercent: 5 }]),
    ).rejects.toThrow(/Unknown portion/);
    expect(JSON.stringify([...fake.tabs.get(SETTINGS_TAB)!])).toBe(before);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import {
  ensureTabs,
  LOG_HEADERS,
  LOG_TAB,
  readSettings,
  resetBootstrap,
  SETTINGS_HEADERS,
  SETTINGS_TAB,
} from "@/lib/sheets/settings-store";
import { TENANCY_LOG_HEADERS, TENANCY_LOG_TAB } from "@/lib/sheets/tenancy-log-store";
import { TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS, settingsGrid } from "../support/fixtures";
import { captureLogs, loggedLines } from "../support/logs";

afterEach(() => vi.restoreAllMocks());

const SETTINGS_MISSING =
  "The Settings tab is missing. Restore it from File > Version history or rename it back. RentBook will not recreate it because that would reset your rent cycle lengths and hike percentages.";
const MISSING_TAB = (tab: string) =>
  `The tab "${tab}" was not found in your Sheet. Restore it from File > Version history or rename it back.`;

async function expectStructure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("sheet-structure");
  return error as AppError;
}

describe("ensureTabs: first-run seeding never resets Settings", () => {
  it.each([
    ["Payments Log", { [LOG_TAB]: [[...LOG_HEADERS]] }],
    ["Tenants", { [TENANTS_TAB]: [[...TENANT_HEADERS]] }],
    ["both", { [LOG_TAB]: [[...LOG_HEADERS]], [TENANTS_TAB]: [[...TENANT_HEADERS]] }],
    ["the Tenancy Log", { [TENANCY_LOG_TAB]: [[...TENANCY_LOG_HEADERS]] }],
    ["all three", { [LOG_TAB]: [[...LOG_HEADERS]], [TENANTS_TAB]: [[...TENANT_HEADERS]], [TENANCY_LOG_TAB]: [[...TENANCY_LOG_HEADERS]] }],
  ])("refuses, and creates nothing, when Settings is missing but %s exists", async (_name, others) => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), ...others });
    const before = structuredClone([...fake.tabs.entries()]);
    const error = await expectStructure(ensureTabs(fake, "Schedule"));
    expect(error.message).toBe(SETTINGS_MISSING);
    expect(fake.calls).not.toContain("addTab");
    expect(fake.calls).not.toContain("updateValues");
    expect([...fake.tabs.entries()]).toEqual(before);
  });

  it("refuses a Settings tab that went missing beside a Tenancy Log with rows in it, and writes nothing", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [TENANCY_LOG_TAB]: [[...TENANCY_LOG_HEADERS], ["2026-11-03T09:30:00.000Z", "t-1", "p1", "Added", "", "", "", "owner@example.com"]],
    });
    const before = structuredClone([...fake.tabs.entries()]);
    expect((await expectStructure(ensureTabs(fake, "Schedule"))).message).toBe(SETTINGS_MISSING);
    expect([...fake.tabs.entries()]).toEqual(before);
    for (const write of ["addTab", "updateValues", "appendRow", "appendRows"]) expect(fake.calls).not.toContain(write);
  });

  it("keeps refusing on every request until the tab is back, then works", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), [LOG_TAB]: [[...LOG_HEADERS]] });
    await expectStructure(ensureTabs(fake, "Schedule"));
    await expectStructure(ensureTabs(fake, "Schedule"));
    fake.tabs.set(SETTINGS_TAB, [[...SETTINGS_HEADERS], ["p1", "Ground", "Tenant", "Count", "Amount", 6, 8]]);
    await ensureTabs(fake, "Schedule");
    expect((await readSettings(fake))[0]).toMatchObject({ name: "Ground", cycleLength: 6, hikePercent: 8 });
  });

  it("still seeds Settings when none of the three app tabs exists", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("seeds an existing Settings tab that is empty", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: [],
      [LOG_TAB]: [[...LOG_HEADERS]],
      [TENANTS_TAB]: [[...TENANT_HEADERS]],
      [TENANCY_LOG_TAB]: [[...TENANCY_LOG_HEADERS]],
    });
    await ensureTabs(fake, "Schedule");
    expect(fake.calls).not.toContain("addTab");
    expect(fake.tabs.get(SETTINGS_TAB)![0]).toEqual(SETTINGS_HEADERS);
    expect((await readSettings(fake)).map((p) => p.tenantHeader)).toEqual(PORTIONS.map((p) => p.tenantHeader));
  });

  it("seeds an existing Settings tab that has only its header", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: [[...SETTINGS_HEADERS], [], []],
      [LOG_TAB]: [[...LOG_HEADERS]],
      [TENANTS_TAB]: [[...TENANT_HEADERS]],
      [TENANCY_LOG_TAB]: [[...TENANCY_LOG_HEADERS]],
    });
    await ensureTabs(fake, "Schedule");
    expect(await readSettings(fake)).toHaveLength(5);
    // the other tabs are not touched
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
  });

  it("does not seed over a Settings tab that has portions, whatever else is in it", async () => {
    const rows = [
      [...SETTINGS_HEADERS],
      ["p1", "Ground", "Tenant", "Count", "Amount", 6, 8],
      [],
      ["a note typed under the table"],
    ];
    const fake = new FakeGateway({ Schedule: baseSchedule(), [SETTINGS_TAB]: rows });
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(SETTINGS_TAB)).toEqual(rows);
  });

  it("does not write over content it does not recognise in a Settings tab with no portions", async () => {
    for (const rows of [
      [["My own notes"]],
      [[...SETTINGS_HEADERS], [], [undefined, "a note without a portion id"]],
    ]) {
      const fake = new FakeGateway({
        Schedule: baseSchedule(),
        [SETTINGS_TAB]: rows,
        [LOG_TAB]: [[...LOG_HEADERS]],
        [TENANTS_TAB]: [[...TENANT_HEADERS]],
        [TENANCY_LOG_TAB]: [[...TENANCY_LOG_HEADERS]],
      });
      await ensureTabs(fake, "Schedule");
      expect(fake.tabs.get(SETTINGS_TAB)).toEqual(rows);
      await expect(readSettings(fake)).rejects.toThrow(/no portions/);
    }
  });

  it("does not create Settings when the Schedule header is broken", async () => {
    const schedule = baseSchedule();
    (schedule[2] as string[])[2] = "Cnt";
    const fake = new FakeGateway({ Schedule: schedule });
    await expectStructure(ensureTabs(fake, "Schedule"));
    expect(fake.tabs.has(SETTINGS_TAB)).toBe(false);
    expect(fake.calls).not.toContain("addTab");
  });

  it("names a missing Schedule tab the same way as a tab that went missing later", async () => {
    const fake = new FakeGateway({ Other: [] });
    expect((await expectStructure(ensureTabs(fake, "Schedule"))).message).toBe(MISSING_TAB("Schedule"));
  });
});

describe("ensureTabs: the Tenancy Log tab", () => {
  const todaysTabs = () => ({
    Schedule: baseSchedule(),
    [SETTINGS_TAB]: settingsGrid(),
    [LOG_TAB]: [
      [...LOG_HEADERS],
      ["2026-10-05T04:30:00.000Z", "2026-10", "First floor, single bedroom", "Asha", 5450, 4, "2026-10-05", "owner@example.com", "Logged"],
    ],
    [TENANTS_TAB]: [
      [...TENANT_HEADERS],
      ["t-1", "p1", "Asha", "98765 43210", "2026-01-15", "", 20000, "2026-01-10", "Held", "", "", "Paid by cheque", "", "owner@example.com", "2026-01-15T05:00:00.000Z"],
    ],
  });

  it("is added, with its headers, to a Sheet that has today's four tabs, and every other grid is exactly as it was", async () => {
    const fake = new FakeGateway(todaysTabs());
    const before = new Map(structuredClone([...fake.tabs.entries()]));
    const report = await ensureTabs(fake, "Schedule");
    expect([...fake.tabs.keys()]).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB, TENANTS_TAB, TENANCY_LOG_TAB]);
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([TENANCY_LOG_HEADERS]);
    for (const [tab, grid] of before) expect(fake.tabs.get(tab), tab).toEqual(grid);
    expect(report).toEqual({ created: [TENANCY_LOG_TAB], filled: [] });
    // One tab, and the one write that gives it its headers: nothing else was written.
    expect(fake.calls.filter((call) => ["addTab", "updateValues", "appendRow", "appendRows", "cloneRow"].includes(call))).toEqual(["addTab", "updateValues"]);
  });

  it("is added after the Tenants tab on a Sheet that has only the Schedule", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    const report = await ensureTabs(fake, "Schedule");
    expect([...fake.tabs.keys()]).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB, TENANTS_TAB, TENANCY_LOG_TAB]);
    expect(report.created).toEqual([SETTINGS_TAB, LOG_TAB, TENANTS_TAB, TENANCY_LOG_TAB]);
  });

  it("is left alone when it is there: a tab with content is never written over, and an empty one gets its headers", async () => {
    const theirs = [["my own notes about tenants"], ["Asha pays late"]];
    const fake = new FakeGateway({ ...todaysTabs(), [TENANCY_LOG_TAB]: structuredClone(theirs) });
    expect(await ensureTabs(fake, "Schedule")).toEqual({ created: [], filled: [] });
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual(theirs);

    const empty = new FakeGateway({ ...todaysTabs(), [TENANCY_LOG_TAB]: [] });
    expect(await ensureTabs(empty, "Schedule")).toEqual({ created: [], filled: [TENANCY_LOG_TAB] });
    expect(empty.tabs.get(TENANCY_LOG_TAB)).toEqual([TENANCY_LOG_HEADERS]);
  });

  it("asks for nothing again once it has been checked", async () => {
    const fake = new FakeGateway(todaysTabs());
    await ensureTabs(fake, "Schedule");
    fake.calls = [];
    await ensureTabs(fake, "Schedule");
    expect(fake.calls).toEqual([]);
  });

  it("does not fail the app when it cannot be added: the other tabs work, the reason is logged, and it is not tried on every request", async () => {
    const logs = captureLogs();
    class NoTenancyLog extends FakeGateway {
      async addTab(title: string) {
        if (title === TENANCY_LOG_TAB) {
          this.calls.push("addTab");
          throw new Error("The Sheet is full");
        }
        return super.addTab(title);
      }
    }
    const fake = new NoTenancyLog(todaysTabs());
    const report = await ensureTabs(fake, "Schedule");
    expect(report).toEqual({ created: [], filled: [] });
    expect(fake.tabs.has(TENANCY_LOG_TAB)).toBe(false);
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    const lines = loggedLines(logs.warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "tenancy-log-tab-failed" });
    fake.calls = [];
    await ensureTabs(fake, "Schedule");
    expect(fake.calls).toEqual([]);
  });

  it("does not fail the app when its header cannot be read", async () => {
    const logs = captureLogs();
    class BrokenRead extends FakeGateway {
      async getValues(tab: string, a1: string, render: Parameters<FakeGateway["getValues"]>[2]) {
        if (tab === TENANCY_LOG_TAB) throw new Error("read failed");
        return super.getValues(tab, a1, render);
      }
    }
    const fake = new BrokenRead({ ...todaysTabs(), [TENANCY_LOG_TAB]: [[...TENANCY_LOG_HEADERS]] });
    await expect(ensureTabs(fake, "Schedule")).resolves.toEqual({ created: [], filled: [] });
    expect(loggedLines(logs.warn).map((line) => line.event)).toEqual(["tenancy-log-tab-failed"]);
  });

  it("is put back by the next check after Google says it is gone", async () => {
    const fake = new FakeGateway(todaysTabs());
    await ensureTabs(fake, "Schedule");
    fake.tabs.delete(TENANCY_LOG_TAB);
    resetBootstrap(fake);
    expect(await ensureTabs(fake, "Schedule")).toEqual({ created: [TENANCY_LOG_TAB], filled: [] });
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([TENANCY_LOG_HEADERS]);
  });
});

/**
 * Two server instances start together: another one adds the tab between this instance listing the tabs and
 * adding it, so this addTab is told the title is taken. `beforeAdd` is what the other instance does first.
 */
class RacingGateway extends FakeGateway {
  beforeAdd = new Map<string, () => void>();

  async addTab(title: string) {
    this.beforeAdd.get(title)?.();
    return super.addTab(title);
  }
}

describe("ensureTabs: another instance adds a tab first", () => {
  it("carries on when the Payments Log and Tenants tabs were added by the other instance", async () => {
    const fake = new RacingGateway({ Schedule: baseSchedule() });
    fake.beforeAdd.set(LOG_TAB, () => fake.tabs.set(LOG_TAB, [[...LOG_HEADERS]]));
    fake.beforeAdd.set(TENANTS_TAB, () => fake.tabs.set(TENANTS_TAB, [[...TENANT_HEADERS]]));
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
    expect(await readSettings(fake)).toHaveLength(5);
  });

  it("completes the headers of a tab the other instance added but has not filled yet", async () => {
    const fake = new RacingGateway({ Schedule: baseSchedule() });
    fake.beforeAdd.set(LOG_TAB, () => fake.tabs.set(LOG_TAB, []));
    fake.beforeAdd.set(TENANTS_TAB, () => fake.tabs.set(TENANTS_TAB, []));
    fake.beforeAdd.set(TENANCY_LOG_TAB, () => fake.tabs.set(TENANCY_LOG_TAB, []));
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([TENANCY_LOG_HEADERS]);
  });

  it("leaves a Tenancy Log that the other instance has already filled", async () => {
    const fake = new RacingGateway({ Schedule: baseSchedule() });
    const theirs = [[...TENANCY_LOG_HEADERS], ["2026-11-03T09:30:00.000Z", "t-1", "p1", "Added", "", "", "", "owner@example.com"]];
    fake.beforeAdd.set(TENANCY_LOG_TAB, () => fake.tabs.set(TENANCY_LOG_TAB, structuredClone(theirs)));
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual(theirs);
  });

  it("seeds Settings when the other instance added it but has not filled it yet", async () => {
    const fake = new RacingGateway({ Schedule: baseSchedule() });
    fake.beforeAdd.set(SETTINGS_TAB, () => fake.tabs.set(SETTINGS_TAB, []));
    await ensureTabs(fake, "Schedule");
    expect(await readSettings(fake)).toHaveLength(5);
  });

  it("leaves Settings alone when the other instance has already filled it", async () => {
    const fake = new RacingGateway({ Schedule: baseSchedule() });
    const theirs = [[...SETTINGS_HEADERS], ["p1", "Theirs", "Tenant", "Count", "Amount", 3, 9]];
    fake.beforeAdd.set(SETTINGS_TAB, () => fake.tabs.set(SETTINGS_TAB, structuredClone(theirs)));
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(SETTINGS_TAB)).toEqual(theirs);
  });

  it("re-lists the tabs after a failed add, and still fails when the tab is not there", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    fake.failOn.add("addTab");
    const error = await ensureTabs(fake, "Schedule").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toBe("addTab failed");
    expect(fake.calls.filter((call) => call === "listTabs")).toHaveLength(2);
    expect(fake.tabs.has(SETTINGS_TAB)).toBe(false);
  });
});

describe("resetBootstrap", () => {
  it("makes the next ensureTabs look at the tabs again, and put back a deleted Payments Log", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    fake.tabs.delete(LOG_TAB);
    fake.calls = [];
    await ensureTabs(fake, "Schedule");
    expect(fake.calls).toEqual([]); // remembered: nothing is looked at again
    expect(fake.tabs.has(LOG_TAB)).toBe(false);

    resetBootstrap(fake);
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
  });

  it("then refuses a deleted Settings tab, and names a deleted Schedule tab", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    resetBootstrap(fake);
    fake.tabs.delete(SETTINGS_TAB);
    expect((await expectStructure(ensureTabs(fake, "Schedule"))).message).toBe(SETTINGS_MISSING);

    fake.tabs.delete("Schedule");
    expect((await expectStructure(ensureTabs(fake, "Schedule"))).message).toBe(MISSING_TAB("Schedule"));
  });

  it("only forgets the gateway it is given", async () => {
    const a = new FakeGateway({ Schedule: baseSchedule() });
    const b = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(a, "Schedule");
    await ensureTabs(b, "Schedule");
    resetBootstrap(a);
    a.calls = [];
    b.calls = [];
    await ensureTabs(a, "Schedule");
    await ensureTabs(b, "Schedule");
    expect(a.calls.length).toBeGreaterThan(0);
    expect(b.calls).toEqual([]);
  });
});

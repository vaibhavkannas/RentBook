import { describe, expect, it } from "vitest";
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
import { TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS } from "../support/fixtures";

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
  ])("refuses, and creates nothing, when Settings is missing but %s exists", async (_name, others) => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), ...others });
    const before = structuredClone([...fake.tabs.entries()]);
    const error = await expectStructure(ensureTabs(fake, "Schedule"));
    expect(error.message).toBe(SETTINGS_MISSING);
    expect(fake.calls).not.toContain("addTab");
    expect(fake.calls).not.toContain("updateValues");
    expect([...fake.tabs.entries()]).toEqual(before);
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
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
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

import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  getMonthView,
  loadSnapshot,
  withSnapshotCache,
  type SheetsContext,
} from "@/lib/sheets/service";
import { parseSettings, readSettings, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { parseTenancies, readTenancies, TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS, settingsGrid, TOTAL_HEADER } from "../support/fixtures";

const OCT = { year: 2026, month: 10 };

function setup() {
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

/** A snapshot on an instance that has already checked its tabs, so the only reads left are the snapshot's own. */
async function warm() {
  const { fake, ctx } = setup();
  await loadSnapshot(ctx);
  fake.calls.length = 0;
  return { fake, ctx };
}

describe("loadSnapshot: one read of the Sheet", () => {
  it("costs exactly one getManyValues call and no other read", async () => {
    const { fake, ctx } = await warm();
    await loadSnapshot(ctx);
    expect(fake.calls).toEqual(["getManyValues"]);
  });

  it("asks for Settings, the Schedule and the Tenants tab, unformatted, in that one call", async () => {
    const { fake, ctx } = await warm();
    const asked: unknown[][] = [];
    const original = fake.getManyValues.bind(fake);
    fake.getManyValues = async (requests, render) => {
      asked.push([requests, render]);
      return original(requests, render);
    };
    await loadSnapshot(ctx);
    expect(asked).toEqual([
      [
        [
          { tab: SETTINGS_TAB, a1: "A1:G50" },
          { tab: "Schedule", a1: "A1:ZZ" },
          { tab: TENANTS_TAB, a1: "A1:O" },
        ],
        "UNFORMATTED_VALUE",
      ],
    ]);
  });

  it("gives the same snapshot as reading each tab on its own", async () => {
    const { fake, ctx } = await warm();
    const snapshot = await loadSnapshot(ctx);
    expect(snapshot.portions).toEqual(await readSettings(fake));
    expect(snapshot.tenancies).toEqual(await readTenancies(fake));
    expect(snapshot.portions).toHaveLength(PORTIONS.length);
    expect(snapshot.rows).toHaveLength(2);
    expect(snapshot.tenantsProblem).toBeUndefined();
  });

  it("is still one call per page view through the cache, and one again after a write clears it", async () => {
    const { fake, ctx } = setup();
    const cached = withSnapshotCache(ctx);
    await getMonthView(cached, OCT); // checks and creates the tabs
    fake.calls.length = 0;
    await getMonthView(cached, OCT);
    await getMonthView(cached, { year: 2026, month: 9 });
    expect(fake.calls).toEqual([]);
    cached.cache!.invalidate();
    await getMonthView(cached, OCT);
    expect(fake.calls).toEqual(["getManyValues"]);
  });

  it("fails as a whole when the read fails, and does not hide the failure as a Tenants problem", async () => {
    const { fake, ctx } = await warm();
    fake.failOn.add("getManyValues");
    await expect(loadSnapshot(ctx)).rejects.toThrow("getManyValues failed");
  });

  it("still reports a wrong Tenants header as a problem, and loads everything else", async () => {
    const { fake, ctx } = await warm();
    fake.tabs.get(TENANTS_TAB)![0][4] = "Moved in";
    const snapshot = await loadSnapshot(ctx);
    expect(fake.calls).toEqual(["getManyValues"]);
    expect(snapshot.tenancies).toEqual([]);
    expect(snapshot.tenantsProblem).toContain('"Move-in date"');
    expect(snapshot.portions).toHaveLength(PORTIONS.length);
    expect(snapshot.rows.length).toBeGreaterThan(0);
  });

  it("refuses a Settings or Schedule problem even when the Tenants tab is fine", async () => {
    const { fake, ctx } = await warm();
    fake.tabs.get(SETTINGS_TAB)!.splice(1, PORTIONS.length);
    const error = await loadSnapshot(ctx).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toMatch(/no portions/);
  });
});

describe("parseSettings", () => {
  it("reads portions from raw values, the same as readSettings does from the tab", async () => {
    const grid = settingsGrid();
    const fake = new FakeGateway({ [SETTINGS_TAB]: grid });
    expect(parseSettings(grid)).toEqual(await readSettings(fake));
    expect(parseSettings(grid).map((p) => p.id)).toEqual(PORTIONS.map((p) => p.id));
  });

  it("ignores a note under the table and refuses a half-filled row, naming it", () => {
    const grid = settingsGrid();
    expect(parseSettings([...grid, ["A note about the hike"]])).toHaveLength(PORTIONS.length);
    expect(() => parseSettings([...grid, ["p6", "Six", "Tenant6", "", ""]])).toThrow(
      new RegExp(`Settings row ${grid.length + 1}\\b`),
    );
  });

  it("refuses no portions", () => {
    expect(() => parseSettings([])).toThrow(/no portions/);
    expect(() => parseSettings([["Portion"]])).toThrow(/no portions/);
  });
});

describe("parseTenancies", () => {
  const row = ["t-1", "p1", "Asha", "", "2026-01-15"];

  it("reads tenancies from raw values with their true row numbers, skipping blank rows", () => {
    const values = [[...TENANT_HEADERS], [], row, ["", "", ""], ["t-2", "p2", "Bala"]];
    const tenancies = parseTenancies(values);
    expect(tenancies.map((t) => [t.rowNumber, t.id, t.tenant])).toEqual([
      [3, "t-1", "Asha"],
      [5, "t-2", "Bala"],
    ]);
  });

  it("reads nothing from a tab that holds only its header", () => {
    expect(parseTenancies([[...TENANT_HEADERS]])).toEqual([]);
  });

  it("refuses a wrong or missing header as a sheet-structure error that names it, on every call", () => {
    const wrong = [...TENANT_HEADERS];
    wrong[4] = "Moved in";
    for (const values of [[wrong, row], [], [TENANT_HEADERS.slice(0, 5)]]) {
      const error = (() => {
        try {
          parseTenancies(values);
          return null;
        } catch (e) {
          return e as AppError;
        }
      })();
      expect(error).toBeInstanceOf(AppError);
      expect(error!.code).toBe("sheet-structure");
      expect(error!.message).toMatch(/The Tenants tab must have/);
    }
  });
});

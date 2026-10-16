import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import { AppError } from "@/lib/errors";
import {
  getMonthView,
  getSettings,
  loadSnapshot,
  logPayment,
  readActivity,
  saveSettings,
  undoPayment,
  withSnapshotCache,
  type SheetsContext,
} from "@/lib/sheets/service";
import { SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { getPortionTenants, moveOutTenancy, saveTenancy } from "@/lib/sheets/tenancy-service";
import { appendTenancy, readTenancies, TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS, settingsGrid, TOTAL_HEADER } from "../support/fixtures";

// A wrong Tenants header must only switch off the tenant details. Month views, payments, undo, Activity and
// Settings keep working, the tenancy writes refuse and write nothing, and the tenant page says what is wrong.
// The header is checked on every read, so a header changed after the app has started is caught too.

const NOW = new Date("2026-10-06T09:00:00Z");
const STAMP = { now: NOW, updatedBy: "member@example.com" };
const PAY = { now: NOW, retryDelayMs: 0, loggedBy: "member@example.com" };
const OCT = { year: 2026, month: 10 };

type Row = Omit<Tenancy, "rowNumber">;

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "t-seed",
    portionId: "p1",
    tenant: "Asha",
    phone: "98765 43210",
    moveIn: "2026-01-15",
    agreementEnd: "",
    advance: 20000,
    advanceDate: "",
    advanceStatus: "Held",
    refund: null,
    deductions: null,
    notes: "",
    moveOut: "",
    updatedBy: "owner@example.com",
    updatedAt: "2026-01-15T05:00:00.000Z",
    ...overrides,
  };
}

function setup() {
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

/** The app has started and the Tenants tab was fine at the time (the "warm instance"). */
async function warm() {
  const { fake, ctx } = setup();
  await getSettings(ctx);
  await appendTenancy(fake, row());
  expect(await readTenancies(fake)).toHaveLength(1);
  return { fake, ctx };
}

/** Someone renames a header by hand. */
function breakHeader(fake: FakeGateway) {
  fake.tabs.get(TENANTS_TAB)![0][4] = "Moved in";
}

const snapshotOf = (fake: FakeGateway) => structuredClone([...fake.tabs.entries()]);

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const p1Cell = (fake: FakeGateway, row: number) => fake.tabs.get("Schedule")![row - 1][1 + 3 * PORTIONS.findIndex((p) => p.id === "p1")];

describe("ensureTabs and a wrong Tenants header (a)", () => {
  it("still creates a missing Tenants tab, with its headers", async () => {
    const { fake, ctx } = setup();
    await getSettings(ctx);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
  });

  it("does not stop the app for a wrong header at the very first load", async () => {
    const { fake, ctx } = setup();
    const wrong = [...TENANT_HEADERS];
    wrong[9] = "Money back";
    fake.tabs.set(SETTINGS_TAB, settingsGrid());
    fake.tabs.set(TENANTS_TAB, [wrong]);
    await expect(getSettings(ctx)).resolves.toHaveLength(PORTIONS.length);
    await expect(getMonthView(ctx, OCT)).resolves.toMatchObject({ cards: expect.any(Array) });
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([wrong]);
  });
});

describe("loadSnapshot and a wrong Tenants header (b, c)", () => {
  it("has no problem when the header is right", async () => {
    const { ctx } = await warm();
    const snapshot = await loadSnapshot(ctx);
    expect(snapshot.tenantsProblem).toBeUndefined();
    expect(snapshot.tenancies).toHaveLength(1);
  });

  it("returns no tenancies and the problem, and still loads everything else, on a warm instance", async () => {
    const { fake, ctx } = await warm();
    breakHeader(fake);
    const snapshot = await loadSnapshot(ctx);
    expect(snapshot.tenancies).toEqual([]);
    expect(snapshot.tenantsProblem).toContain('"Move-in date"');
    expect(snapshot.tenantsProblem).toContain("column E");
    expect(snapshot.tenantsProblem).toContain('"Moved in"');
    expect(snapshot.portions).toHaveLength(PORTIONS.length);
    expect(snapshot.rows.length).toBeGreaterThan(0);
  });

  it("notices a header changed back and forth between two reads", async () => {
    const { fake, ctx } = await warm();
    expect((await loadSnapshot(ctx)).tenantsProblem).toBeUndefined();
    breakHeader(fake);
    expect((await loadSnapshot(ctx)).tenantsProblem).toBeDefined();
    fake.tabs.get(TENANTS_TAB)![0][4] = "Move-in date";
    const fixed = await loadSnapshot(ctx);
    expect(fixed.tenantsProblem).toBeUndefined();
    expect(fixed.tenancies).toHaveLength(1);
  });

  it("does not hide other failures of the Tenants read", async () => {
    const { fake, ctx } = await warm();
    const original = fake.getValues.bind(fake);
    fake.getValues = async (tab, a1, render) => {
      if (tab === TENANTS_TAB) throw new Error("Google is down");
      return original(tab, a1, render);
    };
    await expect(loadSnapshot(ctx)).rejects.toThrow("Google is down");
  });

  it("does not hide a problem with another tab as a Tenants problem", async () => {
    const { fake, ctx } = await warm();
    fake.tabs.set("Schedule", [["nothing useful here"]]);
    await expectCode(loadSnapshot(ctx), "sheet-structure");
  });
});

describe("the rest of the app with a wrong Tenants header (c)", () => {
  let errorSpy: MockInstance<typeof console.error>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("shows the month view without tenancy details, and no error", async () => {
    const { fake, ctx } = await warm();
    expect((await getMonthView(ctx, OCT)).cards.find((c) => c.portionId === "p1")?.tenancy).not.toBeNull();
    breakHeader(fake);
    const view = await getMonthView(ctx, OCT);
    expect(view.cards).toHaveLength(PORTIONS.length);
    expect(view.cards.every((card) => card.tenancy === null)).toBe(true);
    expect(view.cards.find((c) => c.portionId === "p1")).toMatchObject({ status: "pending" });
  });

  it("shows the month view through the snapshot cache too", async () => {
    const { fake } = await warm();
    breakHeader(fake);
    const ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER });
    const view = await getMonthView(ctx, OCT);
    expect(view.cards.every((card) => card.tenancy === null)).toBe(true);
  });

  it("logs a payment, edits it and undoes it, and reads the Activity", async () => {
    const { fake, ctx } = await warm();
    breakHeader(fake);

    const logged = await logPayment(
      ctx,
      { month: OCT, portionId: "p1", amount: 6000, dateReceived: "2026-10-05" },
      PAY,
    );
    expect(logged).toMatchObject({ logWritten: true, entry: { tenant: "Asha", amount: 6000 } });
    expect(logged.tenancyWritten).toBeUndefined();

    await logPayment(
      ctx,
      { month: OCT, portionId: "p1", amount: 6100, dateReceived: "2026-10-06", overwrite: true, expected: logged.entry },
      PAY,
    );
    const undone = await undoPayment(
      ctx,
      { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: logged.entry.count, amount: 6100 } },
      PAY,
    );
    expect(undone.logWritten).toBe(true);

    const activity = await readActivity(ctx);
    expect(activity.map((item) => item.action)).toEqual(["Undone", "Edited", "Logged"]);
  });

  it("reads and saves the settings", async () => {
    const { fake, ctx } = await warm();
    breakHeader(fake);
    const portions = await getSettings(ctx);
    const saved = await saveSettings(ctx, [{ id: "p1", name: "Renamed", cycleLength: 11, hikePercent: 5 }]);
    expect(portions).toHaveLength(PORTIONS.length);
    expect(saved.find((p) => p.id === "p1")?.name).toBe("Renamed");
  });
});

describe("tenancy writes with a wrong Tenants header (d)", () => {
  let errorSpy: MockInstance<typeof console.error>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("saveTenancy refuses to create details, names the header, and writes nothing", async () => {
    const { fake, ctx } = await warm();
    breakHeader(fake);
    const before = snapshotOf(fake);
    const error = await expectCode(
      saveTenancy(ctx, { portionId: "p2", tenant: "Bala", fields: { moveIn: "2026-10-01" } }, STAMP),
      "sheet-structure",
    );
    expect(error.message).toContain('"Move-in date"');
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("saveTenancy refuses to update details, and writes nothing", async () => {
    const { fake, ctx } = await warm();
    const [stored] = await readTenancies(fake);
    breakHeader(fake);
    const before = snapshotOf(fake);
    fake.calls = [];
    await expectCode(
      saveTenancy(
        ctx,
        {
          portionId: "p1",
          tenant: "Asha",
          id: stored.id,
          expectedUpdatedAt: stored.updatedAt,
          fields: { moveIn: "2026-01-15", notes: "changed" },
        },
        STAMP,
      ),
      "sheet-structure",
    );
    expect(snapshotOf(fake)).toEqual(before);
    expect(fake.calls.filter((call) => call === "updateValues" || call === "appendRow")).toEqual([]);
  });

  it("moveOutTenancy refuses, and writes nothing", async () => {
    const { fake, ctx } = await warm();
    const [stored] = await readTenancies(fake);
    breakHeader(fake);
    const before = snapshotOf(fake);
    fake.calls = [];
    await expectCode(
      moveOutTenancy(ctx, { id: stored.id, expectedUpdatedAt: stored.updatedAt, moveOut: "2026-09-30" }, STAMP),
      "sheet-structure",
    );
    expect(snapshotOf(fake)).toEqual(before);
    expect(fake.calls).not.toContain("updateValues");
  });

  it("a header broken after an earlier good save is caught by the next save", async () => {
    const { fake, ctx } = await warm();
    await saveTenancy(ctx, { portionId: "p2", tenant: "Bala", fields: { moveIn: "2026-10-01" } }, STAMP);
    breakHeader(fake);
    const before = snapshotOf(fake);
    await expectCode(
      saveTenancy(ctx, { portionId: "p3", tenant: "Chitra", fields: { moveIn: "2026-10-01" } }, STAMP),
      "sheet-structure",
    );
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("logPayment for a new tenant keeps the payment, writes nothing to Tenants, and says the tenancy part failed", async () => {
    const { fake, ctx } = await warm();
    breakHeader(fake);
    const tenantsBefore = structuredClone(fake.tabs.get(TENANTS_TAB));

    const result = await logPayment(
      ctx,
      {
        month: OCT,
        portionId: "p1",
        amount: 6000,
        dateReceived: "2026-10-05",
        newTenantName: "Hari",
        tenancy: { moveIn: "2026-10-01", advance: 5000 },
      },
      PAY,
    );

    expect(result).toMatchObject({ logWritten: true, tenancyWritten: false, entry: { tenant: "Hari", count: 1, amount: 6000 } });
    expect(p1Cell(fake, 6)).toBe("Hari"); // the new Oct-26 row of the Schedule
    expect(fake.tabs.get(TENANTS_TAB)).toEqual(tenantsBefore);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, reason] = errorSpy.mock.calls[0];
    expect(message).toMatch(/Tenancy write failed after the payment was saved/);
    expect(String((reason as Error).message)).toContain('"Move-in date"');
  });

  it("logPayment for a new tenant with no details also leaves the previous tenancy alone and says so", async () => {
    const { fake, ctx } = await warm();
    breakHeader(fake);
    const tenantsBefore = structuredClone(fake.tabs.get(TENANTS_TAB));
    const result = await logPayment(
      ctx,
      { month: OCT, portionId: "p1", amount: 6000, dateReceived: "2026-10-05", newTenantName: "Hari" },
      PAY,
    );
    expect(result).toMatchObject({ logWritten: true, tenancyWritten: false });
    expect(fake.tabs.get(TENANTS_TAB)).toEqual(tenantsBefore);
  });

  it("logPayment catches a header broken between its first read and its tenancy work", async () => {
    const { fake, ctx } = await warm();
    // break the header right after the payment's own Schedule write, before the tenancy work
    const original = fake.appendRow.bind(fake);
    fake.appendRow = async (tab, values) => {
      await original(tab, values);
      if (tab === "Payments Log") breakHeader(fake);
    };
    const tenantsBefore = structuredClone(fake.tabs.get(TENANTS_TAB));
    const result = await logPayment(
      ctx,
      {
        month: OCT,
        portionId: "p1",
        amount: 6000,
        dateReceived: "2026-10-05",
        newTenantName: "Hari",
        tenancy: { moveIn: "2026-10-01" },
      },
      PAY,
    );
    expect(result.tenancyWritten).toBe(false);
    expect(fake.tabs.get(TENANTS_TAB)!.slice(1)).toEqual(tenantsBefore!.slice(1));
    expect(fake.tabs.get(TENANTS_TAB)).toHaveLength(2); // nothing was appended
  });
});

describe("getPortionTenants with a wrong Tenants header (e)", () => {
  it("returns the problem and no tenancies, for the page to show", async () => {
    const { fake, ctx } = await warm();
    breakHeader(fake);
    const result = await getPortionTenants(ctx, "p1");
    expect(result.tenantsProblem).toContain('"Move-in date"');
    expect(result).toMatchObject({ scheduleTenant: "Asha", current: null, mismatched: null, past: [] });
    expect(result.portion.id).toBe("p1");
  });

  it("has no problem when the header is right", async () => {
    const { ctx } = await warm();
    const result = await getPortionTenants(ctx, "p1");
    expect(result.tenantsProblem).toBeUndefined();
    expect(result.current).toMatchObject({ tenant: "Asha" });
  });

  it("still refuses an unknown portion", async () => {
    const { fake, ctx } = await warm();
    breakHeader(fake);
    await expectCode(getPortionTenants(ctx, "p9"), "validation");
  });

  it("works through the snapshot cache", async () => {
    const { fake } = await warm();
    breakHeader(fake);
    const ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER });
    expect((await getPortionTenants(ctx, "p1")).tenantsProblem).toContain('"Move-in date"');
  });
});

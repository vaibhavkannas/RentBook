import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import { AppError } from "@/lib/errors";
import { getSettings, logPayment, type SheetsContext } from "@/lib/sheets/service";
import { saveTenancy } from "@/lib/sheets/tenancy-service";
import { appendTenancy, readTenancies, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { ShiftingGateway } from "../support/shifting-gateway";
import { baseSchedule, PORTIONS, TOTAL_HEADER } from "../support/fixtures";

// Google appends after the first contiguous block of rows, so a blank row someone left inside the Tenants tab
// makes the new row land there and moves every row below it down. The rows to close must be found again AFTER
// the append, by their ID, never by the row numbers read before it.

const NOW = new Date("2026-10-06T09:00:00Z");
const STAMP = { now: NOW, updatedBy: "member@example.com" };
const PAY = { now: NOW, retryDelayMs: 0, loggedBy: "member@example.com" };

type Row = Omit<Tenancy, "rowNumber">;

function row(overrides: Partial<Row>): Row {
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

/**
 * Sheet rows after setup:  1 header, 2 Bala (p2, current), 3 BLANK, 4 Asha (p1, current), 5 Chitra (p3, current).
 * Asha lies below the blank row, so an append moves her down to row 5.
 */
async function gapped() {
  const fake = new ShiftingGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getSettings(ctx);
  fake.shift = false;
  await appendTenancy(fake, row({ id: "t-bala", portionId: "p2", tenant: "Bala" }));
  fake.tabs.get(TENANTS_TAB)!.push([]);
  await appendTenancy(fake, row({ id: "t-asha", portionId: "p1", tenant: "Asha" }));
  await appendTenancy(fake, row({ id: "t-chitra", portionId: "p3", tenant: "Chitra" }));
  fake.shift = true;
  // the Schedule names Hari for p1 now
  fake.tabs.get("Schedule")![4][1 + 3 * PORTIONS.findIndex((p) => p.id === "p1")] = "Hari";
  return { fake, ctx, before: structuredClone(fake.tabs.get(TENANTS_TAB)!) };
}

const grid = (fake: ShiftingGateway) => fake.tabs.get(TENANTS_TAB)!;
const byId = (all: Tenancy[], id: string) => all.find((t) => t.id === id);

describe("a new tenancy is appended into a Tenants tab with a blank row in it", () => {
  let errorSpy: MockInstance<typeof console.error>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("starts from the layout the tests assume", async () => {
    const { fake } = await gapped();
    expect(grid(fake).map((cells) => cells[0] ?? "")).toEqual(["Tenancy ID", "t-bala", "", "t-asha", "t-chitra"]);
  });

  describe("saveTenancy", () => {
    it("closes the previous tenancy where it is NOW, not on the row it had before the append", async () => {
      const { fake, ctx } = await gapped();

      const { tenancy } = await saveTenancy(
        ctx,
        { portionId: "p1", tenant: "Hari", fields: { moveIn: "2026-10-01", advance: 30000 } },
        STAMP,
      );

      // Google put the new row on the blank row 3 and moved the blank row, Asha and Chitra down
      expect(tenancy).toMatchObject({ rowNumber: 3, tenant: "Hari", moveOut: "" });
      expect(grid(fake).map((cells) => cells[0] ?? "")).toEqual([
        "Tenancy ID",
        "t-bala",
        tenancy.id,
        "",
        "t-asha",
        "t-chitra",
      ]);
      const all = await readTenancies(fake);
      expect(byId(all, "t-asha")).toMatchObject({
        rowNumber: 5,
        moveOut: "2026-10-01",
        updatedBy: "member@example.com",
        updatedAt: "2026-10-06T09:00:00.000Z",
        phone: "98765 43210",
        advance: 20000,
      });
    });

    it("touches no other row: the blank row, Bala and Chitra are exactly as they were", async () => {
      const { fake, ctx, before } = await gapped();

      await saveTenancy(ctx, { portionId: "p1", tenant: "Hari", fields: { moveIn: "2026-10-01" } }, STAMP);

      const after = grid(fake);
      expect(after[1]).toEqual(before[1]); // Bala
      expect(after[3]).toEqual([]); // the blank row, still blank (the old code wrote the close here)
      expect(after[5]).toEqual(before[4]); // Chitra, moved down but unchanged
      expect(after[0]).toEqual(before[0]);
      expect(after).toHaveLength(6);
    });

    it("returns the new tenancy as it is stored, with its real row number", async () => {
      const { fake, ctx } = await gapped();
      const { tenancy } = await saveTenancy(
        ctx,
        { portionId: "p1", tenant: "Hari", fields: { moveIn: "2026-10-01", phone: "99999 00000" } },
        STAMP,
      );
      const stored = byId(await readTenancies(fake), tenancy.id);
      expect(tenancy).toEqual(stored);
    });

    it("skips a previous tenancy whose row has disappeared since it was read, and writes nothing else", async () => {
      const { fake, ctx, before } = await gapped();
      // someone clears Asha's row at the very moment of the append
      fake.afterAppend = () => {
        grid(fake)[grid(fake).findIndex((cells) => cells[0] === "t-asha")] = [];
      };

      const { tenancy } = await saveTenancy(
        ctx,
        { portionId: "p1", tenant: "Hari", fields: { moveIn: "2026-10-01" } },
        STAMP,
      );

      expect(tenancy).toMatchObject({ tenant: "Hari", rowNumber: 3 });
      const after = grid(fake);
      expect(after[1]).toEqual(before[1]);
      expect(after[5]).toEqual(before[4]);
      // the cleared row stayed cleared: nothing was written onto it
      expect(after[3]).toEqual([]);
      expect(after[4]).toEqual([]);
    });

    it("does not overwrite a move-out someone else entered at the same moment", async () => {
      const { fake, ctx } = await gapped();
      fake.afterAppend = () => {
        const asha = grid(fake).find((cells) => cells[0] === "t-asha")!;
        asha[12] = "2026-09-15";
        asha[13] = "owner@example.com";
      };

      await saveTenancy(ctx, { portionId: "p1", tenant: "Hari", fields: { moveIn: "2026-10-01" } }, STAMP);

      expect(byId(await readTenancies(fake), "t-asha")).toMatchObject({
        moveOut: "2026-09-15",
        updatedBy: "owner@example.com",
      });
    });

    it("closes nothing and refuses when the row it just appended cannot be found again", async () => {
      const { fake, ctx, before } = await gapped();
      fake.afterAppend = () => {
        // the appended row vanishes
        grid(fake).splice(2, 1);
      };

      const error = await saveTenancy(
        ctx,
        { portionId: "p1", tenant: "Hari", fields: { moveIn: "2026-10-01" } },
        STAMP,
      ).then(
        () => null,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("conflict");
      // Asha was not closed
      expect(byId(await readTenancies(fake), "t-asha")?.moveOut).toBe("");
      expect(grid(fake)).toEqual(before);
    });
  });

  describe("logPayment with a new tenant", () => {
    const payNew = (ctx: SheetsContext, tenancy?: { moveIn: string; advance?: number }) =>
      logPayment(
        ctx,
        {
          month: { year: 2026, month: 10 },
          portionId: "p1",
          amount: 6000,
          dateReceived: "2026-10-05",
          newTenantName: "Hari",
          ...(tenancy ? { tenancy } : {}),
        },
        PAY,
      );

    it("closes the right previous tenancy after adding the new details", async () => {
      const { fake, ctx, before } = await gapped();

      const result = await payNew(ctx, { moveIn: "2026-10-01", advance: 30000 });

      expect(result.tenancyWritten).toBe(true);
      const all = await readTenancies(fake);
      expect(byId(all, "t-asha")).toMatchObject({ rowNumber: 5, moveOut: "2026-10-01" });
      expect(all.find((t) => t.tenant === "Hari")).toMatchObject({ rowNumber: 3, moveOut: "" });
      expect(grid(fake)[1]).toEqual(before[1]);
      expect(grid(fake)[3]).toEqual([]);
      expect(grid(fake)[5]).toEqual(before[4]);
    });

    it("closes the previous tenancy on the date received when no details were given", async () => {
      const { fake, ctx, before } = await gapped();

      const result = await payNew(ctx);

      expect(result.tenancyWritten).toBe(true);
      expect(byId(await readTenancies(fake), "t-asha")).toMatchObject({ rowNumber: 4, moveOut: "2026-10-05" });
      expect(grid(fake).slice(0, 3)).toEqual(before.slice(0, 3));
      expect(grid(fake)[4]).toEqual(before[4]);
    });

    it("keeps the payment, and reports that the tenancy part did not finish, when the new row vanishes", async () => {
      const { fake, ctx, before } = await gapped();
      fake.afterAppend = (tab) => {
        if (tab === TENANTS_TAB) grid(fake).splice(2, 1);
      };

      const result = await payNew(ctx, { moveIn: "2026-10-01" });

      expect(result.logWritten).toBe(true);
      expect(result.tenancyWritten).toBe(false);
      expect(byId(await readTenancies(fake), "t-asha")?.moveOut).toBe("");
      expect(grid(fake)).toEqual(before);
    });
  });
});

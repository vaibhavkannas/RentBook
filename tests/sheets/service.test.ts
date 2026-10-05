import { describe, expect, it } from "vitest";
import { serialFromYm } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import {
  getMonthView,
  logPayment,
  retryLogRow,
  type LogPaymentInput,
  type SheetsContext,
} from "@/lib/sheets/service";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const NOW = new Date("2026-10-05T04:30:00Z");
const OCT = { year: 2026, month: 10 };

function setup(schedule: unknown[][] = baseSchedule()) {
  const fake = new FakeGateway({ Schedule: schedule });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { portionId: string }) =>
  logPayment(
    ctx,
    { month: OCT, amount: 5450, dateReceived: "2026-10-05", ...input },
    { now: NOW, retryDelayMs: 0 },
  );

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

describe("getMonthView", () => {
  it("creates the Settings and Payments Log tabs on first use and derives cards", async () => {
    const { fake, ctx } = setup();
    const view = await getMonthView(ctx, OCT);
    expect([...fake.tabs.keys()]).toContain("Settings");
    expect([...fake.tabs.keys()]).toContain(LOG_TAB);
    expect(view.cards[0]).toMatchObject({ status: "pending", next: { count: 4 } });
  });
});

describe("logPayment: first payment of a new month", () => {
  it("clones the last month row, blanks the inputs, and writes only this portion", async () => {
    const { fake, ctx } = setup();
    const result = await pay(ctx, { portionId: "p1" });

    expect(result).toMatchObject({
      entry: { tenant: "Asha", count: 4, amount: 5450 },
      logWritten: true,
    });
    expect(cell(fake, "Schedule", "A", 6)).toBe("Oct-26");
    expect(cell(fake, "Schedule", "B", 6)).toBe("Asha");
    expect(cell(fake, "Schedule", "C", 6)).toBe(4);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(cell(fake, "Schedule", "E", 6)).toBeUndefined();
    expect(cell(fake, "Schedule", "G", 6)).toBeUndefined();
    expect(cell(fake, "Schedule", "Q", 6)).toBe("=D6+G6+J6+M6+P6");
    expect(cell(fake, "Schedule", "D", 5)).toBe(5450);
    expect(fake.tabs.get("Schedule")).toHaveLength(6);
  });

  it("writes a Payments Log row with the date received", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1", dateReceived: "2026-10-03" });
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1]).toEqual([
      "2026-10-05T04:30:00.000Z",
      "2026-10",
      "First floor, single bedroom",
      "Asha",
      5450,
      4,
      "2026-10-03",
    ]);
  });

  it("writes a real date serial when the Month column holds dates", async () => {
    const { fake, ctx } = setup(baseSchedule("serial"));
    await pay(ctx, { portionId: "p1" });
    expect(cell(fake, "Schedule", "A", 6)).toBe(serialFromYm(OCT));
  });
});

describe("logPayment: later payments in the same month", () => {
  it("reuses the month row and accepts an edited amount after a cycle wrap", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const result = await pay(ctx, { portionId: "p2", amount: 13300 });

    expect(result.entry).toEqual({ tenant: "Bala", count: 1, amount: 13300 });
    expect(fake.tabs.get("Schedule")).toHaveLength(6);
    expect(cell(fake, "Schedule", "F", 6)).toBe(1);
    expect(cell(fake, "Schedule", "G", 6)).toBe(13300);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
  });

  it("refreshes the month view after saving", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const view = await getMonthView(ctx, OCT);
    expect(view.cards[0]).toMatchObject({ status: "paid", entry: { count: 4 } });
    expect(view.paidCount).toBe(1);
  });
});

describe("logPayment: duplicates", () => {
  it("refuses to replace an amount without confirmation", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const error = await expectCode(pay(ctx, { portionId: "p1", amount: 6000 }), "conflict");
    expect(error.details).toEqual({ existingAmount: 5450, existingTenant: "Asha" });
  });

  it("overwrites when confirmed, keeping the same count", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const result = await pay(ctx, { portionId: "p1", amount: 6000, overwrite: true });
    expect(result.entry).toEqual({ tenant: "Asha", count: 4, amount: 6000 });
    expect(cell(fake, "Schedule", "C", 6)).toBe(4);
    expect(cell(fake, "Schedule", "D", 6)).toBe(6000);
  });
});

describe("logPayment: tenants", () => {
  it("requires a tenant name for a portion with no history", async () => {
    const { ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p4" }), "validation");
  });

  it("starts a new tenant at count 1 with the typed rent", async () => {
    const { fake, ctx } = setup();
    const result = await pay(ctx, { portionId: "p4", amount: 8000, newTenantName: " Farah " });
    expect(result.entry).toEqual({ tenant: "Farah", count: 1, amount: 8000 });
    expect(cell(fake, "Schedule", "K", 6)).toBe("Farah");
    expect(cell(fake, "Schedule", "L", 6)).toBe(1);
  });

  it("restarts the count for a new tenant even mid-cycle", async () => {
    const { ctx } = setup();
    const result = await pay(ctx, { portionId: "p3", amount: 9500, newTenantName: "Gita" });
    expect(result.entry).toMatchObject({ tenant: "Gita", count: 1 });
  });

  it("keeps counting when the cycle never resets", async () => {
    const { fake, ctx } = setup();
    await getMonthView(ctx, OCT);
    const settings = fake.tabs.get("Settings")!;
    settings[2][5] = "";
    const result = await pay(ctx, { portionId: "p2", amount: 12700 });
    expect(result.entry.count).toBe(12);
  });
});

describe("logPayment: total column without a formula", () => {
  function plainTotals() {
    const schedule = baseSchedule();
    (schedule[3] as unknown[])[16] = 31350;
    (schedule[4] as unknown[])[16] = 31350;
    return schedule;
  }

  it("blanks the copied total and then keeps it equal to the sum of the row", async () => {
    const { fake, ctx } = setup(plainTotals());
    await pay(ctx, { portionId: "p1" });
    expect(cell(fake, "Schedule", "Q", 6)).toBe(5450);
    await pay(ctx, { portionId: "p2", amount: 13300 });
    expect(cell(fake, "Schedule", "Q", 6)).toBe(18750);
  });

  it("recomputes the total after an overwrite", async () => {
    const { fake, ctx } = setup(plainTotals());
    await pay(ctx, { portionId: "p1" });
    await pay(ctx, { portionId: "p2", amount: 13300 });
    await pay(ctx, { portionId: "p1", amount: 6000, overwrite: true });
    expect(cell(fake, "Schedule", "Q", 6)).toBe(19300);
  });
});

describe("logPayment: sheet safety", () => {
  it("stops when the row under the table is not empty and changes nothing", async () => {
    const schedule = baseSchedule();
    schedule.push(["Notes: remember to renew insurance"]);
    const { fake, ctx } = setup(schedule);
    await expectCode(pay(ctx, { portionId: "p1" }), "conflict");
    expect(fake.tabs.get("Schedule")).toHaveLength(6);
    expect(cell(fake, "Schedule", "A", 6)).toBe("Notes: remember to renew insurance");
  });

  it("surfaces a header renamed after setup instead of guessing", async () => {
    const { fake, ctx } = setup();
    await getMonthView(ctx, OCT);
    (fake.tabs.get("Schedule")![2] as string[])[2] = "Cnt";
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "sheet-structure");
    expect(error.message).toMatch(/Header "Count" was not found/);
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
  });

  it("rejects a broken header on first run while seeding Settings", async () => {
    const schedule = baseSchedule();
    (schedule[2] as string[])[2] = "Cnt";
    const { ctx } = setup(schedule);
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "sheet-structure");
    expect(error.message).toMatch(/must be followed by a Count and an Amount/);
  });
});

describe("logPayment: Payments Log failures", () => {
  it("keeps the Schedule write and reports the log as pending", async () => {
    const { fake, ctx } = setup();
    fake.failOn.add("appendRow");
    const result = await pay(ctx, { portionId: "p1" });
    expect(result.logWritten).toBe(false);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(fake.calls.filter((c) => c === "appendRow")).toHaveLength(3);

    fake.failOn.clear();
    expect(await retryLogRow(ctx, result.logRow, 0)).toBe(true);
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1]).toEqual(result.logRow);
  });
});

describe("logPayment: input validation", () => {
  it.each([0, -5, 12.5, Number.NaN, 20_000_000])("rejects amount %s", async (amount) => {
    const { ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p1", amount }), "validation");
  });

  it("rejects an impossible date, an empty tenant name, and an unknown portion", async () => {
    const { ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p1", dateReceived: "2026-02-30" }), "validation");
    await expectCode(pay(ctx, { portionId: "p4", newTenantName: "  " }), "validation");
    await expectCode(pay(ctx, { portionId: "p9" }), "validation");
  });

  it("does not touch the sheet when validation fails", async () => {
    const { fake, ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p1", amount: 0 }), "validation");
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
    expect(fake.tabs.has("Settings")).toBe(false);
  });
});

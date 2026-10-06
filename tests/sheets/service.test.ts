import { describe, expect, it } from "vitest";
import { serialFromYm } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import {
  getMonthView,
  getSettings,
  logPayment,
  retryLogRow,
  saveSettings,
  undoPayment,
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

const OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "owner@example.com" };

const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { portionId: string }) =>
  logPayment(ctx, { month: OCT, amount: 5450, dateReceived: "2026-10-05", ...input }, OPTIONS);

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
      "owner@example.com",
      "Logged",
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

  it("records Edited when an existing amount is replaced", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    await pay(ctx, { portionId: "p1", amount: 6000, overwrite: true });
    const log = fake.tabs.get(LOG_TAB)!;
    const last = log[log.length - 1];
    expect(last[7]).toBe("owner@example.com");
    expect(last[8]).toBe("Edited");
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

const AUG = { year: 2026, month: 8 };
const SEP = { year: 2026, month: 9 };

describe("logPayment: overwrite keeps what is recorded", () => {
  it("keeps the tenant and a hand-corrected count, changing only the amount", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p3", amount: 9500, newTenantName: "Gita" });
    fake.tabs.get("Schedule")![5][8] = 7; // the owner corrects the count by hand
    const result = await pay(ctx, { portionId: "p3", amount: 9800, overwrite: true });
    expect(result.entry).toEqual({ tenant: "Gita", count: 7, amount: 9800 });
    expect(cell(fake, "Schedule", "H", 6)).toBe("Gita");
    expect(cell(fake, "Schedule", "I", 6)).toBe(7);
    expect(cell(fake, "Schedule", "J", 6)).toBe(9800);
  });

  it("replaces the tenant and restarts the count when a new tenant is given", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const result = await pay(ctx, {
      portionId: "p1",
      amount: 6000,
      overwrite: true,
      newTenantName: "Hari",
    });
    expect(result.entry).toEqual({ tenant: "Hari", count: 1, amount: 6000 });
  });
});

describe("logPayment: an edit carries what the person saw", () => {
  const ZED = { tenant: "Zed", count: 1, amount: 5100 };

  async function zedLoggedAndUndone() {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p5", amount: ZED.amount, newTenantName: ZED.tenant });
    await undoPayment(ctx, { month: OCT, portionId: "p5", expected: ZED }, OPTIONS);
    return { fake, ctx };
  }

  it("edits the amount when the stored entry is what the person saw", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const result = await pay(ctx, {
      portionId: "p1",
      amount: 6000,
      overwrite: true,
      expected: { tenant: "Asha", count: 4, amount: 5450 },
    });
    expect(result.entry).toEqual({ tenant: "Asha", count: 4, amount: 6000 });
    expect(result.logRow[8]).toBe("Edited");
    expect(cell(fake, "Schedule", "D", 6)).toBe(6000);
  });

  it("refuses a stale edit after someone undid the payment, and writes nothing", async () => {
    const { fake, ctx } = await zedLoggedAndUndone();
    const scheduleBefore = structuredClone(fake.tabs.get("Schedule"));
    const logBefore = structuredClone(fake.tabs.get(LOG_TAB));

    const error = await expectCode(
      pay(ctx, { portionId: "p5", amount: 7100, overwrite: true, expected: ZED }),
      "conflict",
    );

    expect(error.message).toBe(
      "Nothing to edit. Third floor, hall and kitchen has no payment recorded for October 2026 any more. Refresh the page.",
    );
    expect(fake.tabs.get("Schedule")).toEqual(scheduleBefore);
    expect(fake.tabs.get(LOG_TAB)).toEqual(logBefore);
    expect((await getMonthView(ctx, OCT)).cards[4].status).toBe("pending");
  });

  it.each([
    ["tenant", { tenant: "Esha", count: 1, amount: 5100 }],
    ["count", { tenant: "Zed", count: 2, amount: 5100 }],
    ["amount", { tenant: "Zed", count: 1, amount: 5000 }],
  ])("refuses a stale edit when the stored %s differs, and writes nothing", async (_field, seen) => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p5", amount: ZED.amount, newTenantName: ZED.tenant });
    const scheduleBefore = structuredClone(fake.tabs.get("Schedule"));
    const logBefore = structuredClone(fake.tabs.get(LOG_TAB));

    const error = await expectCode(
      pay(ctx, { portionId: "p5", amount: 7100, overwrite: true, expected: seen }),
      "conflict",
    );

    expect(error.message).toBe(
      "Third floor, hall and kitchen for October 2026 was changed by someone else. Refresh the page and try again.",
    );
    expect(fake.tabs.get("Schedule")).toEqual(scheduleBefore);
    expect(fake.tabs.get(LOG_TAB)).toEqual(logBefore);
  });

  it("refuses an edit for a month that has no row yet instead of adding one", async () => {
    const { fake, ctx } = setup();
    await expectCode(
      pay(ctx, {
        portionId: "p1",
        month: { year: 2026, month: 10 },
        amount: 6000,
        overwrite: true,
        expected: { tenant: "Asha", count: 4, amount: 5450 },
      }),
      "conflict",
    );
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
  });
});

describe("logPayment: incomplete data in the target row", () => {
  function sepWithoutCount() {
    const schedule = baseSchedule();
    (schedule[4] as unknown[])[2] = undefined; // Sep p1 count blank, amount still 5450
    return schedule;
  }

  it("refuses to replace a cell that has an amount but no valid count, unless confirmed", async () => {
    const { fake, ctx } = setup(sepWithoutCount());
    const error = await expectCode(
      pay(ctx, { portionId: "p1", month: SEP, amount: 5000 }),
      "conflict",
    );
    expect(error.message).toMatch(/incomplete data in row 5/);
    expect(cell(fake, "Schedule", "D", 5)).toBe(5450);

    const result = await pay(ctx, { portionId: "p1", month: SEP, amount: 5000, overwrite: true });
    expect(result.entry).toEqual({ tenant: "Asha", count: 3, amount: 5000 });
    expect(cell(fake, "Schedule", "C", 5)).toBe(3);
    expect(cell(fake, "Schedule", "D", 5)).toBe(5000);
  });
});

describe("logPayment: total style is read from the row being written", () => {
  it("leaves a formula total alone in an older row when the newest row has a typed total", async () => {
    const schedule = baseSchedule();
    (schedule[4] as unknown[])[16] = 31350; // Sep total typed; Aug total stays a formula
    const { fake, ctx } = setup(schedule);
    await pay(ctx, { portionId: "p4", month: AUG, amount: 8000, newTenantName: "Farah" });
    expect(cell(fake, "Schedule", "Q", 4)).toBe("=D4+G4+J4+M4+P4");
  });

  it("writes a typed total in an older row when the newest row has a formula", async () => {
    const schedule = baseSchedule();
    (schedule[3] as unknown[])[16] = 27150; // Aug total typed; Sep total stays a formula
    const { fake, ctx } = setup(schedule);
    await pay(ctx, { portionId: "p4", month: AUG, amount: 8000, newTenantName: "Farah" });
    expect(cell(fake, "Schedule", "Q", 4)).toBe(35150);
    expect(cell(fake, "Schedule", "Q", 5)).toBe("=D5+G5+J5+M5+P5");
  });
});

describe("logPayment: month rows are added in order", () => {
  it("refuses a month earlier than the last row and changes nothing", async () => {
    const { fake, ctx } = setup();
    const error = await expectCode(
      pay(ctx, { portionId: "p1", month: { year: 2026, month: 7 }, newTenantName: "Zed" }),
      "validation",
    );
    expect(error.message).toMatch(/2026-09 below it/);
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
  });

  it("refuses to skip a month and changes nothing", async () => {
    const { fake, ctx } = setup();
    const error = await expectCode(
      pay(ctx, { portionId: "p1", month: { year: 2026, month: 11 } }),
      "validation",
    );
    expect(error.message).toMatch(/Log 2026-10 first/);
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
    await pay(ctx, { portionId: "p1", month: OCT });
    expect(cell(fake, "Schedule", "A", 6)).toBe("Oct-26");
  });
});

describe("logPayment: month validation", () => {
  it.each([
    [2026.5, 10],
    [2026, 13],
    [2026, 0],
    [1999, 5],
  ])("rejects year %s month %s before touching the sheet", async (year, month) => {
    const { fake, ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p1", month: { year, month } }), "validation");
    expect(fake.tabs.has("Settings")).toBe(false);
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
  });
});

describe("settings through the service", () => {
  it("getSettings creates the tabs on first use and returns the portions", async () => {
    const { fake, ctx } = setup();
    const portions = await getSettings(ctx);
    expect(portions).toHaveLength(5);
    expect(fake.tabs.has("Settings")).toBe(true);
  });

  it("saveSettings applies an update and returns the fresh list", async () => {
    const { ctx } = setup();
    const portions = await saveSettings(ctx, [
      { id: "p2", name: "Rear room", cycleLength: null, hikePercent: 3 },
    ]);
    expect(portions[1]).toMatchObject({ id: "p2", name: "Rear room", cycleLength: null, hikePercent: 3 });
    expect(portions[0].name).toBe("First floor, single bedroom");
  });

  it("saveSettings rejects bad values with a validation error", async () => {
    const { ctx } = setup();
    await expectCode(
      saveSettings(ctx, [{ id: "p1", name: "", cycleLength: 11, hikePercent: 5 }]),
      "validation",
    );
  });
});

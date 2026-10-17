import { describe, expect, it } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
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
import { appendTenancy } from "@/lib/sheets/tenants-store";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid, TOTAL_HEADER } from "../support/fixtures";

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
    expect(error.details).toEqual({ existingAmount: 5450, existingTenant: "Asha", existingCount: 4 });
  });

  it("says in plain words what is already recorded: the amount as the screen shows it, and the month by its name", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const error = await expectCode(pay(ctx, { portionId: "p1", amount: 6000 }), "conflict");
    expect(error.message).toBe("First floor, single bedroom already has ₹ 5,450 recorded for October 2026.");
    expect(error.message).not.toMatch(/\d{4}-\d{2}/);
  });

  describe("a replace after the duplicate warning", () => {
    /** The warning for p1 in October, and the entry it named, as the sheet sends it back with the Replace. */
    async function warned() {
      const { fake, ctx } = setup();
      await pay(ctx, { portionId: "p1" });
      const warning = await expectCode(pay(ctx, { portionId: "p1", amount: 6000 }), "conflict");
      const expected = {
        tenant: String(warning.details!.existingTenant),
        count: Number(warning.details!.existingCount),
        amount: Number(warning.details!.existingAmount),
      };
      return { fake, ctx, expected };
    }

    it("goes through when the entry is still what the warning named", async () => {
      const { fake, ctx, expected } = await warned();
      const result = await pay(ctx, { portionId: "p1", amount: 6000, overwrite: true, expected });
      expect(result.entry).toEqual({ tenant: "Asha", count: 4, amount: 6000 });
      expect(cell(fake, "Schedule", "D", 6)).toBe(6000);
    });

    it("is refused when someone changed the amount after the warning, and writes nothing", async () => {
      const { fake, ctx, expected } = await warned();
      fake.tabs.get("Schedule")![5][3] = 5700; // another person's edit in the Sheet itself
      const logBefore = structuredClone(fake.tabs.get(LOG_TAB));
      const error = await expectCode(
        pay(ctx, { portionId: "p1", amount: 6000, overwrite: true, expected }),
        "conflict",
      );
      expect(error.message).toMatch(/was changed by someone else/);
      expect(cell(fake, "Schedule", "D", 6)).toBe(5700);
      expect(fake.tabs.get(LOG_TAB)).toEqual(logBefore);
    });

    it("is refused when the count or the tenant changed after the warning", async () => {
      for (const [col, value] of [[2, 9], [1, "Someone Else"]] as const) {
        const { fake, ctx, expected } = await warned();
        fake.tabs.get("Schedule")![5][col] = value;
        await expectCode(pay(ctx, { portionId: "p1", amount: 6000, overwrite: true, expected }), "conflict");
      }
    });

    it("is refused when the entry was undone after the warning, instead of recreating it", async () => {
      const { fake, ctx, expected } = await warned();
      await undoPayment(ctx, { month: OCT, portionId: "p1", expected }, OPTIONS);
      const error = await expectCode(
        pay(ctx, { portionId: "p1", amount: 6000, overwrite: true, expected }),
        "conflict",
      );
      expect(error.message).toMatch(/no payment recorded/);
      expect(cell(fake, "Schedule", "D", 6)).toBe("");
    });
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

describe("logPayment: a row below the table that is not empty", () => {
  it("refuses to add the month there, and says what to do in plain words", async () => {
    const schedule = baseSchedule();
    schedule.push(["A note under the table"]);
    const { ctx } = setup(schedule);
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "conflict");
    expect(error.message).toBe(
      "Row 6 of the Schedule tab in your Sheet is below the last month but not empty, so a new month row cannot be added there. If someone else just added this month, tap another tab at the bottom of the screen and come back, then try again.",
    );
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
    // An error it does not know may have come back after the row was added, so it is not tried again
    // (log-resilience.test.ts covers the refusals that are).
    expect(fake.calls.filter((c) => c === "appendRow")).toHaveLength(1);

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

  it("names the field in the details of an amount that is out of range, so the screen can show it beside the field", async () => {
    const { ctx } = setup();
    const error = await expectCode(pay(ctx, { portionId: "p1", amount: 0 }), "validation");
    expect(error.message).toBe("Amount must be whole rupees, from ₹ 1 to ₹ 1,00,00,000.");
    expect(error.details).toEqual({ field: "amount" });
  });

  it("names the field when a portion with no tenant is given no tenant name", async () => {
    const { ctx } = setup();
    const error = await expectCode(pay(ctx, { portionId: "p4" }), "validation");
    expect(error.message).toBe("This portion has no tenant yet. Enter a tenant name.");
    expect(error.details).toEqual({ field: "newTenantName" });
  });

  it("says in plain words that a portion is not in Settings any more, without its id, for a payment and for an undo", async () => {
    const { ctx } = setup();
    const message = "That portion isn't in your Settings any more. Tap another tab at the bottom of the screen and come back, then check the cards.";
    const log = await expectCode(pay(ctx, { portionId: "p9" }), "validation");
    expect(log.message).toBe(message);
    const undo = await expectCode(
      undoPayment(ctx, { month: OCT, portionId: "p9", expected: { tenant: "Asha", count: 4, amount: 5450 } }, OPTIONS),
      "validation",
    );
    expect(undo.message).toBe(message);
    for (const error of [log, undo]) expect(error.message).not.toContain("p9");
  });

  it("rejects an impossible date, an empty tenant name, and an unknown portion", async () => {
    const { ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p1", dateReceived: "2026-02-30" }), "validation");
    await expectCode(pay(ctx, { portionId: "p4", newTenantName: "  " }), "validation");
    await expectCode(pay(ctx, { portionId: "p9" }), "validation");
  });

  it.each(["1999-12-31", "2101-01-01", "1900-01-01", "2026-10-5"])(
    "rejects the date received %s",
    async (dateReceived) => {
      const { fake, ctx } = setup();
      await expectCode(pay(ctx, { portionId: "p1", dateReceived }), "validation");
      expect(fake.calls).toEqual([]);
    },
  );

  it.each(["2000-01-01", "2100-12-31"])("accepts the date received %s", async (dateReceived) => {
    const { ctx } = setup();
    expect((await pay(ctx, { portionId: "p1", dateReceived })).logRow[6]).toBe(dateReceived);
  });

  it.each(["Hari\nKumar", "Hari\tKumar", "Hari\u0000", "x".repeat(61)])(
    "rejects the new tenant name %j",
    async (newTenantName) => {
      const { fake, ctx } = setup();
      await expectCode(pay(ctx, { portionId: "p4", newTenantName }), "validation");
      expect(fake.calls).toEqual([]);
    },
  );

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
      "Nothing to edit. Third floor, hall and kitchen has no payment recorded for October 2026 any more. Tap another tab at the bottom of the screen and come back, then check the card.",
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
      "Third floor, hall and kitchen for October 2026 was changed by someone else. Tap another tab at the bottom of the screen and come back, then try again.",
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
    // Months are named in words, and the message says what to do.
    expect(error.message).toBe(
      "Can't add July 2026: the Schedule already has September 2026 below it. Add the row for July 2026 in your Sheet, in date order, then try again.",
    );
    expect(error.message).not.toMatch(/d{4}-d{2}/);
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
  });

  it("refuses to skip a month and changes nothing", async () => {
    const { fake, ctx } = setup();
    const error = await expectCode(
      pay(ctx, { portionId: "p1", month: { year: 2026, month: 11 } }),
      "validation",
    );
    expect(error.message).toBe(
      "Can't add November 2026 yet: the Schedule's last month is September 2026. Log October 2026 first, or add the row for November 2026 in your Sheet.",
    );
    expect(error.message).not.toMatch(/d{4}-d{2}/);
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

  it("saveSettings rejects a portion name with a line break or another control character", async () => {
    const { ctx } = setup();
    for (const name of ["Rear\nroom", "Rear\troom", "Rear\u0000room"]) {
      await expectCode(saveSettings(ctx, [{ id: "p1", name, cycleLength: 11, hikePercent: 5 }]), "validation");
    }
  });
});

describe("a portion whose id is also a property name", () => {
  // Settings ids are typed by hand; `__proto__` and `constructor` are allowed and must behave as plain ids.
  function oddSetup() {
    const settings = settingsGrid();
    settings[1][0] = "__proto__";
    settings[2][0] = "constructor";
    const fake = new FakeGateway({ Schedule: baseSchedule(), Settings: settings });
    const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
    return { fake, ctx };
  }

  it("shows, logs and undoes a payment for each of them", async () => {
    const { fake, ctx } = oddSetup();
    const before = await getMonthView(ctx, OCT);
    expect(before.cards.map((card) => card.portionId).slice(0, 2)).toEqual(["__proto__", "constructor"]);
    expect(before.cards[0]).toMatchObject({ status: "pending", next: { tenant: "Asha", count: 4 } });

    await pay(ctx, { portionId: "__proto__" });
    await pay(ctx, { portionId: "constructor", amount: 13300 });
    expect(cell(fake, "Schedule", "B", 6)).toBe("Asha");
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(cell(fake, "Schedule", "E", 6)).toBe("Bala");
    expect(cell(fake, "Schedule", "G", 6)).toBe(13300);

    const after = await getMonthView(ctx, OCT);
    expect(after.cards[0]).toMatchObject({ status: "paid", entry: { amount: 5450 } });
    expect(after.cards[1]).toMatchObject({ status: "paid", entry: { amount: 13300 } });
    expect(after.cards[2].status).toBe("pending");
    expect(after.paidCount).toBe(2);

    await undoPayment(
      ctx,
      { month: OCT, portionId: "__proto__", expected: { tenant: "Asha", count: 4, amount: 5450 } },
      OPTIONS,
    );
    expect(cell(fake, "Schedule", "D", 6)).toBe("");
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("pending");
  });
});

describe("logPayment: a portion whose tenant has moved out", () => {
  const NOV = { year: 2026, month: 11 };
  const DEC = { year: 2026, month: 12 };
  const VACANT_MESSAGE =
    "First floor, single bedroom is vacant in November 2026: Asha moved out on 20 Oct 2026. Tap another tab at the bottom of the screen and come back, then add the new tenant with New tenant.";

  function asha(overrides: Partial<Omit<Tenancy, "rowNumber">> = {}): Omit<Tenancy, "rowNumber"> {
    return {
      id: "t-asha",
      portionId: "p1",
      tenant: "Asha",
      phone: "",
      moveIn: "2026-01-15",
      agreementEnd: "",
      advance: null,
      advanceDate: "",
      advanceStatus: null,
      refund: null,
      deductions: null,
      notes: "",
      moveOut: "2026-10-20",
      updatedBy: "owner@example.com",
      updatedAt: "2026-10-20T05:00:00.000Z",
      ...overrides,
    };
  }

  /** October is paid by Asha (p1) through the app, and the Tenants tab says she moved out on `moveOut`. */
  async function afterAsha(overrides: Partial<Omit<Tenancy, "rowNumber">> = {}) {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    await appendTenancy(fake, asha(overrides));
    fake.calls = [];
    return { fake, ctx };
  }

  const snapshotOf = (fake: FakeGateway) => structuredClone([...fake.tabs.entries()]);

  it("refuses a plain log for a vacant month, in plain words, and writes nothing", async () => {
    const { fake, ctx } = await afterAsha();
    const before = snapshotOf(fake);
    const error = await expectCode(pay(ctx, { portionId: "p1", month: NOV }), "conflict");
    expect(error.message).toBe(VACANT_MESSAGE);
    expect(snapshotOf(fake)).toEqual(before);
    expect(fake.calls.filter((call) => ["updateValues", "appendRow", "cloneRow", "addTab"].includes(call))).toEqual([]);
  });

  it("refuses it later in the vacancy too, and when the request says to replace", async () => {
    const { ctx } = await afterAsha();
    const december = await expectCode(pay(ctx, { portionId: "p1", month: DEC }), "conflict");
    expect(december.message).toContain("is vacant in December 2026: Asha moved out on 20 Oct 2026.");
    await expectCode(pay(ctx, { portionId: "p1", month: NOV, overwrite: true }), "conflict");
  });

  it("says a payment that is not there to edit is not there, as it always did", async () => {
    const { ctx } = await afterAsha();
    const error = await expectCode(
      pay(ctx, { portionId: "p1", month: NOV, overwrite: true, expected: { tenant: "Asha", count: 4, amount: 5450 } }),
      "conflict",
    );
    expect(error.message).toMatch(/^Nothing to edit\./);
  });

  it("leaves every other portion alone", async () => {
    const { ctx } = await afterAsha();
    expect((await pay(ctx, { portionId: "p2", month: NOV, amount: 13335 })).entry).toEqual({ tenant: "Bala", count: 1, amount: 13335 });
  });

  it("shows the portion as vacant in the month view, with nothing due for it", async () => {
    const { ctx } = await afterAsha();
    const view = await getMonthView(ctx, NOV);
    expect(view.cards[0]).toMatchObject({ status: "vacant", vacancy: { since: "2026-10-20", previousTenant: "Asha" } });
    expect(view.due).toBe(13335 + 9000 + 5100);
  });

  it("lets a new tenant start on a vacant portion, at payment 1, and the next month is pending for them", async () => {
    const { fake, ctx } = await afterAsha();
    const result = await pay(ctx, { portionId: "p1", month: NOV, amount: 6000, newTenantName: "Hari", dateReceived: "2026-11-03" });
    expect(result.entry).toEqual({ tenant: "Hari", count: 1, amount: 6000 });
    expect(cell(fake, "Schedule", "B", 7)).toBe("Hari");
    expect(cell(fake, "Schedule", "C", 7)).toBe(1);
    expect(cell(fake, "Schedule", "D", 7)).toBe(6000);
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1]).toEqual([
      "2026-10-05T04:30:00.000Z", "2026-11", "First floor, single bedroom", "Hari", 6000, 1, "2026-11-03", "owner@example.com", "Logged",
    ]);

    const november = await getMonthView(ctx, NOV);
    expect(november.cards[0]).toMatchObject({ status: "paid", entry: { tenant: "Hari", count: 1 }, vacancy: null });
    const december = await getMonthView(ctx, DEC);
    expect(december.cards[0]).toMatchObject({
      status: "pending",
      next: { tenant: "Hari", count: 2, suggestedAmount: 6000 },
      vacancy: null,
    });
    // and a plain log for December is no longer refused
    expect((await pay(ctx, { portionId: "p1", month: DEC, amount: 6000 })).entry).toEqual({ tenant: "Hari", count: 2, amount: 6000 });
  });

  it("lets the same name start again: rent logged after the move-out says they stayed", async () => {
    const { ctx } = await afterAsha();
    await pay(ctx, { portionId: "p1", month: NOV, amount: 5450, newTenantName: "Asha" });
    expect((await getMonthView(ctx, DEC)).cards[0]).toMatchObject({ status: "pending", next: { tenant: "Asha", count: 2 } });
  });

  describe("the owner's logging, unchanged when nobody has a move-out", () => {
    it("logs a plain payment for the next month with an open tenancy on file", async () => {
      const { fake, ctx } = await afterAsha({ moveOut: "" });
      const result = await pay(ctx, { portionId: "p1", month: NOV });
      expect(result.entry).toEqual({ tenant: "Asha", count: 5, amount: 5450 });
      expect(cell(fake, "Schedule", "B", 7)).toBe("Asha");
      expect(cell(fake, "Schedule", "C", 7)).toBe(5);
    });

    it("logs a plain payment with no tenancy rows at all", async () => {
      const { ctx } = setup();
      await pay(ctx, { portionId: "p1" });
      expect((await pay(ctx, { portionId: "p1", month: NOV })).entry).toEqual({ tenant: "Asha", count: 5, amount: 5450 });
    });

    it("logs a plain payment when the move-out is not a date", async () => {
      const { ctx } = await afterAsha({ moveOut: "soon" });
      expect((await pay(ctx, { portionId: "p1", month: NOV })).entry).toEqual({ tenant: "Asha", count: 5, amount: 5450 });
    });
  });

  it("still takes a plain payment for the month the tenant left in, when they moved out after its 1st", async () => {
    // moved out 2 November: November is due, December is vacant
    const { ctx } = await afterAsha({ moveOut: "2026-11-02" });
    expect((await pay(ctx, { portionId: "p1", month: NOV })).entry).toEqual({ tenant: "Asha", count: 5, amount: 5450 });
  });
});

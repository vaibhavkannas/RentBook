import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { parseSchedule } from "@/lib/sheets/schedule";
import { getMonthView, logPayment, type SheetsContext } from "@/lib/sheets/service";
import { inferPortions, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS, SCHEDULE_HEADERS, TOTAL_HEADER } from "../support/fixtures";

const OCT = { year: 2026, month: 10 };

function setup(schedule: unknown[][]) {
  const fake = new FakeGateway({ Schedule: schedule });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

const pay = (ctx: SheetsContext, portionId: string, amount = 5450) =>
  logPayment(ctx, { month: OCT, portionId, amount, dateReceived: "2026-10-05" }, { now: new Date(), retryDelayMs: 0 });

describe("header mapping never guesses", () => {
  it("accepts 'Tenant 2' style headers and finds all five portions", () => {
    const headers = ["Month", ...[1, 2, 3, 4, 5].flatMap((n) => {
      const s = n === 1 ? "" : ` ${n}`;
      return [`Tenant${s}`, `Count${s}`, `Amount${s}`];
    }), TOTAL_HEADER];
    expect(inferPortions(headers).map((p) => p.tenantHeader)).toEqual([
      "Tenant", "Tenant 2", "Tenant 3", "Tenant 4", "Tenant 5",
    ]);
  });

  it("refuses repeated headers before creating any tab", async () => {
    const schedule = baseSchedule();
    schedule[2] = ["Month", ...Array(5).fill(["Tenant", "Count", "Amount"]).flat(), TOTAL_HEADER];
    const { fake, ctx } = setup(schedule);
    await expect(getMonthView(ctx, OCT)).rejects.toThrow(/appears more than once/);
    expect(fake.tabs.has(SETTINGS_TAB)).toBe(false);
  });

  it("refuses a Tenant-like header it cannot pair instead of skipping it", () => {
    expect(() => inferPortions(["Month", "Tenant", "Count", "Amount", "Tenant (1F double)", "Count", "Amount"]))
      .toThrow(AppError);
  });

  it("refuses two Settings rows that point at the same columns, and writes nothing", async () => {
    const shared = PORTIONS.map((p) => (p.id === "p3" ? { ...p, tenantHeader: "Tenant", countHeader: "Count", amountHeader: "Amount" } : p));
    expect(() => parseSchedule(baseSchedule(), shared, TOTAL_HEADER)).toThrow(/Settings tab/);

    const { fake, ctx } = setup(baseSchedule());
    await getMonthView(ctx, OCT);
    fake.tabs.get(SETTINGS_TAB)![3] = ["p3", "Second floor", "Tenant", "Count", "Amount", 11, 5];
    await expect(pay(ctx, "p3")).rejects.toThrow(/Settings tab/);
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
    expect(SCHEDULE_HEADERS[1]).toBe("Tenant");
  });
});

describe("a new month row never carries last month's values", () => {
  it("blanks a notes column and a portion missing from Settings, keeps extra formulas", async () => {
    const schedule = baseSchedule();
    (schedule[2] as unknown[]).push("Notes", "Net");
    (schedule[3] as unknown[]).push("old note", "=Q4-100");
    (schedule[4] as unknown[]).push("paid late", "=Q5-100");
    const { fake, ctx } = setup(schedule);
    await getMonthView(ctx, OCT);
    fake.tabs.get(SETTINGS_TAB)!.pop(); // owner removed p5 from Settings
    await pay(ctx, "p1");
    const row6 = fake.tabs.get("Schedule")![5];
    expect(row6.slice(0, 4)).toEqual(["Oct-26", "Asha", 4, 5450]);
    expect([cell(fake, "Schedule", "N", 6), cell(fake, "Schedule", "O", 6), cell(fake, "Schedule", "P", 6)]).toEqual([undefined, undefined, undefined]);
    expect(cell(fake, "Schedule", "Q", 6)).toBe("=D6+G6+J6+M6+P6");
    expect(cell(fake, "Schedule", "R", 6)).toBeUndefined();
    expect(cell(fake, "Schedule", "S", 6)).toBe("=Q6-100");
  });
});

import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  getMonthView,
  logPayment,
  undoPayment,
  type LogPaymentInput,
  type SheetsContext,
} from "@/lib/sheets/service";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const NOW = new Date("2026-10-05T04:30:00Z");
const OCT = { year: 2026, month: 10 };
const NOV = { year: 2026, month: 11 };
const OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "member@example.com" };

function setup(schedule: unknown[][] = baseSchedule()) {
  const fake = new FakeGateway({ Schedule: schedule });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { portionId: string }) =>
  logPayment(ctx, { month: OCT, amount: 5450, dateReceived: "2026-10-05", ...input }, OPTIONS);

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const code = async (promise: Promise<unknown>) => (await rejection(promise)).code;

const UNDONE_ROW = [
  "2026-10-05T04:30:00.000Z",
  "2026-10",
  "First floor, single bedroom",
  "Asha",
  5450,
  4,
  "",
  "member@example.com",
  "Undone",
];

const blank = (value: unknown) => value === undefined || value === "";

describe("undoPayment", () => {
  it("clears the portion's cells, keeps a formula total, and logs Undone", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    fake.calls = [];

    const result = await undoPayment(
      ctx,
      { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
      OPTIONS,
    );

    // All the cleared cells go out in a single write.
    expect(fake.calls.filter((call) => call === "updateValues")).toHaveLength(1);
    expect(result).toMatchObject({ removed: { tenant: "Asha", count: 4, amount: 5450 }, logWritten: true });
    expect(blank(cell(fake, "Schedule", "B", 6))).toBe(true);
    expect(blank(cell(fake, "Schedule", "C", 6))).toBe(true);
    expect(blank(cell(fake, "Schedule", "D", 6))).toBe(true);
    expect(cell(fake, "Schedule", "Q", 6)).toBe("=D6+G6+J6+M6+P6");
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("pending");

    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1]).toEqual(UNDONE_ROW);
    expect(result.logRow).toEqual(UNDONE_ROW);
  });

  it("rewrites a typed total without the undone amount", async () => {
    const schedule = baseSchedule();
    schedule[3][16] = 18150;
    schedule[4][16] = 27250;
    const { fake, ctx } = setup(schedule);
    await pay(ctx, { portionId: "p1" });
    await pay(ctx, { portionId: "p2", amount: 13300 });
    expect(cell(fake, "Schedule", "Q", 6)).toBe(18750);

    await undoPayment(
      ctx,
      { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
      OPTIONS,
    );
    expect(cell(fake, "Schedule", "Q", 6)).toBe(13300);
    expect(blank(cell(fake, "Schedule", "B", 6))).toBe(true);
    expect(blank(cell(fake, "Schedule", "C", 6))).toBe(true);
    expect(blank(cell(fake, "Schedule", "D", 6))).toBe(true);
    // The other portion's entry is untouched.
    expect(cell(fake, "Schedule", "G", 6)).toBe(13300);
  });

  it.each([
    ["tenant", { tenant: "Zed", count: 4, amount: 5450 }],
    ["count", { tenant: "Asha", count: 5, amount: 5450 }],
    ["amount", { tenant: "Asha", count: 4, amount: 9999 }],
  ])("refuses when the stored %s differs from what the person saw", async (_field, expected) => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const scheduleBefore = structuredClone(fake.tabs.get("Schedule"));
    const logBefore = structuredClone(fake.tabs.get(LOG_TAB));

    const error = await rejection(
      undoPayment(ctx, { month: OCT, portionId: "p1", expected }, OPTIONS),
    );

    expect(error.code).toBe("conflict");
    expect(error.message).toBe(
      "First floor, single bedroom for October 2026 was changed by someone else. Refresh the page and try again.",
    );
    expect(fake.tabs.get("Schedule")).toEqual(scheduleBefore);
    expect(fake.tabs.get(LOG_TAB)).toEqual(logBefore);
  });

  it("refuses when there is nothing to undo", async () => {
    const { ctx } = setup();
    const error = await rejection(
      undoPayment(
        ctx,
        { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
        OPTIONS,
      ),
    );
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(
      "Nothing to undo. First floor, single bedroom has no payment recorded for October 2026 any more. Refresh the page.",
    );
  });

  it("refuses to undo a month when a later month has an entry", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    await logPayment(ctx, { month: NOV, portionId: "p1", amount: 5450, dateReceived: "2026-11-05" }, OPTIONS);
    const before = structuredClone(fake.tabs.get("Schedule"));
    const failure = await code(
      undoPayment(
        ctx,
        { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
        OPTIONS,
      ),
    );
    expect(failure).toBe("conflict");
    expect(fake.tabs.get("Schedule")).toEqual(before);
  });

  it("undoes a new tenant's first payment and returns the portion to its earlier state", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p4", newTenantName: "Dev", amount: 7000 });
    await undoPayment(
      ctx,
      { month: OCT, portionId: "p4", expected: { tenant: "Dev", count: 1, amount: 7000 } },
      OPTIONS,
    );
    expect((await getMonthView(ctx, OCT)).cards[3].status).toBe("needs-tenant");
  });

  it("keeps the cleared cells when only the log write fails", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    fake.failOn.add("appendRow");
    fake.calls = [];
    const result = await undoPayment(
      ctx,
      { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
      OPTIONS,
    );
    expect(result.logWritten).toBe(false);
    expect(result.logRow).toEqual(UNDONE_ROW);
    expect(fake.calls.filter((call) => call === "appendRow")).toHaveLength(3);
    expect(blank(cell(fake, "Schedule", "D", 6))).toBe(true);
  });

  it("rejects a month that is not a real month and changes nothing", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const scheduleBefore = structuredClone(fake.tabs.get("Schedule"));
    const failure = await code(
      undoPayment(
        ctx,
        {
          month: { year: 2026, month: 13 },
          portionId: "p1",
          expected: { tenant: "Asha", count: 4, amount: 5450 },
        },
        OPTIONS,
      ),
    );
    expect(failure).toBe("validation");
    expect(fake.tabs.get("Schedule")).toEqual(scheduleBefore);
  });

  it("rejects a portion that does not exist and changes nothing", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const scheduleBefore = structuredClone(fake.tabs.get("Schedule"));
    const failure = await code(
      undoPayment(
        ctx,
        { month: OCT, portionId: "nope", expected: { tenant: "Asha", count: 4, amount: 5450 } },
        OPTIONS,
      ),
    );
    expect(failure).toBe("validation");
    expect(fake.tabs.get("Schedule")).toEqual(scheduleBefore);
  });
});

import { describe, expect, it } from "vitest";
import { getMonthView, logPayment, type LogPaymentInput, type SheetsContext } from "@/lib/sheets/service";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

// The owner's example, end to end through the real data path: log a payment into the in-memory Sheet, read the next month back
// through getMonthView, which is what the month screen and the payment form's prefilled amount (card.next.suggestedAmount) come
// from. The service itself computes no amount: the amount is what the form sent.

const NOW = new Date("2026-10-05T04:30:00Z");
const OCT = { year: 2026, month: 10 };
const NOV = { year: 2026, month: 11 };
const DEC = { year: 2026, month: 12 };
const OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "owner@example.com" };

function setup() {
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { portionId: string; amount: number }) =>
  logPayment(ctx, { month: OCT, dateReceived: "2026-10-05", ...input }, OPTIONS);

const cardOf = async (ctx: SheetsContext, month: { year: number; month: number }, id: string) =>
  (await getMonthView(ctx, month)).cards.find((card) => card.portionId === id)!;

describe("an amount agreed for one month, through logging and reading back", () => {
  it("is the owner's example: October paid 5,000 against 5,450, then November still suggests 5,450 and paid at 5,450 is exact", async () => {
    const { ctx } = setup();
    // before: October's suggestion is the 5,450 of the cycle
    expect(await cardOf(ctx, OCT, "p1")).toMatchObject({ status: "pending", next: { suggestedAmount: 5450 } });

    await pay(ctx, { portionId: "p1", amount: 5000 });
    const october = await cardOf(ctx, OCT, "p1");
    // the agreed amount still says how it compares with the rent, as the card always did
    expect(october).toMatchObject({ status: "paid", entry: { count: 4, amount: 5000 }, rentReference: 5450, rentDifference: -450 });

    // the form for November is prefilled with the card's suggestion: the true rent, not the 5,000
    const november = await cardOf(ctx, NOV, "p1");
    expect(november).toMatchObject({
      status: "pending",
      next: { count: 5, suggestedAmount: 5450, previousAmount: 5450, startsNewCycle: false },
      rentReference: 5450,
    });

    await pay(ctx, { portionId: "p1", month: NOV, amount: 5450, dateReceived: "2026-11-05" });
    expect(await cardOf(ctx, NOV, "p1")).toMatchObject({ status: "paid", rentReference: 5450, rentDifference: 0 });
    // the month summary of October counts the rent, not the amount, as due, and says the difference
    expect(await getMonthView(ctx, OCT)).toMatchObject({ received: 5000, difference: -450 });
  });

  it("writes only what the form sent: the Sheet holds the agreed amount and the count, and nothing about a rent", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1", amount: 5000 });
    expect([cell(fake, "Schedule", "B", 6), cell(fake, "Schedule", "C", 6), cell(fake, "Schedule", "D", 6)]).toEqual(["Asha", 4, 5000]);
  });
});

describe("the first payment of a new cycle, through logging and reading back", () => {
  it("takes a hike the owner rounded as the rent: no difference, and the next month and the next cycle work from it", async () => {
    const { ctx } = setup();
    // Bala's cycle ended in September (payment 11 at 12,700): October is suggested with the hike, 13,335, "was 12,700"
    expect(await cardOf(ctx, OCT, "p2")).toMatchObject({ next: { count: 1, suggestedAmount: 13335, previousAmount: 12700, startsNewCycle: true } });

    await pay(ctx, { portionId: "p2", amount: 13300 });
    expect(await cardOf(ctx, OCT, "p2")).toMatchObject({ status: "paid", entry: { count: 1, amount: 13300 }, rentReference: 13300, rentDifference: 0 });
    expect(await getMonthView(ctx, OCT)).toMatchObject({ difference: 0 });

    // November and December are suggested at 13,300, and an amount agreed for November does not move December
    expect(await cardOf(ctx, NOV, "p2")).toMatchObject({ next: { count: 2, suggestedAmount: 13300, previousAmount: 13300 } });
    await pay(ctx, { portionId: "p2", month: NOV, amount: 12000, dateReceived: "2026-11-05" });
    expect(await cardOf(ctx, NOV, "p2")).toMatchObject({ rentReference: 13300, rentDifference: -1300 });
    expect(await cardOf(ctx, DEC, "p2")).toMatchObject({ next: { count: 3, suggestedAmount: 13300 } });
  });

  it("works the next cycle's hike from the first payment's amount, after eleven payments", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p2", amount: 14000 });
    // payments 2 to 11, with an agreed amount in the middle
    for (let step = 1; step <= 10; step++) {
      const at = { year: 2026 + Math.floor((9 + step) / 12), month: ((9 + step) % 12) + 1 };
      await pay(ctx, { portionId: "p2", month: at, amount: step === 4 ? 9000 : 14000, dateReceived: "2026-11-05" });
    }
    // October 2026 is payment 1, so August 2027 is payment 11 and September 2027 starts the next cycle
    const next = await cardOf(ctx, { year: 2027, month: 8 }, "p2");
    expect(next.entry).toMatchObject({ count: 11 });
    expect(await cardOf(ctx, { year: 2027, month: 9 }, "p2")).toMatchObject({
      status: "pending",
      next: { count: 1, startsNewCycle: true, previousAmount: 14000, suggestedAmount: 14700 },
    });
  });
});

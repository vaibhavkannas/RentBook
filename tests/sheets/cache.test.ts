import { describe, expect, it } from "vitest";
import {
  getMonthView,
  logPayment,
  saveSettings,
  undoPayment,
  withSnapshotCache,
  type SheetsContext,
} from "@/lib/sheets/service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const OCT = { year: 2026, month: 10 };
const OPTIONS = { now: new Date("2026-10-05T04:30:00Z"), retryDelayMs: 0, loggedBy: "owner@example.com" };

function setup() {
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext);
  const reads = () => fake.calls.filter((c) => c === "getValues").length;
  return { fake, ctx, reads };
}

describe("cached month views", () => {
  it("reads the Sheet once for repeated views of any month", async () => {
    const { ctx, reads } = setup();
    await getMonthView(ctx, OCT);
    const afterFirst = reads();
    await getMonthView(ctx, { year: 2026, month: 9 });
    await getMonthView(ctx, { year: 2026, month: 11 });
    expect(reads()).toBe(afterFirst);
  });

  it("shows a payment straight away after logging it", async () => {
    const { ctx } = setup();
    await getMonthView(ctx, OCT);
    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("paid");
  });

  it("shows an undo straight away", async () => {
    const { ctx } = setup();
    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("paid");
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } }, OPTIONS);
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("pending");
  });

  it("shows new settings straight away", async () => {
    const { ctx } = setup();
    await getMonthView(ctx, OCT);
    await saveSettings(ctx, [{ id: "p1", name: "Renamed", cycleLength: 11, hikePercent: 5 }]);
    expect((await getMonthView(ctx, OCT)).cards[0].name).toBe("Renamed");
  });

  it("writes never use a stale snapshot", async () => {
    const { fake, ctx } = setup();
    await getMonthView(ctx, OCT);
    // Someone else logs through a second context sharing the same Sheet.
    const other = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext;
    await logPayment(other, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    await expect(
      logPayment(ctx, { month: OCT, portionId: "p1", amount: 1, dateReceived: "2026-10-05" }, OPTIONS),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("a caller can demand data newer than a given time", async () => {
    const { fake, ctx } = setup();
    await getMonthView(ctx, OCT);
    const other = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext;
    await logPayment(other, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("pending");
    expect((await getMonthView(ctx, OCT, { minFetchedAt: Date.now() + 1 })).cards[0].status).toBe("paid");
  });
});

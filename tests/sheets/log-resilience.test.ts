import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { AppError, configError, rateLimited, unavailable } from "@/lib/errors";
import type { CellWrite, ValueRender } from "@/lib/sheets/gateway";
import {
  getMonthView,
  logPayment,
  retryLogRow,
  undoPayment,
  type LogPaymentInput,
  type SheetsContext,
} from "@/lib/sheets/service";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const NOW = new Date("2026-10-05T04:30:00Z");
const OCT = { year: 2026, month: 10 };
const OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "owner@example.com" };
const SEPT_P1 = { month: { year: 2026, month: 9 }, portionId: "p1", expected: { tenant: "Asha", count: 3, amount: 5450 } };

/**
 * A FakeGateway whose read-back after a write can fail, and whose appends can fail in the ways Google does: a
 * refusal that did nothing, or an error that came back after the row had already been added.
 */
class FlakyGateway extends FakeGateway {
  /** The failure for the first read after the next write (the read-back), then it is cleared. */
  readBackFailure: unknown = null;
  private written = false;
  /** One failure per append, in order. Appends after the list is used up work. */
  appendFailures: unknown[] = [];
  /** The failing appends add the row before they fail, as when the answer is lost on the way back. */
  appendLands = false;

  async updateValues(writes: CellWrite[]) {
    await super.updateValues(writes);
    if (this.readBackFailure) this.written = true;
  }

  async getValues(tab: string, a1: string, render: ValueRender) {
    if (this.written) {
      this.written = false;
      const failure = this.readBackFailure;
      this.readBackFailure = null;
      this.calls.push("getValues");
      throw failure;
    }
    return super.getValues(tab, a1, render);
  }

  async appendRow(tab: string, row: unknown[]) {
    const failure = this.appendFailures.shift();
    if (failure === undefined) return super.appendRow(tab, row);
    if (this.appendLands) await super.appendRow(tab, row);
    else this.calls.push("appendRow");
    throw failure;
  }
}

async function ready() {
  const fake = new FlakyGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getMonthView(ctx, OCT);
  fake.calls = [];
  return { fake, ctx };
}

const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { portionId: string }) =>
  logPayment(ctx, { month: OCT, amount: 5450, dateReceived: "2026-10-05", ...input }, OPTIONS);

const logRows = (fake: FakeGateway) => fake.tabs.get(LOG_TAB)!.slice(1);
const appends = (fake: FakeGateway) => fake.calls.filter((call) => call === "appendRow").length;

let log: MockInstance<typeof console.error>;
beforeEach(() => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  vi.useRealTimers();
});

describe("when the read-back of a written payment cannot be done", () => {
  const FAILURES: [string, () => unknown][] = [
    ["Google not responding", () => unavailable()],
    ["Google limiting requests", () => rateLimited()],
    ["a lost connection", () => new Error("socket hang up")],
    ["a sheet structure problem", () => configError("The key was rejected")],
  ];

  it.each(FAILURES)("a log still gets its Payments Log row and its normal result (%s)", async (_name, failure) => {
    const { fake, ctx } = await ready();
    fake.readBackFailure = failure();
    const result = await pay(ctx, { portionId: "p1" });

    expect(result).toMatchObject({ entry: { tenant: "Asha", count: 4, amount: 5450 }, logWritten: true });
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(logRows(fake)).toEqual([result.logRow]);
    expect(fake.calls.slice(fake.calls.lastIndexOf("updateValues"))).toEqual(["updateValues", "getValues", "appendRow"]);
  });

  it.each(FAILURES)("an undo still gets its Payments Log row and its normal result (%s)", async (_name, failure) => {
    const { fake, ctx } = await ready();
    fake.readBackFailure = failure();
    const result = await undoPayment(ctx, SEPT_P1, OPTIONS);

    expect(result).toMatchObject({ removed: SEPT_P1.expected, logWritten: true });
    expect(cell(fake, "Schedule", "D", 5)).toBe("");
    expect(logRows(fake)).toEqual([result.logRow]);
    expect(logRows(fake)[0][8]).toBe("Undone");
  });

  it("says in the server log that the change was written but not verified, without hiding the cause", async () => {
    const { fake, ctx } = await ready();
    fake.readBackFailure = unavailable();
    await pay(ctx, { portionId: "p1" });
    expect(log).toHaveBeenCalledTimes(1);
    const [message, cause] = log.mock.calls[0];
    expect(String(message)).toMatch(/read back/i);
    expect(String(message)).toMatch(/not verified/i);
    expect((cause as AppError).code).toBe("unavailable");
  });

  it("still refuses a genuine mismatch, and writes no log row", async () => {
    const { fake, ctx } = await ready();
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => {
      await original(writes);
      fake.tabs.get("Schedule")![5][3] = 1; // someone else changes the amount a moment later
    };
    const error = await pay(ctx, { portionId: "p1" }).then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error!.code).toBe("conflict");
    expect(error!.message).toBe("Your change may not have been saved. Refresh and check this month.");
    expect(fake.tabs.get(LOG_TAB)).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("a Payments Log row is added again only after a refusal that cannot have been carried out", () => {
  it("tries again after Google says it is limiting requests, and stops when one try works", async () => {
    const { fake, ctx } = await ready();
    fake.appendFailures = [rateLimited(), rateLimited()];
    const result = await pay(ctx, { portionId: "p1" });
    expect(result.logWritten).toBe(true);
    expect(appends(fake)).toBe(3);
    expect(logRows(fake)).toEqual([result.logRow]);
  });

  it("gives up after three tries when Google keeps limiting requests, and keeps the payment", async () => {
    const { fake, ctx } = await ready();
    fake.appendFailures = [rateLimited(), rateLimited(), rateLimited(), rateLimited()];
    const result = await pay(ctx, { portionId: "p1" });
    expect(result.logWritten).toBe(false);
    expect(appends(fake)).toBe(3);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(logRows(fake)).toEqual([]);
  });

  it("does not add the row again when Google was not responding: it may already be there", async () => {
    const { fake, ctx } = await ready();
    fake.appendLands = true;
    fake.appendFailures = [unavailable()];
    const result = await pay(ctx, { portionId: "p1" });
    expect(result.logWritten).toBe(false);
    expect(result.logRow).toBeDefined();
    expect(appends(fake)).toBe(1);
    expect(logRows(fake)).toHaveLength(1); // exactly one copy, not two
  });

  it("does not add the row again after an error it does not know, or one that is not Google's", async () => {
    for (const failure of [new Error("socket hang up"), configError("denied"), new TypeError("odd")]) {
      const { fake, ctx } = await ready();
      fake.appendLands = true;
      fake.appendFailures = [failure];
      const result = await pay(ctx, { portionId: "p1" });
      expect(result.logWritten).toBe(false);
      expect(appends(fake)).toBe(1);
      expect(logRows(fake)).toHaveLength(1);
    }
  });

  it("does the same for an undo", async () => {
    const { fake, ctx } = await ready();
    fake.appendLands = true;
    fake.appendFailures = [unavailable()];
    const result = await undoPayment(ctx, SEPT_P1, OPTIONS);
    expect(result.logWritten).toBe(false);
    expect(appends(fake)).toBe(1);
    expect(logRows(fake)).toHaveLength(1);

    const again = await ready();
    again.fake.appendFailures = [rateLimited()];
    const retried = await undoPayment(again.ctx, SEPT_P1, OPTIONS);
    expect(retried.logWritten).toBe(true);
    expect(appends(again.fake)).toBe(2);
  });

  it("does the same for the retry button", async () => {
    const { fake, ctx } = await ready();
    const row = ["2026-10-05T04:30:00.000Z", "2026-10", "First floor, single bedroom", "Asha", 5450, 4, "2026-10-05", "owner@example.com", "Logged"] as const;
    fake.appendLands = true;
    fake.appendFailures = [unavailable()];
    expect(await retryLogRow(ctx, [...row], 0)).toBe(false);
    expect(appends(fake)).toBe(1);

    fake.appendLands = false;
    fake.appendFailures = [rateLimited()];
    fake.calls = [];
    expect(await retryLogRow(ctx, [...row], 0)).toBe(true);
    expect(appends(fake)).toBe(2);
  });

  describe("and the tries fit inside the request's time", () => {
    it("waits at most a second between tries, however long it is told to", async () => {
      vi.useFakeTimers();
      const { fake, ctx } = await ready();
      fake.appendFailures = [rateLimited(), rateLimited()];
      const started = Date.now();
      const run = logPaymentWithDelay(ctx, 60_000);
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await run;
      expect(result.logWritten).toBe(true);
      expect(appends(fake)).toBe(3);
      expect(Date.now() - started).toBeLessThanOrEqual(5_000);
    });

    it("stops trying when the tries so far have used up four seconds", async () => {
      vi.useFakeTimers();
      const { fake, ctx } = await ready();
      // each refused try takes three seconds to come back
      fake.appendRow = async () => {
        fake.calls.push("appendRow");
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        throw rateLimited();
      };
      const result = logPaymentWithDelay(ctx, 400);
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await result).logWritten).toBe(false);
      expect(appends(fake)).toBe(2);
    });
  });
});

function logPaymentWithDelay(ctx: SheetsContext, retryDelayMs: number) {
  return logPayment(
    ctx,
    { month: OCT, portionId: "p3", amount: 9000, dateReceived: "2026-10-05" },
    { ...OPTIONS, retryDelayMs },
  );
}

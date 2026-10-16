import { describe, expect, it } from "vitest";
import type { TenancyFields } from "@/lib/domain/tenancy";
import { AppError } from "@/lib/errors";
import type { CellWrite, ValueRender } from "@/lib/sheets/gateway";
import {
  getMonthView,
  logPayment,
  undoPayment,
  type LogPaymentInput,
  type SheetsContext,
} from "@/lib/sheets/service";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import { moveOutTenancy, saveTenancy } from "@/lib/sheets/tenancy-service";
import { readTenancies } from "@/lib/sheets/tenants-store";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const NOW = new Date("2026-10-05T04:30:00Z");
const OCT = { year: 2026, month: 10 };
const OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "owner@example.com" };
const STAMP = { now: NOW, updatedBy: "owner@example.com" };
const SAVED_MESSAGE = "Your change may not have been saved. Refresh and check this month.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A FakeGateway that lets a test act as another person at an exact moment of a call. */
class HookedGateway extends FakeGateway {
  afterRead: ((tab: string, a1: string, render: ValueRender) => void) | null = null;
  afterUpdate: (() => void) | null = null;

  async getValues(tab: string, a1: string, render: ValueRender) {
    const out = await super.getValues(tab, a1, render);
    this.afterRead?.(tab, a1, render);
    return out;
  }

  async updateValues(writes: CellWrite[]) {
    await super.updateValues(writes);
    this.afterUpdate?.();
  }
}

function plainTotals() {
  const schedule = baseSchedule();
  (schedule[3] as unknown[])[16] = 27150;
  (schedule[4] as unknown[])[16] = 31350;
  return schedule;
}

/** The three app tabs already exist, so the calls under test are the only ones that cost time. */
async function ready(schedule: unknown[][] = baseSchedule()) {
  const fake = new HookedGateway({ Schedule: schedule });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getMonthView(ctx, OCT);
  fake.calls = [];
  return { fake, ctx };
}

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

describe("concurrent writes are taken one at a time", () => {
  // Each call takes `delay` ms. The second request starts `offset` ms after the first: 1 ms apart, and then far
  // enough apart that, without the lock, the second clone would land AFTER the first payment was written.
  it.each([
    { delay: 2, offset: 1 },
    { delay: 6, offset: 9 },
  ])("keeps both payments when two people log different portions in a brand-new month ($delay ms per call, $offset ms apart)", async ({ delay, offset }) => {
    const { fake, ctx } = await ready();
    fake.delayMs = delay;
    const first = pay(ctx, { portionId: "p1" });
    await sleep(offset);
    const second = pay(ctx, { portionId: "p2", amount: 13300 });
    await Promise.all([first, second]);

    fake.delayMs = 0;
    expect(fake.tabs.get("Schedule")).toHaveLength(6);
    expect(cell(fake, "Schedule", "A", 6)).toBe("Oct-26");
    expect(cell(fake, "Schedule", "B", 6)).toBe("Asha");
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(cell(fake, "Schedule", "E", 6)).toBe("Bala");
    expect(cell(fake, "Schedule", "G", 6)).toBe(13300);
    expect(cell(fake, "Schedule", "Q", 6)).toBe("=D6+G6+J6+M6+P6");
    expect(fake.tabs.get(LOG_TAB)).toHaveLength(3);
  });

  it("keeps all three payments when three people log in a brand-new month", async () => {
    const { fake, ctx } = await ready();
    fake.delayMs = 4;
    const all = [
      pay(ctx, { portionId: "p1" }),
      sleep(6).then(() => pay(ctx, { portionId: "p3", amount: 9500 })),
      sleep(12).then(() => pay(ctx, { portionId: "p5", amount: 5100 })),
    ];
    await Promise.all(all);
    fake.delayMs = 0;
    expect(fake.tabs.get("Schedule")).toHaveLength(6);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(cell(fake, "Schedule", "J", 6)).toBe(9500);
    expect(cell(fake, "Schedule", "P", 6)).toBe(5100);
  });

  it("refuses the second of two identical payments instead of recording both", async () => {
    const { fake, ctx } = await ready();
    fake.delayMs = 4;
    const first = pay(ctx, { portionId: "p1" });
    await sleep(1);
    const second = pay(ctx, { portionId: "p1" });
    const results = await Promise.allSettled([first, second]);
    fake.delayMs = 0;
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(((results[1] as PromiseRejectedResult).reason as AppError).code).toBe("conflict");
    expect(fake.tabs.get(LOG_TAB)).toHaveLength(2);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
  });

  it("lets the next write run after one fails", async () => {
    const { fake, ctx } = await ready();
    const bad = expectCode(pay(ctx, { portionId: "p1", amount: 0 }), "validation");
    const good = pay(ctx, { portionId: "p1" });
    await bad;
    await good;
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
  });

  it("refuses the second of two undos of the same payment", async () => {
    const { fake, ctx } = await ready();
    await pay(ctx, { portionId: "p1" });
    fake.delayMs = 4;
    const input = { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } };
    const first = undoPayment(ctx, input, OPTIONS);
    await sleep(1);
    const second = undoPayment(ctx, input, OPTIONS);
    const results = await Promise.allSettled([first, second]);
    fake.delayMs = 0;
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(((results[1] as PromiseRejectedResult).reason as AppError).message).toMatch(/Nothing to undo/);
    expect(cell(fake, "Schedule", "D", 6)).toBe("");
    // one "Logged" row and one "Undone" row, not two undos
    expect(fake.tabs.get(LOG_TAB)).toHaveLength(3);
  });

  describe("tenancy writes", () => {
    const FIELDS: TenancyFields = {
      phone: "",
      moveIn: "2026-01-15",
      agreementEnd: "",
      advance: null,
      advanceDate: "",
      notes: "",
    };

    async function withTenancy() {
      const { fake, ctx } = await ready();
      const { tenancy } = await saveTenancy(ctx, { portionId: "p1", tenant: "Asha", fields: FIELDS }, STAMP);
      fake.calls = [];
      return { fake, ctx, tenancy };
    }

    it("refuses the second of two edits made from the same screen", async () => {
      const { fake, ctx, tenancy } = await withTenancy();
      fake.delayMs = 4;
      const edit = (phone: string) =>
        saveTenancy(
          ctx,
          {
            portionId: "p1",
            tenant: "Asha",
            id: tenancy.id,
            expectedUpdatedAt: tenancy.updatedAt,
            fields: { ...FIELDS, phone },
          },
          { now: new Date("2026-10-06T09:00:00Z"), updatedBy: "member@example.com" },
        );
      const first = edit("11111");
      await sleep(1);
      const second = edit("22222");
      const results = await Promise.allSettled([first, second]);
      fake.delayMs = 0;
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
      expect(((results[1] as PromiseRejectedResult).reason as AppError).code).toBe("conflict");
      expect((await readTenancies(fake))[0].phone).toBe("11111");
    });

    it("refuses the second of two move-outs of the same tenancy", async () => {
      const { fake, ctx, tenancy } = await withTenancy();
      fake.delayMs = 4;
      const moveOut = (day: string) =>
        moveOutTenancy(
          ctx,
          { id: tenancy.id, expectedUpdatedAt: tenancy.updatedAt, moveOut: day },
          { now: new Date("2026-10-06T09:00:00Z"), updatedBy: "member@example.com" },
        );
      const first = moveOut("2026-10-01");
      await sleep(1);
      const second = moveOut("2026-10-02");
      const results = await Promise.allSettled([first, second]);
      fake.delayMs = 0;
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
      expect(((results[1] as PromiseRejectedResult).reason as AppError).code).toBe("conflict");
      expect((await readTenancies(fake))[0].moveOut).toBe("2026-10-01");
    });
  });
});

describe("a new month row is only cloned onto an empty row", () => {
  it("refuses when the row under the table is filled between reading it and cloning onto it", async () => {
    const { fake, ctx } = await ready();
    const others = ["Oct-26", "Zed", 1, 9999];
    // Another person adds the month, right after this request has read the row it will copy from.
    fake.afterRead = (tab, a1, render) => {
      if (tab === "Schedule" && a1 === "A5:ZZ5" && render === "FORMULA") {
        fake.tabs.get("Schedule")![5] = [...others];
      }
    };
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "conflict");
    expect(error.message).toMatch(/Row 6/);
    expect(fake.calls).not.toContain("cloneRow");
    expect(fake.calls).not.toContain("updateValues");
    expect(fake.tabs.get("Schedule")![5]).toEqual(others);
    expect(fake.tabs.get(LOG_TAB)).toHaveLength(1);
  });

  it("still adds the month when the row under the table is empty", async () => {
    const { fake, ctx } = await ready();
    await pay(ctx, { portionId: "p1" });
    expect(cell(fake, "Schedule", "A", 6)).toBe("Oct-26");
    expect(fake.calls.filter((call) => call === "cloneRow")).toHaveLength(1);
  });
});

describe("a payment is read back after it is written", () => {
  it("makes exactly one read between the write and the Payments Log row", async () => {
    const { fake, ctx } = await ready();
    await pay(ctx, { portionId: "p1" });
    const written = fake.calls.lastIndexOf("updateValues");
    expect(fake.calls.slice(written)).toEqual(["updateValues", "getValues", "appendRow"]);
  });

  it("reports a conflict when a written cell is not what was written, and logs nothing", async () => {
    const { fake, ctx } = await ready();
    // The amount is overwritten by someone else a moment after this request wrote it.
    fake.afterUpdate = () => {
      fake.afterUpdate = null;
      fake.tabs.get("Schedule")![5][3] = 1;
    };
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "conflict");
    expect(error.message).toBe(SAVED_MESSAGE);
    expect(fake.tabs.get(LOG_TAB)).toHaveLength(1);
  });

  it("reports a conflict when a write did not land at all", async () => {
    const { fake, ctx } = await ready();
    fake.afterUpdate = () => {
      fake.afterUpdate = null;
      delete fake.tabs.get("Schedule")![5][1]; // the tenant cell is empty again
    };
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "conflict");
    expect(error.message).toBe(SAVED_MESSAGE);
  });

  it("checks a typed total as well", async () => {
    const { fake, ctx } = await ready(plainTotals());
    fake.afterUpdate = () => {
      fake.afterUpdate = null;
      fake.tabs.get("Schedule")![5][16] = 1;
    };
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "conflict");
    expect(error.message).toBe(SAVED_MESSAGE);
  });

  it("checks an edit of an existing amount", async () => {
    const { fake, ctx } = await ready();
    await pay(ctx, { portionId: "p1" });
    fake.afterUpdate = () => {
      fake.afterUpdate = null;
      fake.tabs.get("Schedule")![5][3] = 5450;
    };
    const error = await expectCode(pay(ctx, { portionId: "p1", amount: 6000, overwrite: true }), "conflict");
    expect(error.message).toBe(SAVED_MESSAGE);
  });

  it("ignores a change to cells this request did not write", async () => {
    const { fake, ctx } = await ready();
    fake.afterUpdate = () => {
      fake.afterUpdate = null;
      fake.tabs.get("Schedule")![5][6] = 7777; // another portion's amount
      fake.tabs.get("Schedule")![5][0] = "Oct 2026";
    };
    const result = await pay(ctx, { portionId: "p1" });
    expect(result.logWritten).toBe(true);
  });

  it("reads back an undo too, once, and reports a cell that was not cleared", async () => {
    const { fake, ctx } = await ready();
    fake.calls = [];
    const input = { month: { year: 2026, month: 9 }, portionId: "p1", expected: { tenant: "Asha", count: 3, amount: 5450 } };
    await undoPayment(ctx, input, OPTIONS);
    const written = fake.calls.lastIndexOf("updateValues");
    expect(fake.calls.slice(written)).toEqual(["updateValues", "getValues", "appendRow"]);

    const second = await ready();
    second.fake.afterUpdate = () => {
      second.fake.afterUpdate = null;
      second.fake.tabs.get("Schedule")![4][3] = 5450; // the amount is typed back in
    };
    const error = await expectCode(undoPayment(second.ctx, input, OPTIONS), "conflict");
    expect(error.message).toBe(SAVED_MESSAGE);
    expect(second.fake.tabs.get(LOG_TAB)).toHaveLength(1);
  });
});

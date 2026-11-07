import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import { AppError, rateLimited, unavailable } from "@/lib/errors";
import { logPayment, type SheetsContext } from "@/lib/sheets/service";
import { getSettings } from "@/lib/sheets/service";
import { HISTORY_LIMIT_MS, TENANCY_LOG_HEADERS, TENANCY_LOG_TAB } from "@/lib/sheets/tenancy-log-store";
import { moveOutTenancy, moveOutWithoutDetails, retryTenancyHistory, saveTenancy } from "@/lib/sheets/tenancy-service";
import { appendTenancy, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// Every tenancy change adds its rows to the Tenancy Log, in ONE append, after the change itself has been saved. The history
// is a convenience: when it cannot be written the change stays saved, and the person is told through `historyWritten`.

const NOW = new Date("2026-11-03T09:30:00.000Z");
const SAVED_AT = "2026-11-03T09:30:00.000Z";
const OWNER = "owner@example.com";
const MEMBER = "member@example.com";
const STAMP = { now: NOW, updatedBy: OWNER, retryDelayMs: 0 };
const PAY = { now: NOW, retryDelayMs: 0, loggedBy: OWNER };
const OCT = { year: 2026, month: 10 };

type Row = Omit<Tenancy, "rowNumber">;

/**
 * A fake whose Tenancy Log appends can fail the ways Google's do: a refusal that did nothing, or an error after the rows landed.
 * They can also be slow (`appendRowsDelayMs`, then the rows land) or never answer (`appendRowsHangs` appends, counted from the
 * next one, never settle and never land).
 */
class HistoryGateway extends FakeGateway {
  appendRowsFailures: unknown[] = [];
  appendRowsLands = false;
  appendRowsCalls: unknown[][][] = [];
  appendRowsDelayMs = 0;
  appendRowsHangs = 0;

  async appendRows(tab: string, rows: unknown[][]) {
    this.appendRowsCalls.push(structuredClone(rows));
    if (this.appendRowsHangs > 0) {
      this.appendRowsHangs -= 1;
      this.calls.push("appendRows");
      return new Promise<void>(() => {});
    }
    if (this.appendRowsDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.appendRowsDelayMs));
    const failure = this.appendRowsFailures.shift();
    if (failure === undefined) return super.appendRows(tab, rows);
    if (this.appendRowsLands) await super.appendRows(tab, rows);
    else this.calls.push("appendRows");
    throw failure;
  }
}

async function ready(fake = new HistoryGateway({ Schedule: baseSchedule() })) {
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getSettings(ctx);
  fake.calls = [];
  return { fake, ctx };
}

const FIELDS = {
  phone: "98765 43210",
  moveIn: "2026-01-15",
  agreementEnd: "2027-01-14",
  advance: 20000,
  advanceDate: "2026-01-10",
  notes: "Paid by cheque",
};

const create = (ctx: SheetsContext, overrides: Record<string, unknown> = {}, options = STAMP) =>
  saveTenancy(ctx, { portionId: "p1", tenant: "Asha", fields: FIELDS, ...overrides } as Parameters<typeof saveTenancy>[1], options);

/** A tenancy row written straight into the Tenants tab, as if it came from the Sheet. */
function seed(fake: FakeGateway, overrides: Partial<Row> = {}) {
  const row: Row = {
    id: "t-seed",
    portionId: "p1",
    tenant: "Esha",
    phone: "",
    moveIn: "2026-05-01",
    agreementEnd: "",
    advance: null,
    advanceDate: "",
    advanceStatus: null,
    refund: null,
    deductions: null,
    notes: "",
    moveOut: "",
    updatedBy: OWNER,
    updatedAt: "2026-05-01T05:00:00.000Z",
    ...overrides,
  };
  return appendTenancy(fake, row);
}

/** The Tenancy Log's rows, without its header. */
const logged = (fake: FakeGateway) => fake.tabs.get(TENANCY_LOG_TAB)!.slice(1);
const appendsOf = (fake: FakeGateway) => fake.calls.filter((call) => call === "appendRows").length;

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a new tenancy", () => {
  it("adds one Added row in one append, stamped with the moment of the save and the person", async () => {
    const { fake, ctx } = await ready();
    const { tenancy } = await create(ctx);
    expect(appendsOf(fake)).toBe(1);
    expect(fake.tabs.get(TENANCY_LOG_TAB)![0]).toEqual(TENANCY_LOG_HEADERS);
    expect(logged(fake)).toEqual([[SAVED_AT, tenancy.id, "p1", "Added", "", "", "", OWNER]]);
  });

  it("adds the row of each tenancy it closes in the same append, after the Added row", async () => {
    const { fake, ctx } = await ready();
    await seed(fake, { id: "t-esha", moveIn: "2026-05-01" });
    await seed(fake, { id: "t-fara", tenant: "Fara", moveIn: "2026-06-01" });
    fake.calls = [];
    const { tenancy } = await create(ctx, {}, { ...STAMP, updatedBy: MEMBER });
    expect(appendsOf(fake)).toBe(1);
    expect(fake.appendRowsCalls).toHaveLength(1);
    expect(logged(fake)).toEqual([
      [SAVED_AT, tenancy.id, "p1", "Added", "", "", "", MEMBER],
      [SAVED_AT, "t-esha", "p1", "Closed", "Move-out date", "", "2026-05-01", MEMBER],
      [SAVED_AT, "t-fara", "p1", "Closed", "Move-out date", "", "2026-06-01", MEMBER],
    ]);
  });

  it("answers with the tenancy as before, and says the history was written", async () => {
    const { ctx } = await ready();
    const result = await create(ctx);
    expect(result.tenancy.tenant).toBe("Asha");
    expect(result.historyWritten).toBe(true);
    expect(result.historyRows).toEqual([[SAVED_AT, result.tenancy.id, "p1", "Added", "", "", "", OWNER]]);
  });
});

describe("an edit", () => {
  async function created() {
    const made = await ready();
    const { tenancy } = await create(made.ctx);
    made.fake.calls = [];
    made.fake.appendRowsCalls = [];
    return { ...made, tenancy };
  }
  const edit = (ctx: SheetsContext, tenancy: Tenancy, fields: Record<string, unknown>, options = STAMP) =>
    saveTenancy(
      ctx,
      { portionId: "p1", tenant: "Asha", id: tenancy.id, expectedUpdatedAt: tenancy.updatedAt, fields: { ...FIELDS, ...fields } },
      options,
    );

  it("adds a row for each changed field in one append, Phone first and with its values blank", async () => {
    const { fake, ctx, tenancy } = await created();
    const { historyWritten } = await edit(ctx, tenancy, { phone: "91234 56789", agreementEnd: "2027-03-31" }, { ...STAMP, updatedBy: MEMBER });
    expect(historyWritten).toBe(true);
    expect(appendsOf(fake)).toBe(1);
    expect(logged(fake).slice(1)).toEqual([
      [SAVED_AT, tenancy.id, "p1", "Edited", "Phone", "", "", MEMBER],
      [SAVED_AT, tenancy.id, "p1", "Edited", "Agreement end", "2027-01-14", "2027-03-31", MEMBER],
    ]);
  });

  it("adds the advance and its status when an advance is removed", async () => {
    const { fake, ctx, tenancy } = await created();
    await edit(ctx, tenancy, { advance: null, advanceDate: "" });
    expect(logged(fake).slice(1).map((row) => row.slice(3, 7))).toEqual([
      ["Edited", "Advance", 20000, ""],
      ["Edited", "Advance date", "2026-01-10", ""],
      ["Edited", "Advance status", "Held", ""],
    ]);
  });

  it("adds nothing for an edit that changed nothing", async () => {
    const { fake, ctx, tenancy } = await created();
    const result = await edit(ctx, tenancy, {});
    expect(appendsOf(fake)).toBe(0);
    expect(result.historyWritten).toBe(true);
    expect(result.historyRows).toEqual([]);
    expect(logged(fake)).toHaveLength(1); // only the Added row of the creation
  });

  it("adds nothing when the edit is refused", async () => {
    const { fake, ctx, tenancy } = await created();
    const stale = await edit(ctx, { ...tenancy, updatedAt: "2020-01-01T00:00:00.000Z" }, { phone: "1" }).then(() => null, (e: unknown) => e);
    expect((stale as AppError).code).toBe("conflict");
    const invalid = await edit(ctx, tenancy, { moveIn: "not a day" }).then(() => null, (e: unknown) => e);
    expect((invalid as AppError).code).toBe("validation");
    expect(appendsOf(fake)).toBe(0);
  });

  it("adds nothing, and leaves the error as it was, when the tenancy write fails", async () => {
    const { fake, ctx, tenancy } = await created();
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => {
      if (writes.some((write) => write.tab === TENANTS_TAB)) throw new Error("updateValues failed on the Tenants tab");
      return original(writes);
    };
    await expect(edit(ctx, tenancy, { phone: "91234 56789" })).rejects.toThrow("updateValues failed on the Tenants tab");
    expect(appendsOf(fake)).toBe(0);
  });
});

describe("a move-out", () => {
  it("adds a row for the day, the advance outcome, the refund, the deductions and the notes, in column order", async () => {
    const { fake, ctx } = await ready();
    const { tenancy } = await create(ctx);
    fake.calls = [];
    const result = await moveOutTenancy(
      ctx,
      {
        id: tenancy.id,
        expectedUpdatedAt: tenancy.updatedAt,
        moveOut: "2026-11-30",
        advanceStatus: "Refunded",
        refund: 18000,
        deductions: 2000,
        notes: "Keys returned",
      },
      { ...STAMP, updatedBy: MEMBER },
    );
    expect(result.historyWritten).toBe(true);
    expect(appendsOf(fake)).toBe(1);
    expect(logged(fake).slice(1)).toEqual([
      [SAVED_AT, tenancy.id, "p1", "Moved out", "Advance status", "Held", "Refunded", MEMBER],
      [SAVED_AT, tenancy.id, "p1", "Moved out", "Refund", "", 18000, MEMBER],
      [SAVED_AT, tenancy.id, "p1", "Moved out", "Deductions", "", 2000, MEMBER],
      [SAVED_AT, tenancy.id, "p1", "Moved out", "Notes", "", "", MEMBER],
      [SAVED_AT, tenancy.id, "p1", "Moved out", "Move-out date", "", "2026-11-30", MEMBER],
    ]);
  });

  it("adds the day alone when nothing else was given", async () => {
    const { fake, ctx } = await ready();
    const { tenancy } = await create(ctx);
    fake.calls = [];
    await moveOutTenancy(ctx, { id: tenancy.id, expectedUpdatedAt: tenancy.updatedAt, moveOut: "2026-11-30" }, STAMP);
    expect(logged(fake).slice(1)).toEqual([[SAVED_AT, tenancy.id, "p1", "Moved out", "Move-out date", "", "2026-11-30", OWNER]]);
  });

  it("adds nothing when the move-out is refused", async () => {
    const { fake, ctx } = await ready();
    const { tenancy } = await create(ctx);
    fake.calls = [];
    const error = await moveOutTenancy(ctx, { id: tenancy.id, expectedUpdatedAt: tenancy.updatedAt, moveOut: "2026-01-01" }, STAMP).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(appendsOf(fake)).toBe(0);
  });

  it("for a tenant with no details on file, adds the day (and the notes, privately) against an empty tenancy", async () => {
    const { fake, ctx } = await ready();
    const result = await moveOutWithoutDetails(
      ctx,
      { portionId: "p1", tenant: "Asha", moveOut: "2026-10-31", notes: "Left early" },
      STAMP,
    );
    expect(appendsOf(fake)).toBe(1);
    expect(logged(fake)).toEqual([
      [SAVED_AT, result.tenancy.id, "p1", "Moved out", "Notes", "", "", OWNER],
      [SAVED_AT, result.tenancy.id, "p1", "Moved out", "Move-out date", "", "2026-10-31", OWNER],
    ]);
    expect(result.historyWritten).toBe(true);
  });

  it("adds nothing when a move-out without details is refused", async () => {
    const { fake, ctx } = await ready();
    const error = await moveOutWithoutDetails(ctx, { portionId: "p1", tenant: "Someone else", moveOut: "2026-10-31" }, STAMP).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as AppError).code).toBe("conflict");
    expect(appendsOf(fake)).toBe(0);
  });
});

describe("a payment that starts a new tenant", () => {
  const newTenant = (ctx: SheetsContext, overrides: Record<string, unknown> = {}) =>
    logPayment(
      ctx,
      {
        month: OCT,
        portionId: "p4",
        amount: 8800,
        dateReceived: "2026-10-07",
        newTenantName: "Dev",
        tenancy: { phone: "98765 43210", moveIn: "2026-10-01", agreementEnd: "", advance: 20000, advanceDate: "2026-10-01", notes: "" },
        ...overrides,
      },
      PAY,
    );

  it("adds the Added row, and a Closed row for each tenancy the new tenant ends, in one append", async () => {
    const { fake, ctx } = await ready();
    await seed(fake, { id: "t-old", portionId: "p4", tenant: "Gita", moveIn: "2026-02-01" });
    fake.calls = [];
    const result = await newTenant(ctx);
    expect(result.tenancyWritten).toBe(true);
    expect(result.historyWritten).toBe(true);
    expect(appendsOf(fake)).toBe(1);
    const [added, closed] = logged(fake);
    expect(added.slice(0, 1)).toEqual([SAVED_AT]);
    expect(added.slice(2, 8)).toEqual(["p4", "Added", "", "", "", OWNER]);
    expect(closed).toEqual([SAVED_AT, "t-old", "p4", "Closed", "Move-out date", "", "2026-10-01", OWNER]);
    expect(result.historyRows).toEqual(logged(fake));
  });

  it("adds only the Closed row when no details were given for the new tenant", async () => {
    const { fake, ctx } = await ready();
    await seed(fake, { id: "t-old", portionId: "p4", tenant: "Gita", moveIn: "2026-02-01" });
    fake.calls = [];
    const result = await newTenant(ctx, { tenancy: undefined });
    expect(logged(fake)).toEqual([[SAVED_AT, "t-old", "p4", "Closed", "Move-out date", "", "2026-10-07", OWNER]]);
    expect(result.historyWritten).toBe(true);
  });

  it("adds nothing, and makes no append, when the new tenant changed no tenancy", async () => {
    const { fake, ctx } = await ready();
    const result = await newTenant(ctx, { tenancy: undefined });
    expect(result.tenancyWritten).toBe(true);
    expect(appendsOf(fake)).toBe(0);
    expect(result.historyWritten).toBe(true);
    expect(result.historyRows).toEqual([]);
    expect(logged(fake)).toEqual([]);
  });

  it("adds nothing when the tenancy write did not happen, and says nothing about the history", async () => {
    const { fake, ctx } = await ready();
    fake.tabs.get(TENANTS_TAB)![0][4] = "Moved in"; // a wrong header: the tenancy rows cannot be written
    fake.calls = [];
    const result = await newTenant(ctx);
    expect(result.tenancyWritten).toBe(false);
    expect(result).not.toHaveProperty("historyWritten");
    expect(result).not.toHaveProperty("historyRows");
    expect(appendsOf(fake)).toBe(0);
    expect(result.logWritten).toBe(true);
  });

  it("has no history fields for a plain payment", async () => {
    const { fake, ctx } = await ready();
    const result = await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, PAY);
    expect(result).not.toHaveProperty("historyWritten");
    expect(result).not.toHaveProperty("historyRows");
    expect(appendsOf(fake)).toBe(0);
  });
});

describe("when the history cannot be written", () => {
  /** The same work on a fresh fake, with ids that do not change from one run to the next. */
  async function run(options: { failOn?: boolean; failures?: unknown[]; lands?: boolean }) {
    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as ReturnType<typeof crypto.randomUUID>,
    );
    const fake = new HistoryGateway({ Schedule: baseSchedule() });
    const { ctx } = await ready(fake);
    await seed(fake, { id: "t-esha", moveIn: "2026-05-01" });
    if (options.failOn) fake.failOn.add("appendRows");
    fake.appendRowsFailures = options.failures ?? [];
    fake.appendRowsLands = options.lands ?? false;
    const created = await create(ctx);
    const edited = await saveTenancy(
      ctx,
      {
        portionId: "p1",
        tenant: "Asha",
        id: created.tenancy.id,
        expectedUpdatedAt: created.tenancy.updatedAt,
        fields: { ...FIELDS, phone: "91234 56789", agreementEnd: "2027-03-31" },
      },
      STAMP,
    );
    const out = await moveOutTenancy(
      ctx,
      { id: created.tenancy.id, expectedUpdatedAt: edited.tenancy.updatedAt, moveOut: "2026-11-30", advanceStatus: "Refunded", refund: 20000 },
      STAMP,
    );
    return { fake, ctx, created, edited, out };
  }

  it("keeps every tenancy change saved, exactly as it is when the history works, and says the history was not written", async () => {
    const fine = await run({});
    const failing = await run({ failOn: true });

    expect([failing.created.historyWritten, failing.edited.historyWritten, failing.out.historyWritten]).toEqual([false, false, false]);
    expect([fine.created.historyWritten, fine.edited.historyWritten, fine.out.historyWritten]).toEqual([true, true, true]);
    // The Tenants tab is the same, cell for cell, as when the history works.
    expect(failing.fake.tabs.get(TENANTS_TAB)).toEqual(fine.fake.tabs.get(TENANTS_TAB));
    expect(failing.fake.tabs.get("Schedule")).toEqual(fine.fake.tabs.get("Schedule"));
    expect(failing.out.tenancy).toEqual(fine.out.tenancy);
    expect(failing.created.tenancy).toEqual(fine.created.tenancy);
    // Nothing reached the Tenancy Log, and the rows that did not are still in the result, for a retry.
    expect(logged(failing.fake)).toEqual([]);
    expect(failing.created.historyRows).toEqual(fine.created.historyRows);
    expect(failing.out.historyRows).toEqual(fine.out.historyRows);
    expect(failing.out.historyRows!.length).toBeGreaterThan(0);
  });

  it("logs one tenancy-log-append-failed line for each try, naming how many rows were not added and not the rows", async () => {
    const { fake, ctx } = await ready();
    fake.failOn.add("appendRows");
    const { tenancy } = await create(ctx);
    expect(tenancy.tenant).toBe("Asha");
    const lines = loggedLines(logs.error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", event: "tenancy-log-append-failed" });
    expect(String(lines[0].message)).toMatch(/^Tenancy Log: try 1 of 2 did not add 1 row \(/);
  });

  it("tries again after Google says it is limiting requests, and adds the rows once", async () => {
    const { fake, ctx } = await ready();
    fake.appendRowsFailures = [rateLimited()];
    const result = await create(ctx);
    expect(result.historyWritten).toBe(true);
    expect(appendsOf(fake)).toBe(2);
    expect(logged(fake)).toEqual([[SAVED_AT, result.tenancy.id, "p1", "Added", "", "", "", OWNER]]);
    const lines = loggedLines(logs.error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "tenancy-log-append-failed", code: "rate-limited" });
    expect(String(lines[0].message)).toContain("try 1 of 2");
  });

  it("gives up after two tries when Google keeps limiting requests", async () => {
    const { fake, ctx } = await ready();
    fake.appendRowsFailures = [rateLimited(), rateLimited(), rateLimited()];
    const result = await create(ctx);
    expect(result.historyWritten).toBe(false);
    expect(appendsOf(fake)).toBe(2);
    expect(loggedLines(logs.error).map((line) => String(line.message).slice(0, 29))).toEqual([
      "Tenancy Log: try 1 of 2 did n",
      "Tenancy Log: try 2 of 2 did n",
    ]);
  });

  it("does not try again after a timeout or any error that may have been carried out: the rows may be there", async () => {
    for (const failure of [unavailable(), new Error("socket hang up")]) {
      logs.error.mockClear();
      const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
      fake.appendRowsLands = true;
      fake.appendRowsFailures = [failure];
      const result = await create(ctx);
      expect(result.historyWritten).toBe(false);
      expect(appendsOf(fake)).toBe(1);
      expect(logged(fake)).toHaveLength(1); // exactly one copy, not two
      expect(logs.error).toHaveBeenCalledTimes(1);
    }
  });

  it("never lets a failure of the history come out of the write, whatever it throws", async () => {
    const { fake, ctx } = await ready();
    fake.appendRows = () => {
      throw new TypeError("odd");
    };
    const result = await create(ctx);
    expect(result.tenancy.tenant).toBe("Asha");
    expect(result.historyWritten).toBe(false);
    expect(loggedLines(logs.error)[0]).toMatchObject({ event: "tenancy-log-append-failed" });
  });

  it("does not let a missing Tenancy Log stop the save, and says so in the log", async () => {
    const { fake, ctx } = await ready();
    fake.tabs.delete(TENANCY_LOG_TAB);
    const result = await create(ctx);
    expect(result.tenancy.tenant).toBe("Asha");
    expect(result.historyWritten).toBe(false);
    expect(fake.tabs.get(TENANTS_TAB)).toHaveLength(2);
  });

  it("keeps a payment's log row and its tenancy rows when the history of a new tenant fails", async () => {
    const { fake, ctx } = await ready();
    await seed(fake, { id: "t-old", portionId: "p4", tenant: "Gita", moveIn: "2026-02-01" });
    fake.failOn.add("appendRows");
    const result = await logPayment(
      ctx,
      { month: OCT, portionId: "p4", amount: 8800, dateReceived: "2026-10-07", newTenantName: "Dev", tenancy: { moveIn: "2026-10-01" } },
      PAY,
    );
    expect(result).toMatchObject({ logWritten: true, tenancyWritten: true, historyWritten: false });
    expect(result.historyRows).toHaveLength(2);
    expect(fake.tabs.get(TENANTS_TAB)!.slice(1).map((row) => [row[2], row[12]])).toEqual([
      ["Gita", "2026-10-01"],
      ["Dev", ""],
    ]);
  });
});

describe("the history is written inside the write, before the caches are thrown away", () => {
  it("appends while the write still holds its turn, then clears the caches", async () => {
    const { fake, ctx } = await ready();
    const order: string[] = [];
    const original = fake.appendRows.bind(fake);
    fake.appendRows = async (tab, rows) => {
      order.push("history:start");
      await original(tab, rows);
      order.push("history:end");
    };
    ctx.cache = { get: vi.fn(), invalidate: () => order.push("invalidate") } as never;
    await create(ctx);
    expect(order).toEqual(["history:start", "history:end", "invalidate"]);
  });

  it("makes one append for each of two saves made at the same moment, and loses neither", async () => {
    const fake = new HistoryGateway({ Schedule: baseSchedule() }, { delayMs: 2 });
    const { ctx } = await ready(fake);
    const [one, two] = await Promise.all([
      create(ctx),
      saveTenancy(ctx, { portionId: "p2", tenant: "Bala", fields: { moveIn: "2026-02-01" } }, { now: NOW, updatedBy: MEMBER, retryDelayMs: 0 }),
    ]);
    expect(fake.appendRowsCalls).toHaveLength(2);
    expect(logged(fake)).toEqual([
      [SAVED_AT, one.tenancy.id, "p1", "Added", "", "", "", OWNER],
      [SAVED_AT, two.tenancy.id, "p2", "Added", "", "", "", MEMBER],
    ]);
  });
});

describe("what the server log may hold", () => {
  it("never carries a tenant's name, phone number or note, whatever fails", async () => {
    const fake = new HistoryGateway({ Schedule: baseSchedule() });
    const { ctx } = await ready(fake);
    fake.tabs.get("Schedule")![4][1] = "CANARY-TENANT";
    fake.failOn.add("appendRows");
    const fields = { phone: "CANARY-PHONE-1", moveIn: "2026-01-15", agreementEnd: "2027-01-14", advance: 20000, advanceDate: "2026-01-10", notes: "CANARY-NOTE-1" };
    const created = await saveTenancy(ctx, { portionId: "p1", tenant: "CANARY-TENANT", fields }, STAMP);
    const edited = await saveTenancy(
      ctx,
      {
        portionId: "p1",
        tenant: "CANARY-TENANT",
        id: created.tenancy.id,
        expectedUpdatedAt: created.tenancy.updatedAt,
        fields: { ...fields, phone: "CANARY-PHONE-2", notes: "CANARY-NOTE-2" },
      },
      STAMP,
    );
    await moveOutTenancy(
      ctx,
      { id: created.tenancy.id, expectedUpdatedAt: edited.tenancy.updatedAt, moveOut: "2026-11-30", notes: "CANARY-NOTE-3" },
      STAMP,
    );
    fake.appendRowsFailures = [rateLimited(), new Error("socket hang up")];
    fake.failOn.delete("appendRows");
    await seed(fake, { id: "t-x", portionId: "p4", tenant: "CANARY-OLD", phone: "CANARY-PHONE-3", notes: "CANARY-NOTE-4" });
    await logPayment(
      ctx,
      { month: OCT, portionId: "p4", amount: 8800, dateReceived: "2026-10-07", newTenantName: "CANARY-NEW", tenancy: { moveIn: "2026-10-01", phone: "CANARY-PHONE-4", notes: "CANARY-NOTE-5" } },
      PAY,
    );
    const all = [logs.info, logs.warn, logs.error].flatMap((spy) => spy.mock.calls.flat()).join("\n");
    expect(all).toContain("tenancy-log-append-failed");
    expect(all).not.toMatch(/CANARY/);
  });
});

describe("when Google is too slow for the history", () => {
  /** Runs `work` and tells, without waiting for it, whether it has finished. */
  function watch<T>(work: Promise<T>) {
    const state = { done: false, value: undefined as T | undefined, error: undefined as unknown };
    work.then(
      (value) => {
        state.done = true;
        state.value = value;
      },
      (error: unknown) => {
        state.done = true;
        state.error = error;
      },
    );
    return state;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("gives the history up after HISTORY_LIMIT_MS, and returns the saved tenancy with historyWritten false and the rows for a retry", async () => {
    const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
    fake.appendRowsHangs = 1;
    const saving = watch(create(ctx));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS - 1);
    expect(saving.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(saving.done).toBe(true);
    expect(saving.error).toBeUndefined();
    const result = saving.value!;
    expect(result.historyWritten).toBe(false);
    expect(result.tenancy.tenant).toBe("Asha");
    expect(result.historyRows).toEqual([[SAVED_AT, result.tenancy.id, "p1", "Added", "", "", "", OWNER]]);
    // The change itself is saved, and only one append was tried: a try that may be on its way is never repeated.
    expect(fake.tabs.get(TENANTS_TAB)).toHaveLength(2);
    expect(appendsOf(fake)).toBe(1);
  });

  it("is about three seconds", () => {
    expect(HISTORY_LIMIT_MS).toBe(3_000);
  });

  it("counts the wait before the second try in the limit", async () => {
    const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
    // Google refuses the first try at once (the default 400 ms wait follows); the second never answers.
    fake.appendRowsFailures = [rateLimited()];
    const second = fake.appendRows.bind(fake);
    fake.appendRows = async (tab, rows) => {
      if (fake.appendRowsCalls.length >= 1) fake.appendRowsHangs = 1;
      return second(tab, rows);
    };
    const saving = watch(create(ctx, {}, { ...STAMP, retryDelayMs: 400 }));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS - 1);
    expect(saving.done).toBe(false);
    expect(fake.appendRowsCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(saving.done).toBe(true);
    expect(saving.value!.historyWritten).toBe(false);
  });

  it("covers every kind of change: an edit, a move-out, a move-out without details and a new tenant's payment", async () => {
    const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
    const { tenancy } = await create(ctx);
    fake.appendRowsHangs = 1;
    const edit = watch(
      saveTenancy(
        ctx,
        { portionId: "p1", tenant: "Asha", id: tenancy.id, expectedUpdatedAt: tenancy.updatedAt, fields: { ...FIELDS, phone: "91234 56789" } },
        STAMP,
      ),
    );
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    expect(edit.done).toBe(true);
    expect(edit.value).toMatchObject({ historyWritten: false });
    expect(edit.value!.historyRows).toHaveLength(1);

    fake.appendRowsHangs = 1;
    const out = watch(moveOutTenancy(ctx, { id: tenancy.id, expectedUpdatedAt: edit.value!.tenancy.updatedAt, moveOut: "2026-11-30" }, STAMP));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    expect(out.value).toMatchObject({ historyWritten: false });
    expect(out.value!.tenancy.moveOut).toBe("2026-11-30");

    fake.appendRowsHangs = 1;
    const bare = watch(moveOutWithoutDetails(ctx, { portionId: "p2", tenant: "Bala", moveOut: "2026-10-31" }, STAMP));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    expect(bare.value).toMatchObject({ historyWritten: false });
    expect(bare.value!.tenancy.moveOut).toBe("2026-10-31");

    fake.appendRowsHangs = 1;
    const paying = watch(
      logPayment(ctx, { month: OCT, portionId: "p4", amount: 8800, dateReceived: "2026-10-07", newTenantName: "Dev", tenancy: { moveIn: "2026-10-01" } }, PAY),
    );
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    expect(paying.done).toBe(true);
    expect(paying.value).toMatchObject({ logWritten: true, tenancyWritten: true, historyWritten: false });
    expect(paying.value!.historyRows).toHaveLength(1);
  });

  it("lets the next write go ahead: the lock is released, and the next save's history is written", async () => {
    const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
    fake.appendRowsHangs = 1;
    const first = watch(create(ctx));
    const second = watch(saveTenancy(ctx, { portionId: "p2", tenant: "Bala", fields: { moveIn: "2026-02-01" } }, { ...STAMP, updatedBy: MEMBER }));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    expect(first.value).toMatchObject({ historyWritten: false });
    expect(second.done).toBe(true);
    expect(second.value).toMatchObject({ historyWritten: true });
    expect(logged(fake)).toEqual([[SAVED_AT, second.value!.tenancy.id, "p2", "Added", "", "", "", MEMBER]]);
  });

  it("clears the page caches after a history that timed out, as after any other save", async () => {
    const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
    const invalidate = vi.fn();
    ctx.cache = { get: vi.fn(), invalidate } as never;
    fake.appendRowsHangs = 1;
    const saving = watch(create(ctx));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    expect(saving.done).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer running once an append has finished in time", async () => {
    const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
    fake.appendRowsDelayMs = 100;
    const saving = watch(create(ctx));
    await vi.advanceTimersByTimeAsync(100);
    expect(saving.value).toMatchObject({ historyWritten: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs one tenancy-log-append-failed line that says how many rows and how long, and never a name, phone or note", async () => {
    const fake = new HistoryGateway({ Schedule: baseSchedule() });
    const { ctx } = await ready(fake);
    fake.tabs.get("Schedule")![4][1] = "CANARY-TENANT";
    fake.appendRowsHangs = 1;
    const fields = { phone: "CANARY-PHONE-1", moveIn: "2026-01-15", agreementEnd: "2027-01-14", advance: 20000, advanceDate: "2026-01-10", notes: "CANARY-NOTE-1" };
    const saving = watch(saveTenancy(ctx, { portionId: "p1", tenant: "CANARY-TENANT", fields }, STAMP));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    expect(saving.done).toBe(true);
    const lines = loggedLines(logs.error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", event: "tenancy-log-append-failed" });
    expect(String(lines[0].message)).toMatch(/^Tenancy Log: 1 row not confirmed within 3 seconds/);
    const all = [logs.info, logs.warn, logs.error].flatMap((spy) => spy.mock.calls.flat()).join("\n");
    expect(all).not.toMatch(/CANARY/);
  });

  it("lets an append that was given up on land later without a second line or an unhandled error, and the retry then adds nothing", async () => {
    const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
    fake.appendRowsDelayMs = 5_000; // Google answers after 5 seconds, longer than the limit
    const saving = watch(create(ctx));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    const result = saving.value!;
    expect(result.historyWritten).toBe(false);
    expect(logged(fake)).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(logged(fake)).toEqual([[SAVED_AT, result.tenancy.id, "p1", "Added", "", "", "", OWNER]]);
    expect(logs.error).toHaveBeenCalledTimes(1);
    // The browser's retry finds the rows that landed late and adds nothing. (A retry that looks in the instant between the
    // timeout and the late landing would add a second copy: that tiny race is accepted, as it is for the Payments Log.)
    fake.appendRowsDelayMs = 0;
    expect(await retryTenancyHistory(ctx, result.historyRows, 0)).toBe(true);
    expect(logged(fake)).toHaveLength(1);
  });

  it("is bounded for the browser's retry as well", async () => {
    const { fake, ctx } = await ready(new HistoryGateway({ Schedule: baseSchedule() }));
    fake.appendRowsHangs = 1;
    const retrying = watch(retryTenancyHistory(ctx, [[SAVED_AT, "t-x", "p1", "Added", "", "", "", OWNER]], 0));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS);
    expect(retrying.done).toBe(true);
    expect(retrying.value).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, logPayment, undoPayment, type LogPaymentInput, type SheetsContext } from "@/lib/sheets/service";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import { readTenancyHistory } from "@/lib/sheets/tenancy-log-read";
import { HISTORY_LIMIT_MS, TENANCY_LOG_TAB } from "@/lib/sheets/tenancy-log-store";
import { retryTenancyHistory, saveTenancy } from "@/lib/sheets/tenancy-service";
import { appendTenancy, readTenancies, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { historyEntries } from "@/lib/tenancy-history";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// Undoing a New tenant's first payment opens again the tenancy that payment closed. The Tenancy Log recorded the closing, so it
// must record the opening too, or the tenant page's History would go on saying the tenancy was closed. The row is an Edited one
// for the Move-out date (the old day, then nothing), written in one append after the Undone row of the Payments Log, with the
// same limits as every other history: it never fails or undoes the undo, it is bounded, and its retry adds it once.

const OCT = { year: 2026, month: 10 };
const OWNER = "owner@example.com";
const MEMBER = "member@example.com";

let tick = 0;
const at = () => new Date(Date.UTC(2026, 9, 5, 4, 30, 0) + 1000 * ++tick);
const stamp = (by = OWNER) => ({ now: at(), updatedBy: by, retryDelayMs: 0 });
const payOptions = (by = OWNER) => ({ now: at(), retryDelayMs: 0, loggedBy: by });

class HistoryGateway extends FakeGateway {
  hangAppendRows = false;
  appendRowsCalls = 0;
  async appendRows(tab: string, rows: unknown[][]) {
    this.appendRowsCalls += 1;
    if (this.hangAppendRows) {
      this.calls.push("appendRows");
      return new Promise<void>(() => {});
    }
    return super.appendRows(tab, rows);
  }
}

async function ready() {
  const fake = new HistoryGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getSettings(ctx);
  fake.calls = [];
  return { fake, ctx };
}

const DETAILS = { phone: "CANARY-PHONE", moveIn: "2026-01-15", advance: 20000, advanceDate: "2026-01-10", notes: "CANARY-NOTE" };
const saveAsha = async (ctx: SheetsContext) => (await saveTenancy(ctx, { portionId: "p1", tenant: "Asha", fields: DETAILS }, stamp())).tenancy;
const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { month: { year: number; month: number } }, by?: string) =>
  logPayment(ctx, { portionId: "p1", amount: 5450, dateReceived: "2026-10-05", ...input }, payOptions(by));
const undoHari = (ctx: SheetsContext, by?: string) =>
  undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions(by));

/** The Tenancy Log's rows, without its header. */
const logged = (fake: FakeGateway) => fake.tabs.get(TENANCY_LOG_TAB)!.slice(1);

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the undo of a New tenant that closed a tenancy", () => {
  async function closedByHari() {
    const { fake, ctx } = await ready();
    const asha = await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    // Added for Asha, then the Closed row of her tenancy
    expect(logged(fake).map((row) => row[3])).toEqual(["Added", "Closed"]);
    const closedDay = logged(fake)[1][6];
    fake.calls = [];
    return { fake, ctx, asha, closedDay };
  }

  it("adds one Edited row for the Move-out date, the old day then nothing, by the person who undid it, in one append", async () => {
    const { fake, ctx, asha, closedDay } = await closedByHari();
    const options = payOptions(MEMBER);
    const result = await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, options);

    expect(closedDay).toBe("2026-10-05");
    expect((await readTenancies(fake)).find((t) => t.id === asha.id)).toMatchObject({ moveOut: "" });
    expect(fake.calls.filter((call) => call === "appendRows")).toHaveLength(1);
    expect(logged(fake).slice(2)).toEqual([[options.now.toISOString(), asha.id, "p1", "Edited", "Move-out date", "2026-10-05", "", MEMBER]]);
    expect(result).toMatchObject({ removed: { tenant: "Hari" }, logWritten: true, historyWritten: true });
    expect(result.historyRows).toEqual(logged(fake).slice(2));
  });

  it("adds it after the Undone row of the Payments Log and the write to the Tenants tab, and after nothing else", async () => {
    const { fake, ctx } = await closedByHari();
    await undoHari(ctx);
    const writes = fake.calls.filter((call) => ["appendRow", "updateValues", "appendRows"].includes(call));
    expect(writes).toEqual(["updateValues", "appendRow", "updateValues", "appendRows"]); // Schedule, Payments Log, Tenants, Tenancy Log
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1][8]).toBe("Undone");
  });

  it("is one entry that says the tenancy is open again, in the History", async () => {
    const { fake, ctx, asha } = await closedByHari();
    await undoHari(ctx);
    const { items } = await readTenancyHistory(ctx, "p1");
    const { entries } = historyEntries(items, new Map([[asha.id, "Asha"]]), OWNER);
    expect(entries.map((entry) => entry.title)).toEqual([
      "Asha's tenancy was opened again.",
      "Asha's tenancy was closed on 5 Oct 2026, when the next tenant was added.",
      "Details added for Asha.",
    ]);
    expect(entries[0].lines).toEqual(["Move-out date removed (was 5 Oct 2026)."]);
    expect(logged(fake)).toHaveLength(3);
  });

  it("writes the rows of every tenancy it opens, in the one append", async () => {
    const { fake, ctx } = await ready();
    const asha = await saveAsha(ctx);
    // a second open row for the portion, typed by hand for someone else: a New tenant closes both
    await appendTenancy(fake, {
      id: "t-hand", portionId: "p1", tenant: "Bala", phone: "", moveIn: "2025-01-01", agreementEnd: "", advance: null, advanceDate: "",
      advanceStatus: null, refund: null, deductions: null, notes: "", moveOut: "", updatedBy: OWNER, updatedAt: "2025-01-01T05:00:00.000Z",
    });
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    fake.calls = [];
    const before = logged(fake).length;
    const result = await undoHari(ctx);
    expect((await readTenancies(fake)).filter((t) => t.portionId === "p1").map((t) => t.moveOut)).toEqual(["", ""]);
    expect(fake.calls.filter((call) => call === "appendRows")).toHaveLength(1);
    const added = logged(fake).slice(before);
    expect(added.map((row) => [row[1], row[3], row[4], row[5], row[6]])).toEqual([
      [asha.id, "Edited", "Move-out date", "2026-10-05", ""],
      ["t-hand", "Edited", "Move-out date", "2026-10-05", ""],
    ]);
    expect(result.historyRows).toHaveLength(2);
  });

  it("is also written when the New tenant was made with Replace over an entry", async () => {
    const { fake, ctx } = await ready();
    const asha = await saveAsha(ctx);
    await pay(ctx, { month: OCT });
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000, overwrite: true, expected: { tenant: "Asha", count: 4, amount: 5450 } });
    const before = logged(fake).length;
    const result = await undoHari(ctx);
    expect(result.historyWritten).toBe(true);
    expect(logged(fake).slice(before).map((row) => [row[1], row[3], row[4], row[5], row[6]])).toEqual([[asha.id, "Edited", "Move-out date", "2026-10-05", ""]]);
  });
});

describe("an undo that opens nothing", () => {
  it("adds nothing to the Tenancy Log and gives no history fields, for an ordinary payment", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT });
    const before = structuredClone(fake.tabs.get(TENANCY_LOG_TAB));
    fake.calls = [];
    const result = await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } }, payOptions());
    expect(fake.calls).not.toContain("appendRows");
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual(before);
    expect(result).not.toHaveProperty("historyWritten");
    expect(result).not.toHaveProperty("historyRows");
  });

  it("adds nothing for a first payment that closed no tenancy, or when the portion has another open tenancy", async () => {
    const { fake, ctx } = await ready();
    // no tenancy at all: the New tenant closes nothing
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    const result = await undoHari(ctx);
    expect(result).not.toHaveProperty("historyWritten");
    expect(logged(fake)).toEqual([]);

    // a New tenant with details: the portion has an open tenancy again, so nothing is opened
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000, tenancy: { moveIn: "2026-10-01" } });
    const before = logged(fake).length;
    const second = await undoHari(ctx);
    expect(second).not.toHaveProperty("historyWritten");
    expect(logged(fake)).toHaveLength(before);
  });

  it("adds nothing for a row the read back did not show opened", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    const before = logged(fake).length;
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => original(writes.filter((write) => write.tab !== TENANTS_TAB)); // a lost write
    const result = await undoHari(ctx);
    expect(result).not.toHaveProperty("historyWritten");
    expect(logged(fake)).toHaveLength(before);
  });

  it("adds nothing when opening the tenancy failed", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    const before = logged(fake).length;
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => {
      if (writes.some((write) => write.tab === TENANTS_TAB)) throw new Error("updateValues failed on the Tenants tab");
      return original(writes);
    };
    const result = await undoHari(ctx);
    expect(result).not.toHaveProperty("historyWritten");
    expect(logged(fake)).toHaveLength(before);
  });
});

describe("when the history of the undo cannot be written", () => {
  async function closedByHari() {
    const { fake, ctx } = await ready();
    const asha = await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    return { fake, ctx, asha };
  }

  it("still undoes the payment and opens the tenancy, says the history was not written and keeps the row for a retry", async () => {
    const { fake, ctx, asha } = await closedByHari();
    const before = logged(fake).length;
    fake.failOn.add("appendRows");
    const result = await undoHari(ctx, MEMBER);
    expect(result).toMatchObject({ removed: { tenant: "Hari" }, logWritten: true, historyWritten: false });
    expect(result.historyRows).toEqual([[expect.any(String), asha.id, "p1", "Edited", "Move-out date", "2026-10-05", "", MEMBER]]);
    // the undo itself stands: the Schedule is cleared, the Payments Log has its Undone row, the tenancy is open again
    expect((await readTenancies(fake)).find((t) => t.id === asha.id)).toMatchObject({ moveOut: "" });
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1][8]).toBe("Undone");
    expect(logged(fake)).toHaveLength(before);
  });

  it("logs one tenancy-log-append-failed line, with no name, phone or note", async () => {
    const { fake, ctx } = await closedByHari();
    fake.failOn.add("appendRows");
    await undoHari(ctx);
    const lines = loggedLines(logs.error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "tenancy-log-append-failed" });
    const all = [logs.info, logs.warn, logs.error].flatMap((spy) => spy.mock.calls.flat()).join("\n");
    expect(all).not.toMatch(/Asha|Hari|CANARY/);
  });

  it("gives the history up after HISTORY_LIMIT_MS when Google never answers, and the undo still comes back", async () => {
    const { fake, ctx } = await closedByHari();
    vi.useFakeTimers();
    fake.hangAppendRows = true;
    let result: Awaited<ReturnType<typeof undoHari>> | undefined;
    void undoHari(ctx).then((value) => (result = value));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toMatchObject({ removed: { tenant: "Hari" }, historyWritten: false });
  });

  it("is added once by the retry, and the same retry again adds nothing", async () => {
    const { fake, ctx, asha } = await closedByHari();
    const before = logged(fake).length;
    fake.failOn.add("appendRows");
    const { historyRows } = await undoHari(ctx);
    fake.failOn.delete("appendRows");
    expect(await retryTenancyHistory(ctx, historyRows!, 0)).toBe(true);
    expect(await retryTenancyHistory(ctx, historyRows!, 0)).toBe(true);
    expect(logged(fake).slice(before)).toEqual([[expect.any(String), asha.id, "p1", "Edited", "Move-out date", "2026-10-05", "", OWNER]]);
  });
});

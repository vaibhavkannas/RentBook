import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import { closedByRequest } from "@/lib/sheets/tenancy-writes";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";
import { getMonthView, getSettings, logPayment, undoPayment, type LogPaymentInput, type SheetsContext } from "@/lib/sheets/service";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import { moveOutTenancy, saveTenancy } from "@/lib/sheets/tenancy-service";
import { appendTenancy, readTenancies, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

// The app's own flows close tenancies in the Tenants tab: a New tenant closes the portion's open tenancy on the day the rent
// was received. The vacancy rule must never read such a closing as a move-out that nobody recorded: a live tenant's rent
// must not disappear from the month. A closing the owner recorded with Move out is the only thing that makes a portion vacant.

const OCT = { year: 2026, month: 10 };
const NOV = { year: 2026, month: 11 };
const DEC = { year: 2026, month: 12 };

/** Every step of a flow has its own moment, as in life: the stamps of two requests are never equal. */
let tick = 0;
const at = () => new Date(Date.UTC(2026, 9, 5, 4, 30, 0) + 1000 * ++tick);
const stamp = (by = "owner@example.com") => ({ now: at(), updatedBy: by });
const payOptions = (by = "owner@example.com") => ({ now: at(), retryDelayMs: 0, loggedBy: by });

async function ready() {
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getSettings(ctx);
  fake.calls = [];
  return { fake, ctx };
}

const DETAILS = { phone: "98765 43210", moveIn: "2026-01-15", advance: 20000, advanceDate: "2026-01-10", notes: "" };
const saveAsha = (ctx: SheetsContext) => saveTenancy(ctx, { portionId: "p1", tenant: "Asha", fields: DETAILS }, stamp());
const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { month: { year: number; month: number } }, by?: string) =>
  logPayment(ctx, { portionId: "p1", amount: 5450, dateReceived: "2026-10-05", ...input }, payOptions(by));

/** What the three months look like for the portion: the status and what is due. */
async function months(ctx: SheetsContext) {
  const out: string[] = [];
  for (const month of [OCT, NOV, DEC]) {
    const view = await getMonthView(ctx, month);
    out.push(`${month.month}:${view.cards[0].status}/due=${view.due}`);
  }
  return out;
}

const asha = async (ctx: SheetsContext) => (await readTenancies(ctx.gateway)).filter((t) => t.portionId === "p1");

/** Today's app, before vacancy existed: every month after Asha's October is pending, due 32,885 each. */
const ALL_DUE = ["10:pending/due=32885", "11:pending/due=32885", "12:pending/due=32885"];

describe("New tenant with the name of the tenant who is there", () => {
  it("leaves the tenant's open tenancy open, and the months after it due", async () => {
    const { ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Asha" });

    expect(await months(ctx)).toEqual(["10:paid/due=32885", "11:pending/due=32885", "12:pending/due=32885"]);
    expect(await asha(ctx)).toMatchObject([{ tenant: "Asha", moveOut: "" }]);
  });

  it("works the same for another spelling of the name, and logs the next month plainly", async () => {
    const { ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "  ASHA " });
    expect((await getMonthView(ctx, NOV)).cards[0]).toMatchObject({ status: "pending", next: { tenant: "ASHA", count: 2 } });
    expect((await pay(ctx, { month: NOV, dateReceived: "2026-11-05" })).entry).toMatchObject({ count: 2 });
  });

  it("still closes the open tenancy of another name, as it always did", async () => {
    const { ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    expect(await asha(ctx)).toMatchObject([{ tenant: "Asha", moveOut: "2026-10-05" }]);
    // Hari is the tenant now: nothing is vacant
    expect(await months(ctx)).toEqual(["10:paid/due=33435", "11:pending/due=33435", "12:pending/due=33435"]);
  });

  it("closes only the tenancies of other names when a portion has several open rows", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    // a second open row for the portion, typed by hand for someone else
    await appendTenancy(fake, {
      id: "t-hand", portionId: "p1", tenant: "Bala", phone: "", moveIn: "2025-01-01", agreementEnd: "", advance: null, advanceDate: "",
      advanceStatus: null, refund: null, deductions: null, notes: "", moveOut: "", updatedBy: "owner@example.com", updatedAt: "2025-01-01T05:00:00.000Z",
    });
    await pay(ctx, { month: OCT, newTenantName: "Asha" });
    expect((await asha(ctx)).map((t) => [t.tenant, t.moveOut])).toEqual([["Asha", ""], ["Bala", "2026-10-05"]]);
  });
});

describe("a New tenant that is undone", () => {
  it("opens the tenancy it closed again, so nothing is vacant and a plain log for the next month works", async () => {
    const { ctx } = await ready();
    await saveAsha(ctx);
    const [open] = await asha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    expect((await asha(ctx))[0].moveOut).toBe("2026-10-05");

    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions("member@example.com"));

    const [reopened] = await asha(ctx);
    expect(reopened).toMatchObject({ id: open.id, tenant: "Asha", moveOut: "", updatedBy: "member@example.com", phone: "98765 43210", advance: 20000 });
    expect(await months(ctx)).toEqual(ALL_DUE);

    await pay(ctx, { month: OCT, dateReceived: "2026-10-06" });
    expect(await months(ctx)).toEqual(["10:paid/due=32885", "11:pending/due=32885", "12:pending/due=32885"]);
    expect((await pay(ctx, { month: NOV, dateReceived: "2026-11-06" })).entry).toEqual({ tenant: "Asha", count: 5, amount: 5450 });
  });

  it("writes only the Move-out date, Updated by and Updated at of the row, and reads them back", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    const before = structuredClone(fake.tabs.get(TENANTS_TAB));
    const undo = payOptions();
    fake.calls = [];
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, undo);
    const after = fake.tabs.get(TENANTS_TAB)!;
    // columns A to L are as they were; M, N, O are the move-out date (blank), who and when
    expect(after[1].slice(0, 12)).toEqual(before![1].slice(0, 12));
    expect(after[1].slice(12)).toEqual(["", "owner@example.com", undo.now.toISOString()]);
    expect(after.length).toBe(before!.length);
  });

  it("restores nothing for a closing the owner recorded with Move out, even on the day of a later New tenant", async () => {
    const { ctx } = await ready();
    await saveAsha(ctx);
    const [open] = await asha(ctx);
    await pay(ctx, { month: OCT, amount: 5450 });
    await moveOutTenancy(ctx, { id: open.id, expectedUpdatedAt: open.updatedAt, moveOut: "2026-10-05" }, stamp());
    // Nov and Dec are vacant for the owner's own reason
    expect(await months(ctx)).toEqual(["10:paid/due=32885", "11:vacant/due=27435", "12:vacant/due=27435"]);
    await pay(ctx, { month: NOV, newTenantName: "Hari", amount: 6000, dateReceived: "2026-11-05" });
    await undoPayment(ctx, { month: NOV, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions());
    expect((await asha(ctx))[0]).toMatchObject({ tenant: "Asha", moveOut: "2026-10-05" });
    expect((await getMonthView(ctx, NOV)).cards[0].status).toBe("vacant");
  });

  it("does not open a tenancy that was closed by the same person on the same day but by an earlier request", async () => {
    const { ctx } = await ready();
    await saveAsha(ctx);
    const [open] = await asha(ctx);
    await moveOutTenancy(ctx, { id: open.id, expectedUpdatedAt: open.updatedAt, moveOut: "2026-10-05" }, stamp());
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions());
    expect((await asha(ctx))[0].moveOut).toBe("2026-10-05");
  });

  it("opens nothing while the portion has another open tenancy (a New tenant with details), and changes no row", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000, tenancy: { moveIn: "2026-10-01" } });
    const before = structuredClone(fake.tabs.get(TENANTS_TAB));
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions());
    expect(fake.tabs.get(TENANTS_TAB)).toEqual(before);
    // the portion has a current tenancy (Hari's), so nothing is vacant
    expect((await getMonthView(ctx, NOV)).cards[0].status).toBe("pending");
  });

  it("still undoes the payment when the Payments Log entry is missing, and opens nothing", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    fake.tabs.get(LOG_TAB)!.length = 1; // only the header: the entry was never logged
    const before = structuredClone(fake.tabs.get(TENANTS_TAB));
    const result = await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions());
    expect(result.removed).toMatchObject({ tenant: "Hari" });
    expect(fake.tabs.get(TENANTS_TAB)).toEqual(before);
  });

  it("still undoes the payment when opening the tenancy fails, and says nothing wrong about it", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => {
      if (writes.some((write) => write.tab === TENANTS_TAB)) throw new Error("updateValues failed on the Tenants tab");
      return original(writes);
    };
    const result = await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions());
    expect(result).toMatchObject({ removed: { tenant: "Hari" }, logWritten: true });
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("pending");
  });

  it("leaves an ordinary undo exactly as it was: no extra read of the Payments Log, no write to the Tenants tab", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT });
    const reads: string[] = [];
    const getValues = fake.getValues.bind(fake);
    fake.getValues = async (tab, a1, render) => {
      reads.push(tab);
      return getValues(tab, a1, render);
    };
    fake.calls = [];
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } }, payOptions());
    expect(reads).not.toContain(LOG_TAB);
    expect(fake.calls.filter((call) => call === "updateValues")).toHaveLength(1);
  });

  it("opens it again whoever undoes the entry: the closing and the log row carry the same person and moment", async () => {
    const { ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 }, "member@example.com");
    // the owner undoes what the member entered: the closing was stamped by the member, and so was the log row
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions("owner@example.com"));
    expect((await asha(ctx))[0].moveOut).toBe("");
  });
});

describe("closedByRequest", () => {
  const row = (overrides: Partial<Tenancy>): Tenancy => ({
    rowNumber: 2, id: "t-1", portionId: "p1", tenant: "Asha", phone: "", moveIn: "2026-01-15", agreementEnd: "", advance: null,
    advanceDate: "", advanceStatus: null, refund: null, deductions: null, notes: "", moveOut: "2026-10-05",
    updatedBy: "owner@example.com", updatedAt: "2026-10-05T04:30:01.000Z", ...overrides,
  });
  const request = { savedAt: "2026-10-05T04:30:01.000Z", loggedBy: "owner@example.com" };

  it("takes the closed rows of the portion that carry the request's moment and person", () => {
    expect(closedByRequest([row({})], "p1", request)).toHaveLength(1);
  });

  it("leaves out an open row, another portion's, another moment, another person, and a request with no moment", () => {
    expect(closedByRequest([row({ moveOut: "" })], "p1", request)).toEqual([]);
    expect(closedByRequest([row({ portionId: "p2" })], "p1", request)).toEqual([]);
    expect(closedByRequest([row({ updatedAt: "2026-10-05T04:30:02.000Z" })], "p1", request)).toEqual([]);
    expect(closedByRequest([row({ updatedBy: "member@example.com" })], "p1", request)).toEqual([]);
    expect(closedByRequest([row({ updatedAt: "" })], "p1", { savedAt: "", loggedBy: "owner@example.com" })).toEqual([]);
  });
});

describe("opening a closed tenancy again, when it does not take", () => {
  let logs: LogSpies;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => vi.restoreAllMocks());

  it("logs that the read back did not show it, and the undo stands", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    // the write is accepted and does nothing, as a lost write would
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => original(writes.filter((write) => write.tab !== TENANTS_TAB));
    const result = await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions());
    expect(result).toMatchObject({ removed: { tenant: "Hari" } });
    expect(loggedLines(logs.warn)).toEqual([expect.objectContaining({ event: "tenancy-reopen-not-confirmed" })]);
    expect(JSON.stringify(loggedLines(logs.warn))).not.toMatch(/Asha|Hari/);
  });

  it("logs the code of a failure, never the tenant", async () => {
    const { fake, ctx } = await ready();
    await saveAsha(ctx);
    await pay(ctx, { month: OCT, newTenantName: "Hari", amount: 6000 });
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => {
      if (writes.some((write) => write.tab === TENANTS_TAB)) throw new Error("updateValues failed on the Tenants tab");
      return original(writes);
    };
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Hari", count: 1, amount: 6000 } }, payOptions());
    const lines = loggedLines(logs.error);
    expect(lines).toEqual([expect.objectContaining({ event: "tenancy-reopen-failed" })]);
    expect(JSON.stringify(lines)).not.toMatch(/Asha|Hari/);
  });
});

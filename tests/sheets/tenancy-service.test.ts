import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Tenancy, TenancyFields } from "@/lib/domain/tenancy";
import { AppError } from "@/lib/errors";
import {
  getMonthView,
  getSettings,
  logPayment,
  withSnapshotCache,
  type LogPaymentInput,
  type SheetsContext,
} from "@/lib/sheets/service";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import {
  getPortionTenants,
  moveOutTenancy,
  saveTenancy,
  type SaveTenancyInput,
} from "@/lib/sheets/tenancy-service";
import { appendTenancy, readTenancies, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS, TOTAL_HEADER } from "../support/fixtures";

const NOW = new Date("2026-10-05T04:30:00Z");
const LATER = new Date("2026-10-06T09:00:00Z");
const OCT = { year: 2026, month: 10 };
const OPTIONS = { now: NOW, updatedBy: "owner@example.com" };
const LATER_OPTIONS = { now: LATER, updatedBy: "member@example.com" };
const PAY_OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "owner@example.com" };

type Row = Omit<Tenancy, "rowNumber">;

function setup() {
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

/** The Settings, Payments Log and Tenants tabs exist, and the call log is empty. */
async function ready() {
  const { fake, ctx } = setup();
  await getSettings(ctx);
  fake.calls = [];
  return { fake, ctx };
}

const FIELDS: TenancyFields = {
  phone: "98765 43210",
  moveIn: "2026-01-15",
  agreementEnd: "2027-01-14",
  advance: 20000,
  advanceDate: "2026-01-10",
  notes: "Paid by cheque",
};

const create = (ctx: SheetsContext, overrides: Partial<SaveTenancyInput> = {}, options = OPTIONS) =>
  saveTenancy(ctx, { portionId: "p1", tenant: "Asha", fields: FIELDS, ...overrides }, options);

const tenancies = (ctx: SheetsContext) => readTenancies(ctx.gateway);

/** A row written straight into the Tenants tab, as if it came from the Sheet. */
function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "t-seed",
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
    moveOut: "",
    updatedBy: "owner@example.com",
    updatedAt: "2026-01-15T05:00:00.000Z",
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const snapshotOf = (fake: FakeGateway) => structuredClone([...fake.tabs.entries()]);

/**
 * Types a tenant name into the portion's latest Schedule row (Sep-26, sheet row 5), as if someone
 * had edited the Sheet by hand. The portion must already have an entry there.
 */
function setScheduleTenant(fake: FakeGateway, portionId: string, name: string) {
  const index = PORTIONS.findIndex((p) => p.id === portionId);
  fake.tabs.get("Schedule")![4][1 + 3 * index] = name;
}

/** A row pushed into the Tenants tab exactly as typed, with no cleaning (a hand-edited Sheet). */
function pushRawRow(fake: FakeGateway, cells: unknown[]) {
  fake.tabs.get(TENANTS_TAB)!.push([...cells]);
}

const RAW_ASHA = [
  "t-raw", "p1", "Asha", "98765 43210", "2026-01-15", "2027-01-14", "20,000 rupees", "2026-01-10",
  "paid back", "see notes", "about 500", "=HYPERLINK(1)", "", "owner@example.com", "2026-01-15T05:00:00.000Z",
];

/**
 * Makes writes to the Tenants tab fail while writes to every other tab keep working.
 * (`failOn.add("appendRow")` would also break the Payments Log, so the fake is wrapped instead.)
 * Install it after the tabs exist: creating the Tenants tab is itself an `updateValues` call.
 */
function failTenantsWrites(fake: FakeGateway, which: "appendRow" | "updateValues") {
  if (which === "appendRow") {
    const original = fake.appendRow.bind(fake);
    fake.appendRow = async (tab, values) => {
      if (tab === TENANTS_TAB) throw new Error("appendRow failed on the Tenants tab");
      return original(tab, values);
    };
  } else {
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => {
      if (writes.some((write) => write.tab === TENANTS_TAB)) {
        throw new Error("updateValues failed on the Tenants tab");
      }
      return original(writes);
    };
  }
}

/** RAW_ASHA plus a column added by hand to the right of O. */
const HAND_TYPED_ROW = [...RAW_ASHA, "flat key given"];

/** Records every CellWrite the fake receives, and still applies it. */
function recordUpdates(fake: FakeGateway) {
  const writes: Array<{ a1: string; values: unknown[][] }> = [];
  const original = fake.updateValues.bind(fake);
  fake.updateValues = async (cellWrites) => {
    writes.push(...cellWrites.map(({ a1, values }) => ({ a1, values })));
    return original(cellWrites);
  };
  return writes;
}

/** The columns (0-based) whose cells are the same before and after. */
function unchangedColumns(before: unknown[], after: unknown[]): number[] {
  const length = Math.max(before.length, after.length);
  return Array.from({ length }, (_, index) => index).filter((index) => before[index] === after[index]);
}

describe("saveTenancy: create", () => {
  it("appends one row with id, portion, name, fields, who and when", async () => {
    const { fake, ctx } = await ready();
    const { tenancy } = await create(ctx);

    expect(fake.calls.filter((call) => call === "appendRow")).toHaveLength(1);
    expect(tenancy.id).toMatch(/^t-[0-9a-z]+$/);
    expect(await tenancies(ctx)).toEqual([
      {
        rowNumber: 2,
        id: tenancy.id,
        portionId: "p1",
        tenant: "Asha",
        phone: "98765 43210",
        moveIn: "2026-01-15",
        agreementEnd: "2027-01-14",
        advance: 20000,
        advanceDate: "2026-01-10",
        advanceStatus: "Held",
        refund: null,
        deductions: null,
        notes: "Paid by cheque",
        moveOut: "",
        updatedBy: "owner@example.com",
        updatedAt: "2026-10-05T04:30:00.000Z",
      },
    ]);
    expect(tenancy).toMatchObject({ rowNumber: 2, tenant: "Asha", updatedAt: "2026-10-05T04:30:00.000Z" });
  });

  it("creates the Tenants tab on first use", async () => {
    const { fake, ctx } = setup();
    await create(ctx);
    expect(fake.tabs.has(TENANTS_TAB)).toBe(true);
    expect(await tenancies(ctx)).toHaveLength(1);
  });

  it("trims the name and the fields, and stores no status when there is no advance", async () => {
    const { ctx } = await ready();
    await create(ctx, {
      tenant: "  Asha  ",
      fields: { moveIn: " 2026-01-15 ", phone: " +91 98765 ", notes: "  note  " },
    });
    expect(await tenancies(ctx)).toMatchObject([
      { tenant: "Asha", moveIn: "2026-01-15", phone: "+91 98765", notes: "note", advance: null, advanceStatus: null },
    ]);
  });

  it("gives an advance of zero the status Held", async () => {
    const { ctx } = await ready();
    await create(ctx, { fields: { moveIn: "2026-01-15", advance: 0 } });
    expect(await tenancies(ctx)).toMatchObject([{ advance: 0, advanceStatus: "Held" }]);
  });

  it("stores text that starts with = as text", async () => {
    const { fake, ctx } = await ready();
    // (The tenant name must match the Schedule's, and a Schedule cell starting with = reads as a formula,
    // so the name itself is covered at store level in tenants-store.test.ts.)
    await create(ctx, { fields: { moveIn: "2026-01-15", notes: "=HYPERLINK(1)" } });
    const cells = fake.tabs.get(TENANTS_TAB)![1];
    expect(cells[2]).toBe("Asha");
    expect(cells[11]).toBe("=HYPERLINK(1)");
  });

  it("refuses details for a tenant that already has current details, and writes nothing", async () => {
    const { fake, ctx } = await ready();
    await create(ctx);
    const before = snapshotOf(fake);
    const error = await expectCode(create(ctx, { tenant: " ASHA " }), "conflict");
    expect(error.message).toBe("Details already exist for ASHA. Refresh the page.");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("closes the previous current tenancy of the portion when the name differs: append, then close", async () => {
    const { fake, ctx } = await ready();
    const first = await create(ctx);
    setScheduleTenant(fake, "p1", "Hari"); // the Sheet was edited by hand: Hari lives there now
    fake.calls = [];

    const second = await create(
      ctx,
      { tenant: "Hari", fields: { moveIn: "2026-10-01", advance: 30000 } },
      LATER_OPTIONS,
    );

    expect(fake.calls.filter((call) => call === "appendRow" || call === "updateValues")).toEqual([
      "appendRow",
      "updateValues",
    ]);
    const [old, current] = await tenancies(ctx);
    expect(old).toMatchObject({
      id: first.tenancy.id,
      tenant: "Asha",
      moveOut: "2026-10-01",
      updatedBy: "member@example.com",
      updatedAt: "2026-10-06T09:00:00.000Z",
      // everything else is as it was
      phone: "98765 43210",
      moveIn: "2026-01-15",
      advance: 20000,
      advanceStatus: "Held",
      notes: "Paid by cheque",
    });
    expect(current).toMatchObject({ id: second.tenancy.id, tenant: "Hari", moveOut: "", rowNumber: 3 });
  });

  it("closes the previous tenancy no earlier than its own move-in date", async () => {
    const { fake, ctx } = await ready();
    await create(ctx, { fields: { moveIn: "2026-10-20" } });
    setScheduleTenant(fake, "p1", "Hari");
    await create(ctx, { tenant: "Hari", fields: { moveIn: "2026-10-01" } });
    expect(await tenancies(ctx)).toMatchObject([{ tenant: "Asha", moveOut: "2026-10-20" }, { tenant: "Hari", moveOut: "" }]);
  });

  it("leaves the tenancies of other portions alone", async () => {
    const { fake, ctx } = await ready();
    await create(ctx, { portionId: "p2", tenant: "Bala" });
    await create(ctx, { portionId: "p1", tenant: "Asha" });
    setScheduleTenant(fake, "p1", "Hari");
    await create(ctx, { portionId: "p1", tenant: "Hari", fields: { moveIn: "2026-10-01" } });
    expect(await tenancies(ctx)).toMatchObject([
      { portionId: "p2", tenant: "Bala", moveOut: "" },
      { portionId: "p1", tenant: "Asha", moveOut: "2026-10-01" },
      { portionId: "p1", tenant: "Hari", moveOut: "" },
    ]);
  });

  it("allows new details for a portion whose last tenancy is already closed", async () => {
    const { ctx } = await ready();
    const first = await create(ctx);
    await moveOutTenancy(
      ctx,
      { id: first.tenancy.id, expectedUpdatedAt: first.tenancy.updatedAt, moveOut: "2026-09-30" },
      LATER_OPTIONS,
    );
    await create(ctx, { tenant: "Asha", fields: { moveIn: "2026-10-10" } }, LATER_OPTIONS);
    expect(await tenancies(ctx)).toMatchObject([
      { tenant: "Asha", moveOut: "2026-09-30" },
      { tenant: "Asha", moveOut: "" },
    ]);
  });

  it("refuses an unknown portion and writes nothing", async () => {
    const { fake, ctx } = await ready();
    const before = snapshotOf(fake);
    const error = await expectCode(create(ctx, { portionId: "p9" }), "validation");
    expect(error.message).toBe('Unknown portion "p9".');
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("refuses details for a tenant other than the one the Schedule names now, and writes nothing", async () => {
    const { fake, ctx } = await ready();
    setScheduleTenant(fake, "p1", "Hari"); // the person's page still said Asha
    const before = snapshotOf(fake);
    const error = await expectCode(create(ctx, { tenant: "Asha" }), "conflict");
    expect(error.message).toBe("The tenant for First floor, single bedroom changed. Refresh the page.");
    expect(snapshotOf(fake)).toEqual(before);
    expect(fake.calls).not.toContain("appendRow");
    expect(fake.calls).not.toContain("updateValues");
  });

  it("compares the tenant name with the Schedule's ignoring case and spaces", async () => {
    const { fake, ctx } = await ready();
    setScheduleTenant(fake, "p1", "  hARi ");
    await create(ctx, { tenant: "Hari" });
    expect(await tenancies(ctx)).toMatchObject([{ portionId: "p1", tenant: "Hari" }]);
  });

  it("refuses details for a portion that has no tenant in the Schedule, and writes nothing", async () => {
    const { fake, ctx } = await ready();
    const before = snapshotOf(fake);
    // p4 has never had an entry
    const error = await expectCode(create(ctx, { portionId: "p4", tenant: "Farah" }), "validation");
    expect(error.message).toBe("This portion has no tenant yet.");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("treats a blank tenant cell in the Schedule as no tenant", async () => {
    const { fake, ctx } = await ready();
    setScheduleTenant(fake, "p1", "   ");
    const before = snapshotOf(fake);
    const error = await expectCode(create(ctx, { tenant: "Asha" }), "validation");
    expect(error.message).toBe("This portion has no tenant yet.");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("closes the previous tenancy by writing only Move-out date, Updated by and Updated at", async () => {
    const { fake, ctx } = await ready();
    pushRawRow(fake, RAW_ASHA);
    const rowBefore = [...fake.tabs.get(TENANTS_TAB)![1]];
    setScheduleTenant(fake, "p1", "Hari");
    fake.calls = [];
    const updates: Array<{ a1: string; values: unknown[][] }> = [];
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => {
      updates.push(...writes.map(({ a1, values }) => ({ a1, values })));
      return original(writes);
    };

    await create(ctx, { tenant: "Hari", fields: { moveIn: "2026-10-01" } }, LATER_OPTIONS);

    expect(updates).toEqual([
      { a1: "M2:O2", values: [["2026-10-01", "member@example.com", "2026-10-06T09:00:00.000Z"]] },
    ]);
    const rowAfter = fake.tabs.get(TENANTS_TAB)![1];
    // hand-typed text in the amount columns, the status and the notes is exactly as it was
    expect(rowAfter.slice(0, 12)).toEqual(rowBefore.slice(0, 12));
    expect(rowAfter.slice(12)).toEqual(["2026-10-01", "member@example.com", "2026-10-06T09:00:00.000Z"]);
  });

  it("closes EVERY other open tenancy of the portion, and no other portion's", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ id: "dup-1", moveIn: "2026-01-15" }));
    await appendTenancy(fake, row({ id: "dup-2", moveIn: "2026-10-20" })); // a hand-copied row
    await appendTenancy(fake, row({ id: "other", portionId: "p2", tenant: "Bala" }));
    await appendTenancy(fake, row({ id: "done", moveIn: "2025-01-01", moveOut: "2025-12-31" }));
    setScheduleTenant(fake, "p1", "Hari");
    fake.calls = [];

    const { tenancy } = await create(ctx, { tenant: "Hari", fields: { moveIn: "2026-10-01" } }, LATER_OPTIONS);

    expect(fake.calls.filter((call) => call === "appendRow" || call === "updateValues")).toEqual([
      "appendRow",
      "updateValues",
      "updateValues",
    ]);
    expect(await tenancies(ctx)).toMatchObject([
      { id: "dup-1", moveOut: "2026-10-01", updatedBy: "member@example.com" },
      { id: "dup-2", moveOut: "2026-10-20", updatedBy: "member@example.com" }, // never before its own move-in
      { id: "other", moveOut: "", updatedBy: "owner@example.com" },
      { id: "done", moveOut: "2025-12-31", updatedBy: "owner@example.com" },
      { id: tenancy.id, tenant: "Hari", moveOut: "" },
    ]);
  });

  it.each([
    ["an empty name", { tenant: "   " }],
    ["a name over 60 characters", { tenant: "x".repeat(61) }],
    ["a phone with a line break", { fields: { moveIn: "2026-01-15", phone: "98765\n43210" } }],
    ["no move-in date", { fields: { moveIn: "" } }],
    ["an agreement end before move-in", { fields: { moveIn: "2026-01-15", agreementEnd: "2026-01-14" } }],
    ["a fractional advance", { fields: { moveIn: "2026-01-15", advance: 1.5 } }],
    ["notes over 500 characters", { fields: { moveIn: "2026-01-15", notes: "n".repeat(501) } }],
  ] as Array<[string, Partial<SaveTenancyInput>]>)("refuses %s before touching the sheet", async (_name, overrides) => {
    const { fake, ctx } = setup();
    await expectCode(create(ctx, overrides), "validation");
    expect(fake.calls).toEqual([]);
  });
});

describe("saveTenancy: update", () => {
  async function created() {
    const { fake, ctx } = await ready();
    const { tenancy } = await create(ctx);
    fake.calls = [];
    return { fake, ctx, tenancy };
  }

  const edit = (ctx: SheetsContext, tenancy: Tenancy, fields: TenancyFields, overrides: Partial<SaveTenancyInput> = {}) =>
    saveTenancy(
      ctx,
      {
        portionId: "p1",
        tenant: "ignored on update",
        fields,
        id: tenancy.id,
        expectedUpdatedAt: tenancy.updatedAt,
        ...overrides,
      },
      LATER_OPTIONS,
    );

  it("changes only the editable fields, refreshes who and when, and uses one write", async () => {
    const { fake, ctx, tenancy } = await created();
    const { tenancy: saved } = await edit(ctx, tenancy, {
      phone: "99999 11111",
      moveIn: "2026-01-20",
      agreementEnd: "2027-02-01",
      advance: 25000,
      advanceDate: "2026-01-18",
      notes: "Raised advance",
    });

    expect(fake.calls.filter((call) => call !== "getValues")).toEqual(["updateValues"]);
    expect(await tenancies(ctx)).toEqual([
      {
        rowNumber: 2,
        id: tenancy.id,
        portionId: "p1",
        tenant: "Asha",
        phone: "99999 11111",
        moveIn: "2026-01-20",
        agreementEnd: "2027-02-01",
        advance: 25000,
        advanceDate: "2026-01-18",
        advanceStatus: "Held",
        refund: null,
        deductions: null,
        notes: "Raised advance",
        moveOut: "",
        updatedBy: "member@example.com",
        updatedAt: "2026-10-06T09:00:00.000Z",
      },
    ]);
    expect(saved).toMatchObject({ rowNumber: 2, phone: "99999 11111", updatedAt: "2026-10-06T09:00:00.000Z" });
  });

  it("writes only its own columns, in one updateValues call, and leaves the other cells of a hand-typed row alone", async () => {
    const { fake, ctx } = await ready();
    pushRawRow(fake, HAND_TYPED_ROW);
    const [stored] = await tenancies(ctx);
    const typedBefore = [...fake.tabs.get(TENANTS_TAB)![1]];
    fake.calls = [];
    const writes = recordUpdates(fake);

    await edit(
      ctx,
      stored,
      {
        phone: "99999 11111",
        moveIn: "2026-01-20",
        agreementEnd: "2027-02-01",
        advance: 21000,
        advanceDate: "2026-01-18",
        notes: "Raised advance",
      },
      { id: stored.id },
    );

    expect(fake.calls.filter((call) => call === "updateValues")).toHaveLength(1);
    expect(writes.map((write) => write.a1)).toEqual(["D2:I2", "L2", "N2:O2"]);
    const after = fake.tabs.get(TENANTS_TAB)![1];
    // the ID, portion and tenant, hand-typed Refund and Deductions, Move-out date, and the extra column
    expect(unchangedColumns(typedBefore, after)).toEqual([0, 1, 2, 9, 10, 12, 15]);
    expect(after.slice(3, 9)).toEqual(["99999 11111", "2026-01-20", "2027-02-01", 21000, "2026-01-18", "Held"]);
    expect(after[11]).toBe("Raised advance");
    expect(after.slice(13, 15)).toEqual(["member@example.com", "2026-10-06T09:00:00.000Z"]);
  });

  describe("on a hand-edited row only what the person changed is written", () => {
    // A clean row typed straight into the Sheet; each test changes the cells it is about.
    const CELLS = [
      "t-hand", "p1", "Asha", "98765 43210", "2026-01-15", "2027-01-14", 20000, "2026-01-10",
      "Held", "", "", "Paid by cheque", "", "owner@example.com", "2026-01-15T05:00:00.000Z",
    ];
    const typed = (changes: Record<number, unknown>) =>
      CELLS.map((cell, index) => (index in changes ? changes[index] : cell));

    /** The fields an edit screen sends back when it was shown this tenancy and the person changed `changes`. */
    const sent = (stored: Tenancy, changes: Partial<TenancyFields> = {}): TenancyFields => ({
      phone: stored.phone,
      moveIn: stored.moveIn,
      agreementEnd: stored.agreementEnd,
      advance: stored.advance,
      advanceDate: stored.advanceDate,
      notes: stored.notes,
      ...changes,
    });

    async function handTyped(cells: unknown[]) {
      const { fake, ctx } = await ready();
      pushRawRow(fake, cells);
      const [stored] = await tenancies(ctx);
      const before = [...fake.tabs.get(TENANTS_TAB)![1]];
      fake.calls = [];
      const writes = recordUpdates(fake);
      return { fake, ctx, stored, before, writes };
    }

    it("leaves text typed into Advance, the status next to it and the notes when only the phone changes", async () => {
      const { fake, ctx, stored, before, writes } = await handTyped(HAND_TYPED_ROW);
      expect(stored).toMatchObject({ advance: null, advanceStatus: null });

      const { tenancy: saved } = await edit(ctx, stored, sent(stored, { phone: "99999 11111" }), { id: stored.id });

      expect(fake.calls.filter((call) => call === "updateValues")).toHaveLength(1);
      expect(writes).toEqual([
        { a1: "D2", values: [["99999 11111"]] },
        { a1: "N2:O2", values: [["member@example.com", "2026-10-06T09:00:00.000Z"]] },
      ]);
      const after = fake.tabs.get(TENANTS_TAB)![1];
      expect(after[6]).toBe("20,000 rupees");
      expect(after[8]).toBe("paid back");
      expect(after[11]).toBe("=HYPERLINK(1)");
      // everything but Phone, Updated by and Updated at is as it was, the extra column too
      expect(unchangedColumns(before, after)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15]);
      // the person is told what the Sheet holds, not a value that was never written
      expect(saved).toMatchObject({ phone: "99999 11111", advance: null, advanceStatus: null });
    });

    it("writes only Updated by and Updated at when nothing was changed", async () => {
      const { fake, ctx, stored, before, writes } = await handTyped(HAND_TYPED_ROW);

      await edit(ctx, stored, sent(stored), { id: stored.id });

      expect(writes).toEqual([
        { a1: "N2:O2", values: [["member@example.com", "2026-10-06T09:00:00.000Z"]] },
      ]);
      expect(unchangedColumns(before, fake.tabs.get(TENANTS_TAB)![1])).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15,
      ]);
    });

    it("does not touch the notes when they come back the same apart from surrounding spaces", async () => {
      const { ctx, stored, writes } = await handTyped(typed({ 11: "  two keys  ", 3: " 98765 43210 " }));

      await edit(ctx, stored, sent(stored, { notes: "two keys", phone: "98765 43210" }), { id: stored.id });

      expect(writes.map((write) => write.a1)).toEqual(["N2:O2"]);
    });

    it("does not rewrite an unknown status when the advance did not change", async () => {
      const { fake, ctx, stored, writes } = await handTyped(typed({ 8: "paid back" }));
      expect(stored).toMatchObject({ advance: 20000, advanceStatus: null });

      await edit(ctx, stored, sent(stored, { notes: "Cheque cleared" }), { id: stored.id });

      expect(writes.map((write) => write.a1)).toEqual(["L2", "N2:O2"]);
      expect(fake.tabs.get(TENANTS_TAB)![1][8]).toBe("paid back");
    });

    it("does not rewrite an unknown status when only the advance amount changes", async () => {
      const { fake, ctx, stored, writes } = await handTyped(typed({ 8: "paid back" }));

      await edit(ctx, stored, sent(stored, { advance: 25000 }), { id: stored.id });

      expect(writes.map((write) => write.a1)).toEqual(["G2", "N2:O2"]);
      const after = fake.tabs.get(TENANTS_TAB)![1];
      expect(after[6]).toBe(25000);
      expect(after[8]).toBe("paid back");
    });

    it("clears the advance and its status, and leaves the advance date, when the advance is removed", async () => {
      const { fake, ctx, stored, writes } = await handTyped(typed({ 8: "paid back" }));

      await edit(ctx, stored, sent(stored, { advance: null }), { id: stored.id });

      expect(writes.map((write) => write.a1)).toEqual(["G2", "I2", "N2:O2"]);
      const after = fake.tabs.get(TENANTS_TAB)![1];
      expect(after.slice(6, 9)).toEqual(["", "2026-01-10", ""]);
    });

    it("starts a new advance as Held, even over an unknown status", async () => {
      const { fake, ctx, stored, writes } = await handTyped(typed({ 6: "twenty thousand", 8: "paid back" }));

      await edit(ctx, stored, sent(stored, { advance: 15000 }), { id: stored.id });

      expect(writes.map((write) => write.a1)).toEqual(["G2", "I2", "N2:O2"]);
      expect(fake.tabs.get(TENANTS_TAB)![1].slice(6, 9)).toEqual([15000, "2026-01-10", "Held"]);
    });

    it("keeps a status that is readable when a hand-typed advance becomes a number", async () => {
      const { fake, ctx, stored } = await handTyped(typed({ 6: "twenty thousand", 8: "Refunded" }));

      await edit(ctx, stored, sent(stored, { advance: 15000 }), { id: stored.id });

      expect(fake.tabs.get(TENANTS_TAB)![1][8]).toBe("Refunded");
    });

    it("counts a Move-out date of only spaces as still current: it can be edited, and the cell is not written", async () => {
      const { fake, ctx, stored, writes } = await handTyped(typed({ 12: "   " }));
      expect(stored.moveOut).toBe("");

      await edit(ctx, stored, sent(stored, { phone: "99999 11111" }), { id: stored.id });

      expect(writes.map((write) => write.a1)).toEqual(["D2", "N2:O2"]);
      expect(fake.tabs.get(TENANTS_TAB)![1][12]).toBe("   ");
      const view = await getPortionTenants(ctx, "p1");
      expect(view.current).toMatchObject({ id: "t-hand", phone: "99999 11111", moveOut: "" });
      expect(view.past).toEqual([]);
    });

    it("can move out a tenancy whose Move-out date holds only spaces", async () => {
      const { fake, ctx, stored } = await handTyped(typed({ 12: "   " }));

      await moveOutTenancy(
        ctx,
        { id: stored.id, expectedUpdatedAt: stored.updatedAt, moveOut: "2026-09-30" },
        LATER_OPTIONS,
      );

      expect(fake.tabs.get(TENANTS_TAB)![1][12]).toBe("2026-09-30");
    });

    it("matches a portion id that has a stray space around it", async () => {
      const { fake, ctx, stored, writes } = await handTyped(typed({ 1: " p1 " }));
      expect(stored.portionId).toBe("p1");

      expect((await getPortionTenants(ctx, "p1")).current).toMatchObject({ id: "t-hand" });
      await edit(ctx, stored, sent(stored, { notes: "Spare key" }), { id: stored.id });

      expect(writes.map((write) => write.a1)).toEqual(["L2", "N2:O2"]);
      expect(fake.tabs.get(TENANTS_TAB)![1][1]).toBe(" p1 ");
    });

    it("closes a previous tenancy with a stray space in its portion id and spaces in its Move-out date for a new tenant", async () => {
      const { fake, ctx } = await ready();
      pushRawRow(fake, typed({ 1: " p1 ", 12: " " }));
      setScheduleTenant(fake, "p1", "Hari");
      const writes = recordUpdates(fake);

      await create(ctx, { tenant: "Hari", fields: { moveIn: "2026-10-01" } }, LATER_OPTIONS);

      expect(writes.map((write) => write.a1)).toEqual(["M2:O2"]);
      expect(fake.tabs.get(TENANTS_TAB)![1][12]).toBe("2026-10-01");
    });
  });

  it("keeps the tenant, status, refund, deductions and move-out of the stored row", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ advance: 20000, advanceStatus: "Adjusted", refund: 100, deductions: 200 }));
    const [stored] = await tenancies(ctx);
    await edit(ctx, stored, { moveIn: "2026-01-15", advance: 21000 }, { id: stored.id });
    expect(await tenancies(ctx)).toMatchObject([
      { tenant: "Asha", advance: 21000, advanceStatus: "Adjusted", refund: 100, deductions: 200, moveOut: "" },
    ]);
  });

  it("clears the status when the advance is removed", async () => {
    const { ctx, tenancy } = await created();
    await edit(ctx, tenancy, { moveIn: "2026-01-15", advance: null });
    expect(await tenancies(ctx)).toMatchObject([{ advance: null, advanceStatus: null }]);
  });

  it("sets the status to Held when an advance is added to a tenancy that had none", async () => {
    const { ctx } = await ready();
    const { tenancy } = await create(ctx, { fields: { moveIn: "2026-01-15" } });
    await edit(ctx, tenancy, { moveIn: "2026-01-15", advance: 15000 });
    expect(await tenancies(ctx)).toMatchObject([{ advance: 15000, advanceStatus: "Held" }]);
  });

  it("treats an omitted advance as none", async () => {
    const { ctx, tenancy } = await created();
    await edit(ctx, tenancy, { moveIn: "2026-01-15" });
    expect(await tenancies(ctx)).toMatchObject([{ advance: null, advanceStatus: null, phone: "", notes: "" }]);
  });

  it("stores text that starts with = as text", async () => {
    const { fake, ctx, tenancy } = await created();
    await edit(ctx, tenancy, { moveIn: "2026-01-15", notes: "=SUM(A1:A9)" });
    expect(fake.tabs.get(TENANTS_TAB)![1][11]).toBe("=SUM(A1:A9)");
  });

  it("refuses a stale screen with a conflict and writes nothing", async () => {
    const { fake, ctx, tenancy } = await created();
    const before = snapshotOf(fake);
    const error = await expectCode(
      edit(ctx, tenancy, { moveIn: "2026-01-15", notes: "late" }, { expectedUpdatedAt: "2026-10-04T00:00:00.000Z" }),
      "conflict",
    );
    expect(error.message).toMatch(/was changed by someone else\. Refresh the page and try again\.$/);
    expect(snapshotOf(fake)).toEqual(before);
    expect(fake.calls).not.toContain("updateValues");
  });

  it("refuses a second edit made from the screen that was already saved over", async () => {
    const { ctx, tenancy } = await created();
    await edit(ctx, tenancy, { moveIn: "2026-01-15", notes: "first" });
    await expectCode(edit(ctx, tenancy, { moveIn: "2026-01-15", notes: "second" }), "conflict");
    expect(await tenancies(ctx)).toMatchObject([{ notes: "first" }]);
  });

  it("requires the updated-at the person saw", async () => {
    const { fake, ctx, tenancy } = await created();
    const before = snapshotOf(fake);
    await expectCode(
      saveTenancy(ctx, { portionId: "p1", tenant: "Asha", fields: FIELDS, id: tenancy.id }, LATER_OPTIONS),
      "validation",
    );
    expect(snapshotOf(fake)).toEqual(before);
  });

  describe("a hand-typed row with a blank Updated at", () => {
    async function blankRow() {
      const { fake, ctx } = await ready();
      await appendTenancy(fake, row({ updatedAt: "", updatedBy: "" }));
      const [stored] = await tenancies(ctx);
      expect(stored.updatedAt).toBe("");
      return { fake, ctx, stored };
    }

    it("can be edited by a screen that also saw a blank", async () => {
      const { ctx, stored } = await blankRow();
      const { tenancy } = await edit(ctx, stored, { moveIn: "2026-01-15", notes: "typed by hand" });
      expect(tenancy.updatedAt).toBe("2026-10-06T09:00:00.000Z");
      expect(await tenancies(ctx)).toMatchObject([
        { notes: "typed by hand", updatedBy: "member@example.com", updatedAt: "2026-10-06T09:00:00.000Z" },
      ]);
    });

    it("is a conflict when the screen saw a value but the stored cell is blank", async () => {
      const { fake, ctx, stored } = await blankRow();
      const before = snapshotOf(fake);
      await expectCode(
        edit(ctx, stored, { moveIn: "2026-01-15" }, { expectedUpdatedAt: "2026-01-15T05:00:00.000Z" }),
        "conflict",
      );
      expect(snapshotOf(fake)).toEqual(before);
    });

    it("is a conflict when the screen saw a blank but the stored cell now has a value", async () => {
      const { fake, ctx } = await ready();
      await appendTenancy(fake, row());
      const [stored] = await tenancies(ctx);
      const before = snapshotOf(fake);
      await expectCode(edit(ctx, stored, { moveIn: "2026-01-15" }, { expectedUpdatedAt: "" }), "conflict");
      expect(snapshotOf(fake)).toEqual(before);
    });

    it("still needs the updated-at to be given at all", async () => {
      const { fake, ctx, stored } = await blankRow();
      const before = snapshotOf(fake);
      await expectCode(
        saveTenancy(ctx, { portionId: "p1", tenant: "Asha", fields: FIELDS, id: stored.id }, LATER_OPTIONS),
        "validation",
      );
      expect(snapshotOf(fake)).toEqual(before);
    });
  });

  describe("a row whose id was copied by hand", () => {
    const FIRST_AT = "2026-01-15T05:00:00.000Z";
    const SECOND_AT = "2026-03-01T05:00:00.000Z";

    async function duplicated(second: Partial<Row> = {}) {
      const { fake, ctx } = await ready();
      await appendTenancy(fake, row({ id: "dup", notes: "first", updatedAt: FIRST_AT }));
      await appendTenancy(fake, row({ id: "dup", notes: "second", updatedAt: SECOND_AT, ...second }));
      return { fake, ctx };
    }

    it("is edited in its LAST row, and the earlier row is left alone", async () => {
      const { fake, ctx } = await duplicated();
      const [first, last] = await tenancies(ctx);
      await edit(ctx, last, { moveIn: "2026-01-15", notes: "edited" }, { id: "dup" });
      expect(await tenancies(ctx)).toMatchObject([
        { rowNumber: 2, notes: "first", updatedAt: FIRST_AT },
        { rowNumber: 3, notes: "edited", updatedAt: "2026-10-06T09:00:00.000Z" },
      ]);
      expect((await tenancies(ctx))[0]).toEqual(first);
      expect(fake.calls.filter((call) => call === "updateValues")).toHaveLength(1);
    });

    it("is checked against the last row's updated-at, not the first row's", async () => {
      const { fake, ctx } = await duplicated();
      const [first] = await tenancies(ctx);
      const before = snapshotOf(fake);
      await expectCode(edit(ctx, first, { moveIn: "2026-01-15" }, { id: "dup" }), "conflict");
      expect(snapshotOf(fake)).toEqual(before);
    });

    it("is refused as moved out when the last row is closed, even though an earlier row is open", async () => {
      const { fake, ctx } = await duplicated({ moveOut: "2026-06-30" });
      const [, last] = await tenancies(ctx);
      const before = snapshotOf(fake);
      const error = await expectCode(edit(ctx, last, { moveIn: "2026-01-15" }, { id: "dup" }), "conflict");
      expect(error.message).toMatch(/already moved out/);
      expect(snapshotOf(fake)).toEqual(before);
    });
  });

  it("refuses a tenancy that has been closed", async () => {
    const { fake, ctx, tenancy } = await created();
    const { tenancy: closed } = await moveOutTenancy(
      ctx,
      { id: tenancy.id, expectedUpdatedAt: tenancy.updatedAt, moveOut: "2026-09-30" },
      LATER_OPTIONS,
    );
    const before = snapshotOf(fake);
    const error = await expectCode(edit(ctx, closed, { moveIn: "2026-01-15" }), "conflict");
    expect(error.message).toMatch(/already moved out/);
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("refuses the id of another portion's tenancy", async () => {
    const { fake, ctx } = await ready();
    const { tenancy: other } = await create(ctx, { portionId: "p2", tenant: "Bala" });
    const before = snapshotOf(fake);
    await expectCode(edit(ctx, other, { moveIn: "2026-01-15" }, { portionId: "p1" }), "validation");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("refuses an id that is not in the Tenants tab", async () => {
    const { fake, ctx, tenancy } = await created();
    const before = snapshotOf(fake);
    await expectCode(edit(ctx, tenancy, { moveIn: "2026-01-15" }, { id: "t-missing" }), "conflict");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("refuses an unknown portion", async () => {
    const { ctx, tenancy } = await created();
    await expectCode(edit(ctx, tenancy, { moveIn: "2026-01-15" }, { portionId: "p9" }), "validation");
  });

  it("refuses invalid fields and writes nothing", async () => {
    const { fake, ctx, tenancy } = await created();
    const before = snapshotOf(fake);
    await expectCode(edit(ctx, tenancy, { moveIn: "2026-01-15", agreementEnd: "2025-01-01" }), "validation");
    await expectCode(edit(ctx, tenancy, { moveIn: "2026-02-30" }), "validation");
    await expectCode(edit(ctx, tenancy, { moveIn: "2026-01-15", advance: -1 }), "validation");
    expect(snapshotOf(fake)).toEqual(before);
  });
});

describe("moveOutTenancy", () => {
  async function created(fields: TenancyFields = FIELDS) {
    const { fake, ctx } = await ready();
    const { tenancy } = await create(ctx, { fields });
    fake.calls = [];
    return { fake, ctx, tenancy };
  }

  const moveOut = (
    ctx: SheetsContext,
    tenancy: Tenancy,
    overrides: Partial<Parameters<typeof moveOutTenancy>[1]> = {},
    options = LATER_OPTIONS,
  ) =>
    moveOutTenancy(
      ctx,
      { id: tenancy.id, expectedUpdatedAt: tenancy.updatedAt, moveOut: "2026-09-30", ...overrides },
      options,
    );

  it("sets the move-out date, outcome, refund and deductions, keeps the notes, and uses one write", async () => {
    const { fake, ctx, tenancy } = await created();
    const { tenancy: closed } = await moveOut(ctx, tenancy, {
      advanceStatus: "Adjusted",
      refund: 15000,
      deductions: 5000,
    });

    expect(fake.calls.filter((call) => call !== "getValues")).toEqual(["updateValues"]);
    expect(await tenancies(ctx)).toEqual([
      {
        rowNumber: 2,
        id: tenancy.id,
        portionId: "p1",
        tenant: "Asha",
        phone: "98765 43210",
        moveIn: "2026-01-15",
        agreementEnd: "2027-01-14",
        advance: 20000,
        advanceDate: "2026-01-10",
        advanceStatus: "Adjusted",
        refund: 15000,
        deductions: 5000,
        notes: "Paid by cheque",
        moveOut: "2026-09-30",
        updatedBy: "member@example.com",
        updatedAt: "2026-10-06T09:00:00.000Z",
      },
    ]);
    expect(closed).toMatchObject({ rowNumber: 2, moveOut: "2026-09-30", refund: 15000 });
  });

  describe("on a hand-typed row", () => {
    // Advance (G) is text here, so the tenancy has no advance. Status, refund, deductions and notes hold text.
    async function typed(cells: unknown[] = HAND_TYPED_ROW) {
      const { fake, ctx } = await ready();
      pushRawRow(fake, cells);
      const [stored] = await tenancies(ctx);
      const typedBefore = [...fake.tabs.get(TENANTS_TAB)![1]];
      fake.calls = [];
      const writes = recordUpdates(fake);
      return { fake, ctx, stored, typedBefore, writes };
    }
    const updateCalls = (fake: FakeGateway) => fake.calls.filter((call) => call === "updateValues");
    const STAMP = ["member@example.com", "2026-10-06T09:00:00.000Z"];

    it("writes only the refund, deductions and move-out cells, in one call, when there is no advance to give an outcome for", async () => {
      const { fake, ctx, stored, typedBefore, writes } = await typed();

      await moveOut(ctx, stored, { advanceStatus: "Refunded", refund: 15000, deductions: 5000 });

      expect(updateCalls(fake)).toHaveLength(1);
      // a tenancy whose Advance cell is text has no advance, so the outcome is not written; no notes were given
      expect(writes.map((write) => write.a1)).toEqual(["J2:K2", "M2:O2"]);
      const after = fake.tabs.get(TENANTS_TAB)![1];
      // Tenancy ID to Advance status (hand-typed Advance and status included), the hand-typed Notes, the extra column
      expect(unchangedColumns(typedBefore, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 15]);
      expect(after[6]).toBe("20,000 rupees");
      expect(after[8]).toBe("paid back");
      expect(after[11]).toBe("=HYPERLINK(1)");
      expect(after.slice(9, 13)).toEqual([15000, 5000, "=HYPERLINK(1)", "2026-09-30"]);
      expect(after.slice(13, 15)).toEqual(STAMP);
    });

    it("writes only Move-out date, Updated by and Updated at when nothing else was given, and leaves hand-typed text in status, refund, deductions and notes", async () => {
      const { fake, ctx, stored, typedBefore, writes } = await typed();

      await moveOut(ctx, stored);

      expect(updateCalls(fake)).toHaveLength(1);
      expect(writes.map((write) => write.a1)).toEqual(["M2:O2"]);
      const after = fake.tabs.get(TENANTS_TAB)![1];
      expect(unchangedColumns(typedBefore, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15]);
      expect(after.slice(8, 12)).toEqual(["paid back", "see notes", "about 500", "=HYPERLINK(1)"]);
      expect(after.slice(12, 15)).toEqual(["2026-09-30", ...STAMP]);
    });

    it("writes the Notes cell too when notes are given, still in one call", async () => {
      const { fake, ctx, stored, typedBefore, writes } = await typed();

      await moveOut(ctx, stored, { notes: "Left the keys" });

      expect(updateCalls(fake)).toHaveLength(1);
      expect(writes.map((write) => write.a1)).toEqual(["L2:O2"]);
      const after = fake.tabs.get(TENANTS_TAB)![1];
      expect(unchangedColumns(typedBefore, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15]);
      expect(after[11]).toBe("Left the keys");
    });

    it("writes a given refund of null as an empty cell: the person asked for it", async () => {
      const { fake, ctx, stored, writes } = await typed();

      await moveOut(ctx, stored, { refund: null });

      expect(writes.map((write) => write.a1)).toEqual(["J2", "M2:O2"]);
      expect(fake.tabs.get(TENANTS_TAB)![1][9]).toBe("");
      expect(fake.tabs.get(TENANTS_TAB)![1][10]).toBe("about 500");
    });

    it("writes the outcome too when the Advance cell is a real number, and still leaves hand-typed refund text alone", async () => {
      const withAdvance: unknown[] = [...HAND_TYPED_ROW];
      withAdvance[6] = 20000;
      const { fake, ctx, stored, typedBefore, writes } = await typed(withAdvance);
      expect(stored.advance).toBe(20000);

      const { tenancy } = await moveOut(ctx, stored, { advanceStatus: "Refunded" });

      expect(updateCalls(fake)).toHaveLength(1);
      expect(writes.map((write) => write.a1)).toEqual(["I2", "M2:O2"]);
      const after = fake.tabs.get(TENANTS_TAB)![1];
      expect(after[8]).toBe("Refunded");
      expect(unchangedColumns(typedBefore, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 15]);
      expect(tenancy.advanceStatus).toBe("Refunded");
    });

    it("tells the caller what the Sheet still holds, not what was asked for, when the outcome was not written", async () => {
      const { ctx, stored } = await typed();
      const { tenancy } = await moveOut(ctx, stored, { advanceStatus: "Refunded" });
      expect(tenancy.advanceStatus).toBeNull();
    });
  });

  it("replaces the notes when new notes are given, including empty ones", async () => {
    const { ctx, tenancy } = await created();
    const { tenancy: closed } = await moveOut(ctx, tenancy, { notes: "  Left the keys  " });
    expect(closed.notes).toBe("Left the keys");
    expect(await tenancies(ctx)).toMatchObject([{ notes: "Left the keys" }]);

    const second = await created();
    await moveOut(second.ctx, second.tenancy, { notes: "" });
    expect(await tenancies(second.ctx)).toMatchObject([{ notes: "" }]);
  });

  it("keeps the existing outcome when none is given and the tenancy has an advance", async () => {
    const { ctx, tenancy } = await created();
    await moveOut(ctx, tenancy);
    expect(await tenancies(ctx)).toMatchObject([{ advanceStatus: "Held", refund: null, deductions: null }]);
  });

  it("keeps the outcome when null is given", async () => {
    const { ctx, tenancy } = await created();
    await moveOut(ctx, tenancy, { advanceStatus: null });
    expect(await tenancies(ctx)).toMatchObject([{ advanceStatus: "Held" }]);
  });

  it("stores no outcome when the tenancy has no advance", async () => {
    const { ctx, tenancy } = await created({ moveIn: "2026-01-15" });
    const { tenancy: closed } = await moveOut(ctx, tenancy, { advanceStatus: "Refunded" });
    expect(closed.advanceStatus).toBeNull();
    expect(await tenancies(ctx)).toMatchObject([{ advance: null, advanceStatus: null }]);
  });

  it("stores empty refund and deductions as nothing, and accepts the limits", async () => {
    const { ctx, tenancy } = await created();
    await moveOut(ctx, tenancy, { refund: null, deductions: 0 });
    expect(await tenancies(ctx)).toMatchObject([{ refund: null, deductions: 0 }]);

    const second = await created();
    await moveOut(second.ctx, second.tenancy, { refund: 10_000_000, deductions: 10_000_000 });
    expect(await tenancies(second.ctx)).toMatchObject([{ refund: 10_000_000, deductions: 10_000_000 }]);
  });

  it("allows moving out on the move-in day", async () => {
    const { ctx, tenancy } = await created();
    await moveOut(ctx, tenancy, { moveOut: "2026-01-15" });
    expect(await tenancies(ctx)).toMatchObject([{ moveOut: "2026-01-15" }]);
  });

  it("refuses a move-out before the move-in date and writes nothing", async () => {
    const { fake, ctx, tenancy } = await created();
    const before = snapshotOf(fake);
    const error = await expectCode(moveOut(ctx, tenancy, { moveOut: "2026-01-14" }), "validation");
    expect(error.message).toMatch(/before the move-in date/);
    expect(snapshotOf(fake)).toEqual(before);
  });

  it.each([
    ["a day that does not exist", { moveOut: "2026-02-30" }],
    ["text for a date", { moveOut: "30 Sep" }],
    ["a fractional refund", { refund: 1.5 }],
    ["a negative refund", { refund: -1 }],
    ["a refund over the limit", { refund: 10_000_001 }],
    ["a fractional deduction", { deductions: 0.5 }],
    ["a negative deduction", { deductions: -1 }],
    ["a deduction over the limit", { deductions: 10_000_001 }],
    ["an unknown outcome", { advanceStatus: "Lost" as never }],
    ["notes over 500 characters", { notes: "n".repeat(501) }],
  ])("refuses %s and writes nothing", async (_name, overrides) => {
    const { fake, ctx, tenancy } = await created();
    const before = snapshotOf(fake);
    await expectCode(moveOut(ctx, tenancy, overrides), "validation");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("refuses to close a tenancy that is already closed", async () => {
    const { fake, ctx, tenancy } = await created();
    const { tenancy: closed } = await moveOut(ctx, tenancy);
    const before = snapshotOf(fake);
    const error = await expectCode(moveOut(ctx, closed, { moveOut: "2026-10-02" }), "conflict");
    expect(error.message).toMatch(/already moved out/);
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("refuses a stale screen and writes nothing", async () => {
    const { fake, ctx, tenancy } = await created();
    await saveTenancy(
      ctx,
      { portionId: "p1", tenant: "Asha", fields: { moveIn: "2026-01-15", notes: "changed" }, id: tenancy.id, expectedUpdatedAt: tenancy.updatedAt },
      LATER_OPTIONS,
    );
    const before = snapshotOf(fake);
    const error = await expectCode(moveOut(ctx, tenancy), "conflict");
    expect(error.message).toMatch(/was changed by someone else\. Refresh the page and try again\.$/);
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("refuses an id that is not in the Tenants tab", async () => {
    const { fake, ctx, tenancy } = await created();
    const before = snapshotOf(fake);
    await expectCode(moveOut(ctx, tenancy, { id: "t-missing" }), "conflict");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("changes only the tenancy asked for", async () => {
    const { ctx } = await ready();
    await create(ctx, { portionId: "p2", tenant: "Bala" });
    const { tenancy } = await create(ctx);
    await moveOut(ctx, tenancy);
    expect(await tenancies(ctx)).toMatchObject([
      { tenant: "Bala", moveOut: "" },
      { tenant: "Asha", moveOut: "2026-09-30" },
    ]);
  });

  it("moves out a hand-typed row with a blank Updated at, for a screen that also saw a blank", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ updatedAt: "", updatedBy: "" }));
    const [stored] = await tenancies(ctx);
    const { tenancy } = await moveOut(ctx, stored);
    expect(tenancy).toMatchObject({ moveOut: "2026-09-30", updatedAt: "2026-10-06T09:00:00.000Z" });
    expect(await tenancies(ctx)).toMatchObject([{ moveOut: "2026-09-30", updatedBy: "member@example.com" }]);
  });

  it("refuses a move-out when the screen saw a value but the stored Updated at is blank", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ updatedAt: "" }));
    const [stored] = await tenancies(ctx);
    const before = snapshotOf(fake);
    await expectCode(moveOut(ctx, stored, { expectedUpdatedAt: "2026-01-15T05:00:00.000Z" }), "conflict");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("still needs the updated-at to be given at all", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ updatedAt: "" }));
    const before = snapshotOf(fake);
    await expectCode(
      moveOutTenancy(ctx, { id: "t-seed", moveOut: "2026-09-30" } as Parameters<typeof moveOutTenancy>[1], LATER_OPTIONS),
      "validation",
    );
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("moves out the LAST row when an id was copied by hand, and leaves the earlier row alone", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ id: "dup", notes: "first", updatedAt: "2026-01-15T05:00:00.000Z" }));
    await appendTenancy(fake, row({ id: "dup", notes: "second", updatedAt: "2026-03-01T05:00:00.000Z" }));
    const [first, last] = await tenancies(ctx);

    await expectCode(moveOut(ctx, first), "conflict"); // the screen of the first row is stale: the last row wins
    expect(await tenancies(ctx)).toEqual([first, last]);

    await moveOut(ctx, last);
    const [firstAfter, lastAfter] = await tenancies(ctx);
    expect(firstAfter).toEqual(first);
    expect(lastAfter).toMatchObject({ moveOut: "2026-09-30", notes: "second" });
    expect(fake.calls.filter((call) => call === "updateValues")).toHaveLength(1);
  });
});

describe("getPortionTenants", () => {
  it("returns the current tenancy only when its name matches the Schedule's tenant", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ tenant: " asha " }));
    const result = await getPortionTenants(ctx, "p1");
    expect(result.portion).toMatchObject({ id: "p1", name: "First floor, single bedroom" });
    expect(result.scheduleTenant).toBe("Asha");
    expect(result.current).toMatchObject({ id: "t-seed", rowNumber: 2 });
    expect(result.mismatched).toBeNull();
    expect(result.past).toEqual([]);
  });

  it("reports a current tenancy for a different name as mismatched", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ tenant: "Bala" }));
    const result = await getPortionTenants(ctx, "p1");
    expect(result.current).toBeNull();
    expect(result.mismatched).toMatchObject({ id: "t-seed", tenant: "Bala" });
  });

  it("reports a tenancy as mismatched when the portion has no tenant in the Schedule", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ portionId: "p4", tenant: "Farah" }));
    const result = await getPortionTenants(ctx, "p4");
    expect(result.scheduleTenant).toBeNull();
    expect(result.current).toBeNull();
    expect(result.mismatched).toMatchObject({ tenant: "Farah" });
  });

  it("has neither current nor mismatched when only closed tenancies exist", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ moveOut: "2026-08-31" }));
    const result = await getPortionTenants(ctx, "p1");
    expect(result.current).toBeNull();
    expect(result.mismatched).toBeNull();
    expect(result.past).toHaveLength(1);
  });

  it("has no schedule tenant when the tenant cell is blank or only spaces", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ tenant: "Asha" }));
    for (const blank of ["", "   "]) {
      setScheduleTenant(fake, "p1", blank);
      const result = await getPortionTenants(ctx, "p1");
      expect(result.scheduleTenant).toBeNull(); // null, never ""
      expect(result.current).toBeNull();
      expect(result.mismatched).toMatchObject({ tenant: "Asha" });
    }
  });

  it("lists past tenancies newest first, only for this portion", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ id: "old", tenant: "Chitra", moveIn: "2024-01-01", moveOut: "2025-03-31" }));
    await appendTenancy(fake, row({ id: "other", portionId: "p2", moveOut: "2026-01-01" }));
    await appendTenancy(fake, row({ id: "newer", tenant: "Dev", moveIn: "2025-04-01", moveOut: "2026-06-30" }));
    await appendTenancy(fake, row({ id: "now", tenant: "Asha" }));
    const result = await getPortionTenants(ctx, "p1");
    expect(result.past.map((t) => t.id)).toEqual(["newer", "old"]);
    expect(result.current?.id).toBe("now");
  });

  it("takes the tenant from the latest Schedule entry of the portion", async () => {
    const { fake, ctx } = await ready();
    await logPayment(
      ctx,
      { month: OCT, portionId: "p1", amount: 6000, dateReceived: "2026-10-05", newTenantName: "Hari" },
      PAY_OPTIONS,
    );
    await appendTenancy(fake, row({ tenant: "Hari" }));
    const result = await getPortionTenants(ctx, "p1");
    expect(result.scheduleTenant).toBe("Hari");
    expect(result.current).toMatchObject({ tenant: "Hari" });
  });

  it("refuses an unknown portion", async () => {
    const { ctx } = await ready();
    const error = await expectCode(getPortionTenants(ctx, "p9"), "validation");
    expect(error.message).toBe('Unknown portion "p9".');
  });

  it("uses the snapshot cache when the context has one, and honours minFetchedAt", async () => {
    const { fake } = setup();
    const ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER });
    await getPortionTenants(ctx, "p1");
    const reads = () => fake.calls.filter((call) => call === "getValues").length;
    const afterFirst = reads();
    await getPortionTenants(ctx, "p2");
    expect(reads()).toBe(afterFirst);

    await appendTenancy(fake, row());
    expect((await getPortionTenants(ctx, "p1")).current).toBeNull();
    expect((await getPortionTenants(ctx, "p1", { minFetchedAt: Date.now() + 1 })).current).toMatchObject({ id: "t-seed" });
  });

  it("shows a saved tenancy straight away through a cached context", async () => {
    const { fake } = setup();
    const ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER });
    expect((await getPortionTenants(ctx, "p1")).current).toBeNull();
    await create(ctx);
    expect((await getPortionTenants(ctx, "p1")).current).toMatchObject({ tenant: "Asha" });
  });
});

describe("logPayment: tenancy details for a new tenant", () => {
  // A tenancy failure is logged with console.error. Keep the test output clean and let tests look at the calls.
  let errorSpy: MockInstance<typeof console.error>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  const payNew =(ctx: SheetsContext, input: Partial<LogPaymentInput> = {}, options = PAY_OPTIONS) =>
    logPayment(
      ctx,
      { month: OCT, portionId: "p1", amount: 6000, dateReceived: "2026-10-05", newTenantName: "Hari", ...input },
      options,
    );

  const NEW_FIELDS: TenancyFields = { moveIn: "2026-10-01", advance: 12000, advanceDate: "2026-09-28", phone: "98000 12345" };

  it("writes the Schedule cells, the log row and a tenancy row, and says so", async () => {
    const { fake, ctx } = await ready();
    const result = await payNew(ctx, { tenancy: NEW_FIELDS });

    expect(result).toMatchObject({
      entry: { tenant: "Hari", count: 1, amount: 6000 },
      logWritten: true,
      tenancyWritten: true,
    });
    expect(cell(fake, "Schedule", "B", 6)).toBe("Hari");
    expect(cell(fake, "Schedule", "C", 6)).toBe(1);
    expect(cell(fake, "Schedule", "D", 6)).toBe(6000);
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1].slice(2, 6)).toEqual(["First floor, single bedroom", "Hari", 6000, 1]);
    expect(await tenancies(ctx)).toEqual([
      {
        rowNumber: 2,
        id: expect.stringMatching(/^t-/),
        portionId: "p1",
        tenant: "Hari",
        phone: "98000 12345",
        moveIn: "2026-10-01",
        agreementEnd: "",
        advance: 12000,
        advanceDate: "2026-09-28",
        advanceStatus: "Held",
        refund: null,
        deductions: null,
        notes: "",
        moveOut: "",
        updatedBy: "owner@example.com",
        updatedAt: "2026-10-05T04:30:00.000Z",
      },
    ]);
  });

  it("closes the previous tenancy on the new move-in date: new row first, then the close", async () => {
    const { fake, ctx } = await ready();
    const { tenancy: asha } = await create(ctx);
    fake.calls = [];

    const result = await payNew(ctx, { tenancy: NEW_FIELDS });

    expect(result.tenancyWritten).toBe(true);
    const tenantWrites = fake.calls.slice(fake.calls.indexOf("appendRow"));
    expect(tenantWrites.filter((call) => call === "appendRow" || call === "updateValues")).toEqual([
      "appendRow", // the Payments Log row
      "appendRow", // the new tenancy
      "updateValues", // closing the previous tenancy
    ]);
    expect(await tenancies(ctx)).toMatchObject([
      { id: asha.id, tenant: "Asha", moveOut: "2026-10-01", updatedBy: "owner@example.com", updatedAt: "2026-10-05T04:30:00.000Z" },
      { tenant: "Hari", moveOut: "" },
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("closes the previous tenancy by writing only Move-out date, Updated by and Updated at", async () => {
    const { fake, ctx } = await ready();
    pushRawRow(fake, RAW_ASHA);
    const before = [...fake.tabs.get(TENANTS_TAB)![1]];
    const updates: Array<{ a1: string; values: unknown[][] }> = [];
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (writes) => {
      updates.push(...writes.filter((w) => w.tab === TENANTS_TAB).map(({ a1, values }) => ({ a1, values })));
      return original(writes);
    };

    await payNew(ctx, { tenancy: NEW_FIELDS });

    expect(updates).toEqual([{ a1: "M2:O2", values: [["2026-10-01", "owner@example.com", "2026-10-05T04:30:00.000Z"]] }]);
    const after = fake.tabs.get(TENANTS_TAB)![1];
    expect(after.slice(0, 12)).toEqual(before.slice(0, 12)); // hand-typed text amounts, status and notes kept
    expect(after.slice(12)).toEqual(["2026-10-01", "owner@example.com", "2026-10-05T04:30:00.000Z"]);
  });

  it("does not undo an edit made to the previous row between the read and the close", async () => {
    const { fake, ctx } = await ready();
    await create(ctx);
    const original = fake.appendRow.bind(fake);
    fake.appendRow = async (tab, values) => {
      await original(tab, values);
      if (tab === TENANTS_TAB) fake.tabs.get(TENANTS_TAB)![1][11] = "edited meanwhile";
    };

    const result = await payNew(ctx, { tenancy: NEW_FIELDS });

    expect(result.tenancyWritten).toBe(true);
    const asha = fake.tabs.get(TENANTS_TAB)![1];
    expect(asha[11]).toBe("edited meanwhile");
    expect(asha[12]).toBe("2026-10-01");
  });

  it("closes every other open tenancy of the portion, not only the last", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ id: "dup-1", moveIn: "2026-01-15" }));
    await appendTenancy(fake, row({ id: "dup-2", moveIn: "2026-10-20" })); // a hand-copied row
    await appendTenancy(fake, row({ id: "other", portionId: "p2", tenant: "Bala" }));
    await appendTenancy(fake, row({ id: "done", moveIn: "2025-01-01", moveOut: "2025-12-31" }));
    fake.calls = [];

    const result = await payNew(ctx, { tenancy: NEW_FIELDS });

    expect(result.tenancyWritten).toBe(true);
    const tenantWrites = fake.calls.slice(fake.calls.indexOf("appendRow"));
    expect(tenantWrites.filter((call) => call === "appendRow" || call === "updateValues")).toEqual([
      "appendRow", // the Payments Log row
      "appendRow", // the new tenancy
      "updateValues", // dup-1
      "updateValues", // dup-2
    ]);
    expect(await tenancies(ctx)).toMatchObject([
      { id: "dup-1", moveOut: "2026-10-01" },
      { id: "dup-2", moveOut: "2026-10-20" }, // never before its own move-in
      { id: "other", moveOut: "" },
      { id: "done", moveOut: "2025-12-31", updatedBy: "owner@example.com" },
      { tenant: "Hari", moveOut: "" },
    ]);
  });

  it("closes every open tenancy of the portion on the date received when no details are given", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, row({ id: "dup-1" }));
    await appendTenancy(fake, row({ id: "dup-2" }));

    const result = await payNew(ctx, { dateReceived: "2026-10-03" });

    expect(result.tenancyWritten).toBe(true);
    expect(await tenancies(ctx)).toMatchObject([
      { id: "dup-1", moveOut: "2026-10-03" },
      { id: "dup-2", moveOut: "2026-10-03" },
    ]);
  });

  it("does not close the previous tenancy before its own move-in date", async () => {
    const { ctx } = await ready();
    await create(ctx, { fields: { moveIn: "2026-10-20" } });
    await payNew(ctx, { tenancy: NEW_FIELDS });
    expect(await tenancies(ctx)).toMatchObject([{ tenant: "Asha", moveOut: "2026-10-20" }, { tenant: "Hari" }]);
  });

  it("with no tenancy details it only closes the previous one, on the date received", async () => {
    const { fake, ctx } = await ready();
    await create(ctx);
    fake.calls = [];

    const result = await payNew(ctx, { dateReceived: "2026-10-03" });

    expect(result).toMatchObject({ logWritten: true, tenancyWritten: true });
    expect(fake.calls.filter((call) => call === "appendRow")).toHaveLength(1); // only the Payments Log
    expect(await tenancies(ctx)).toMatchObject([{ tenant: "Asha", moveOut: "2026-10-03" }]);
    expect(await tenancies(ctx)).toHaveLength(1);
  });

  it("with no details and no previous tenancy writes nothing to the Tenants tab and still reports success", async () => {
    const { fake, ctx } = await ready();
    const result = await payNew(ctx);
    expect(result.tenancyWritten).toBe(true);
    expect(fake.tabs.get(TENANTS_TAB)).toHaveLength(1); // the header row only
  });

  it("leaves the tenancies of other portions alone", async () => {
    const { ctx } = await ready();
    await create(ctx, { portionId: "p2", tenant: "Bala" });
    await payNew(ctx, { tenancy: NEW_FIELDS });
    expect(await tenancies(ctx)).toMatchObject([
      { portionId: "p2", tenant: "Bala", moveOut: "" },
      { portionId: "p1", tenant: "Hari", moveOut: "" },
    ]);
  });

  it("has no tenancyWritten when the payment does not involve a new tenant", async () => {
    const { fake, ctx } = await ready();
    const before = structuredClone(fake.tabs.get(TENANTS_TAB));
    const result = await logPayment(
      ctx,
      { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" },
      PAY_OPTIONS,
    );
    expect(result.logWritten).toBe(true);
    expect("tenancyWritten" in result).toBe(false);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual(before);
  });

  it("ignores tenancy details when no new tenant is named", async () => {
    const { ctx } = await ready();
    const result = await logPayment(
      ctx,
      { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05", tenancy: NEW_FIELDS },
      PAY_OPTIONS,
    );
    expect("tenancyWritten" in result).toBe(false);
    expect(await tenancies(ctx)).toEqual([]);
  });

  it("refuses invalid tenancy details before anything is written", async () => {
    const { fake, ctx } = setup();
    await expectCode(
      payNew(ctx, { tenancy: { moveIn: "2026-10-01", agreementEnd: "2026-09-01" } }),
      "validation",
    );
    await expectCode(payNew(ctx, { tenancy: { moveIn: "", advance: 5 } }), "validation");
    await expectCode(payNew(ctx, { tenancy: { moveIn: "2026-10-01", phone: "98765\n43210" } }), "validation");
    expect(fake.calls).toEqual([]);
    expect(fake.tabs.has(LOG_TAB)).toBe(false);
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
  });

  it("refuses invalid tenancy details without changing a sheet that is already set up", async () => {
    const { fake, ctx } = await ready();
    await create(ctx);
    const before = snapshotOf(fake);
    await expectCode(payNew(ctx, { tenancy: { moveIn: "2026-13-01" } }), "validation");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("keeps the payment when adding the tenancy row fails, and says so", async () => {
    const { fake, ctx } = await ready();
    const { tenancy: asha } = await create(ctx);
    failTenantsWrites(fake, "appendRow");

    const result = await payNew(ctx, { tenancy: NEW_FIELDS });

    expect(result).toMatchObject({ entry: { tenant: "Hari" }, logWritten: true, tenancyWritten: false });
    expect(cell(fake, "Schedule", "B", 6)).toBe("Hari");
    expect(cell(fake, "Schedule", "D", 6)).toBe(6000);
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1][3]).toBe("Hari");
    // nothing half-done: the new row was not added, so the previous tenancy was not closed either
    expect(await tenancies(ctx)).toMatchObject([{ id: asha.id, tenant: "Asha", moveOut: "" }]);
  });

  it("logs the reason when the tenancy work fails after the payment was saved", async () => {
    const { fake, ctx } = await ready();
    await create(ctx);
    failTenantsWrites(fake, "appendRow");

    await payNew(ctx, { tenancy: NEW_FIELDS });

    expect(errorSpy).toHaveBeenCalledOnce();
    const [message, error] = errorSpy.mock.calls[0];
    expect(message).toBe("Tenancy write failed after the payment was saved");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("appendRow failed on the Tenants tab");
  });

  it("keeps the payment when closing the previous tenancy fails, and says so", async () => {
    const { fake, ctx } = await ready();
    await create(ctx);
    failTenantsWrites(fake, "updateValues");

    const result = await payNew(ctx, { tenancy: NEW_FIELDS });

    expect(result).toMatchObject({ logWritten: true, tenancyWritten: false });
    expect(cell(fake, "Schedule", "D", 6)).toBe(6000);
    expect((await tenancies(ctx)).map((t) => t.tenant)).toEqual(["Asha", "Hari"]);
  });

  it("keeps the payment when only closing the previous tenancy is needed and fails", async () => {
    const { fake, ctx } = await ready();
    await create(ctx);
    failTenantsWrites(fake, "updateValues");
    const result = await payNew(ctx);
    expect(result).toMatchObject({ logWritten: true, tenancyWritten: false });
    expect(cell(fake, "Schedule", "D", 6)).toBe(6000);
  });

  it("does not add a second current tenancy for a tenant who already has details", async () => {
    const { fake, ctx } = await ready();
    await create(ctx);
    const before = structuredClone(fake.tabs.get(TENANTS_TAB));

    const result = await payNew(ctx, { newTenantName: " asha ", tenancy: NEW_FIELDS });

    expect(result).toMatchObject({ entry: { tenant: "asha", count: 1 }, logWritten: true, tenancyWritten: false });
    expect(fake.tabs.get(TENANTS_TAB)).toEqual(before);
  });

  it("shows the new tenancy on the card straight away through a cached context", async () => {
    const { fake } = setup();
    const ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER });
    await getMonthView(ctx, OCT);
    await payNew(ctx, { tenancy: NEW_FIELDS });
    const card = (await getMonthView(ctx, OCT)).cards[0];
    expect(card).toMatchObject({ status: "paid", tenancy: { phone: "98000 12345", moveIn: "2026-10-01", advance: 12000 } });
  });
});

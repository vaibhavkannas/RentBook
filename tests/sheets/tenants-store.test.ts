import { describe, expect, it } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import { AppError } from "@/lib/errors";
import {
  appendTenancy,
  closeTenancyRow,
  ensureTenantsTab,
  readTenancies,
  TENANT_HEADERS,
  TENANTS_TAB,
  writeTenancy,
  writeTenancyEdit,
  writeTenancyMoveOut,
} from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule } from "../support/fixtures";

type Row = Omit<Tenancy, "rowNumber">;

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "t-1",
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
    updatedAt: "2026-01-15T05:00:00.000Z",
    ...overrides,
  };
}

/** The cells the store writes for a row: amounts as numbers or "" for null. */
function stored(r: Row): unknown[] {
  return [
    r.id,
    r.portionId,
    r.tenant,
    r.phone,
    r.moveIn,
    r.agreementEnd,
    r.advance ?? "",
    r.advanceDate,
    r.advanceStatus ?? "",
    r.refund ?? "",
    r.deductions ?? "",
    r.notes,
    r.moveOut,
    r.updatedBy,
    r.updatedAt,
  ];
}

async function ensured(initial: Record<string, unknown[][]> = {}) {
  const fake = new FakeGateway({ Schedule: baseSchedule(), ...initial });
  await ensureTenantsTab(fake, await fake.listTabs());
  return fake;
}

async function structureError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("sheet-structure");
    return error as AppError;
  }
  throw new Error("expected a sheet-structure error");
}

describe("TENANT_HEADERS", () => {
  it("are the fifteen headers of columns A to O, in order", () => {
    expect(TENANTS_TAB).toBe("Tenants");
    expect(TENANT_HEADERS).toEqual([
      "Tenancy ID",
      "Portion",
      "Tenant",
      "Phone",
      "Move-in date",
      "Agreement end",
      "Advance",
      "Advance date",
      "Advance status",
      "Refund",
      "Deductions",
      "Notes",
      "Move-out date",
      "Updated by",
      "Updated at",
    ]);
  });
});

describe("ensureTenantsTab", () => {
  it("creates the tab with the fifteen headers when it is missing", async () => {
    const fake = await ensured();
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
  });

  it("does not touch an existing correct tab", async () => {
    const data = stored(row());
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [TENANT_HEADERS, data] });
    await ensureTenantsTab(fake, await fake.listTabs());
    expect(fake.calls.filter((call) => call !== "listTabs" && call !== "getValues")).toEqual([]);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS, data]);
  });

  it("accepts columns added by hand to the right of O", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [TENANTS_TAB]: [[...TENANT_HEADERS, "Flat key given"]],
    });
    await ensureTenantsTab(fake, await fake.listTabs());
    expect(fake.calls).not.toContain("updateValues");
    expect(fake.tabs.get(TENANTS_TAB)![0]).toHaveLength(16);
  });

  it("writes the headers into an existing tab that is empty", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [] });
    await ensureTenantsTab(fake, await fake.listTabs());
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
    expect(fake.calls).not.toContain("addTab");
  });

  it("does not throw for a wrong header, and writes nothing: readTenancies reports it on every read", async () => {
    const wrong = [...TENANT_HEADERS];
    wrong[4] = "Moved in";
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [wrong, stored(row())] });
    await expect(ensureTenantsTab(fake, await fake.listTabs())).resolves.toBeUndefined();
    expect(fake.calls).not.toContain("updateValues");
    expect(fake.calls).not.toContain("addTab");
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([wrong, stored(row())]);
  });

  it("does not throw for headers that are missing or in the wrong order either", async () => {
    const swapped = [...TENANT_HEADERS];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    for (const header of [TENANT_HEADERS.slice(0, 3), swapped]) {
      const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [header] });
      await expect(ensureTenantsTab(fake, await fake.listTabs())).resolves.toBeUndefined();
      expect(fake.tabs.get(TENANTS_TAB)).toEqual([header]);
    }
  });
});

describe("readTenancies: the header is checked on every read", () => {
  it("checks the header on EVERY call: a header changed after a good read is reported by the next read", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push(stored(row()));
    await expect(readTenancies(fake)).resolves.toHaveLength(1);
    await expect(readTenancies(fake)).resolves.toHaveLength(1);

    fake.tabs.get(TENANTS_TAB)![0][4] = "Moved in";
    const error = await structureError(() => readTenancies(fake));
    expect(error.message).toContain('"Move-in date"');
    expect(error.message).toContain('"Moved in"');
    await structureError(() => readTenancies(fake));

    fake.tabs.get(TENANTS_TAB)![0][4] = "Move-in date";
    await expect(readTenancies(fake)).resolves.toHaveLength(1);
  });

  it("reports a tab whose header row was deleted", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.splice(0, 1);
    const error = await structureError(() => readTenancies(fake));
    expect(error.message).toContain('"Tenancy ID"');
    expect(error.message).toContain("column A");
  });

  it("throws sheet-structure naming the first wrong header, and writes nothing", async () => {
    const wrong = [...TENANT_HEADERS];
    wrong[4] = "Moved in";
    wrong[9] = "Money back";
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [wrong] });
    const error = await structureError(() => readTenancies(fake));
    expect(error.message).toContain('"Move-in date"');
    expect(error.message).toContain("column E");
    expect(error.message).toContain('"Moved in"');
    expect(error.message).not.toContain("Refund");
    expect(fake.calls).not.toContain("updateValues");
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([wrong]);
  });

  it("names \"Updated at\" and column O when only the last header is wrong", async () => {
    const wrong = [...TENANT_HEADERS];
    wrong[14] = "Changed at";
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [wrong] });
    const error = await structureError(() => readTenancies(fake));
    expect(error.message).toContain('"Updated at"');
    expect(error.message).toContain("column O");
    expect(error.message).toContain('"Changed at"');
    expect(fake.calls).not.toContain("updateValues");
  });

  it("names \"Updated at\" and column O when only the last header is missing", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [TENANT_HEADERS.slice(0, 14)] });
    const error = await structureError(() => readTenancies(fake));
    expect(error.message).toContain('"Updated at"');
    expect(error.message).toContain("column O");
    expect(error.message).toContain("found nothing");
    expect(fake.calls).not.toContain("updateValues");
  });

  it("throws sheet-structure naming the first missing header when the row is too short", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [TENANT_HEADERS.slice(0, 3)] });
    const error = await structureError(() => readTenancies(fake));
    expect(error.message).toContain('"Phone"');
    expect(error.message).toContain("column D");
  });

  it("refuses headers that are the right text in the wrong order", async () => {
    const swapped = [...TENANT_HEADERS];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [swapped] });
    const error = await structureError(() => readTenancies(fake));
    expect(error.message).toContain('"Portion"');
  });

  it("ignores spaces around a header", async () => {
    const padded = TENANT_HEADERS.map((header) => ` ${header} `);
    const fake = new FakeGateway({ Schedule: baseSchedule(), [TENANTS_TAB]: [padded] });
    await expect(readTenancies(fake)).resolves.toEqual([]);
    expect(fake.calls).not.toContain("updateValues");
  });
});

describe("readTenancies", () => {
  it("returns nothing for a tab that has only the header row", async () => {
    const fake = await ensured();
    expect(await readTenancies(fake)).toEqual([]);
  });

  it("skips the header and fully blank rows but keeps true row numbers", async () => {
    const fake = await ensured();
    const grid = fake.tabs.get(TENANTS_TAB)!;
    grid.push(stored(row({ id: "a" })));
    grid.push([]);
    grid.push(["", "", ""]);
    grid.push(stored(row({ id: "b", portionId: "p2" })));
    const all = await readTenancies(fake);
    expect(all.map((t) => [t.id, t.rowNumber])).toEqual([
      ["a", 2],
      ["b", 5],
    ]);
  });

  it("skips a row that holds only spaces", async () => {
    const fake = await ensured();
    const grid = fake.tabs.get(TENANTS_TAB)!;
    grid.push([" ", "  "]);
    grid.push(stored(row({ id: "a" })));
    grid.push(["   ", "", "\t"]);
    const all = await readTenancies(fake);
    expect(all.map((t) => [t.id, t.rowNumber])).toEqual([["a", 3]]);
  });

  it("reads amounts only from real numbers, never from numeric-looking text", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push(
      ["t-1", "p1", "Asha", "", "2026-01-15", "", "5000", "", "Held", "5000", "5000", "", "", "", ""],
      ["t-2", "p1", "Bala", "", "2026-01-15", "", 5000, "", "Held", 5000, 5000, "", "", "", ""],
    );
    const [text, numbers] = await readTenancies(fake);
    expect(text).toMatchObject({ advance: null, refund: null, deductions: null });
    expect(numbers).toMatchObject({ advance: 5000, refund: 5000, deductions: 5000 });
  });

  it("reads a date typed by hand into a date cell (a serial number) as YYYY-MM-DD", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push([
      "t-1", "p1", "Asha", "", 46037, 46401, 20000, 46032, "Held", "", "", "", 46295, "owner@example.com", "2026-01-15T05:00:00.000Z",
    ]);
    const [only] = await readTenancies(fake);
    expect(only).toMatchObject({
      moveIn: "2026-01-15",
      agreementEnd: "2027-01-14",
      advanceDate: "2026-01-10",
      moveOut: "2026-09-30",
    });
    expect(only.updatedAt).toBe("2026-01-15T05:00:00.000Z");
  });

  it("drops the time of day from a date serial and leaves text dates exactly as typed", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push(
      ["t-1", "p1", "Asha", "", 46037.75, "2027-01-14", "", "15 Jan 2026", "", "", "", "", "", "", ""],
    );
    const [only] = await readTenancies(fake);
    expect(only.moveIn).toBe("2026-01-15");
    expect(only.agreementEnd).toBe("2027-01-14");
    expect(only.advanceDate).toBe("15 Jan 2026");
  });

  it("keeps a number that cannot be a date as text instead of failing", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push(["t-1", "p1", "Asha", "", 1e12, "", "", "", "", "", "", "", "", "", ""]);
    const [only] = await readTenancies(fake);
    expect(only.moveIn).toBe("1000000000000");
  });

  it("does not turn a number in a text column into a date", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push(["t-1", "p1", "Asha", 9876543210, "2026-01-15", "", "", "", "", "", "", 46037, "", "", ""]);
    const [only] = await readTenancies(fake);
    expect(only.phone).toBe("9876543210");
    expect(only.notes).toBe("46037");
  });

  it("parses numbers, blanks and an unknown status to null", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push(
      ["t-9", "p1", "Asha", "", "2026-01-15", "", "", "", "Lost", "", "", "", "", "", ""],
      ["t-10", "p1", "Bala", "", "2026-01-15", "", "twenty", "", "Held", "5,000", 0, "", "", "", ""],
    );
    const [first, second] = await readTenancies(fake);
    expect(first).toMatchObject({ advance: null, advanceStatus: null, refund: null, deductions: null });
    expect(second).toMatchObject({ advance: null, advanceStatus: "Held", refund: null, deductions: 0 });
  });

  it("reads text with String, so a number typed into a text column does not break", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push(["t-9", "p1", "Asha", 9876543210, "2026-01-15"]);
    const [only] = await readTenancies(fake);
    expect(only.phone).toBe("9876543210");
    expect(only.agreementEnd).toBe("");
    expect(only.notes).toBe("");
    expect(only.moveOut).toBe("");
    expect(only.updatedAt).toBe("");
  });

  it("reads all three advance statuses", async () => {
    const fake = await ensured();
    for (const status of ["Held", "Refunded", "Adjusted"] as const) {
      await appendTenancy(fake, row({ id: status, advanceStatus: status }));
    }
    expect((await readTenancies(fake)).map((t) => t.advanceStatus)).toEqual(["Held", "Refunded", "Adjusted"]);
  });

  it("asks for unformatted values over columns A to O", async () => {
    const fake = await ensured();
    const seen: Array<[string, string, string]> = [];
    const original = fake.getValues.bind(fake);
    fake.getValues = async (tab, a1, render) => {
      seen.push([tab, a1, render]);
      return original(tab, a1, render);
    };
    await readTenancies(fake);
    expect(seen).toEqual([[TENANTS_TAB, "A1:O", "UNFORMATTED_VALUE"]]);
  });
});

describe("appendTenancy", () => {
  it("appends exactly one row and round-trips every field", async () => {
    const fake = await ensured();
    const closed = row({
      id: "t-2",
      portionId: "p3",
      tenant: "Chitra",
      moveOut: "2026-08-31",
      advanceStatus: "Refunded",
      refund: 18000,
      deductions: 2000,
    });
    await appendTenancy(fake, row());
    await appendTenancy(fake, closed);
    expect(fake.calls.filter((call) => call === "appendRow")).toHaveLength(2);
    const all = await readTenancies(fake);
    expect(all).toEqual([
      { rowNumber: 2, ...row() },
      { rowNumber: 3, ...closed },
    ]);
  });

  it("round-trips a tenancy with no advance and no optional fields", async () => {
    const fake = await ensured();
    const bare = row({
      phone: "",
      agreementEnd: "",
      advance: null,
      advanceDate: "",
      advanceStatus: null,
      notes: "",
    });
    await appendTenancy(fake, bare);
    expect(fake.tabs.get(TENANTS_TAB)![1]).toEqual(stored(bare));
    expect(await readTenancies(fake)).toEqual([{ rowNumber: 2, ...bare }]);
  });

  it("stores a missing amount as an empty cell and a number as a number", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ advance: 0, refund: null }));
    const cells = fake.tabs.get(TENANTS_TAB)![1];
    expect(cells[6]).toBe(0);
    expect(cells[9]).toBe("");
  });

  it("stores text that starts with = as text, written through the raw gateway", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ tenant: "=1+1", notes: "=HYPERLINK(1)", phone: "+91 98765" }));
    const cells = fake.tabs.get(TENANTS_TAB)![1];
    expect(cells[2]).toBe("=1+1");
    expect(cells[11]).toBe("=HYPERLINK(1)");
    expect(cells[3]).toBe("+91 98765");
  });
});

describe("writeTenancy", () => {
  it("rewrites exactly one row with exactly one updateValues call", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ id: "a" }));
    await appendTenancy(fake, row({ id: "b", portionId: "p2", tenant: "Bala" }));
    await appendTenancy(fake, row({ id: "c", portionId: "p3", tenant: "Chitra" }));
    const before = structuredClone(fake.tabs.get(TENANTS_TAB)!);
    fake.calls = [];

    const changed = row({
      id: "b",
      portionId: "p2",
      tenant: "Bala",
      advanceStatus: "Refunded",
      refund: 20000,
      moveOut: "2026-09-30",
      updatedAt: "2026-09-30T05:00:00.000Z",
    });
    await writeTenancy(fake, 3, changed);

    expect(fake.calls).toEqual(["updateValues"]);
    const after = fake.tabs.get(TENANTS_TAB)!;
    expect(after[2]).toEqual(stored(changed)); // sheet row 3
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
    expect(after[3]).toEqual(before[3]);
    expect(after).toHaveLength(before.length);
    expect((await readTenancies(fake))[1]).toEqual({ rowNumber: 3, ...changed });
  });

  it("targets A{r}:O{r} of the Tenants tab", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row());
    const writes: unknown[] = [];
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (cellWrites) => {
      writes.push(...cellWrites);
      return original(cellWrites);
    };
    await writeTenancy(fake, 2, row({ notes: "Changed" }));
    expect(writes).toEqual([{ tab: TENANTS_TAB, a1: "A2:O2", values: [stored(row({ notes: "Changed" }))] }]);
  });

  it("clears a cell that becomes null instead of leaving the old number", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ advance: 20000, advanceStatus: "Held" }));
    await writeTenancy(fake, 2, row({ advance: null, advanceStatus: null }));
    const [only] = await readTenancies(fake);
    expect(only.advance).toBeNull();
    expect(only.advanceStatus).toBeNull();
  });

  it("stores text that starts with = as text", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row());
    await writeTenancy(fake, 2, row({ notes: "=SUM(A1:A9)" }));
    expect(fake.tabs.get(TENANTS_TAB)![1][11]).toBe("=SUM(A1:A9)");
  });
});

describe("closeTenancyRow", () => {
  const STAMP = { moveOut: "2026-09-30", updatedBy: "member@example.com", updatedAt: "2026-09-30T08:00:00.000Z" };

  it("writes only Move-out date, Updated by and Updated at (M:O), with one updateValues call", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ id: "a" }));
    await appendTenancy(fake, row({ id: "b", portionId: "p2", tenant: "Bala" }));
    await appendTenancy(fake, row({ id: "c", portionId: "p3", tenant: "Chitra" }));
    const before = structuredClone(fake.tabs.get(TENANTS_TAB)!);
    fake.calls = [];
    const writes: unknown[] = [];
    const original = fake.updateValues.bind(fake);
    fake.updateValues = async (cellWrites) => {
      writes.push(...cellWrites);
      return original(cellWrites);
    };

    await closeTenancyRow(fake, 3, STAMP);

    expect(fake.calls).toEqual(["updateValues"]);
    expect(writes).toEqual([
      { tab: TENANTS_TAB, a1: "M3:O3", values: [["2026-09-30", "member@example.com", "2026-09-30T08:00:00.000Z"]] },
    ]);
    const after = fake.tabs.get(TENANTS_TAB)!;
    expect(after[2].slice(0, 12)).toEqual(before[2].slice(0, 12));
    expect(after[2].slice(12)).toEqual(["2026-09-30", "member@example.com", "2026-09-30T08:00:00.000Z"]);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
    expect(after[3]).toEqual(before[3]);
    expect(after).toHaveLength(before.length);
  });

  it("leaves hand-typed text in the amount, status, notes and extra columns exactly as it is", async () => {
    const fake = await ensured();
    const typed = [
      "t-hand", "p1", "Asha", "98765 43210", "2026-01-15", "2027-01-14", "20,000 rupees", "ten Jan",
      "paid back", "see notes", "about 500", "=HYPERLINK(1)", "", "owner@example.com", "2026-01-15T05:00:00.000Z",
      "flat key given",
    ];
    fake.tabs.get(TENANTS_TAB)!.push([...typed]);

    await closeTenancyRow(fake, 2, STAMP);

    const after = fake.tabs.get(TENANTS_TAB)![1];
    expect(after.slice(0, 12)).toEqual(typed.slice(0, 12));
    expect(after[15]).toBe("flat key given"); // a column added by hand to the right of O
    expect((await readTenancies(fake))[0]).toMatchObject({ moveOut: "2026-09-30", updatedBy: "member@example.com" });
  });

  it("stores text that starts with = as text", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row());
    await closeTenancyRow(fake, 2, { ...STAMP, updatedBy: "=1+1" });
    expect(fake.tabs.get(TENANTS_TAB)![1][13]).toBe("=1+1");
  });
});

/** A row typed by hand, with text where the app expects numbers, and a column added to the right of O. */
const TYPED_ROW = [
  "t-hand", "p1", "Asha", "98765 43210", "2026-01-15", "2027-01-14", "20,000 rupees", "ten Jan",
  "paid back", "see notes", "about 500", "=HYPERLINK(1)", "", "owner@example.com", "2026-01-15T05:00:00.000Z",
  "flat key given",
];

/** Records every CellWrite the fake receives, and still applies it. */
function recordWrites(fake: FakeGateway) {
  const writes: Array<{ tab: string; a1: string; values: unknown[][] }> = [];
  const original = fake.updateValues.bind(fake);
  fake.updateValues = async (cellWrites) => {
    writes.push(...cellWrites);
    return original(cellWrites);
  };
  return writes;
}

/** The columns (0-based) whose cells are the same before and after. */
function unchangedColumns(before: unknown[], after: unknown[]): number[] {
  const length = Math.max(before.length, after.length);
  return Array.from({ length }, (_, index) => index).filter((index) => before[index] === after[index]);
}

describe("writeTenancyEdit", () => {
  // Everything the edit screen can change. Tenant, refund, deductions and move-out are different on purpose:
  // an edit must not write them.
  const EDITED = row({
    tenant: "Not written",
    phone: "99999 11111",
    moveIn: "2026-02-01",
    agreementEnd: "2027-02-01",
    advance: 25000,
    advanceDate: "2026-01-20",
    advanceStatus: "Held",
    refund: 111,
    deductions: 222,
    notes: "Raised advance",
    moveOut: "2030-01-01",
    updatedBy: "member@example.com",
    updatedAt: "2026-10-06T09:00:00.000Z",
  });

  it("writes only Phone to Advance status, Notes, Updated by and Updated at, in one updateValues call", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push([...TYPED_ROW]);
    fake.calls = [];
    const writes = recordWrites(fake);

    await writeTenancyEdit(fake, 2, EDITED);

    expect(fake.calls).toEqual(["updateValues"]);
    expect(writes).toEqual([
      {
        tab: TENANTS_TAB,
        a1: "D2:I2",
        values: [["99999 11111", "2026-02-01", "2027-02-01", 25000, "2026-01-20", "Held"]],
      },
      { tab: TENANTS_TAB, a1: "L2", values: [["Raised advance"]] },
      { tab: TENANTS_TAB, a1: "N2:O2", values: [["member@example.com", "2026-10-06T09:00:00.000Z"]] },
    ]);
  });

  it("leaves the ID, portion, tenant, refund, deductions, move-out and extra columns exactly as they were", async () => {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push([...TYPED_ROW]);

    await writeTenancyEdit(fake, 2, EDITED);

    const after = fake.tabs.get(TENANTS_TAB)![1];
    // A, B, C (0 to 2), J, K (9, 10), M (12) and the column right of O (15)
    expect(unchangedColumns(TYPED_ROW, after)).toEqual([0, 1, 2, 9, 10, 12, 15]);
    expect(after[9]).toBe("see notes");
    expect(after[10]).toBe("about 500");
    expect(after[15]).toBe("flat key given");
  });

  it("touches no other row and no other tab", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ id: "a" }));
    await appendTenancy(fake, row({ id: "b", portionId: "p2", tenant: "Bala" }));
    await appendTenancy(fake, row({ id: "c", portionId: "p3", tenant: "Chitra" }));
    const before = new Map(structuredClone([...fake.tabs.entries()]));

    await writeTenancyEdit(fake, 3, EDITED);

    for (const [name, grid] of before) {
      if (name === TENANTS_TAB) continue;
      expect(fake.tabs.get(name)).toEqual(grid);
    }
    const tenants = fake.tabs.get(TENANTS_TAB)!;
    const tenantsBefore = before.get(TENANTS_TAB)!;
    expect(tenants[0]).toEqual(tenantsBefore[0]);
    expect(tenants[1]).toEqual(tenantsBefore[1]);
    expect(tenants[3]).toEqual(tenantsBefore[3]);
    expect(tenants).toHaveLength(4);
  });

  it("clears the advance and its status cells when they become null", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ advance: 20000, advanceStatus: "Held" }));
    await writeTenancyEdit(fake, 2, row({ advance: null, advanceStatus: null }));
    const [only] = await readTenancies(fake);
    expect(only).toMatchObject({ advance: null, advanceStatus: null });
  });

  it("stores text that starts with = as text", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row());
    await writeTenancyEdit(fake, 2, row({ notes: "=SUM(A1:A9)", phone: "=1+1" }));
    const cells = fake.tabs.get(TENANTS_TAB)![1];
    expect(cells[11]).toBe("=SUM(A1:A9)");
    expect(cells[3]).toBe("=1+1");
  });
});

describe("writeTenancyMoveOut", () => {
  // Phone, move-in, agreement end, advance and its date are different on purpose: a move-out must not write them.
  const CLOSED = row({
    phone: "Not written",
    moveIn: "2030-01-01",
    agreementEnd: "2030-02-02",
    advance: 1,
    advanceDate: "2030-03-03",
    advanceStatus: "Adjusted",
    refund: 15000,
    deductions: 5000,
    notes: "Left the keys",
    moveOut: "2026-09-30",
    updatedBy: "member@example.com",
    updatedAt: "2026-10-06T09:00:00.000Z",
  });
  const STAMP_CELLS = ["2026-09-30", "member@example.com", "2026-10-06T09:00:00.000Z"];
  const ALL = { status: true, refund: true, deductions: true, notes: false };
  const NONE = { status: false, refund: false, deductions: false, notes: false };

  async function typedRow() {
    const fake = await ensured();
    fake.tabs.get(TENANTS_TAB)!.push([...TYPED_ROW]);
    fake.calls = [];
    return { fake, writes: recordWrites(fake) };
  }

  it("with status, refund and deductions writes them and Move-out date to Updated at, in one call", async () => {
    const { fake, writes } = await typedRow();

    await writeTenancyMoveOut(fake, 2, CLOSED, ALL);

    expect(fake.calls).toEqual(["updateValues"]);
    expect(writes).toEqual([
      { tab: TENANTS_TAB, a1: "I2:K2", values: [["Adjusted", 15000, 5000]] },
      { tab: TENANTS_TAB, a1: "M2:O2", values: [STAMP_CELLS] },
    ]);
    const after = fake.tabs.get(TENANTS_TAB)![1];
    // A to H (0 to 7), the Notes cell (11) and the column right of O (15)
    expect(unchangedColumns(TYPED_ROW, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 11, 15]);
    expect(after[6]).toBe("20,000 rupees");
    expect(after[11]).toBe("=HYPERLINK(1)");
  });

  it("with notes too also writes the Notes cell, still in one call", async () => {
    const { fake, writes } = await typedRow();

    await writeTenancyMoveOut(fake, 2, CLOSED, { ...ALL, notes: true });

    expect(fake.calls).toEqual(["updateValues"]);
    expect(writes).toEqual([
      { tab: TENANTS_TAB, a1: "I2:O2", values: [["Adjusted", 15000, 5000, "Left the keys", ...STAMP_CELLS]] },
    ]);
    const after = fake.tabs.get(TENANTS_TAB)![1];
    expect(unchangedColumns(TYPED_ROW, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 15]);
  });

  it("with nothing given writes only Move-out date, Updated by and Updated at, and leaves hand-typed status, refund, deductions and notes", async () => {
    const { fake, writes } = await typedRow();

    await writeTenancyMoveOut(fake, 2, CLOSED, NONE);

    expect(fake.calls).toEqual(["updateValues"]);
    expect(writes).toEqual([{ tab: TENANTS_TAB, a1: "M2:O2", values: [STAMP_CELLS] }]);
    const after = fake.tabs.get(TENANTS_TAB)![1];
    // everything from Tenancy ID to Notes, and the extra column, is exactly as typed
    expect(unchangedColumns(TYPED_ROW, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15]);
    expect(after.slice(8, 11)).toEqual(["paid back", "see notes", "about 500"]);
  });

  it.each([
    ["only the status", { status: true, refund: false, deductions: false }, ["I2", "M2:O2"], [["Adjusted"], STAMP_CELLS], [9, 10]],
    ["only the refund", { status: false, refund: true, deductions: false }, ["J2", "M2:O2"], [[15000], STAMP_CELLS], [8, 10]],
    ["only the deductions", { status: false, refund: false, deductions: true }, ["K2", "M2:O2"], [[5000], STAMP_CELLS], [8, 9]],
    ["the refund and the deductions", { status: false, refund: true, deductions: true }, ["J2:K2", "M2:O2"], [[15000, 5000], STAMP_CELLS], [8]],
    ["the status and the deductions", { status: true, refund: false, deductions: true }, ["I2", "K2", "M2:O2"], [["Adjusted"], [5000], STAMP_CELLS], [9]],
  ])("with %s writes just those columns and the move-out columns", async (_name, flags, ranges, values, kept) => {
    const { fake, writes } = await typedRow();

    await writeTenancyMoveOut(fake, 2, CLOSED, { ...flags, notes: false });

    expect(fake.calls).toEqual(["updateValues"]);
    expect(writes.map((write) => write.a1)).toEqual(ranges);
    expect(writes.map((write) => write.values[0])).toEqual(values);
    const after = fake.tabs.get(TENANTS_TAB)![1];
    for (const column of kept) expect(after[column]).toBe(TYPED_ROW[column]);
  });

  it("round-trips through readTenancies", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ id: "t-1" }));
    await writeTenancyMoveOut(fake, 2, { ...CLOSED, id: "t-1" }, { ...ALL, notes: true });
    expect((await readTenancies(fake))[0]).toMatchObject({
      advanceStatus: "Adjusted",
      refund: 15000,
      deductions: 5000,
      notes: "Left the keys",
      moveOut: "2026-09-30",
      updatedBy: "member@example.com",
    });
  });

  it("writes empty cells for a null status, refund and deductions that were asked for", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ advance: 20000, advanceStatus: "Held", refund: 5, deductions: 6 }));
    await writeTenancyMoveOut(
      fake,
      2,
      row({ advanceStatus: null, refund: null, deductions: null, moveOut: "2026-09-30" }),
      ALL,
    );
    const cells = fake.tabs.get(TENANTS_TAB)![1];
    expect(cells.slice(8, 11)).toEqual(["", "", ""]);
  });

  it("leaves a stored status, refund and deductions alone when they were not asked for", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row({ advance: 20000, advanceStatus: "Held", refund: 5, deductions: 6 }));
    await writeTenancyMoveOut(
      fake,
      2,
      row({ advanceStatus: null, refund: null, deductions: null, moveOut: "2026-09-30" }),
      NONE,
    );
    const cells = fake.tabs.get(TENANTS_TAB)![1];
    expect(cells.slice(8, 11)).toEqual(["Held", 5, 6]);
    expect(cells[12]).toBe("2026-09-30");
  });

  it("stores text that starts with = as text", async () => {
    const fake = await ensured();
    await appendTenancy(fake, row());
    await writeTenancyMoveOut(fake, 2, row({ notes: "=1+1", updatedBy: "=2+2", moveOut: "2026-09-30" }), {
      ...ALL,
      notes: true,
    });
    const cells = fake.tabs.get(TENANTS_TAB)![1];
    expect(cells[11]).toBe("=1+1");
    expect(cells[13]).toBe("=2+2");
  });
});

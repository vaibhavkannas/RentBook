import { describe, expect, it } from "vitest";
import {
  LOGGED_FIELDS,
  PRIVATE_FIELDS,
  TENANCY_LOG_ACTIONS,
  tenancyLogRows,
  type TenancyChange,
  type TenancyLogRow,
} from "@/lib/domain/tenancy-log";
import { TENANT_HEADERS } from "@/lib/sheets/tenants-store";
import { tenancyRow } from "../support/fixtures";

// The rows of the Tenancy Log: one per field a save changed, in the order of the Tenants tab's columns. Pure: it only
// compares two tenancies as the Tenants tab stores them, and never copies a name, a phone number or a note.

const NOW = new Date("2026-11-03T09:30:00.000Z");
const STAMP = { now: NOW, changedBy: "owner@example.com" };
const SAVED_AT = "2026-11-03T09:30:00.000Z";

const rowsOf = (change: TenancyChange) => tenancyLogRows(change, STAMP);

/** A row as the tab holds it: saved at, tenancy id, portion, action, field, old value, new value, changed by. */
const row = (action: TenancyLogRow[3], field: string, oldValue: string | number, newValue: string | number, id = "t-1"): TenancyLogRow => [
  SAVED_AT,
  id,
  "p1",
  action,
  field,
  oldValue,
  newValue,
  "owner@example.com",
];

describe("what is logged", () => {
  it("names the four actions", () => {
    expect([...TENANCY_LOG_ACTIONS]).toEqual(["Added", "Edited", "Moved out", "Closed"]);
  });

  it("logs the ten Tenants columns that hold a person's details, in the order of the Tenants tab", () => {
    expect([...LOGGED_FIELDS]).toEqual([
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
    ]);
    // Each is a real header of the Tenants tab, and they follow its column order.
    const columns = LOGGED_FIELDS.map((field) => TENANT_HEADERS.indexOf(field));
    expect(columns.every((column) => column >= 0)).toBe(true);
    expect(columns).toEqual([...columns].sort((a, b) => a - b));
  });

  it("keeps the phone and the notes private: only that they changed is logged", () => {
    expect([...PRIVATE_FIELDS]).toEqual(["Phone", "Notes"]);
  });
});

describe("an edit", () => {
  const before = tenancyRow({ phone: "98765 43210", agreementEnd: "2027-01-14", notes: "Paid by cheque" });

  it("gives a row for each changed field, Phone first, with the phone's values blank", () => {
    const after = { ...before, phone: "91234 56789", agreementEnd: "2027-03-31" };
    expect(rowsOf({ kind: "edited", before, after })).toEqual([
      row("Edited", "Phone", "", ""),
      row("Edited", "Agreement end", "2027-01-14", "2027-03-31"),
    ]);
  });

  it("stamps every row with the moment of the save, the tenancy, its portion and the person", () => {
    const after = { ...before, moveIn: "2026-01-20", agreementEnd: "2027-03-31" };
    for (const logged of rowsOf({ kind: "edited", before, after })) {
      expect(logged[0]).toBe(SAVED_AT);
      expect(logged[1]).toBe("t-1");
      expect(logged[2]).toBe("p1");
      expect(logged[3]).toBe("Edited");
      expect(logged[7]).toBe("owner@example.com");
    }
  });

  it("keeps the days as text and the amounts as numbers, with an empty cell for none", () => {
    const after = { ...before, advance: 20000, advanceDate: "2026-01-10", advanceStatus: "Held" as const };
    expect(rowsOf({ kind: "edited", before, after })).toEqual([
      row("Edited", "Advance", "", 20000),
      row("Edited", "Advance date", "", "2026-01-10"),
      row("Edited", "Advance status", "", "Held"),
    ]);
    const removed = { ...after, advance: null, advanceDate: "", advanceStatus: null };
    expect(rowsOf({ kind: "edited", before: after, after: removed })).toEqual([
      row("Edited", "Advance", 20000, ""),
      row("Edited", "Advance date", "2026-01-10", ""),
      row("Edited", "Advance status", "Held", ""),
    ]);
  });

  it("gives a row only for a field whose stored value changed", () => {
    const after = { ...before, moveIn: "2026-02-01" };
    expect(rowsOf({ kind: "edited", before, after })).toEqual([row("Edited", "Move-in date", "2026-01-15", "2026-02-01")]);
  });

  it("gives nothing for an edit that changed nothing", () => {
    expect(rowsOf({ kind: "edited", before, after: { ...before } })).toEqual([]);
    // The Updated by and Updated at stamps are not details: a save always changes them.
    expect(rowsOf({ kind: "edited", before, after: { ...before, updatedBy: "member@example.com", updatedAt: "2026-11-03T09:30:00.000Z" } })).toEqual([]);
  });

  it("compares text trimmed, as the tenancy is saved", () => {
    const after = { ...before, phone: " 98765 43210 ", agreementEnd: "2027-01-14 ", notes: "Paid by cheque\t" };
    expect(rowsOf({ kind: "edited", before, after })).toEqual([]);
  });

  it("says that Notes changed without saying what they were or are", () => {
    const after = { ...before, notes: "Prefers calls after 6" };
    expect(rowsOf({ kind: "edited", before, after })).toEqual([row("Edited", "Notes", "", "")]);
  });

  it("never copies a phone number or a note into a row, whatever the values are", () => {
    const secretBefore = tenancyRow({ phone: "CANARY-PHONE-OLD", notes: "CANARY-NOTE-OLD", tenant: "CANARY-TENANT" });
    const secretAfter = { ...secretBefore, phone: "CANARY-PHONE-NEW", notes: "CANARY-NOTE-NEW", agreementEnd: "2027-03-31" };
    const text = JSON.stringify([
      ...rowsOf({ kind: "edited", before: secretBefore, after: secretAfter }),
      ...rowsOf({ kind: "added", after: secretAfter }),
      ...rowsOf({ kind: "moved-out", before: secretBefore, after: { ...secretAfter, moveOut: "2026-11-30" } }),
      ...rowsOf({ kind: "moved-out", before: null, after: { ...secretAfter, moveOut: "2026-11-30" } }),
      ...rowsOf({ kind: "closed", before: secretBefore, moveOut: "2026-11-03" }),
    ]);
    expect(text).not.toContain("CANARY");
  });
});

describe("a move-out", () => {
  const before = tenancyRow({ advance: 20000, advanceStatus: "Held", notes: "" });

  it("gives the day, what became of the advance, the refund, the deductions and the notes, in column order", () => {
    const after = {
      ...before,
      advanceStatus: "Refunded" as const,
      refund: 18000,
      deductions: 2000,
      notes: "Left the keys with the neighbour",
      moveOut: "2026-11-30",
    };
    expect(rowsOf({ kind: "moved-out", before, after })).toEqual([
      row("Moved out", "Advance status", "Held", "Refunded"),
      row("Moved out", "Refund", "", 18000),
      row("Moved out", "Deductions", "", 2000),
      row("Moved out", "Notes", "", ""),
      row("Moved out", "Move-out date", "", "2026-11-30"),
    ]);
  });

  it("gives only the move-out day when nothing else was given", () => {
    expect(rowsOf({ kind: "moved-out", before, after: { ...before, moveOut: "2026-11-30" } })).toEqual([
      row("Moved out", "Move-out date", "", "2026-11-30"),
    ]);
  });

  it("for a tenant with no details on file, gives what the new closed row holds against an empty one", () => {
    const closed = tenancyRow({
      id: "t-9",
      moveIn: "",
      notes: "Left early",
      moveOut: "2026-11-30",
    });
    expect(rowsOf({ kind: "moved-out", before: null, after: closed })).toEqual([
      row("Moved out", "Notes", "", "", "t-9"),
      row("Moved out", "Move-out date", "", "2026-11-30", "t-9"),
    ]);
    expect(rowsOf({ kind: "moved-out", before: null, after: { ...closed, notes: "" } })).toEqual([
      row("Moved out", "Move-out date", "", "2026-11-30", "t-9"),
    ]);
  });
});

describe("a closing by the next tenant", () => {
  it("gives one Closed row for the Move-out date", () => {
    const before = tenancyRow({ phone: "98765 43210", notes: "x" });
    expect(rowsOf({ kind: "closed", before, moveOut: "2026-11-03" })).toEqual([row("Closed", "Move-out date", "", "2026-11-03")]);
  });
});

describe("a new tenancy", () => {
  it("gives one Added row with no field and no values", () => {
    const after = tenancyRow({ id: "t-2", phone: "98765 43210", advance: 20000, moveIn: "2026-11-01" });
    expect(rowsOf({ kind: "added", after })).toEqual([row("Added", "", "", "", "t-2")]);
  });
});

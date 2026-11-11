import { describe, expect, it } from "vitest";
import { formatSavedAt } from "@/lib/format";
import {
  HISTORY_EMPTY_HINT,
  HISTORY_EMPTY_TITLE,
  HISTORY_SHOWN_LIMIT,
  historyEntries,
  historyOverLimitNote,
  historyProblemNotice,
  PAST_TENANT,
} from "@/lib/tenancy-history";
import type { TenancyLogItem } from "@/lib/sheets/tenancy-log-store";

// What the History section of the tenant page says about the Tenancy Log's rows: one entry for each save, newest first, in
// plain words. Pure, so it is tried with odd and hand-edited rows too.

const SAVED_AT = "2026-11-03T09:30:00.000Z";
const NAMES = new Map([
  ["t-1", "Asha"],
  ["t-0", "Esha"],
]);

const item = (overrides: Partial<TenancyLogItem> = {}): TenancyLogItem => ({
  savedAt: SAVED_AT,
  tenancyId: "t-1",
  portionId: "p1",
  action: "Edited",
  field: "",
  oldValue: "",
  newValue: "",
  changedBy: "owner@example.com",
  ...overrides,
});

/** The rows of one save, as the tab holds them (oldest first); the function is given them newest first. */
const newestFirst = (...rows: TenancyLogItem[]) => [...rows].reverse();

const one = (rows: TenancyLogItem[], viewer: string | null = "owner@example.com") => historyEntries(newestFirst(...rows), NAMES, viewer).entries;

describe("the words of an entry", () => {
  it("Added: details were added for the tenant, with no lines", () => {
    const [entry] = one([item({ action: "Added" })]);
    expect(entry.title).toBe("Details added for Asha.");
    expect(entry.lines).toEqual([]);
  });

  it("Edited: details were changed, with one line for each field", () => {
    const [entry] = one([
      item({ field: "Phone" }),
      item({ field: "Agreement end", oldValue: "2027-01-14", newValue: "2027-03-31" }),
      item({ field: "Advance", oldValue: 20000, newValue: 25000 }),
      item({ field: "Notes" }),
    ]);
    expect(entry.title).toBe("Details changed for Asha.");
    expect(entry.lines).toEqual([
      "Phone number changed.",
      "Agreement end changed from 14 Jan 2027 to 31 Mar 2027.",
      "Advance changed from ₹ 20,000 to ₹ 25,000.",
      "Notes changed.",
    ]);
  });

  it("says a field was set when it had no value, and removed (with what it was) when it has none now", () => {
    const [entry] = one([
      item({ field: "Agreement end", oldValue: "", newValue: "2027-03-31" }),
      item({ field: "Advance", oldValue: "", newValue: 20000 }),
      item({ field: "Advance status", oldValue: "", newValue: "Held" }),
      item({ field: "Advance date", oldValue: "2026-01-10", newValue: "" }),
      item({ field: "Advance", oldValue: 20000, newValue: "" }),
    ]);
    expect(entry.lines).toEqual([
      "Agreement end set to 31 Mar 2027.",
      "Advance set to ₹ 20,000.",
      "Advance status set to Held.",
      "Advance date removed (was 10 Jan 2026).",
      "Advance removed (was ₹ 20,000).",
    ]);
  });

  it("writes days through formatDay and amounts through formatRupees, and a value it cannot read as it is", () => {
    const [entry] = one([
      item({ field: "Move-in date", oldValue: "2026-01-15", newValue: "2026-02-01" }),
      item({ field: "Refund", oldValue: "", newValue: 1234567 }),
      item({ field: "Deductions", oldValue: "", newValue: "to be decided" }),
      item({ field: "Move-in date", oldValue: "soon", newValue: "2026-02-30" }),
    ]);
    expect(entry.lines).toEqual([
      "Move-in date changed from 15 Jan 2026 to 1 Feb 2026.",
      "Refund set to ₹ 12,34,567.",
      "Deductions set to to be decided.",
      "Move-in date changed from soon to 2026-02-30.",
    ]);
  });

  it("never says what a phone number or a note was or is, even when a hand-edited row holds values", () => {
    const [entry] = one([
      item({ field: "Phone", oldValue: "98765 43210", newValue: "91234 56789" }),
      item({ field: "Notes", oldValue: "Paid by cheque", newValue: "Raised the advance" }),
    ]);
    expect(entry.lines).toEqual(["Phone number changed.", "Notes changed."]);
  });

  it("says only that a field changed when both of its values are blank", () => {
    const [entry] = one([item({ field: "Refund" })]);
    expect(entry.lines).toEqual(["Refund changed."]);
  });

  it("Edited with the Move-out date taken away (an undo opened the tenancy again): says the tenancy was opened again, and what the day was", () => {
    const [entry] = one([item({ field: "Move-out date", oldValue: "2026-10-05", newValue: "" })]);
    expect(entry.title).toBe("Asha's tenancy was opened again.");
    expect(entry.lines).toEqual(["Move-out date removed (was 5 Oct 2026)."]);
  });

  it("keeps the other lines of such an entry, and the plain title when a Move-out date is only changed or set", () => {
    const [opened] = one([item({ field: "Move-out date", oldValue: "2026-10-05", newValue: "" }), item({ field: "Refund", oldValue: "", newValue: 500 })]);
    expect(opened.title).toBe("Asha's tenancy was opened again.");
    expect(opened.lines).toEqual(["Move-out date removed (was 5 Oct 2026).", "Refund set to ₹\u00a0500."]);
    for (const [oldValue, newValue] of [["2026-10-05", "2026-10-09"], ["", "2026-10-09"], ["", ""]] as const) {
      const [other] = one([item({ field: "Move-out date", oldValue, newValue })]);
      expect(other.title, `${oldValue} to ${newValue}`).toBe("Details changed for Asha.");
    }
  });

  it("calls a tenancy it has no name for a past tenant, with a capital, when it was opened again", () => {
    const entries = historyEntries([item({ tenancyId: "t-gone", field: "Move-out date", oldValue: "2026-10-05", newValue: "" })], NAMES, null).entries;
    expect(entries[0].title).toBe("A past tenant's tenancy was opened again.");
  });

  it("Moved out: names the day in the title, and keeps a line for each other field", () => {
    const [entry] = one([
      item({ action: "Moved out", field: "Advance status", oldValue: "Held", newValue: "Refunded" }),
      item({ action: "Moved out", field: "Refund", oldValue: "", newValue: 18000 }),
      item({ action: "Moved out", field: "Notes" }),
      item({ action: "Moved out", field: "Move-out date", oldValue: "", newValue: "2026-11-30" }),
    ]);
    expect(entry.title).toBe("Asha moved out on 30 Nov 2026.");
    expect(entry.lines).toEqual(["Advance status changed from Held to Refunded.", "Refund set to ₹ 18,000.", "Notes changed."]);
  });

  it("Moved out, with no day in the rows: still says so, and keeps the other lines", () => {
    const [entry] = one([item({ action: "Moved out", field: "Refund", oldValue: "", newValue: 500 })]);
    expect(entry.title).toBe("Asha moved out.");
    expect(entry.lines).toEqual(["Refund set to ₹ 500."]);
  });

  it("Closed: says the tenancy was closed on the day, when the next tenant was added", () => {
    const [entry] = one([item({ tenancyId: "t-0", action: "Closed", field: "Move-out date", oldValue: "", newValue: "2026-10-01" })]);
    expect(entry.title).toBe("Esha's tenancy was closed on 1 Oct 2026, when the next tenant was added.");
    expect(entry.lines).toEqual([]);
  });

  it("Closed, with no day in the row, drops the day", () => {
    const [entry] = one([item({ tenancyId: "t-0", action: "Closed", field: "Move-out date", oldValue: "", newValue: "" })]);
    expect(entry.title).toBe("Esha's tenancy was closed, when the next tenant was added.");
  });

  it("an action it does not know reads 'Change recorded: {Field}.', one entry for each row", () => {
    const entries = one([
      item({ action: null, field: "Deposit" }),
      item({ action: null, field: "" }),
      item({ action: null, field: "Phone", oldValue: "98765 43210", newValue: "91234 56789" }),
    ]);
    expect(entries.map((entry) => entry.title)).toEqual(["Change recorded: Deposit.", "Change recorded.", "Change recorded: Phone."]);
    expect(entries.every((entry) => entry.lines.length === 0)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("98765");
  });

  it("calls a tenancy it has no name for a past tenant, with a capital at the start of a sentence", () => {
    const rows = [
      item({ tenancyId: "t-gone", action: "Added" }),
      item({ tenancyId: "t-gone2", action: "Moved out", field: "Move-out date", newValue: "2026-11-30" }),
      item({ tenancyId: "t-gone3", action: "Closed", field: "Move-out date", newValue: "2026-10-01", savedAt: "2026-11-03T09:31:00.000Z" }),
      item({ tenancyId: "t-gone4", action: "Edited", field: "Phone", savedAt: "2026-11-03T09:32:00.000Z" }),
    ];
    expect(PAST_TENANT).toBe("a past tenant");
    expect(historyEntries(newestFirst(...rows), NAMES, null).entries.map((entry) => entry.title)).toEqual([
      "Details changed for a past tenant.",
      "A past tenant's tenancy was closed on 1 Oct 2026, when the next tenant was added.",
      "Details added for a past tenant.",
      "A past tenant moved out on 30 Nov 2026.",
    ]);
  });

  it("treats a blank name as no name", () => {
    const names = new Map([["t-1", "   "]]);
    expect(historyEntries([item({ action: "Added" })], names, null).entries[0].title).toBe("Details added for a past tenant.");
  });
});

describe("who and when", () => {
  const when = formatSavedAt(SAVED_AT);

  it("says by you for the signed-in person's own address, however its capitals are written", () => {
    for (const changedBy of ["owner@example.com", "Owner@Example.COM", " owner@example.com "]) {
      expect(one([item({ action: "Added", changedBy })])[0].meta).toBe(`${when} · by you`);
    }
  });

  it("says by and the address for anyone else, and who: not recorded for nobody", () => {
    expect(one([item({ action: "Added", changedBy: "member@example.com" })])[0].meta).toBe(`${when} · by member@example.com`);
    expect(one([item({ action: "Added", changedBy: "" })])[0].meta).toBe(`${when} · who: not recorded`);
    expect(one([item({ action: "Added", changedBy: "  " })])[0].meta).toBe(`${when} · who: not recorded`);
  });

  it("says by the address for everyone when nobody is signed in", () => {
    expect(one([item({ action: "Added" })], null)[0].meta).toBe(`${when} · by owner@example.com`);
  });

  it("writes the time in India time", () => {
    expect(one([item({ action: "Added" })])[0].meta).toMatch(/^3 Nov, 3:00\s?pm · /i);
  });

  it("says the time is not recorded when the saved-at cannot be read", () => {
    for (const savedAt of ["", "yesterday", "5 Oct", "2026-11-03"]) {
      expect(one([item({ action: "Added", savedAt })])[0].meta).toBe("Time not recorded · by you");
    }
  });
});

describe("the grouping and the order", () => {
  it("makes one entry of the neighbouring rows of one save, with the lines in the order they were written", () => {
    const entries = one([
      item({ field: "Phone" }),
      item({ field: "Move-in date", oldValue: "2026-01-15", newValue: "2026-01-20" }),
      item({ field: "Notes" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].lines.map((line) => line.split(" ")[0])).toEqual(["Phone", "Move-in", "Notes"]);
  });

  it("lists the saves newest first, whatever they are", () => {
    const rows = [
      item({ savedAt: "2026-11-01T05:00:00.000Z", action: "Added" }),
      item({ savedAt: "2026-11-02T05:00:00.000Z", field: "Phone" }),
      item({ savedAt: "2026-11-03T05:00:00.000Z", action: "Moved out", field: "Move-out date", newValue: "2026-11-30" }),
    ];
    expect(one(rows).map((entry) => entry.title)).toEqual(["Asha moved out on 30 Nov 2026.", "Details changed for Asha.", "Details added for Asha."]);
  });

  it("splits one save by tenancy and by action: a new tenant's start is its own entry beside the one it closed, Added first", () => {
    const rows = [
      item({ tenancyId: "t-1", action: "Added" }),
      item({ tenancyId: "t-0", action: "Closed", field: "Move-out date", newValue: "2026-10-01" }),
    ];
    expect(one(rows).map((entry) => entry.title)).toEqual([
      "Details added for Asha.",
      "Esha's tenancy was closed on 1 Oct 2026, when the next tenant was added.",
    ]);
  });

  it("keeps two saves apart when they are the same moment, tenancy and action but not neighbours", () => {
    const rows = [
      item({ field: "Phone" }),
      item({ savedAt: "2026-11-03T09:31:00.000Z", field: "Notes" }),
      item({ field: "Refund", newValue: 5 }),
    ];
    expect(one(rows)).toHaveLength(3);
  });

  it("keeps saves of one tenancy and one moment apart when the action differs", () => {
    const rows = [item({ action: "Edited", field: "Phone" }), item({ action: "Moved out", field: "Move-out date", newValue: "2026-11-30" })];
    expect(one(rows)).toHaveLength(2);
  });

  it("shows at most HISTORY_SHOWN_LIMIT entries, the newest, and says how many older ones there are", () => {
    expect(HISTORY_SHOWN_LIMIT).toBe(30);
    const rows = Array.from({ length: 34 }, (_, index) =>
      item({ savedAt: new Date(Date.UTC(2026, 9, 1, 5, index)).toISOString(), field: "Phone" }),
    );
    const { entries, older } = historyEntries(newestFirst(...rows), NAMES, null);
    expect(entries).toHaveLength(30);
    expect(older).toBe(4);
    expect(entries[0].meta).toContain(formatSavedAt(rows[33].savedAt));
    expect(entries[29].meta).toContain(formatSavedAt(rows[4].savedAt));
  });

  it("counts every row of a save as one entry against the limit", () => {
    const rows = Array.from({ length: 30 }, (_, index) => item({ field: "Phone", savedAt: new Date(Date.UTC(2026, 9, 1, 5, 0, index)).toISOString() }));
    const withLines = rows.flatMap((row) => [row, { ...row, field: "Notes" }]);
    const { entries, older } = historyEntries(newestFirst(...withLines), NAMES, null);
    expect(entries).toHaveLength(30);
    expect(older).toBe(0);
    expect(entries.every((entry) => entry.lines.length === 2)).toBe(true);
  });

  it("is empty for no rows", () => {
    expect(historyEntries([], NAMES, null)).toEqual({ entries: [], older: 0 });
  });

  it("does not change the rows it is given", () => {
    const rows = newestFirst(item({ field: "Phone" }), item({ field: "Notes" }));
    const before = structuredClone(rows);
    historyEntries(rows, NAMES, null);
    expect(rows).toEqual(before);
  });
});

describe("the words around the list", () => {
  it("says what an empty history means", () => {
    expect(HISTORY_EMPTY_TITLE).toBe("No changes recorded yet.");
    expect(HISTORY_EMPTY_HINT).toBe(
      "Changes saved in the app from now on are listed here, newest first. Changes made straight in the Sheet are not.",
    );
  });

  it("says that older changes are in the Tenancy Log tab", () => {
    expect(historyOverLimitNote()).toBe("Showing the newest 30 changes. Older ones are in the Tenancy Log tab of your Sheet.");
  });

  it("says the history cannot be shown, with the reason", () => {
    expect(historyProblemNotice("Google isn't responding. Try again in a minute.")).toBe(
      "The history can't be shown right now. Google isn't responding. Try again in a minute.",
    );
  });
});

describe("the kind of an entry, for the icon beside it", () => {
  it("is added, edited, moved-out (a move-out or a closing) or other", () => {
    const kind = (rows: TenancyLogItem[]) => one(rows)[0].kind;
    expect(kind([item({ action: "Added" })])).toBe("added");
    expect(kind([item({ field: "Phone" })])).toBe("edited");
    expect(kind([item({ action: "Moved out", field: "Move-out date", newValue: "2026-10-05" })])).toBe("moved-out");
    expect(kind([item({ action: "Closed", field: "Move-out date", newValue: "2026-10-05" })])).toBe("moved-out");
    expect(kind([item({ action: null })])).toBe("other");
  });
});

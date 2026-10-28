import { describe, expect, it } from "vitest";
import type { PortionConfig } from "@/lib/domain/types";
import { onPortions, parseSettingsRows, reconcileRows, rowFromPortion, type SettingsRowInput } from "@/lib/settings-input";

const row = (patch: Partial<SettingsRowInput> = {}): SettingsRowInput => ({
  id: "p1",
  name: "Ground floor",
  cycle: "11",
  never: false,
  hike: "5",
  ...patch,
});

/** What the form is told about the first thing that is wrong in `rows`. */
const failure = (...rows: SettingsRowInput[]) => {
  const result = parseSettingsRows(rows);
  expect(result.ok).toBe(false);
  return result.ok ? { message: "", rowId: "", field: "" } : result;
};

const NAME = "Portion name must be 1 to 60 characters.";
const CYCLE = 'Payments per cycle must be a whole number from 1 to 120. To stop the count resetting, tick "Count never resets".';
const HIKE = "Hike must be a number from 0 to 100. Use a dot for decimals, like 5.5.";

describe("parseSettingsRows", () => {
  it("accepts good input and trims text", () => {
    const result = parseSettingsRows([
      row({ name: "  Attic  ", cycle: " 12 ", hike: " 7.5 " }),
      row({ id: "p2", never: true, cycle: "garbage" }),
    ]);
    expect(result).toEqual({
      ok: true,
      portions: [
        { id: "p1", name: "Attic", cycleLength: 12, hikePercent: 7.5 },
        { id: "p2", name: "Ground floor", cycleLength: null, hikePercent: 5 },
      ],
    });
  });

  it("only the checkbox can make the cycle length null", () => {
    for (const cycle of ["", "abc", "1.2.3", "12,5", "11.5", "0", "-3", "1e2", "121", "Infinity"]) {
      expect(failure(row({ cycle })), JSON.stringify(cycle)).toEqual({ ok: false, message: CYCLE, rowId: "p1", field: "cycle" });
    }
  });

  it("accepts the cycle length boundaries", () => {
    for (const cycle of ["1", "120", "007"]) {
      expect(parseSettingsRows([row({ cycle })]).ok).toBe(true);
    }
  });

  it("rejects an unusable hike percent, and says to use a dot with an example", () => {
    for (const hike of ["", "abc", "12,5", "-1", "101", "1e2", "5%", "."]) {
      expect(failure(row({ hike })), JSON.stringify(hike)).toEqual({ ok: false, message: HIKE, rowId: "p1", field: "hike" });
    }
    expect(parseSettingsRows([row({ hike: "0" })]).ok).toBe(true);
    expect(parseSettingsRows([row({ hike: "100" })]).ok).toBe(true);
  });

  it("rejects an empty or very long name", () => {
    expect(failure(row({ name: "   " }))).toEqual({ ok: false, message: NAME, rowId: "p1", field: "name" });
    expect(failure(row({ name: "x".repeat(61) }))).toEqual({ ok: false, message: NAME, rowId: "p1", field: "name" });
    expect(parseSettingsRows([row({ name: "x".repeat(60) })]).ok).toBe(true);
  });

  it("says where the problem is by the field and the row, and no longer puts the portion's name or id in front of the message", () => {
    for (const result of [failure(row({ id: "p4", name: "   " })), failure(row({ id: "p4", name: "Attic", cycle: "abc" })), failure(row({ id: "p4", name: "Attic", hike: "x" }))]) {
      expect(result.rowId).toBe("p4");
      expect(result.message).not.toMatch(/^p4|^Attic|:/);
      expect(result.message).not.toContain("Attic");
    }
  });

  it("names the first problem in the order the fields are on the screen: name, then payments per cycle, then hike", () => {
    expect(failure(row({ name: "", cycle: "x", hike: "x" })).field).toBe("name");
    expect(failure(row({ cycle: "x", hike: "x" })).field).toBe("cycle");
    expect(failure(row({ hike: "x" })).field).toBe("hike");
  });

  it("does not check the cycle of a row whose count never resets, but still checks its hike", () => {
    expect(failure(row({ never: true, cycle: "x", hike: "x" })).field).toBe("hike");
  });

  it("stops at the first problem, in the first row that has one, and returns no partial payload", () => {
    const result = parseSettingsRows([row(), row({ id: "p2", cycle: "abc" }), row({ id: "p3", name: "" })]);
    expect(result).toMatchObject({ ok: false, rowId: "p2", field: "cycle" });
    expect(result).not.toHaveProperty("portions");
  });
});

const portion = (patch: Partial<PortionConfig> = {}): PortionConfig => ({
  id: "p1",
  name: "Ground floor",
  tenantHeader: "Tenant",
  countHeader: "Count",
  amountHeader: "Amount",
  cycleLength: 11,
  hikePercent: 5,
  ...patch,
});

describe("rowFromPortion", () => {
  it("fills the form row from what the Sheet holds, as text", () => {
    expect(rowFromPortion(portion())).toEqual({ id: "p1", name: "Ground floor", cycle: "11", never: false, hike: "5" });
    expect(rowFromPortion(portion({ hikePercent: 7.5 })).hike).toBe("7.5");
  });

  it("ticks Count never resets for a portion with no cycle length, and leaves a usual cycle in the box behind it", () => {
    expect(rowFromPortion(portion({ cycleLength: null }))).toEqual({ id: "p1", name: "Ground floor", cycle: "11", never: true, hike: "5" });
  });
});

describe("onPortions", () => {
  it("keeps the portions that are on, in order, and leaves out the ones switched off", () => {
    const all = [portion({ id: "p1" }), portion({ id: "p2", inactive: true }), portion({ id: "p3" })];
    expect(onPortions(all).map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(onPortions([])).toEqual([]);
  });
});

describe("reconcileRows", () => {
  const typed = (patch: Partial<SettingsRowInput>) => row({ ...patch });

  it("keeps what was typed for a portion that is still on, even when the Sheet says something else", () => {
    const rows = [typed({ id: "p1", name: "Ground (typed)", hike: "9" })];
    expect(reconcileRows(rows, [portion({ id: "p1", name: "Ground floor" })])).toEqual(rows);
  });

  it("takes a row for each portion that is on from the Sheet when nothing was typed for it (a portion just added or switched on)", () => {
    const rows = [typed({ id: "p1" })];
    const next = reconcileRows(rows, [portion({ id: "p1" }), portion({ id: "p6", name: "Roof room", cycleLength: null, hikePercent: 0 })]);
    expect(next).toEqual([rows[0], { id: "p6", name: "Roof room", cycle: "11", never: true, hike: "0" }]);
  });

  it("drops the row of a portion that was switched off, and has no row for one that never was on", () => {
    const rows = [typed({ id: "p1" }), typed({ id: "p2", name: "First floor" })];
    expect(reconcileRows(rows, [portion({ id: "p1" }), portion({ id: "p2", inactive: true })])).toEqual([rows[0]]);
  });

  it("follows the order of the portions, so a new order puts the rows in it, typed text and all", () => {
    const rows = [typed({ id: "p1", name: "A (typed)" }), typed({ id: "p2", name: "B (typed)" })];
    const next = reconcileRows(rows, [portion({ id: "p2" }), portion({ id: "p1" })]);
    expect(next.map((r) => r.name)).toEqual(["B (typed)", "A (typed)"]);
  });

  it("never changes the rows it is given", () => {
    const rows = Object.freeze([typed({ id: "p1" })]);
    expect(() => reconcileRows(rows, [portion({ id: "p1" }), portion({ id: "p2" })])).not.toThrow();
    expect(rows).toHaveLength(1);
  });
});

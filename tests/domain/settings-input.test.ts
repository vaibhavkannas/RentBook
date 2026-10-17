import { describe, expect, it } from "vitest";
import { parseSettingsRows, type SettingsRowInput } from "@/lib/settings-input";

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

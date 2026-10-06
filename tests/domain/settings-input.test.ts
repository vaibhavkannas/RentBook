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

const failure = (patch: Partial<SettingsRowInput>) => {
  const result = parseSettingsRows([row(patch)]);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.message;
};

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
      expect(failure({ cycle })).toMatch(/cycle length must be a whole number from 1 to 120/);
    }
  });

  it("accepts the cycle length boundaries", () => {
    for (const cycle of ["1", "120", "007"]) {
      expect(parseSettingsRows([row({ cycle })]).ok).toBe(true);
    }
  });

  it("rejects an unusable hike percent", () => {
    for (const hike of ["", "abc", "12,5", "-1", "101", "1e2", "5%", "."]) {
      expect(failure({ hike })).toMatch(/hike % must be a number from 0 to 100/);
    }
    expect(parseSettingsRows([row({ hike: "0" })]).ok).toBe(true);
    expect(parseSettingsRows([row({ hike: "100" })]).ok).toBe(true);
  });

  it("rejects an empty or very long name and names the portion in the message", () => {
    expect(failure({ name: "   ", id: "p4" })).toMatch(/^p4: the name must be 1 to 60/);
    expect(failure({ name: "x".repeat(61) })).toMatch(/the name must be 1 to 60/);
    expect(failure({ cycle: "abc", name: "Attic" })).toMatch(/^Attic: /);
  });

  it("stops at the first problem and returns no partial payload", () => {
    const result = parseSettingsRows([row(), row({ id: "p2", cycle: "abc" }), row({ id: "p3" })]);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("portions");
  });
});

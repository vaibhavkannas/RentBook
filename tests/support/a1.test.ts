import { describe, expect, it } from "vitest";
import { parseA1 } from "./a1";

describe("parseA1", () => {
  it("parses open-ended ranges", () => {
    expect(parseA1("A1:ZZ")).toEqual({ startCol: 0, endCol: 701, startRow: 1, endRow: null });
  });
  it("parses a row range", () => {
    expect(parseA1("A12:ZZ12")).toEqual({ startCol: 0, endCol: 701, startRow: 12, endRow: 12 });
  });
  it("parses a single cell", () => {
    expect(parseA1("D5")).toEqual({ startCol: 3, endCol: 3, startRow: 5, endRow: 5 });
  });
  it("rejects unsupported input", () => {
    expect(() => parseA1("Sheet1!A1")).toThrow(/Unsupported/);
  });
});

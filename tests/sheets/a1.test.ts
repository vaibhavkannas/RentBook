import { describe, expect, it } from "vitest";
import { colIndex, colLetter, parseA1 } from "@/lib/sheets/a1";

describe("column letters", () => {
  it("converts both ways", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(701)).toBe("ZZ");
    expect(colIndex("A")).toBe(0);
    expect(colIndex("AA")).toBe(26);
    expect(colIndex("ZZ")).toBe(701);
  });
});

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

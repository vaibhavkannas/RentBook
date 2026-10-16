import { describe, expect, it } from "vitest";
import { colIndex, colLetter } from "@/lib/sheets/a1";

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

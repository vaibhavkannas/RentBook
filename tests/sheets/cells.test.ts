import { describe, expect, it } from "vitest";
import { isBlankCell, text } from "@/lib/sheets/cells";

describe("text", () => {
  it("is the empty string for a cell with nothing in it, and the content as text otherwise", () => {
    expect(text(undefined)).toBe("");
    expect(text(null)).toBe("");
    expect(text("")).toBe("");
    expect(text("Asha")).toBe("Asha");
    expect(text(5450)).toBe("5450");
    expect(text(0)).toBe("0");
    expect(text(false)).toBe("false");
  });
});

describe("isBlankCell", () => {
  it("is true for nothing, an empty string, and only spaces", () => {
    for (const cell of [undefined, null, "", " ", "\t \n"]) expect(isBlankCell(cell)).toBe(true);
  });

  it("is false for anything with content, including 0", () => {
    for (const cell of ["a", " a ", 0, 5, false]) expect(isBlankCell(cell)).toBe(false);
  });
});

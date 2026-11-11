import { describe, expect, it } from "vitest";
import { closeIfCurrent } from "@/lib/sheet-active";

describe("closing a sheet", () => {
  const second = { nonce: 2, typed: "13000" };

  it("closes the sheet that is open when it is its own close", () => {
    expect(closeIfCurrent(second, 2)).toBeNull();
  });

  it("leaves the open sheet, and what was typed in it, alone when an earlier sheet answers late and closes itself", () => {
    expect(closeIfCurrent(second, 1)).toBe(second);
  });

  it("does nothing when no sheet is open", () => {
    expect(closeIfCurrent(null, 1)).toBeNull();
  });
});

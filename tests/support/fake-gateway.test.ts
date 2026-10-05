import { describe, expect, it } from "vitest";
import { cell, FakeGateway } from "./fake-gateway";

describe("FakeGateway.getValues", () => {
  it("fills blank cells inside a row with empty strings and trims trailing blanks", async () => {
    const fake = new FakeGateway({ T: [["a", undefined, , "x", "", undefined]] });
    expect(await fake.getValues("T", "A1:ZZ", "UNFORMATTED_VALUE")).toEqual([["a", "", "", "x"]]);
  });

  it("drops trailing blank rows and keeps blank rows in the middle", async () => {
    const fake = new FakeGateway({ T: [["a"], [], ["b"], [], []] });
    expect(await fake.getValues("T", "A1:ZZ", "UNFORMATTED_VALUE")).toEqual([["a"], [], ["b"]]);
  });

  it("reads a sub-range by column and row", async () => {
    const fake = new FakeGateway({ T: [["a", "b", "c"], ["d", "e", "f"]] });
    expect(await fake.getValues("T", "B2:C2", "FORMATTED_VALUE")).toEqual([["e", "f"]]);
    expect(await fake.getValues("T", "C1", "FORMATTED_VALUE")).toEqual([["c"]]);
  });

  it("returns formula text only for the FORMULA render, and 0 otherwise", async () => {
    const fake = new FakeGateway({ T: [["=A2+B2", 5]] });
    expect(await fake.getValues("T", "A1", "FORMULA")).toEqual([["=A2+B2"]]);
    expect(await fake.getValues("T", "A1", "UNFORMATTED_VALUE")).toEqual([[0]]);
    expect(await fake.getValues("T", "A1", "FORMATTED_VALUE")).toEqual([[0]]);
    expect(await fake.getValues("T", "B1", "UNFORMATTED_VALUE")).toEqual([[5]]);
  });
});

describe("FakeGateway writes", () => {
  it("updateValues writes into the right cells and creates rows as needed", async () => {
    const fake = new FakeGateway({ T: [["a"]] });
    await fake.updateValues([{ tab: "T", a1: "C3", values: [["z"]] }]);
    expect(cell(fake, "T", "C", 3)).toBe("z");
    expect(cell(fake, "T", "A", 1)).toBe("a");
  });

  it("appendRow adds a row after the last one", async () => {
    const fake = new FakeGateway({ T: [["a"]] });
    await fake.appendRow("T", ["b", 2]);
    expect(fake.tabs.get("T")).toEqual([["a"], ["b", 2]]);
  });

  it("addTab refuses a duplicate title and keeps the existing data", async () => {
    const fake = new FakeGateway({ T: [["a"]] });
    await expect(fake.addTab("T")).rejects.toThrow(/already exists/);
    expect(fake.tabs.get("T")).toEqual([["a"]]);
    await fake.addTab("U");
    expect(fake.tabs.get("U")).toEqual([]);
  });
});

describe("FakeGateway.cloneRow", () => {
  const source = ["Jan", "Asha", 1, 5000, "=D1+D1+$D$1+D$1+$D1"];

  it("shifts relative row references, leaves absolute ones, then clears and overrides", async () => {
    const fake = new FakeGateway({ T: [source] });
    await fake.cloneRow("T", 1, 2, [1, 2, 3], [{ col: 0, value: "Feb" }]);
    const row = fake.tabs.get("T")![1];
    expect(row[0]).toBe("Feb");
    expect(row[1]).toBeUndefined();
    expect(row[2]).toBeUndefined();
    expect(row[3]).toBeUndefined();
    expect(row[4]).toBe("=D2+D2+$D$1+D$1+$D2");
    expect(fake.tabs.get("T")![0]).toEqual(source);
  });

  it("applies an override to a column that was also cleared", async () => {
    const fake = new FakeGateway({ T: [source] });
    await fake.cloneRow("T", 1, 2, [3], [{ col: 3, value: 42 }]);
    expect(cell(fake, "T", "D", 2)).toBe(42);
  });

  it("rejects a missing or empty source row and changes nothing", async () => {
    const fake = new FakeGateway({ T: [source, []] });
    await expect(fake.cloneRow("T", 2, 3, [], [])).rejects.toThrow(/row 2 is empty/);
    await expect(fake.cloneRow("T", 9, 3, [], [])).rejects.toThrow(/row 9 is empty or missing/);
    expect(fake.tabs.get("T")).toHaveLength(2);
  });

  it("rejects an occupied target row and changes nothing", async () => {
    const fake = new FakeGateway({ T: [source, ["note"]] });
    await expect(fake.cloneRow("T", 1, 2, [], [])).rejects.toThrow(/row 2 is not empty/);
    expect(fake.tabs.get("T")![1]).toEqual(["note"]);
  });
});

describe("FakeGateway.failOn", () => {
  it("throws for a listed method, records the call, and leaves state unchanged", async () => {
    const fake = new FakeGateway({ T: [["a", 1]] });
    fake.failOn.add("cloneRow");
    await expect(fake.cloneRow("T", 1, 2, [], [])).rejects.toThrow(/cloneRow failed/);
    expect(fake.calls).toEqual(["cloneRow"]);
    expect(fake.tabs.get("T")).toHaveLength(1);
    fake.failOn.clear();
    await fake.cloneRow("T", 1, 2, [], []);
    expect(fake.tabs.get("T")).toHaveLength(2);
  });
});

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

describe("FakeGateway.getManyValues", () => {
  it("answers each request like getValues, in the order asked, as ONE call", async () => {
    const fake = new FakeGateway({ T: [["a", "b"], ["c"]], U: [["=A1", 5]] });
    const out = await fake.getManyValues(
      [
        { tab: "U", a1: "A1:B1" },
        { tab: "T", a1: "A1:ZZ" },
        { tab: "T", a1: "B2" },
      ],
      "UNFORMATTED_VALUE",
    );
    expect(out).toEqual([[[0, 5]], [["a", "b"], ["c"]], []]);
    expect(fake.calls).toEqual(["getManyValues"]);
  });

  it("returns formula text only for the FORMULA render, like getValues", async () => {
    const fake = new FakeGateway({ T: [["=A2+B2", 5]] });
    expect(await fake.getManyValues([{ tab: "T", a1: "A1" }], "FORMULA")).toEqual([[["=A2+B2"]]]);
  });

  it("fails as a whole when any tab is missing, and can be made to fail, and to take time", async () => {
    const fake = new FakeGateway({ T: [["a"]] }, { delayMs: 20 });
    await expect(
      fake.getManyValues([{ tab: "T", a1: "A1" }, { tab: "Nope", a1: "A1" }], "FORMULA"),
    ).rejects.toThrow(/No tab named Nope/);
    fake.failOn.add("getManyValues");
    const started = performance.now();
    await expect(fake.getManyValues([], "FORMULA")).rejects.toThrow(/getManyValues failed/);
    expect(performance.now() - started).toBeLessThan(15);
  });

  it("answers nothing for no requests", async () => {
    expect(await new FakeGateway().getManyValues([], "FORMULA")).toEqual([]);
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

  it("overwrites an occupied target row, as Google's copy and paste does", async () => {
    const fake = new FakeGateway({ T: [source, ["note", "x", "y", "z", "w", "extra"]] });
    await fake.cloneRow("T", 1, 2, [1], [{ col: 0, value: "Feb" }]);
    const row = fake.tabs.get("T")![1];
    expect(row).toHaveLength(5);
    expect(row[0]).toBe("Feb");
    expect(row[1]).toBeUndefined();
    expect(row[2]).toBe(1);
    expect(row[3]).toBe(5000);
    expect(row[4]).toBe("=D2+D2+$D$1+D$1+$D2");
  });

  it("overwrites a target row whose cells hold someone else's data", async () => {
    const fake = new FakeGateway({ T: [source, ["Feb", "Bala", 7, 9999]] });
    await fake.cloneRow("T", 1, 2, [1, 2, 3], []);
    expect(fake.tabs.get("T")![1].slice(0, 4)).toEqual(["Jan", undefined, undefined, undefined]);
  });
});

describe("FakeGateway latency", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("has none unless asked for", async () => {
    const fake = new FakeGateway({ T: [["a"]] });
    expect(fake.delayMs).toBe(0);
    const started = performance.now();
    await fake.getValues("T", "A1", "FORMATTED_VALUE");
    expect(performance.now() - started).toBeLessThan(20);
  });

  it("makes every call take delayMs, from the constructor option or by setting the field", async () => {
    const fake = new FakeGateway({ T: [["a"]] }, { delayMs: 25 });
    let started = performance.now();
    await fake.getValues("T", "A1", "FORMATTED_VALUE");
    expect(performance.now() - started).toBeGreaterThanOrEqual(20);

    fake.delayMs = 0;
    started = performance.now();
    await fake.listTabs();
    expect(performance.now() - started).toBeLessThan(20);

    fake.delayMs = 25;
    started = performance.now();
    await fake.appendRow("T", ["b"]);
    await fake.cloneRow("T", 1, 3, [], []);
    expect(performance.now() - started).toBeGreaterThanOrEqual(40);
  });

  it("applies a write after its delay, and a read sees the sheet as it is when the delay is over", async () => {
    const fake = new FakeGateway({ T: [["old"]] }, { delayMs: 30 });
    const write = fake.updateValues([{ tab: "T", a1: "A1", values: [["new"]] }]);
    await sleep(10);
    // The write has been sent but has not landed yet: the sheet still says "old".
    expect(fake.tabs.get("T")![0][0]).toBe("old");
    await write;
    expect(fake.tabs.get("T")![0][0]).toBe("new");
  });

  it("still records a call and refuses a listed method straight away", async () => {
    const fake = new FakeGateway({ T: [["a"]] }, { delayMs: 50 });
    fake.failOn.add("listTabs");
    const started = performance.now();
    await expect(fake.listTabs()).rejects.toThrow(/listTabs failed/);
    expect(performance.now() - started).toBeLessThan(40);
    expect(fake.calls).toEqual(["listTabs"]);
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

describe("FakeGateway with a grid that has a limit on its columns (gridColumns)", () => {
  const limited = () => new FakeGateway({ T: [["a", "b", "c"]], U: [["x"]] }, { gridColumns: { T: 3 } });

  it("takes a write inside the limit", async () => {
    const fake = limited();
    await fake.updateValues([{ tab: "T", a1: "C2", values: [["z"]] }]);
    expect(cell(fake, "T", "C", 2)).toBe("z");
  });

  it("refuses a write beyond it the way Google does, naming the range and the limit, and changes nothing", async () => {
    const fake = limited();
    const error = await fake
      .updateValues([
        { tab: "T", a1: "A2", values: [["first"]] },
        { tab: "T", a1: "D1", values: [["beyond"]] },
      ])
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(error?.message).toMatch(/exceeds grid limits/);
    expect(error?.message).toContain("T!D1");
    expect(error?.message).toContain("max columns: 3");
    expect(fake.tabs.get("T")).toEqual([["a", "b", "c"]]);
  });

  it("measures a write by its last cell: three cells from B reach column D", async () => {
    const fake = limited();
    await expect(fake.updateValues([{ tab: "T", a1: "B1:D1", values: [["x", "y", "z"]] }])).rejects.toThrow(/exceeds grid limits/);
    await fake.updateValues([{ tab: "T", a1: "A1:C1", values: [["x", "y", "z"]] }]);
    expect(fake.tabs.get("T")).toEqual([["x", "y", "z"]]);
  });

  it("leaves a tab with no limit unlimited, and reads past the limit as empty", async () => {
    const fake = limited();
    await fake.updateValues([{ tab: "U", a1: "ZZ1", values: [["far"]] }]);
    expect(cell(fake, "U", "ZZ", 1)).toBe("far");
    expect(await fake.getValues("T", "D1:F1", "UNFORMATTED_VALUE")).toEqual([]);
  });

  it("is widened by ensureColumnCount, which never narrows, and is recorded as a call", async () => {
    const fake = limited();
    await fake.ensureColumnCount("T", 6);
    expect(fake.gridColumns.get("T")).toBe(6);
    await fake.updateValues([{ tab: "T", a1: "D1:F1", values: [["d", "e", "f"]] }]);
    await fake.ensureColumnCount("T", 2);
    expect(fake.gridColumns.get("T")).toBe(6);
    await fake.ensureColumnCount("U", 40);
    expect(fake.gridColumns.has("U")).toBe(false);
    expect(fake.calls).toEqual(["ensureColumnCount", "updateValues", "ensureColumnCount", "ensureColumnCount"]);
  });

  it("refuses ensureColumnCount for a tab that is not there, and can be made to fail", async () => {
    const fake = limited();
    await expect(fake.ensureColumnCount("Nope", 5)).rejects.toThrow(/No tab named Nope/);
    fake.failOn.add("ensureColumnCount");
    await expect(fake.ensureColumnCount("T", 5)).rejects.toThrow(/ensureColumnCount failed/);
    expect(fake.gridColumns.get("T")).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { findHeader, headerKey } from "@/lib/sheets/headers";

describe("headerKey", () => {
  it("is empty for nothing at all", () => {
    expect(headerKey(undefined)).toBe("");
    expect(headerKey(null)).toBe("");
    expect(headerKey("")).toBe("");
    expect(headerKey("   ")).toBe("");
  });

  it("trims and lower-cases, as the old rule did", () => {
    expect(headerKey("  Tenant2 ")).toBe("tenant2");
    expect(headerKey("MONTH")).toBe("month");
    expect(headerKey("Total Rent")).toBe("total rent");
  });

  it("reads a number as its text", () => {
    expect(headerKey(2)).toBe("2");
    expect(headerKey(0)).toBe("0");
  });

  it("turns every run of whitespace into one space", () => {
    expect(headerKey("Count   2")).toBe("count 2");
    expect(headerKey("Count\t2")).toBe("count 2");
    expect(headerKey("Count\n2")).toBe("count 2");
    expect(headerKey(" Move-in \r\n  date ")).toBe("move-in date");
  });

  it("counts a no-break space as whitespace", () => {
    expect(headerKey("Count\u00a02")).toBe("count 2");
    expect(headerKey("Count\u00a0\u00a0 2")).toBe("count 2");
    expect(headerKey("\u00a0Month\u00a0")).toBe("month");
  });

  it("drops zero-width spaces, joiners and the byte order mark", () => {
    expect(headerKey("Ten\u200bant")).toBe("tenant");
    expect(headerKey("Ten\u200cant")).toBe("tenant");
    expect(headerKey("Ten\u200dant")).toBe("tenant");
    expect(headerKey("\ufeffMonth")).toBe("month");
    expect(headerKey("Count \u200b 2")).toBe("count 2");
  });

  it("applies NFKC, so full-width and ligature characters read as plain ones", () => {
    expect(headerKey("Ｔｅｎａｎｔ２")).toBe("tenant2");
    expect(headerKey("oﬃce")).toBe("office");
    expect(headerKey("Count\u30002")).toBe("count 2");
  });

  it("keeps words that differ by more than spacing apart", () => {
    expect(headerKey("Tenant 2")).not.toBe(headerKey("Tenant"));
    expect(headerKey("Tenant2")).not.toBe(headerKey("Tenant 2"));
  });
});

describe("findHeader", () => {
  it("finds one header, trimmed and in any case, as before", () => {
    expect(findHeader(["Month", " TENANT ", "Count"], "Tenant")).toEqual({ index: 1 });
  });

  it("says missing when nothing matches", () => {
    expect(findHeader(["Month", "Tenant"], "Count")).toEqual({ problem: "missing" });
    expect(findHeader([], "Count")).toEqual({ problem: "missing" });
  });

  it("says duplicate when the old rule finds two", () => {
    expect(findHeader(["Count", "x", " count "], "Count")).toEqual({ problem: "duplicate" });
  });

  it("falls back to the looser match only when the old rule finds nothing", () => {
    expect(findHeader(["Month", "Count\u00a02"], "Count 2")).toEqual({ index: 1 });
    expect(findHeader(["Month", "Count  2"], "Count 2")).toEqual({ index: 1 });
    expect(findHeader(["Month", "Ten\u200bant"], "Tenant")).toEqual({ index: 1 });
    expect(findHeader(["Month", "Count 2"], "Count  2")).toEqual({ index: 1 });
  });

  it("finds the exact one of Count 2 and Count  2 with no duplicate error", () => {
    const headers = ["Count 2", "Count  2"];
    expect(findHeader(headers, "Count 2")).toEqual({ index: 0 });
    expect(findHeader(headers, "Count  2")).toEqual({ index: 1 });
  });

  it("says duplicate when the old rule finds nothing and the looser one finds two", () => {
    expect(findHeader(["Count  2", "Count\u00a02"], "Count 2")).toEqual({ problem: "duplicate" });
  });

  it("never reports a duplicate the old rule did not see when it found exactly one", () => {
    expect(findHeader(["Count 2", "Count\u00a02", "count   2"], "Count 2")).toEqual({ index: 0 });
  });

  it("matches a header that matched before in the same column", () => {
    const headers = ["Month", "Tenant", "Count", "Amount", "Tenant2", "Count2", "Amount2", "Total Rent"];
    headers.forEach((name, index) => expect(findHeader(headers, name)).toEqual({ index }));
    headers.forEach((name, index) => expect(findHeader(headers, ` ${name.toUpperCase()} `)).toEqual({ index }));
  });

  it("reads a numeric header cell as text", () => {
    expect(findHeader(["Month", 2026], "2026")).toEqual({ index: 1 });
  });

  it("agrees with the old rule wherever the old rule found exactly one header, over many rows and names", () => {
    // The rule as it was before headerKey: trimmed, lower-cased, exactly one match or an error.
    const old = (headers: unknown[], name: string) => {
      const wanted = String(name ?? "").trim().toLowerCase();
      const matches = headers.flatMap((h, i) => (String(h ?? "").trim().toLowerCase() === wanted ? [i] : []));
      return matches.length === 1 ? matches[0] : null;
    };
    const words = ["Month", "Tenant", "Count", "Amount", "Tenant2", "Count 2", "Count  2", "Total Rent", "Notes", " tenant ", "COUNT", ""];
    const rows: unknown[][] = [
      ["Month", "Tenant", "Count", "Amount", "Tenant2", "Count2", "Amount2", "Total Rent"],
      ["Month", "Count 2", "Count  2", "Notes"],
      [" MONTH ", "tenant", " Count", "Amount ", "Count\u00a02", "Total  Rent"],
      ["Month", "Tenant", "tenant", "Count"],
      ["", "Month", undefined, "Notes", 2026],
    ];
    for (const row of rows) {
      for (const name of words) {
        const expected = old(row, name);
        if (expected !== null) expect(findHeader(row, name), `${JSON.stringify(row)} / ${name}`).toEqual({ index: expected });
      }
    }
  });
});

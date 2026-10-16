import { describe, expect, it } from "vitest";
import { serialFromYm } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { parseSchedule } from "@/lib/sheets/schedule";
import {
  baseSchedule,
  monthCell,
  PORTIONS,
  scheduleRow,
  TOTAL_HEADER,
} from "../support/fixtures";

describe("parseSchedule", () => {
  it("finds the header below a banner and maps every portion's columns", () => {
    const { layout } = parseSchedule(baseSchedule(), PORTIONS, TOTAL_HEADER);
    expect(layout.headerRow).toBe(3);
    expect(layout.monthCol).toBe(0);
    expect(layout.totalCol).toBe(16);
    expect(layout.portionCols.get("p1")).toEqual({ tenant: 1, count: 2, amount: 3 });
    expect(layout.portionCols.get("p5")).toEqual({ tenant: 13, count: 14, amount: 15 });
    expect(layout.lastDataRow).toBe(5);
    expect(layout.codec).toEqual({
      kind: "text",
      style: { longName: false, separator: "-", fourDigitYear: false },
    });
  });

  it("reads months and entries, with null for vacant portions", () => {
    const { rows } = parseSchedule(baseSchedule(), PORTIONS, TOTAL_HEADER);
    expect(rows).toHaveLength(2);
    expect(rows[1].rowNumber).toBe(5);
    expect(rows[1].month).toEqual({ year: 2026, month: 9 });
    expect(rows[1].entries.get("p1")).toEqual({ tenant: "Asha", count: 3, amount: 5450 });
    expect(rows[1].entries.get("p4")).toBeNull();
  });

  it("works when the Month column holds real dates", () => {
    const { layout, rows } = parseSchedule(baseSchedule("serial"), PORTIONS, TOTAL_HEADER);
    expect(layout.codec).toEqual({ kind: "serial" });
    expect(rows[0].month).toEqual({ year: 2026, month: 8 });
  });

  it("ignores a footer row under the table", () => {
    const values = baseSchedule();
    values.push(["Grand total", undefined, undefined, 123]);
    const { rows, layout } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
    expect(rows).toHaveLength(2);
    expect(layout.lastDataRow).toBe(5);
  });

  it("reports a missing header by name and never guesses", () => {
    const values = baseSchedule();
    (values[2] as string[])[4] = "Tenant two";
    expect(() => parseSchedule(values, PORTIONS, TOTAL_HEADER)).toThrow(
      /Header "Tenant2" was not found/,
    );
  });

  it("reports a missing total header", () => {
    expect(() => parseSchedule(baseSchedule(), PORTIONS, "Per Month")).toThrow(
      /Header "Per Month" was not found/,
    );
  });

  it("rejects a duplicated header", () => {
    const values = baseSchedule();
    (values[2] as string[])[7] = "Tenant";
    expect(() => parseSchedule(values, PORTIONS, TOTAL_HEADER)).toThrow(/more than once/);
  });

  it("fails clearly when there is no header or no month rows", () => {
    expect(() => parseSchedule([["nothing"]], PORTIONS, TOTAL_HEADER)).toThrow(AppError);
    const headerOnly = baseSchedule().slice(0, 3);
    expect(() => parseSchedule(headerOnly, PORTIONS, TOTAL_HEADER)).toThrow(/no month rows/);
  });

  it("reads every Month cell on its own: dates and text can be mixed", () => {
    const values = baseSchedule();
    (values[3] as unknown[])[0] = serialFromYm({ year: 2026, month: 8 });
    (values[4] as unknown[])[0] = "Sept-26";
    values.push(scheduleRow("October 2026", [null, null, null, null, null], 6));
    values.push(scheduleRow("2026-11", [null, null, null, null, null], 7));
    const { rows, layout } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
    expect(rows.map((row) => row.month)).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
    ]);
    expect(rows.map((row) => row.rowNumber)).toEqual([4, 5, 6, 7]);
    expect(rows[1].entries.get("p1")).toEqual({ tenant: "Asha", count: 3, amount: 5450 });
    expect(layout.lastDataRow).toBe(7);
    // The format used to write a new row comes from the bottom-most month cell only.
    expect(layout.codec).toEqual({ kind: "iso" });
  });

  it("reads a text row in a sheet whose bottom row is a date, and the other way round", () => {
    const dateBottom = baseSchedule();
    (dateBottom[4] as unknown[])[0] = serialFromYm({ year: 2026, month: 9 });
    const a = parseSchedule(dateBottom, PORTIONS, TOTAL_HEADER);
    expect(a.rows).toHaveLength(2);
    expect(a.layout.codec).toEqual({ kind: "serial" });

    const textBottom = baseSchedule("serial");
    (textBottom[4] as unknown[])[0] = "Sep-26";
    const b = parseSchedule(textBottom, PORTIONS, TOTAL_HEADER);
    expect(b.rows.map((row) => row.month)).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
    expect(b.layout.codec).toEqual({
      kind: "text",
      style: { longName: false, separator: "-", fourDigitYear: false },
    });
  });

  it("reads Sept-26 and other three-or-more-letter prefixes", () => {
    const values = baseSchedule();
    (values[3] as unknown[])[0] = "sept. 26";
    (values[4] as unknown[])[0] = "Sept-26";
    const { rows } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
    expect(rows.map((row) => row.month)).toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 9 },
    ]);
  });

  describe("a Month cell that cannot be read", () => {
    const expectStructure = (run: () => unknown) => {
      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("sheet-structure");
      return (thrown as AppError).message;
    };

    it("inside the table is an error that names the row and the cell text", () => {
      const values = baseSchedule();
      (values[3] as unknown[])[0] = "Agust-26";
      const message = expectStructure(() => parseSchedule(values, PORTIONS, TOTAL_HEADER));
      expect(message).toMatch(/Row 4\b/);
      expect(message).toContain('"Agust-26"');
    });

    it("is cut to 40 characters in the message", () => {
      const values = baseSchedule();
      const long = "x".repeat(25) + "y".repeat(25);
      (values[3] as unknown[])[0] = long;
      const message = expectStructure(() => parseSchedule(values, PORTIONS, TOTAL_HEADER));
      expect(message).toContain(long.slice(0, 40));
      expect(message).not.toContain(long.slice(0, 41));
    });

    describe("echoes only printable text", () => {
      const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202e]/;
      const messageFor = (cell: string) => {
        const values = baseSchedule();
        (values[3] as unknown[])[0] = cell;
        return expectStructure(() => parseSchedule(values, PORTIONS, TOTAL_HEADER));
      };

      it("turns a line break inside the cell into a space, and still names the row", () => {
        const message = messageFor("Agust\r\n-26");
        expect(message).toMatch(/Row 4\b/);
        expect(message).toContain('"Agust -26"');
        expect(message).toMatch(/cannot read/i);
        expect(message).not.toMatch(CONTROL);
      });

      it("drops other control characters, line and paragraph separators and text-direction overrides", () => {
        const message = messageFor("A\u0000B\u0007C\u001b[31mD\u2028E\u2029F\u0085G\u202eH\tI");
        expect(message).not.toMatch(CONTROL);
        expect(message).toContain('"A B C [31mD E F G H I"');
      });

      it("does not let control characters use up the 40 characters", () => {
        const message = messageFor("\n".repeat(30) + "x".repeat(50));
        expect(message).toContain(`"${"x".repeat(40)}..."`);
        expect(message).not.toContain("x".repeat(41));
      });
    });

    it("is ignored below the last month row, like a footer label", () => {
      const values = baseSchedule();
      values.push(["Total"], ["Grand total", undefined, undefined, 123], [5], ["garbled'cell"]);
      const { rows, layout } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
      expect(rows).toHaveLength(2);
      expect(layout.lastDataRow).toBe(5);
    });

    it("is an error for a stray number such as 5 in a sheet of dates, never a 1900-01 row", () => {
      const values = baseSchedule("serial");
      (values[3] as unknown[])[0] = 5;
      const message = expectStructure(() => parseSchedule(values, PORTIONS, TOTAL_HEADER));
      expect(message).toMatch(/Row 4\b/);
      expect(message).toContain('"5"');
    });

    it("is an error for a date in a sheet of text months (it used to be dropped silently)", () => {
      const values = baseSchedule();
      (values[3] as unknown[])[0] = 7;
      expectStructure(() => parseSchedule(values, PORTIONS, TOTAL_HEADER));
    });

    it("is ignored when it is a stray number below the last month row", () => {
      const values = baseSchedule("serial");
      values.push(scheduleRow(5, [null, null, null, null, null], 6));
      const { rows, layout } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
      expect(rows).toHaveLength(2);
      expect(layout.lastDataRow).toBe(5);
    });

    it.each([
      ["before 2000", serialFromYm({ year: 1999, month: 12 })],
      ["after 2100", serialFromYm({ year: 2101, month: 1 })],
    ])("treats a date serial %s as unreadable", (_label, serial) => {
      const inside = baseSchedule("serial");
      (inside[3] as unknown[])[0] = serial;
      expectStructure(() => parseSchedule(inside, PORTIONS, TOTAL_HEADER));

      const below = baseSchedule("serial");
      below.push(scheduleRow(serial, [null, null, null, null, null], 6));
      expect(parseSchedule(below, PORTIONS, TOTAL_HEADER).rows).toHaveLength(2);
    });

    it("never turns a blank Month cell, or one of only spaces, into an error", () => {
      const values = baseSchedule();
      values.splice(4, 0, [], ["   ", undefined, undefined, 10], [""]);
      const { rows } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
      expect(rows.map((row) => row.month)).toEqual([
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ]);
      expect(rows[1].rowNumber).toBe(8);
    });

    it("leaves the 'no month rows' message when nothing in the column can be read", () => {
      const values = baseSchedule().slice(0, 3);
      values.push(["Notes"], ["More notes"]);
      expect(expectStructure(() => parseSchedule(values, PORTIONS, TOTAL_HEADER))).toMatch(
        /no month rows/,
      );
    });
  });

  it("treats a row with a month but no numbers as vacant for every portion", () => {
    const values = baseSchedule();
    values.push(scheduleRow(monthCell("text", 2026, 10), [null, null, null, null, null], 6));
    const { rows } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
    expect(rows[2].month).toEqual({ year: 2026, month: 10 });
    expect([...rows[2].entries.values()].every((e) => e === null)).toBe(true);
  });
});

describe("parseSchedule: portion ids that are also property names", () => {
  // `__proto__` and `constructor` are valid ids. Keyed by a plain object they would reach into the
  // prototype; keyed by a Map they are just ids.
  const odd = [
    { ...PORTIONS[0], id: "__proto__" },
    { ...PORTIONS[1], id: "constructor" },
    ...PORTIONS.slice(2),
  ];

  it("keeps each portion's columns and entry under its own id", () => {
    const { layout, rows } = parseSchedule(baseSchedule(), odd, TOTAL_HEADER);
    expect(layout.portionCols.get("__proto__")).toEqual({ tenant: 1, count: 2, amount: 3 });
    expect(layout.portionCols.get("constructor")).toEqual({ tenant: 4, count: 5, amount: 6 });
    expect([...layout.portionCols.keys()]).toEqual(odd.map((p) => p.id));
    expect(rows[1].entries.get("__proto__")).toEqual({ tenant: "Asha", count: 3, amount: 5450 });
    expect(rows[1].entries.get("constructor")).toEqual({ tenant: "Bala", count: 11, amount: 12700 });
    expect([...rows[1].entries.keys()]).toEqual(odd.map((p) => p.id));
  });

  it("does not invent an entry for an id that is not a portion", () => {
    const { layout, rows } = parseSchedule(baseSchedule(), PORTIONS, TOTAL_HEADER);
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(layout.portionCols.get(name)).toBeUndefined();
      expect(rows[1].entries.get(name)).toBeUndefined();
    }
  });
});

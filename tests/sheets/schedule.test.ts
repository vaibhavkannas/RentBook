import { describe, expect, it } from "vitest";
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
    expect(layout.portionCols.p1).toEqual({ tenant: 1, count: 2, amount: 3 });
    expect(layout.portionCols.p5).toEqual({ tenant: 13, count: 14, amount: 15 });
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
    expect(rows[1].entries.p1).toEqual({ tenant: "Asha", count: 3, amount: 5450 });
    expect(rows[1].entries.p4).toBeNull();
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

  it("treats a row with a month but no numbers as vacant for every portion", () => {
    const values = baseSchedule();
    values.push(scheduleRow(monthCell("text", 2026, 10), [null, null, null, null, null], 6));
    const { rows } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
    expect(rows[2].month).toEqual({ year: 2026, month: 10 });
    expect(Object.values(rows[2].entries).every((e) => e === null)).toBe(true);
  });
});

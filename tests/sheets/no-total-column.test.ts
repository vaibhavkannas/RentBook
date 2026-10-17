import { describe, expect, it } from "vitest";
import { colLetter } from "@/lib/sheets/a1";
import type { CellWrite, ValueRender } from "@/lib/sheets/gateway";
import { getMonthView, logPayment, undoPayment, type SheetsContext } from "@/lib/sheets/service";
import { parseSchedule } from "@/lib/sheets/schedule";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS, TOTAL_HEADER } from "../support/fixtures";

const NOW = new Date("2026-10-05T04:30:00Z");
const SEP = { year: 2026, month: 9 };
const OCT = { year: 2026, month: 10 };
const OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "owner@example.com" };

/** A fake that remembers every write and every read, so a test can say which cells were asked for and which were touched. */
class WatchedGateway extends FakeGateway {
  writes: CellWrite[][] = [];
  reads: { tab: string; a1: string; render: ValueRender }[] = [];

  async updateValues(writes: CellWrite[]) {
    this.writes.push(writes);
    return super.updateValues(writes);
  }

  async getValues(tab: string, a1: string, render: ValueRender) {
    this.reads.push({ tab, a1, render });
    return super.getValues(tab, a1, render);
  }
}

type Grid = unknown[][];

/** The A1 address of every cell that holds something different in `after`, rows 1 to the longer grid, columns to the widest row. */
function changedCells(before: Grid, after: Grid): string[] {
  const changed: string[] = [];
  const rows = Math.max(before.length, after.length);
  for (let r = 0; r < rows; r++) {
    const width = Math.max(before[r]?.length ?? 0, after[r]?.length ?? 0);
    for (let c = 0; c < width; c++) {
      const was = before[r]?.[c] ?? "";
      const now = after[r]?.[c] ?? "";
      if (was !== now) changed.push(`${colLetter(c)}${r + 1}`);
    }
  }
  return changed;
}

const TOTAL_COL = 16;

/** The schedules a Sheet with no configured total can have: no total column at all, a formula column, or typed totals. */
const SHEETS: [string, () => Grid][] = [
  ["a Sheet with no total column", () => baseSchedule().map((row) => row.slice(0, TOTAL_COL))],
  ["a Sheet with a formula total column that the app is not told about", () => baseSchedule()],
  [
    "a Sheet with typed totals that the app is not told about",
    () => {
      const schedule = baseSchedule();
      schedule[3][TOTAL_COL] = 21150;
      schedule[4][TOTAL_COL] = 27350;
      return schedule;
    },
  ],
];

describe.each(SHEETS)("totalHeader null: %s", (_name, build) => {
  function setup() {
    const fake = new WatchedGateway({ Schedule: build() });
    const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: null };
    return { fake, ctx, before: () => fake.tabs.get("Schedule")!.map((row) => [...row]) };
  }
  const singleCellFormulaReads = (fake: WatchedGateway) =>
    fake.reads.filter((read) => read.render === "FORMULA" && /^[A-Z]+\d+$/.test(read.a1));

  it("reads the Sheet and has no total column in the layout", async () => {
    const { ctx } = setup();
    const view = await getMonthView(ctx, SEP);
    expect(view.cards).toHaveLength(5);
  });

  it("logs into an existing month by writing only the portion's three cells, and asks nothing about a total", async () => {
    const { fake, ctx, before } = setup();
    await getMonthView(ctx, SEP);
    const grid = before();
    fake.writes = [];
    fake.reads = [];

    await logPayment(ctx, { month: SEP, portionId: "p4", amount: 8800, dateReceived: "2026-09-20", newTenantName: "Dev" }, OPTIONS);

    expect(changedCells(grid, fake.tabs.get("Schedule")!)).toEqual(["K5", "L5", "M5"]);
    expect(fake.writes.filter((writes) => writes.some((w) => w.tab === "Schedule"))).toEqual([
      [
        { tab: "Schedule", a1: "K5", values: [["Dev"]] },
        { tab: "Schedule", a1: "L5", values: [[1]] },
        { tab: "Schedule", a1: "M5", values: [[8800]] },
      ],
    ]);
    expect(singleCellFormulaReads(fake)).toEqual([]);
    expect(fake.reads.some((read) => read.render === "FORMULA")).toBe(false);
  });

  it("undoes a payment by clearing only the portion's three cells, and asks nothing about a total", async () => {
    const { fake, ctx, before } = setup();
    await getMonthView(ctx, SEP);
    const grid = before();
    fake.writes = [];
    fake.reads = [];

    await undoPayment(ctx, { month: SEP, portionId: "p5", expected: { tenant: "Esha", count: 1, amount: 5100 } }, OPTIONS);

    expect(changedCells(grid, fake.tabs.get("Schedule")!)).toEqual(["N5", "O5", "P5"]);
    expect(fake.writes.filter((writes) => writes.some((w) => w.tab === "Schedule"))).toEqual([
      [
        { tab: "Schedule", a1: "N5", values: [[""]] },
        { tab: "Schedule", a1: "O5", values: [[""]] },
        { tab: "Schedule", a1: "P5", values: [[""]] },
      ],
    ]);
    expect(fake.reads.some((read) => read.render === "FORMULA")).toBe(false);
  });

  it("adds a new month by cloning the last row, then writes only the portion's three cells", async () => {
    const { fake, ctx, before } = setup();
    await getMonthView(ctx, SEP);
    const grid = before();
    fake.writes = [];
    fake.reads = [];

    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);

    expect(fake.calls).toContain("cloneRow");
    expect(fake.writes.filter((writes) => writes.some((w) => w.tab === "Schedule"))).toEqual([
      [
        { tab: "Schedule", a1: "B6", values: [["Asha"]] },
        { tab: "Schedule", a1: "C6", values: [[4]] },
        { tab: "Schedule", a1: "D6", values: [[5450]] },
      ],
    ]);
    // Row 5 is as it was, and the new row holds the month and this portion's cells (and a copied formula, if the Sheet has one).
    const after = fake.tabs.get("Schedule")!;
    expect(changedCells(grid, after).filter((a1) => !a1.endsWith("5"))).toEqual(
      ["A6", "B6", "C6", "D6", ...(after[5][TOTAL_COL] === undefined ? [] : ["Q6"])],
    );
    expect(changedCells(grid, after).some((a1) => a1.endsWith("5"))).toBe(false);
    expect(cell(fake, "Schedule", "A", 6)).toBe("Oct-26");
    expect(cell(fake, "Schedule", "E", 6)).toBeUndefined();
    expect(cell(fake, "Schedule", "G", 6)).toBeUndefined();
  });
});

describe("totalHeader null: what a total column holds is left to the Sheet", () => {
  it("leaves a formula total as the clone copied it and never writes a total in its place", async () => {
    const fake = new WatchedGateway({ Schedule: baseSchedule() });
    const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: null };
    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect(cell(fake, "Schedule", "Q", 6)).toBe("=D6+G6+J6+M6+P6");
  });

  it("blanks a typed total on the new month's row, as it blanks every typed value it copies", async () => {
    const schedule = baseSchedule();
    schedule[4][TOTAL_COL] = 27350;
    const fake = new WatchedGateway({ Schedule: schedule });
    const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: null };
    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect(cell(fake, "Schedule", "Q", 6)).toBeUndefined();
    expect(cell(fake, "Schedule", "Q", 5)).toBe(27350);
  });
});

describe("parseSchedule with no total header", () => {
  it("has no total column, and reads the same portions and months", () => {
    const withTotal = parseSchedule(baseSchedule(), PORTIONS, TOTAL_HEADER);
    const without = parseSchedule(baseSchedule(), PORTIONS, null);
    expect(without.layout.totalCol).toBeNull();
    expect({ ...without.layout, totalCol: withTotal.layout.totalCol }).toEqual(withTotal.layout);
    expect(without.rows).toEqual(withTotal.rows);
  });

  it("does not look for a total header, so a Sheet without one parses", () => {
    const noTotal = baseSchedule().map((row) => row.slice(0, TOTAL_COL));
    expect(parseSchedule(noTotal, PORTIONS, null).layout.totalCol).toBeNull();
    expect(() => parseSchedule(noTotal, PORTIONS, TOTAL_HEADER)).toThrow(/Header "Total Rent" was not found/);
  });

  it("still refuses a total header that is set but missing, and one that is a portion's column", () => {
    expect(() => parseSchedule(baseSchedule(), PORTIONS, "Per Month")).toThrow(/Header "Per Month" was not found/);
    expect(() => parseSchedule(baseSchedule(), PORTIONS, "Amount")).toThrow(/both use the column headed "Amount"/);
  });
});

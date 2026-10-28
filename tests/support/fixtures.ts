import type { Tenancy } from "@/lib/domain/tenancy";
import type { PortionConfig, ScheduleRow } from "@/lib/domain/types";
import { serialFromYm } from "@/lib/domain/year-month";
import { parseSchedule } from "@/lib/sheets/schedule";
import { SETTINGS_HEADERS } from "@/lib/sheets/settings-store";

export const TOTAL_HEADER = "Total Rent";

export const PORTIONS: PortionConfig[] = [
  ["p1", "First floor, single bedroom", ""],
  ["p2", "First floor, double bedroom", "2"],
  ["p3", "Second floor, single bedroom", "3"],
  ["p4", "Second floor, double bedroom", "4"],
  ["p5", "Third floor, hall and kitchen", "5"],
].map(([id, name, suffix]) => ({
  id,
  name,
  tenantHeader: `Tenant${suffix}`,
  countHeader: `Count${suffix}`,
  amountHeader: `Amount${suffix}`,
  cycleLength: 11,
  hikePercent: 5,
}));

/**
 * The owner's Settings tab as it is today: the seven headers A to G (H1 blank, no Active column) and one row per portion. The
 * tests that stand for the owner's Sheet use this one; a test that needs the Active header takes `seededSettingsGrid`.
 */
export function settingsGrid(): unknown[][] {
  return [
    SETTINGS_HEADERS.slice(0, 7),
    ...PORTIONS.map((p) => [
      p.id,
      p.name,
      p.tenantHeader,
      p.countHeader,
      p.amountHeader,
      p.cycleLength ?? "",
      p.hikePercent,
    ]),
  ];
}

/** A Settings tab as the app seeds it now: the eight headers (H1 reads Active) and one row per portion, every H cell blank. */
export function seededSettingsGrid(): unknown[][] {
  const grid = settingsGrid();
  grid[0] = [...SETTINGS_HEADERS];
  return grid;
}

export const SCHEDULE_HEADERS = [
  "Month",
  ...PORTIONS.flatMap((p) => [p.tenantHeader, p.countHeader, p.amountHeader]),
  TOTAL_HEADER,
];

export type Entry = [tenant: string, count: number, amount: number] | null;

/**
 * One data row. `entries` has one item per portion. The total column holds a
 * formula in the style of the owner's sheet, so copyRow can be checked.
 */
export function scheduleRow(
  month: string | number,
  entries: Entry[],
  rowNumber: number,
  total: "formula" | number = "formula",
): unknown[] {
  const cells: unknown[] = [month];
  for (const entry of entries) {
    cells.push(...(entry ?? []));
    if (!entry) cells.push(undefined, undefined, undefined);
  }
  cells.push(
    total === "formula"
      ? `=D${rowNumber}+G${rowNumber}+J${rowNumber}+M${rowNumber}+P${rowNumber}`
      : total,
  );
  return cells;
}

export type MonthStyle = "text" | "serial";

export function monthCell(style: MonthStyle, year: number, month: number): string | number {
  if (style === "serial") return serialFromYm({ year, month });
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[month - 1]}-${String(year % 100).padStart(2, "0")}`;
}

/**
 * A Schedule tab with a banner above the header (header on row 3) and two
 * months of history: Aug-26 and Sep-26.
 * After Sep-26: p1 is at count 3, p2 at 11 (cycle ends), p3 at 5, p4 has no
 * tenant ever, p5 started in Sep-26 (count 1).
 */
export function baseSchedule(style: MonthStyle = "text"): unknown[][] {
  return [
    ["Rent Receipts Schedule"],
    [],
    [...SCHEDULE_HEADERS],
    scheduleRow(
      monthCell(style, 2026, 8),
      [["Asha", 2, 5450], ["Bala", 10, 12700], ["Chitra", 4, 9000], null, null],
      4,
    ),
    scheduleRow(
      monthCell(style, 2026, 9),
      [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], null, ["Esha", 1, 5100]],
      5,
    ),
  ];
}

/**
 * The Settings grid with an Active column: H1 reads "Active" and `flags` gives the H cell of each portion by id (a
 * portion that is not named keeps a blank H cell, which means on).
 */
export function settingsGridWithActive(flags: Record<string, unknown> = {}): unknown[][] {
  const grid = seededSettingsGrid();
  PORTIONS.forEach((portion, index) => {
    if (portion.id in flags) grid[index + 1][7] = flags[portion.id];
  });
  return grid;
}

/**
 * `schedule` with the three columns of portion `id` deleted, as the owner would delete them in the Sheet, and
 * every total formula rewritten to add up the amounts that are left (Sheets would leave a #REF! in it).
 */
export function scheduleWithoutPortion(schedule: unknown[][], id: string): unknown[][] {
  const at = PORTIONS.findIndex((portion) => portion.id === id);
  const first = 1 + 3 * at;
  const letters = (col: number) => String.fromCharCode(65 + col);
  const amountCols = PORTIONS.filter((_, index) => index !== at).map((_, index) => 1 + 3 * index + 2);
  return schedule.map((row, index) => {
    const cells = row.length > first ? [...row.slice(0, first), ...row.slice(first + 3)] : [...row];
    return cells.map((cell) =>
      typeof cell === "string" && cell.startsWith("=") ? `=${amountCols.map((col) => `${letters(col)}${index + 1}`).join("+")}` : cell,
    );
  });
}

type MonthSpec = [year: number, month: number, entries?: Entry[]];

const monthRow = ([year, month, entries = []]: MonthSpec, rowNumber: number) =>
  scheduleRow(monthCell("text", year, month), PORTIONS.map((_, at) => entries[at] ?? null), rowNumber);

/**
 * Schedule rows as the app reads them, in the order given: each item is a month and the entries for p1 to p5 (a missing one is
 * blank). It uses the headers and the five portions above, with the "Month" text style ("Oct-26").
 */
export function parsedRows(...months: MonthSpec[]): ScheduleRow[] {
  const values = [["Rent Receipts Schedule"], [], [...SCHEDULE_HEADERS], ...months.map((spec, index) => monthRow(spec, index + 4))];
  return parseSchedule(values, PORTIONS, TOTAL_HEADER).rows;
}

/** The base Schedule (August and September 2026) read as rows, then the given months after it (see `parsedRows`). */
export function baseRows(...later: MonthSpec[]): ScheduleRow[] {
  const values = [...baseSchedule(), ...later.map((spec, index) => monthRow(spec, index + 6))];
  return parseSchedule(values, PORTIONS, TOTAL_HEADER).rows;
}

/** One Tenants row, current (no move-out) for Asha on p1 unless the overrides say otherwise. */
export function tenancyRow(overrides: Partial<Tenancy> = {}): Tenancy {
  return {
    rowNumber: 2,
    id: "t-1",
    portionId: "p1",
    tenant: "Asha",
    phone: "",
    moveIn: "2026-01-15",
    agreementEnd: "",
    advance: null,
    advanceDate: "",
    advanceStatus: null,
    refund: null,
    deductions: null,
    notes: "",
    moveOut: "",
    updatedBy: "owner@example.com",
    updatedAt: "2026-01-15T05:00:00.000Z",
    ...overrides,
  };
}

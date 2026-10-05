import type { PortionConfig } from "@/lib/domain/types";
import { serialFromYm } from "@/lib/domain/year-month";

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

export const SCHEDULE_HEADERS = [
  "Month",
  ...PORTIONS.flatMap((p) => [p.tenantHeader, p.countHeader, p.amountHeader]),
  TOTAL_HEADER,
];

type Entry = [tenant: string, count: number, amount: number] | null;

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

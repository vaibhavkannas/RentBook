import { deriveMonthView } from "./month-view";
import { cardShortfall, lastDueMonth } from "./rent-due";
import { sumAmounts } from "./rent-rules";
import type { PortionCard, RentSnapshot, ScheduleRow, YearMonth } from "./types";
import { monthOfDay } from "./vacancy";
import { compareYm } from "./year-month";

/**
 * How a portion did in one month of a year:
 * - `paid`: an entry for the month, and not short of the rent
 * - `partial`: an entry for the month, short of the rent (as in the overdue list)
 * - `unpaid`: no entry, and the month is overdue (on or before `lastDueMonth`)
 * - `upcoming`: no entry, and the month is not overdue yet
 * - `vacant`: nobody is let the portion (it moved out, or never had a tenant) in a month the Schedule covers
 * - `none`: before the Schedule's first month, or the portion has no card that month (switched off and vacant)
 */
export type YearCellState = "paid" | "partial" | "unpaid" | "upcoming" | "vacant" | "none";

/**
 * One month of one portion. `received` is the amount entered; `due` the rent for the month (the card's reference rent, or
 * the amount when a paid card has none), counted only for paid, partial and unpaid months; `shortBy` how much a partial month
 * is short, in whole rupees (0 otherwise).
 */
export type YearCell = { month: YearMonth; state: YearCellState; received: number; due: number; shortBy: number };

export type YearRow = { portionId: string; name: string; cells: YearCell[]; received: number; due: number };

export type YearView = {
  year: number;
  rows: YearRow[];
  received: number;
  due: number;
  /** The Schedule's first month (any year), or null when it has no month rows. */
  firstMonth: YearMonth | null;
  /** False when every cell is `none`: nothing to show for the year. */
  hasData: boolean;
};

/** The earliest month the Schedule has a row for, or null. */
function firstScheduleMonth(rows: ScheduleRow[]): YearMonth | null {
  let first: YearMonth | null = null;
  for (const row of rows) {
    if (!first || compareYm(row.month, first) < 0) first = row.month;
  }
  return first ? { ...first } : null;
}

const NO_MONEY = { received: 0, due: 0, shortBy: 0 };

/** The cell of a card (null: the portion has none that month) in a month, given the Schedule's first month and the last overdue month. */
function cellFor(
  card: PortionCard | undefined,
  month: YearMonth,
  first: YearMonth | null,
  last: YearMonth,
): YearCell {
  const cell = (state: YearCellState, money = NO_MONEY): YearCell => ({ month, state, ...money });
  if (!card || !first || compareYm(month, first) < 0) return cell("none");
  switch (card.status) {
    case "paid": {
      const received = card.entry?.amount ?? 0;
      // The month view's own rule for what is due: the reference rent, or the amount when the card has none.
      const due = card.rentReference ?? received;
      const shortBy = cardShortfall(card);
      return shortBy > 0 ? cell("partial", { received, due, shortBy }) : cell("paid", { received, due, shortBy: 0 });
    }
    case "pending":
      return compareYm(month, last) <= 0
        ? cell("unpaid", { received: 0, due: card.rentReference ?? 0, shortBy: 0 })
        : cell("upcoming");
    default:
      // vacant, and needs-tenant (a portion that has not had its first tenant yet) from the Schedule's first month on
      return cell("vacant");
  }
}

/**
 * Every portion's twelve months of `year`, from the same cards the month screen shows (twelve `deriveMonthView` calls), on the
 * India day `today`. Rows are in Settings order; a switched-off portion has a row only when it has a card in some month of the
 * year. Months before the Schedule's first month are `none`.
 */
export function deriveYearView(snapshot: RentSnapshot, year: number, today: string): YearView {
  const { rows, portions, tenancies } = snapshot;
  const last = lastDueMonth(today);
  const first = firstScheduleMonth(rows);

  const months: YearMonth[] = Array.from({ length: 12 }, (_, index) => ({ year, month: index + 1 }));
  const cards = months.map((month) => new Map(deriveMonthView(rows, portions, month, tenancies).cards.map((card) => [card.portionId, card])));

  const yearRows: YearRow[] = [];
  for (const portion of portions) {
    const own = cards.map((byId) => byId.get(portion.id));
    if (portion.inactive && own.every((card) => card === undefined)) continue;
    const cells = months.map((month, index) => cellFor(own[index], month, first, last));
    yearRows.push({
      portionId: portion.id,
      name: portion.name,
      cells,
      received: sumAmounts(cells.map((cell) => cell.received)),
      due: sumAmounts(cells.map((cell) => cell.due)),
    });
  }

  return {
    year,
    rows: yearRows,
    received: sumAmounts(yearRows.map((row) => row.received)),
    due: sumAmounts(yearRows.map((row) => row.due)),
    firstMonth: first,
    hasData: yearRows.some((row) => row.cells.some((cell) => cell.state !== "none")),
  };
}

/**
 * The years the year screen can show: from the Schedule's first year (this year when it has no month rows) to the later of its
 * last year and this year, where this year is the year of `today` (the India day).
 */
export function yearBounds(rows: ScheduleRow[], today: string): { first: number; last: number } {
  const thisYear = monthOfDay(today).year;
  if (rows.length === 0) return { first: thisYear, last: thisYear };
  let first = Infinity;
  let last = thisYear;
  for (const row of rows) {
    first = Math.min(first, row.month.year);
    last = Math.max(last, row.month.year);
  }
  return { first, last };
}

/**
 * The years the year screen's arrows lead to from `year`: the one before and the one after, or null where the Schedule has none
 * (the arrow is then dimmed). A year outside the bounds (typed into the address) leads back to the nearest year inside them
 * instead of one empty year at a time.
 */
export function yearNeighbours(year: number, bounds: { first: number; last: number }): { previous: number | null; next: number | null } {
  const previous = year > bounds.last ? bounds.last : year - 1;
  const next = year < bounds.first ? bounds.first : year + 1;
  return { previous: previous >= bounds.first ? previous : null, next: next <= bounds.last ? next : null };
}

const YEAR_PATTERN = /^\d{4}$/;

/** The year of an address's `year` parameter: four digits from 2000 to 2100, else null. The first value is used when there are several. */
export function parseYear(value: string | readonly string[] | null | undefined): number | null {
  const first = typeof value === "string" || value == null ? value : value[0];
  if (first == null || !YEAR_PATTERN.test(first)) return null;
  const year = Number(first);
  return year >= 2000 && year <= 2100 ? year : null;
}

import { findEntryForMonth } from "./month-view";
import { sameTenantName } from "./tenancy";
import type { PortionCard, ScheduleRow, YearMonth } from "./types";
import { monthOfDay } from "./vacancy";
import { addMonths, compareYm, daysBetween, ymKey } from "./year-month";

/**
 * The day of the month that rent falls due: the 1st. It is a day every month has (1 to 28), so a month's due date is
 * always a real day.
 */
export const RENT_DUE_DAY = 1;

/**
 * How many days after the due date a month's rent still counts as on time. Rent due on the 1st is overdue from the 6th:
 * the tenant has five days.
 */
export const OVERDUE_GRACE_DAYS = 5;

/**
 * How many rupees a payment may fall short of the rent before the month counts as short. 0: any shortfall counts, as the
 * month card's "less than rent" line does. (A new cycle's rent within the rounding allowance of the hike is already paid
 * in full on the card, so that is not a shortfall either.)
 */
export const SHORTFALL_TOLERANCE = 0;

/** The day (YYYY-MM-DD) a month's rent falls due. */
export function dueDate(month: YearMonth): string {
  return `${ymKey(month)}-${String(RENT_DUE_DAY).padStart(2, "0")}`;
}

/**
 * The latest month whose rent is overdue on `today` (YYYY-MM-DD, India time): this month from the day it becomes overdue
 * on, and last month before that. Throws a RangeError when `today` is not a real day.
 */
export function lastDueMonth(today: string): YearMonth {
  let month = monthOfDay(today);
  while (daysBetween(dueDate(month), today) < OVERDUE_GRACE_DAYS) month = addMonths(month, -1);
  return month;
}

/** Whole days from the month's due date to `today`, and 0 on or before the due date. */
export function daysOverdue(month: YearMonth, today: string): number {
  return Math.max(0, daysBetween(dueDate(month), today));
}

/**
 * What a paid card is short by, in whole rupees (as the card's "less than rent" line shows it), when it is more than
 * SHORTFALL_TOLERANCE short of its rent; 0 for a card that is not short and for every other status. A new tenant's first
 * payment has no rent to measure against, so it is never short, and a hiked rent paid within the rounding allowance is
 * already paid in full on the card.
 */
export function cardShortfall(card: Pick<PortionCard, "status" | "rentDifference">): number {
  if (card.status !== "paid" || card.rentDifference === null) return 0;
  if (!(card.rentDifference < -SHORTFALL_TOLERANCE)) return 0;
  // The card rounds the signed difference, so an exact half-rupee goes toward zero here as it does there.
  return Math.max(0, -Math.round(card.rentDifference));
}

/**
 * The tenant of the portion's latest Schedule entry (any month, months paid ahead included), and the first month of their
 * latest unbroken run of entries. Months with no entry do not break the run; an entry by another tenant does, so an
 * earlier tenant's months are history. A month typed twice reads as the lower row (`findEntryForMonth`); tenant names are
 * compared ignoring case and the spaces around them, and a blank tenant cell is a name of its own, as on the card. Null when
 * the portion has no entry.
 */
export function latestTenantStart(
  rows: ScheduleRow[],
  portionId: string,
): { tenant: string; start: YearMonth } | null {
  // The months the portion has an entry for, newest first.
  const byKey = new Map<number, YearMonth>();
  for (const row of rows) {
    if (row.entries.get(portionId)) byKey.set(row.month.year * 12 + row.month.month, row.month);
  }
  const months = [...byKey.values()].sort((a, b) => compareYm(b, a));
  if (months.length === 0) return null;

  const tenant = findEntryForMonth(rows, portionId, months[0])?.tenant ?? "";
  let start = months[0];
  for (const month of months) {
    const entry = findEntryForMonth(rows, portionId, month);
    if (!entry || !sameTenantName(entry.tenant, tenant)) break;
    start = month;
  }
  return { tenant, start };
}

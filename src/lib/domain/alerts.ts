import { startsNewCycle, suggestAmount } from "./rent-rules";
import { currentTenancy, sameTenantName } from "./tenancy";
import type { RentSnapshot, YearMonth } from "./types";
import { latestEntryRow, monthOfDay, occupancyFor } from "./vacancy";
import { addMonths, compareYm, daysBetween, isValidIsoDay } from "./year-month";

/** How many days before an agreement's end the owner is told it is coming: an agreement that ends within 60 days is "soon". */
export const AGREEMENT_NOTICE_DAYS = 60;

/**
 * How many months ahead of a rent hike the owner is told it is coming. A hike comes with the first payment of a new cycle: it
 * is "soon" when that payment is for this month or either of the next two, and "due" from the month it is for.
 */
export const HIKE_NOTICE_MONTHS = 2;

/**
 * The month of the first payment of the next cycle, the one that carries the hike, worked out from the latest entry (month and
 * payment count) at one payment a month, and how many payments come before it. A count at or past the cycle means the very
 * next payment starts the cycle. Counts the way the card does for a count that is not a whole number. Null when the count never
 * resets (`cycleLength` null) or the count is not a number.
 */
export function hikeMonthFor(
  latestMonth: YearMonth,
  latestCount: number,
  cycleLength: number | null,
): { hikeMonth: YearMonth; paymentsLeft: number } | null {
  if (cycleLength === null || !Number.isFinite(latestCount)) return null;
  const paymentsLeft = startsNewCycle(latestCount, cycleLength) ? 0 : Math.ceil(cycleLength - latestCount);
  return { hikeMonth: addMonths(latestMonth, paymentsLeft + 1), paymentsLeft };
}

export type AgreementAlert = {
  portionId: string;
  name: string;
  tenant: string;
  /** The Agreement end, YYYY-MM-DD. */
  agreementEnd: string;
  /** Days from today to the end: below 0 it ended that many days ago, 0 is today. */
  days: number;
  state: "ended" | "today" | "soon";
};

/**
 * Agreements that have ended or end within AGREEMENT_NOTICE_DAYS of `today` (YYYY-MM-DD, India time). A portion's current
 * tenancy counts (no move-out) when its tenant is the one the Schedule's latest entry names, as on the tenant page, and its
 * Agreement end is a real day. An ended agreement stays listed until its date is changed or the tenant moves out. Ended first,
 * the longest ago first, then the soonest, then Settings order.
 */
export function agreementAlerts(snapshot: RentSnapshot, today: string): AgreementAlert[] {
  const { rows, portions, tenancies } = snapshot;
  const alerts: AgreementAlert[] = [];
  for (const portion of portions) {
    const current = currentTenancy(tenancies, portion.id);
    const scheduleTenant = latestEntryRow(rows, portion.id)?.entry.tenant;
    if (!current || !scheduleTenant || !sameTenantName(current.tenant, scheduleTenant)) continue;
    const agreementEnd = current.agreementEnd.trim();
    if (!isValidIsoDay(agreementEnd)) continue;
    const days = daysBetween(today, agreementEnd);
    if (days > AGREEMENT_NOTICE_DAYS) continue;
    alerts.push({
      portionId: portion.id,
      name: portion.name,
      tenant: current.tenant.trim(),
      agreementEnd,
      days,
      state: days < 0 ? "ended" : days === 0 ? "today" : "soon",
    });
  }
  // `alerts` is in Settings order and the sort is stable.
  return alerts.sort((a, b) => a.days - b.days);
}

export type HikeAlert = {
  portionId: string;
  name: string;
  /** The tenant of the latest entry, as the Schedule names them. */
  tenant: string;
  /** The month of the payment that carries the hike. */
  hikeMonth: YearMonth;
  /** Payments (one a month) between the latest entry and that one. */
  paymentsLeft: number;
  currentRent: number;
  newRent: number;
  hikePercent: number;
  /** `due`: that month is this month or has passed. `soon`: it is within HIKE_NOTICE_MONTHS. */
  state: "due" | "soon";
};

/**
 * Rent hikes that are due or within HIKE_NOTICE_MONTHS of `today` (YYYY-MM-DD, India time). The Sheet has no hike date: the
 * hike comes with the first payment of a new cycle, so it is worked out from the portion's latest entry (`hikeMonthFor`) and the
 * new rent is the one the card will suggest. No alert for a portion whose count never resets, whose hike changes nothing (0 %),
 * that is vacant this month or in the hike month, or that is switched off. Earliest hike first, then Settings order.
 */
export function hikeAlerts(snapshot: RentSnapshot, today: string): HikeAlert[] {
  const { rows, portions, tenancies } = snapshot;
  const thisMonth = monthOfDay(today);
  const horizon = addMonths(thisMonth, HIKE_NOTICE_MONTHS);
  const alerts: HikeAlert[] = [];
  for (const portion of portions) {
    if (portion.inactive) continue;
    const latest = latestEntryRow(rows, portion.id);
    if (!latest) continue;
    const hike = hikeMonthFor(latest.month, latest.entry.count, portion.cycleLength);
    if (!hike || compareYm(hike.hikeMonth, horizon) > 0) continue;
    if (occupancyFor(rows, tenancies, portion.id, thisMonth).state === "vacant") continue;
    // A move-out recorded for a later day can leave the hike month vacant while the portion is still let today.
    if (compareYm(hike.hikeMonth, thisMonth) > 0 && occupancyFor(rows, tenancies, portion.id, hike.hikeMonth).state === "vacant") continue;
    const currentRent = latest.entry.amount;
    const newRent = suggestAmount(currentRent, portion.hikePercent, true);
    if (!(newRent > currentRent)) continue;
    alerts.push({
      portionId: portion.id,
      name: portion.name,
      tenant: latest.entry.tenant,
      hikeMonth: hike.hikeMonth,
      paymentsLeft: hike.paymentsLeft,
      currentRent,
      newRent,
      hikePercent: portion.hikePercent,
      state: compareYm(hike.hikeMonth, thisMonth) <= 0 ? "due" : "soon",
    });
  }
  return alerts.sort((a, b) => compareYm(a.hikeMonth, b.hikeMonth));
}

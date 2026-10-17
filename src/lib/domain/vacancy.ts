import { currentTenancy, pastTenancies, sameTenantName, type Tenancy } from "./tenancy";
import type { PortionEntry, ScheduleRow, Vacancy, YearMonth } from "./types";
import { addMonths, compareYm, isValidIsoDay, ymKey } from "./year-month";

/**
 * Whether a portion has a tenant in a month, from the Schedule and the Tenants tab. The Schedule is what the owner
 * keeps; a move-out date in the Tenants tab only says when the tenant left, so a portion is vacant only when the Schedule
 * has stopped naming a tenant for it AND the Tenants tab says the last one moved out.
 *
 * - `occupied`: the month has an entry, or the portion is let as far as the Sheet says (the month is due).
 * - `never`: no entry in any earlier month. The portion has never had a tenant (a card "needs a tenant").
 * - `vacant`: the last tenant moved out `since` that day, on or before the 1st of the month.
 */
export type Occupancy =
  | { state: "occupied" }
  | { state: "never" }
  | { state: "vacant"; since: string; previousTenant: string };

/** The portion's latest entry, with the month it is in, optionally only from months strictly before `before`. A month's lower row wins. */
export function latestEntryRow(
  rows: ScheduleRow[],
  portionId: string,
  before?: YearMonth,
): { month: YearMonth; entry: PortionEntry } | null {
  let best: ScheduleRow | null = null;
  for (const row of rows) {
    if ((before && compareYm(row.month, before) >= 0) || !row.entries.get(portionId)) continue;
    if (
      !best ||
      compareYm(row.month, best.month) > 0 ||
      (compareYm(row.month, best.month) === 0 && row.rowNumber > best.rowNumber)
    ) {
      best = row;
    }
  }
  const entry = best?.entries.get(portionId);
  return best && entry ? { month: best.month, entry } : null;
}

/** The month a YYYY-MM-DD day is in. */
const monthOfDay = (day: string): YearMonth => {
  const [year, month] = day.split("-").map(Number);
  return { year, month };
};

/**
 * The first month a move-out leaves vacant: the month of the day when it is the 1st (the tenant did not live there
 * that month), and the month after otherwise (the tenant lived there after the 1st, so that month is still due).
 */
export function firstVacantMonth(moveOut: string): YearMonth {
  const month = monthOfDay(moveOut);
  return moveOut.endsWith("-01") ? month : addMonths(month, 1);
}

/**
 * The tenant the Schedule last named for the portion, and the day they moved out, when the Tenants tab says they did and
 * nothing since says they stayed. Null when there is no such tenant:
 * - no entry (before `before`, when given),
 * - the portion has a current tenancy (no move-out),
 * - no past tenancy of the portion for that tenant name has a move-out that is a real day ("soon" says nothing), or
 * - rent was logged in a month after the one the tenant moved out in: the Sheet says they stayed.
 */
function leaver(
  rows: ScheduleRow[],
  tenancies: Tenancy[],
  portionId: string,
  before?: YearMonth,
): { tenant: string; moveOut: string } | null {
  const last = latestEntryRow(rows, portionId, before);
  if (!last) return null;
  if (currentTenancy(tenancies, portionId)) return null;
  const left = pastTenancies(tenancies, portionId).find(
    (t) => isValidIsoDay(t.moveOut) && sameTenantName(t.tenant, last.entry.tenant),
  );
  if (!left) return null;
  if (compareYm(last.month, monthOfDay(left.moveOut)) > 0) return null;
  return { tenant: last.entry.tenant, moveOut: left.moveOut };
}

/** Whether the portion has a tenant in `month`. See `Occupancy`. */
export function occupancyFor(
  rows: ScheduleRow[],
  tenancies: Tenancy[],
  portionId: string,
  month: YearMonth,
): Occupancy {
  if (rows.some((row) => compareYm(row.month, month) === 0 && row.entries.get(portionId))) {
    return { state: "occupied" };
  }
  if (!latestEntryRow(rows, portionId, month)) return { state: "never" };
  const gone = leaver(rows, tenancies, portionId, month);
  // Days are written YYYY-MM-DD, so they compare as text. Moving out on the 1st makes that month vacant.
  if (!gone || gone.moveOut > `${ymKey(month)}-01`) return { state: "occupied" };
  return { state: "vacant", since: gone.moveOut, previousTenant: gone.tenant };
}

/**
 * The portion's latest vacancy, whatever month it is looked at in: since when and who moved out. Null when the portion is
 * not vacant (never had a tenant, has a current tenancy, or rent was logged after the move-out). The tenant page uses it.
 */
export function vacancyOf(rows: ScheduleRow[], tenancies: Tenancy[], portionId: string): Vacancy | null {
  const gone = leaver(rows, tenancies, portionId);
  return gone ? { since: gone.moveOut, previousTenant: gone.tenant } : null;
}

/**
 * The latest month in which the portion has an entry for this tenant (their name, ignoring capitals and spaces around it):
 * the last month their rent was logged. Null when the Schedule never names them for the portion.
 */
export function lastRentMonth(rows: ScheduleRow[], portionId: string, tenant: string): YearMonth | null {
  let best: YearMonth | null = null;
  for (const row of rows) {
    const entry = row.entries.get(portionId);
    if (entry && sameTenantName(entry.tenant, tenant) && (!best || compareYm(row.month, best) > 0)) best = row.month;
  }
  return best;
}

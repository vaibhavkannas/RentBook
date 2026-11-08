import { nextCount, startsNewCycle, suggestAmount, sumAmounts } from "./rent-rules";
import { currentTenancy, sameTenantName, summarize, type Tenancy } from "./tenancy";
import type {
  MonthView,
  NextPayment,
  PortionCard,
  PortionConfig,
  PortionEntry,
  ScheduleRow,
  YearMonth,
} from "./types";
import { latestEntryRow, occupancyFor } from "./vacancy";
import { compareYm } from "./year-month";

/** The entry saved for this month, if any. If a month appears twice, the lower row wins. */
export function findEntryForMonth(
  rows: ScheduleRow[],
  portionId: string,
  month: YearMonth,
): PortionEntry | null {
  const matches = rows.filter(
    (row) => compareYm(row.month, month) === 0 && row.entries.get(portionId),
  );
  return matches.length > 0 ? (matches[matches.length - 1].entries.get(portionId) ?? null) : null;
}

/** The portion's latest entry, optionally only from months strictly before `before`. A month's lower row wins. */
function latestEntry(
  rows: ScheduleRow[],
  portionId: string,
  before?: YearMonth,
): PortionEntry | null {
  return latestEntryRow(rows, portionId, before)?.entry ?? null;
}

/** The most recent entry from a month strictly before `month`. */
export function findPriorEntry(
  rows: ScheduleRow[],
  portionId: string,
  month: YearMonth,
): PortionEntry | null {
  return latestEntry(rows, portionId, month);
}

/** The portion's most recent entry in any month. */
export function findLatestEntry(rows: ScheduleRow[], portionId: string): PortionEntry | null {
  return latestEntry(rows, portionId);
}

export const LATER_ENTRY_REASON =
  "Later months have entries for this portion. Undo those first.";

/** True when a month after `month` has an entry for the portion. */
export function hasLaterEntry(
  rows: ScheduleRow[],
  portionId: string,
  month: YearMonth,
): boolean {
  return rows.some((row) => compareYm(row.month, month) > 0 && row.entries.get(portionId));
}

/** The portion's entries from months strictly before `before`, newest month first, one per month (a month's lower row wins). */
function entriesBefore(
  rows: ScheduleRow[],
  portionId: string,
  before: YearMonth,
): Array<{ month: YearMonth; entry: PortionEntry }> {
  const byMonth = new Map<number, { month: YearMonth; entry: PortionEntry; rowNumber: number }>();
  for (const row of rows) {
    const entry = row.entries.get(portionId);
    if (!entry || compareYm(row.month, before) >= 0) continue;
    const key = row.month.year * 12 + row.month.month;
    const seen = byMonth.get(key);
    if (!seen || row.rowNumber > seen.rowNumber) byMonth.set(key, { month: row.month, entry, rowNumber: row.rowNumber });
  }
  return [...byMonth.values()].sort((a, b) => compareYm(b.month, a.month));
}

/**
 * The portion's latest entry before `before` (its latest entry of all when no month is given), with the entry that is the first
 * payment of the cycle it is in: the cycle's true rent. An amount agreed for one month, or a rent that was rounded, is only the
 * rent of its own month; the first payment of a cycle is the rent of the whole cycle, so what is suggested next is worked from it.
 *
 * The cycle's first payment is found by walking back from the latest entry through the portion's earlier entries (a month's lower
 * row wins, months with no entry do not matter) while they are the same tenant's, up to and including the entry whose count is 1.
 * The walk also stops at the earliest entry of the tenant's run (a Schedule that starts in the middle of a cycle, or a change of
 * tenant) and at the end of an earlier cycle: an entry whose count reached the cycle length ended it, so the entry after it began
 * a cycle even if its count was typed by hand to something other than 1, as the next-payment rule reads it.
 *
 * A portion whose count never resets has no hike cycle and so no first payment after a hike to trust: its anchor is the latest
 * entry itself, and the suggestion follows the last payment, as it always did.
 */
export function findPriorWithAnchor(
  rows: ScheduleRow[],
  portion: Pick<PortionConfig, "id" | "cycleLength">,
  before?: YearMonth,
): { month: YearMonth; entry: PortionEntry; anchor: PortionEntry } | null {
  const latest = latestEntryRow(rows, portion.id, before);
  if (!latest) return null;
  const { month, entry } = latest;
  if (portion.cycleLength === null || entry.count === 1) return { month, entry, anchor: entry };

  let anchor = entry;
  for (const earlier of entriesBefore(rows, portion.id, month)) {
    if (anchor.count === 1) break;
    if (!sameTenantName(earlier.entry.tenant, entry.tenant) || startsNewCycle(earlier.entry.count, portion.cycleLength)) break;
    anchor = earlier.entry;
  }
  return { month, entry, anchor };
}

/**
 * The payment after `prior`. `baseAmount` is the rent the suggestion is worked from: the portion's true rent, the cycle's first
 * payment (see `findPriorWithAnchor`). It is `prior`'s own amount when not given.
 */
export function nextPayment(
  prior: PortionEntry,
  portion: PortionConfig,
  baseAmount: number = prior.amount,
): NextPayment {
  const newCycle = startsNewCycle(prior.count, portion.cycleLength);
  return {
    tenant: prior.tenant,
    count: nextCount(prior.count, portion.cycleLength),
    previousAmount: baseAmount,
    startsNewCycle: newCycle,
    suggestedAmount: suggestAmount(baseAmount, portion.hikePercent, newCycle),
  };
}

/**
 * The rent a month is measured against. None when there is no earlier entry, and none for a paid card whose tenant is not the
 * earlier entry's tenant: a new tenant's first payment has no previous rent to compare with.
 *
 * The first payment of a new cycle (the earlier entry ended the cycle) is the rent of the cycle, whatever it is: a hike the owner
 * rounded, or a rent agreed some other way, so it is its own reference and never shows as more or less. Any other month is
 * measured against the suggested amount, which is the true rent of its cycle (the cycle's first payment), so an amount agreed for
 * one month still shows as more or less than rent, and moves nothing after it.
 */
function rentReference(entry: PortionEntry | null, next: NextPayment | null): number | null {
  if (!next) return null;
  if (entry && !sameTenantName(entry.tenant, next.tenant)) return null;
  if (entry && next.startsNewCycle) return entry.amount;
  return next.suggestedAmount;
}

export function deriveMonthView(
  rows: ScheduleRow[],
  portions: PortionConfig[],
  month: YearMonth,
  tenancies: Tenancy[] = [],
): MonthView {
  // A switched-off portion is on the screen in a month it has an entry for (its history) and in any month it is still let in, by
  // the vacancy rule (its tenant has not moved out), so switching it off, or switching it off by hand, can never hide rent that
  // is owed. From the month it is vacant, or if it never had a tenant, it has no card and adds nothing to what is due.
  const shown = portions.filter(
    (portion) => !portion.inactive || occupancyFor(rows, tenancies, portion.id, month).state === "occupied",
  );
  const cards: PortionCard[] = shown.map((portion) => {
    const entry = findEntryForMonth(rows, portion.id, month);
    // A portion whose last tenant has moved out has nothing due: no rent suggested, nothing to log or undo.
    const occupancy = entry ? null : occupancyFor(rows, tenancies, portion.id, month);
    if (occupancy?.state === "vacant") {
      return {
        portionId: portion.id,
        name: portion.name,
        cycleLength: portion.cycleLength,
        status: "vacant",
        entry: null,
        next: null,
        rentReference: null,
        rentDifference: null,
        undoBlockedReason: null,
        tenancy: null,
        vacancy: { since: occupancy.since, previousTenant: occupancy.previousTenant },
      };
    }
    const found = findPriorWithAnchor(rows, portion, month);
    const next = found ? nextPayment(found.entry, portion, found.anchor.amount) : null;
    const reference = rentReference(entry, next);
    // Details are shown only for the tenant the card shows, so they never outlive a change of tenant.
    const name = entry?.tenant ?? next?.tenant;
    const current = currentTenancy(tenancies, portion.id);
    return {
      portionId: portion.id,
      name: portion.name,
      cycleLength: portion.cycleLength,
      status: entry ? "paid" : next ? "pending" : "needs-tenant",
      entry,
      next,
      rentReference: reference,
      rentDifference: entry && reference !== null ? entry.amount - reference : null,
      undoBlockedReason:
        entry && hasLaterEntry(rows, portion.id, month) ? LATER_ENTRY_REASON : null,
      tenancy:
        current && name !== undefined && sameTenantName(current.tenant, name)
          ? summarize(current)
          : null,
      vacancy: null,
      // Only on the card of a switched-off portion (which is let in this month, so it is never vacant above).
      ...(portion.inactive ? { inactive: true } : {}),
    };
  });

  return {
    month,
    cards,
    received: sumAmounts(cards.map((card) => card.entry?.amount)),
    due: sumAmounts(cards.map((card) => card.rentReference ?? card.entry?.amount)),
    difference: sumAmounts(cards.map((card) => card.rentDifference)),
    paidCount: cards.filter((card) => card.status === "paid").length,
  };
}

import { isHikeRounding, nextCount, startsNewCycle, suggestAmount, sumAmounts } from "./rent-rules";
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

export function nextPayment(
  prior: PortionEntry,
  portion: PortionConfig,
): NextPayment {
  const newCycle = startsNewCycle(prior.count, portion.cycleLength);
  return {
    tenant: prior.tenant,
    count: nextCount(prior.count, portion.cycleLength),
    previousAmount: prior.amount,
    startsNewCycle: newCycle,
    suggestedAmount: suggestAmount(prior.amount, portion.hikePercent, newCycle),
  };
}

/**
 * The rent a month is measured against: the suggested amount for the payment after the earlier
 * entry. None when there is no earlier entry, and none for a paid card whose tenant is not the
 * earlier entry's tenant: a new tenant's first payment has no previous rent to compare with.
 *
 * On a new cycle, an amount within the rounding allowance of the suggested hike is the owner's
 * rounded rent: it becomes the reference itself, so it never shows as extra or short.
 */
function rentReference(entry: PortionEntry | null, next: NextPayment | null): number | null {
  if (!next) return null;
  if (entry && !sameTenantName(entry.tenant, next.tenant)) return null;
  if (entry && next.startsNewCycle && isHikeRounding(entry.amount, next.suggestedAmount)) {
    return entry.amount;
  }
  return next.suggestedAmount;
}

export function deriveMonthView(
  rows: ScheduleRow[],
  portions: PortionConfig[],
  month: YearMonth,
  tenancies: Tenancy[] = [],
): MonthView {
  // A switched-off portion is on the screen only in a month it has an entry for (its history, not its rent): in any other month
  // it has no card, so it adds nothing to what is due.
  const shown = portions.filter((portion) => !portion.inactive || findEntryForMonth(rows, portion.id, month));
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
    const prior = findPriorEntry(rows, portion.id, month);
    const next = prior ? nextPayment(prior, portion) : null;
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
      // Only on the card of a switched-off portion (which has an entry in this month, so it is never vacant above).
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

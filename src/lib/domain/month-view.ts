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
import { compareYm } from "./year-month";

/** The entry saved for this month, if any. If a month appears twice, the lower row wins. */
export function findEntryForMonth(
  rows: ScheduleRow[],
  portionId: string,
  month: YearMonth,
): PortionEntry | null {
  const matches = rows.filter(
    (row) => compareYm(row.month, month) === 0 && row.entries[portionId],
  );
  return matches.length > 0 ? matches[matches.length - 1].entries[portionId] : null;
}

/** The portion's latest entry, optionally only from months strictly before `before`. A month's lower row wins. */
function latestEntry(
  rows: ScheduleRow[],
  portionId: string,
  before?: YearMonth,
): PortionEntry | null {
  let best: ScheduleRow | null = null;
  for (const row of rows) {
    if ((before && compareYm(row.month, before) >= 0) || !row.entries[portionId]) continue;
    if (
      !best ||
      compareYm(row.month, best.month) > 0 ||
      (compareYm(row.month, best.month) === 0 && row.rowNumber > best.rowNumber)
    ) {
      best = row;
    }
  }
  return best ? best.entries[portionId] : null;
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
  return rows.some((row) => compareYm(row.month, month) > 0 && row.entries[portionId]);
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

export function deriveMonthView(
  rows: ScheduleRow[],
  portions: PortionConfig[],
  month: YearMonth,
  tenancies: Tenancy[] = [],
): MonthView {
  const cards: PortionCard[] = portions.map((portion) => {
    const entry = findEntryForMonth(rows, portion.id, month);
    const prior = findPriorEntry(rows, portion.id, month);
    const next = prior ? nextPayment(prior, portion) : null;
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
      undoBlockedReason:
        entry && hasLaterEntry(rows, portion.id, month) ? LATER_ENTRY_REASON : null,
      tenancy:
        current && name !== undefined && sameTenantName(current.tenant, name)
          ? summarize(current)
          : null,
    };
  });

  return {
    month,
    cards,
    received: sumAmounts(cards.map((card) => card.entry?.amount)),
    expected: sumAmounts(
      cards.map((card) => card.entry?.amount ?? card.next?.suggestedAmount),
    ),
    paidCount: cards.filter((card) => card.status === "paid").length,
  };
}

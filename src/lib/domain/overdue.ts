import { deriveMonthView } from "./month-view";
import { daysOverdue, dueDate, lastDueMonth, latestTenantStart } from "./rent-due";
import { sumAmounts } from "./rent-rules";
import type { PortionCard, RentSnapshot, YearMonth } from "./types";
import { addMonths, compareYm } from "./year-month";

/**
 * One month a portion's tenant owes rent for: a month with no payment recorded. `owed` is the rent its card suggests for the
 * month, in whole rupees; `dueDate` is YYYY-MM-DD.
 */
export type OverdueMonth = {
  month: YearMonth;
  owed: number;
  dueDate: string;
  daysOverdue: number;
};

/** A portion's current tenant and the months they owe: oldest first. `daysOverdue` is the oldest month's. */
export type OverdueItem = {
  portionId: string;
  name: string;
  tenant: string;
  months: OverdueMonth[];
  owed: number;
  oldest: YearMonth;
  daysOverdue: number;
};

/**
 * What a month card says is owed for its month, or null when nothing is. Only a card with no payment (pending) owes: its
 * suggested rent. A card with any payment recorded is paid, whatever the amount (the owner and the tenant may have agreed one
 * for the month), so it owes nothing, and neither does a vacant or needs-tenant card, or a month whose rent is nothing. Every
 * figure is the card's own, in whole rupees.
 */
function monthOwed(card: PortionCard, month: YearMonth, today: string): OverdueMonth | null {
  if (card.status !== "pending" || card.rentReference === null) return null;
  const owed = Math.round(card.rentReference);
  return owed > 0 ? { month, owed, dueDate: dueDate(month), daysOverdue: daysOverdue(month, today) } : null;
}

/**
 * Who owes rent on `today` (YYYY-MM-DD, India time), and for which months. Per portion only the tenant of its latest Schedule
 * entry is looked at, from the first month of their latest unbroken run of entries to the last month that is overdue
 * (`lastDueMonth`), each month judged by the portion's card from `deriveMonthView`: a month is overdue only when it has no
 * payment entry, and it owes the rent the card suggests. A month with any payment recorded, however much more or less than the
 * rent, is never overdue. Vacant, needs-tenant and switched-off months have no due card and are skipped; a month paid ahead is
 * after the last due month and never counts, nor does it make up an earlier month. Most owed first; equal amounts, the oldest
 * month first; then Settings order. Portions that owe nothing are left out.
 */
export function overdueList(snapshot: RentSnapshot, today: string): OverdueItem[] {
  const { rows, portions, tenancies } = snapshot;
  const last = lastDueMonth(today);

  const runs = new Map<string, { tenant: string; start: YearMonth }>();
  let earliest: YearMonth | null = null;
  for (const portion of portions) {
    const run = latestTenantStart(rows, portion.id);
    if (!run) continue;
    runs.set(portion.id, run);
    if (!earliest || compareYm(run.start, earliest) < 0) earliest = run.start;
  }
  if (!earliest) return [];

  // One month view per month for every portion, not one per portion and month.
  const owedBy = new Map<string, OverdueMonth[]>();
  for (let month = earliest; compareYm(month, last) <= 0; month = addMonths(month, 1)) {
    for (const card of deriveMonthView(rows, portions, month, tenancies).cards) {
      const run = runs.get(card.portionId);
      if (!run || compareYm(month, run.start) < 0) continue;
      const owed = monthOwed(card, month, today);
      if (!owed) continue;
      const list = owedBy.get(card.portionId);
      if (list) list.push(owed);
      else owedBy.set(card.portionId, [owed]);
    }
  }

  const items: OverdueItem[] = [];
  for (const portion of portions) {
    const months = owedBy.get(portion.id);
    const run = runs.get(portion.id);
    if (!months || !run) continue;
    items.push({
      portionId: portion.id,
      name: portion.name,
      tenant: run.tenant,
      months,
      owed: sumAmounts(months.map((m) => m.owed)),
      oldest: months[0].month,
      daysOverdue: months[0].daysOverdue,
    });
  }
  // `items` is in Settings order and the sort is stable, so equal amounts of the same age stay in that order.
  return items.sort((a, b) => b.owed - a.owed || compareYm(a.oldest, b.oldest));
}

/** How many portions owe, and how much between them. */
export function overdueTotals(items: ReadonlyArray<Pick<OverdueItem, "owed">>): { portions: number; owed: number } {
  return { portions: items.length, owed: sumAmounts(items.map((item) => item.owed)) };
}

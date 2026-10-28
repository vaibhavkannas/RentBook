import { deriveMonthView } from "./month-view";
import { cardShortfall, daysOverdue, dueDate, lastDueMonth, latestTenantStart } from "./rent-due";
import { sumAmounts } from "./rent-rules";
import type { PortionCard, RentSnapshot, YearMonth } from "./types";
import { addMonths, compareYm } from "./year-month";

/**
 * One month a portion's tenant owes rent for. `unpaid`: nothing entered, `owed` is the card's suggested rent for the month.
 * `short`: paid, but less than the rent, `owed` is what the card's "less than rent" line says is missing. `expected` is the
 * rent the month is measured against and `paid` what was entered (0 when unpaid). Whole rupees owed; `dueDate` is YYYY-MM-DD.
 */
export type OverdueMonth = {
  month: YearMonth;
  kind: "unpaid" | "short";
  expected: number;
  paid: number;
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
  unpaid: number;
  short: number;
};

/**
 * What a month card says is owed for its month, or null when nothing is: a pending card is owed its suggested rent, a paid
 * card that is short is owed the shortfall. Every other card (paid in full, extra, vacant, needs a tenant) owes nothing, and
 * so does a month whose rent is nothing. Every figure is the card's own, in whole rupees.
 */
function monthOwed(card: PortionCard, month: YearMonth, today: string): OverdueMonth | null {
  const base = { month, dueDate: dueDate(month), daysOverdue: daysOverdue(month, today) };
  if (card.status === "pending" && card.rentReference !== null) {
    const owed = Math.round(card.rentReference);
    return owed > 0 ? { ...base, kind: "unpaid", expected: card.rentReference, paid: 0, owed } : null;
  }
  if (card.status === "paid" && card.entry) {
    const owed = cardShortfall(card);
    if (owed <= 0) return null;
    return { ...base, kind: "short", expected: card.rentReference ?? card.entry.amount, paid: card.entry.amount, owed };
  }
  return null;
}

/**
 * Who owes rent on `today` (YYYY-MM-DD, India time), and for which months. Per portion only the tenant of its latest Schedule
 * entry is looked at, from the first month of their latest unbroken run of entries to the last month that is overdue
 * (`lastDueMonth`), each month judged by the portion's card from `deriveMonthView`, which is the figure the month screen shows.
 * Vacant, needs-tenant and switched-off months have no due card and are skipped; a month paid ahead is after the last due
 * month and never counts, nor does it make up an earlier month. Most owed first; equal amounts, the oldest month first; then
 * Settings order. Portions that owe nothing are left out.
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
      unpaid: months.filter((m) => m.kind === "unpaid").length,
      short: months.filter((m) => m.kind === "short").length,
    });
  }
  // `items` is in Settings order and the sort is stable, so equal amounts of the same age stay in that order.
  return items.sort((a, b) => b.owed - a.owed || compareYm(a.oldest, b.oldest));
}

/** How many portions owe, and how much between them. */
export function overdueTotals(items: OverdueItem[]): { portions: number; owed: number } {
  return { portions: items.length, owed: sumAmounts(items.map((item) => item.owed)) };
}

import type { MonthView, PortionCard } from "@/lib/domain/types";

/**
 * The month summary's count of portions, from the cards. A vacant portion (its last tenant moved out) and one that never had
 * a tenant owe nothing, so they are not counted among the portions that are let. Pure on purpose, so the words can be tested.
 */

/** A card with no tenant this month: vacant, or never had one. */
export const isVacantCard = (card: Pick<PortionCard, "status">): boolean =>
  card.status === "vacant" || card.status === "needs-tenant";

/** How many portions have paid, how many are vacant, and how many are let (every card that is not vacant). */
export function summaryCounts(view: Pick<MonthView, "cards" | "paidCount">): { paid: number; vacant: number; let: number } {
  const vacant = view.cards.filter(isVacantCard).length;
  return { paid: view.paidCount, vacant, let: view.cards.length - vacant };
}

/** "3 of 4 portions · 1 vacant": what has been paid of the portions that are let, and how many are vacant. */
export function summaryText(view: Pick<MonthView, "cards" | "paidCount">): string {
  const counts = summaryCounts(view);
  if (counts.let === 0 && counts.vacant > 0) return "All portions are vacant";
  const paid = `${counts.paid} of ${counts.let} portions`;
  return counts.vacant > 0 ? `${paid} · ${counts.vacant} vacant` : paid;
}

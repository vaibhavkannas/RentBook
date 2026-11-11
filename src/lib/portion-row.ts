import type { PortionCard } from "@/lib/domain/types";
import { lastDueMonth } from "@/lib/domain/rent-due";
import { ymKey } from "@/lib/domain/year-month";
import { formatDay, formatRupees } from "@/lib/format";
import { isVacantCard } from "@/lib/month-summary";
import type { PillTone } from "@/lib/ui-classes";

/** The words and figures of a portion's row on the month screen. Pure on purpose, so they can be tested. */

export type RowStatus = "paid" | "pending" | "overdue" | "vacant";

/**
 * Whether a card is overdue: it has no payment (pending), it owes rent (the same test as the Overdue screen, src/lib/domain/overdue.ts),
 * and its month is on or before the last month whose rent counts as overdue on `today` (src/lib/domain/rent-due.ts). `today` is
 * YYYY-MM-DD, India time. A day that is not a real day guesses nothing: not overdue.
 */
export function isOverdueCard(card: Pick<PortionCard, "status" | "rentReference">, monthKey: string, today: string): boolean {
  if (card.status !== "pending" || card.rentReference === null || Math.round(card.rentReference) <= 0) return false;
  try {
    return monthKey <= ymKey(lastDueMonth(today));
  } catch {
    return false;
  }
}

/** A portion with no tenant this month, vacant or never let, is vacant to the person; a pending one is overdue when `overdue`. */
export const rowStatus = (card: Pick<PortionCard, "status">, overdue = false): RowStatus =>
  isVacantCard(card) ? "vacant" : card.status === "paid" ? "paid" : overdue ? "overdue" : "pending";

const PILLS: Record<RowStatus, { tone: PillTone; label: string }> = {
  paid: { tone: "success", label: "Paid" },
  pending: { tone: "warn", label: "Pending" },
  overdue: { tone: "danger", label: "Overdue" },
  vacant: { tone: "neutral", label: "Vacant" },
};
export const rowPill = (status: RowStatus) => PILLS[status];

/** The line under the name: who pays and which payment of the cycle, or why the portion is vacant. */
export function rowSubtitle(card: PortionCard): string {
  if (card.status === "vacant" && card.vacancy) {
    return `Vacant since ${formatDay(card.vacancy.since)}. ${card.vacancy.previousTenant} moved out.`;
  }
  if (isVacantCard(card)) return "No tenant recorded yet.";
  const count = card.entry?.count ?? card.next?.count;
  const tenant = card.entry?.tenant ?? card.next?.tenant;
  return `${tenant} · Payment ${count}${card.cycleLength !== null ? ` of ${card.cycleLength}` : ""}`;
}

/** What was received for a paid card, the suggested rent for a pending one, and nothing for a portion with no tenant. */
export function rowAmount(card: PortionCard): string | null {
  if (isVacantCard(card)) return null;
  const amount = card.entry?.amount ?? card.next?.suggestedAmount;
  return amount === undefined ? null : formatRupees(amount);
}

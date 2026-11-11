import type { PortionCard } from "@/lib/domain/types";
import { formatDay, formatRupees } from "@/lib/format";
import { isVacantCard } from "@/lib/month-summary";
import type { PillTone } from "@/lib/ui-classes";

/** The words and figures of a portion's row on the month screen. Pure on purpose, so they can be tested. */

export type RowStatus = "paid" | "pending" | "vacant";

/** A portion with no tenant this month, vacant or never let, is vacant to the person. */
export const rowStatus = (card: Pick<PortionCard, "status">): RowStatus =>
  isVacantCard(card) ? "vacant" : card.status === "paid" ? "paid" : "pending";

const PILLS: Record<RowStatus, { tone: PillTone; label: string }> = {
  paid: { tone: "success", label: "Paid" },
  pending: { tone: "warn", label: "Pending" },
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

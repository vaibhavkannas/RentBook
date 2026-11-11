import type { PortionCard } from "@/lib/domain/types";
import { isVacantCard } from "@/lib/month-summary";

/** The chips above the portions of the month screen. Which one is chosen is a choice of the screen, not of the address. */
export const FILTERS = ["all", "pending", "paid", "vacant"] as const;
export type Filter = (typeof FILTERS)[number];

const LABELS: Record<Filter, string> = { all: "All", pending: "Pending", paid: "Paid", vacant: "Vacant" };
export const filterLabel = (filter: Filter): string => LABELS[filter];

const MATCHES: Record<Filter, (card: PortionCard) => boolean> = {
  all: () => true,
  pending: (card) => card.status === "pending",
  paid: (card) => card.status === "paid",
  // A portion that never had a tenant is vacant for the owner's purposes, as in the month summary.
  vacant: isVacantCard,
};

export const filterCards = (cards: readonly PortionCard[], filter: Filter): PortionCard[] => cards.filter(MATCHES[filter]);

/** How many cards each chip would show. */
export function filterCounts(cards: readonly PortionCard[]): Record<Filter, number> {
  return Object.fromEntries(FILTERS.map((filter) => [filter, filterCards(cards, filter).length])) as Record<Filter, number>;
}

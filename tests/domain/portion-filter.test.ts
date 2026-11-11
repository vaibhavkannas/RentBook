import { describe, expect, it } from "vitest";
import type { PortionCard } from "@/lib/domain/types";
import { FILTERS, filterCards, filterCounts, filterLabel } from "@/lib/portion-filter";

const card = (portionId: string, status: PortionCard["status"]): PortionCard => ({
  portionId,
  name: portionId,
  cycleLength: 11,
  status,
  entry: null,
  next: null,
  rentReference: null,
  rentDifference: null,
  undoBlockedReason: null,
  tenancy: null,
});

const CARDS = [card("a", "paid"), card("b", "pending"), card("c", "pending"), card("d", "vacant"), card("e", "needs-tenant")];

describe("the filter chips of the month screen", () => {
  it("are All, Pending, Paid and Vacant, in that order", () => {
    expect(FILTERS).toEqual(["all", "pending", "paid", "vacant"]);
    expect(FILTERS.map(filterLabel)).toEqual(["All", "Pending", "Paid", "Vacant"]);
  });

  it("count the cards of each kind; a portion that never had a tenant is vacant too", () => {
    expect(filterCounts(CARDS)).toEqual({ all: 5, pending: 2, paid: 1, vacant: 2 });
    expect(filterCounts([])).toEqual({ all: 0, pending: 0, paid: 0, vacant: 0 });
  });

  it("keep the cards of the kind, in their order, and every card for All", () => {
    expect(filterCards(CARDS, "all")).toEqual(CARDS);
    expect(filterCards(CARDS, "pending").map((c) => c.portionId)).toEqual(["b", "c"]);
    expect(filterCards(CARDS, "paid").map((c) => c.portionId)).toEqual(["a"]);
    expect(filterCards(CARDS, "vacant").map((c) => c.portionId)).toEqual(["d", "e"]);
  });
});

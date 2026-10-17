import { describe, expect, it } from "vitest";
import type { MonthView, PortionCard } from "@/lib/domain/types";
import { isVacantCard, summaryCounts, summaryText } from "@/lib/month-summary";

function card(status: PortionCard["status"], portionId: string): PortionCard {
  return {
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
  };
}

function view(statuses: PortionCard["status"][]): Pick<MonthView, "cards" | "paidCount"> {
  return {
    cards: statuses.map((status, index) => card(status, `p${index + 1}`)),
    paidCount: statuses.filter((status) => status === "paid").length,
  };
}

describe("isVacantCard", () => {
  it("is true for a vacant card and for one that never had a tenant, and false for the rest", () => {
    expect(isVacantCard({ status: "vacant" })).toBe(true);
    expect(isVacantCard({ status: "needs-tenant" })).toBe(true);
    expect(isVacantCard({ status: "paid" })).toBe(false);
    expect(isVacantCard({ status: "pending" })).toBe(false);
  });
});

describe("summaryCounts", () => {
  it("counts what is paid, what is vacant (vacant or never had a tenant) and what is let", () => {
    expect(summaryCounts(view(["paid", "paid", "paid", "pending", "vacant"]))).toEqual({ paid: 3, vacant: 1, let: 4 });
    expect(summaryCounts(view(["paid", "pending", "needs-tenant", "vacant"]))).toEqual({ paid: 1, vacant: 2, let: 2 });
  });

  it("has nothing vacant when every portion has a tenant", () => {
    expect(summaryCounts(view(["paid", "pending"]))).toEqual({ paid: 1, vacant: 0, let: 2 });
  });

  it("takes the paid count from the view", () => {
    expect(summaryCounts({ cards: view(["pending"]).cards, paidCount: 7 }).paid).toBe(7);
  });
});

describe("summaryText", () => {
  it("says how many portions have paid, as it always did, when none is vacant", () => {
    expect(summaryText(view(["paid", "pending", "pending"]))).toBe("1 of 3 portions");
    expect(summaryText(view(["paid"]))).toBe("1 of 1 portions");
    expect(summaryText(view([]))).toBe("0 of 0 portions");
  });

  it("counts only the portions that are let, and says how many are vacant", () => {
    expect(summaryText(view(["paid", "paid", "paid", "pending", "vacant"]))).toBe("3 of 4 portions · 1 vacant");
    expect(summaryText(view(["paid", "paid", "paid", "paid", "needs-tenant"]))).toBe("4 of 4 portions · 1 vacant");
    expect(summaryText(view(["pending", "vacant", "needs-tenant"]))).toBe("0 of 1 portions · 2 vacant");
  });

  it("says all portions are vacant when none is let", () => {
    expect(summaryText(view(["vacant", "vacant"]))).toBe("All portions are vacant");
    expect(summaryText(view(["vacant", "needs-tenant"]))).toBe("All portions are vacant");
  });
});

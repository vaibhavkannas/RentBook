import { describe, expect, it } from "vitest";
import type { PortionCard } from "@/lib/domain/types";
import { rowAmount, rowPill, rowStatus, rowSubtitle } from "@/lib/portion-row";

const card = (overrides: Partial<PortionCard> = {}): PortionCard => ({
  portionId: "p1",
  name: "Ground floor",
  cycleLength: 11,
  status: "pending",
  entry: null,
  next: { tenant: "Asha", count: 4, suggestedAmount: 5450, previousAmount: 5450, startsNewCycle: false },
  undoBlockedReason: null,
  tenancy: null,
  rentReference: 5450,
  rentDifference: null,
  ...overrides,
});

describe("the line under a portion's name", () => {
  it("names the tenant and the payment of the cycle", () => {
    expect(rowSubtitle(card())).toBe("Asha · Payment 4 of 11");
    expect(rowSubtitle(card({ cycleLength: null }))).toBe("Asha · Payment 4");
  });

  it("takes a paid card's tenant and count from its entry", () => {
    const paid = card({ status: "paid", entry: { tenant: "Bala", count: 2, amount: 12700 }, next: null });
    expect(rowSubtitle(paid)).toBe("Bala · Payment 2 of 11");
  });

  it("says since when a portion is vacant and who moved out", () => {
    const vacant = card({
      status: "vacant",
      next: null,
      vacancy: { since: "2026-10-01", previousTenant: "Esha" },
    });
    expect(rowSubtitle(vacant)).toBe("Vacant since 1 Oct 2026. Esha moved out.");
  });

  it("says no tenant has been recorded for a portion that never had one, and for a vacant one with no history", () => {
    expect(rowSubtitle(card({ status: "needs-tenant", next: null }))).toBe("No tenant recorded yet.");
    expect(rowSubtitle(card({ status: "vacant", next: null, vacancy: null }))).toBe("No tenant recorded yet.");
  });
});

describe("a portion's amount", () => {
  it("is what was received for a paid card, and the suggested rent for a pending one", () => {
    expect(rowAmount(card())).toBe("₹ 5,450");
    expect(rowAmount(card({ status: "paid", entry: { tenant: "Asha", count: 4, amount: 5480 }, next: null }))).toBe("₹ 5,480");
  });

  it("is nothing for a portion with no tenant", () => {
    expect(rowAmount(card({ status: "needs-tenant", next: null }))).toBeNull();
    expect(rowAmount(card({ status: "vacant", next: null }))).toBeNull();
  });
});

describe("a portion's status", () => {
  it("is paid, pending or vacant, the last for both kinds of portion with no tenant", () => {
    expect(rowStatus(card())).toBe("pending");
    expect(rowStatus(card({ status: "paid" }))).toBe("paid");
    expect(rowStatus(card({ status: "vacant" }))).toBe("vacant");
    expect(rowStatus(card({ status: "needs-tenant" }))).toBe("vacant");
  });

  it("has a pill in the colour of its tone, with its word", () => {
    expect(rowPill("paid")).toEqual({ tone: "success", label: "Paid" });
    expect(rowPill("pending")).toEqual({ tone: "warn", label: "Pending" });
    expect(rowPill("vacant")).toEqual({ tone: "neutral", label: "Vacant" });
  });
});

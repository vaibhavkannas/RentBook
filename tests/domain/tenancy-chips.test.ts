import { describe, expect, it } from "vitest";
import type { TenancySummary } from "@/lib/domain/tenancy";
import { tenancyChips } from "@/lib/tenancy-chips";

function summary(overrides: Partial<TenancySummary> = {}): TenancySummary {
  return {
    id: "t-1",
    phone: "",
    moveIn: "2026-01-15",
    agreementEnd: "",
    advance: null,
    advanceStatus: null,
    updatedAt: "2026-01-15T05:00:00.000Z",
    ...overrides,
  };
}

describe("tenancyChips", () => {
  it("shows a held advance with its amount", () => {
    expect(tenancyChips(summary({ advance: 20000, advanceStatus: "Held" }))).toEqual(["Advance ₹ 20,000 held"]);
  });

  it("uses Indian digit grouping for the amount", () => {
    expect(tenancyChips(summary({ advance: 150000, advanceStatus: "Held" }))).toEqual(["Advance ₹ 1,50,000 held"]);
  });

  it("shows a refunded advance as returned, without the amount", () => {
    expect(tenancyChips(summary({ advance: 20000, advanceStatus: "Refunded" }))).toEqual(["Advance returned"]);
  });

  it("shows an adjusted advance as adjusted, without the amount", () => {
    expect(tenancyChips(summary({ advance: 20000, advanceStatus: "Adjusted" }))).toEqual(["Advance adjusted"]);
  });

  it("shows an advance with no known status by its amount alone", () => {
    expect(tenancyChips(summary({ advance: 20000, advanceStatus: null }))).toEqual(["Advance ₹ 20,000"]);
  });

  it("shows nothing for an advance that is null or zero", () => {
    expect(tenancyChips(summary({ advance: null, advanceStatus: "Held" }))).toEqual([]);
    expect(tenancyChips(summary({ advance: null }))).toEqual([]);
    expect(tenancyChips(summary({ advance: 0, advanceStatus: "Held" }))).toEqual([]);
  });

  it("shows the agreement end as a short date", () => {
    expect(tenancyChips(summary({ agreementEnd: "2027-03-15" }))).toEqual(["Agreement ends 15 Mar 2027"]);
  });

  it("shows an agreement end that is not a date as the text it is", () => {
    expect(tenancyChips(summary({ agreementEnd: "March next year" }))).toEqual([
      "Agreement ends March next year",
    ]);
  });

  it("puts the advance first and the agreement second", () => {
    expect(
      tenancyChips(summary({ advance: 20000, advanceStatus: "Held", agreementEnd: "2027-03-15" })),
    ).toEqual(["Advance ₹ 20,000 held", "Agreement ends 15 Mar 2027"]);
  });

  it("has no chips for a summary with only a phone and a move-in date", () => {
    expect(tenancyChips(summary({ phone: "98765 43210" }))).toEqual([]);
  });

  it("ignores an agreement end of spaces", () => {
    expect(tenancyChips(summary({ agreementEnd: "   " }))).toEqual([]);
  });
});

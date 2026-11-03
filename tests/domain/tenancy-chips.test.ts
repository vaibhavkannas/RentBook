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
    expect(tenancyChips(summary({ advance: 20000, advanceStatus: "Held" }))).toEqual(["Advance ₹ 20,000 held"]);
  });

  it("uses Indian digit grouping for the amount", () => {
    expect(tenancyChips(summary({ advance: 150000, advanceStatus: "Held" }))).toEqual(["Advance ₹ 1,50,000 held"]);
  });

  it("shows a refunded advance as returned, without the amount", () => {
    expect(tenancyChips(summary({ advance: 20000, advanceStatus: "Refunded" }))).toEqual(["Advance returned"]);
  });

  it("shows an adjusted advance as adjusted, without the amount", () => {
    expect(tenancyChips(summary({ advance: 20000, advanceStatus: "Adjusted" }))).toEqual(["Advance adjusted"]);
  });

  it("shows an advance with no known status by its amount alone", () => {
    expect(tenancyChips(summary({ advance: 20000, advanceStatus: null }))).toEqual(["Advance ₹ 20,000"]);
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
    ).toEqual(["Advance ₹ 20,000 held", "Agreement ends 15 Mar 2027"]);
  });

  it("has no chips for a summary with only a phone and a move-in date", () => {
    expect(tenancyChips(summary({ phone: "98765 43210" }))).toEqual([]);
  });

  it("ignores an agreement end of spaces", () => {
    expect(tenancyChips(summary({ agreementEnd: "   " }))).toEqual([]);
  });

  describe("with today", () => {
    it("says an agreement has ended when today is after the end", () => {
      expect(tenancyChips(summary({ agreementEnd: "2027-03-15" }), "2027-03-16")).toEqual(["Agreement ended 15 Mar 2027"]);
      expect(tenancyChips(summary({ agreementEnd: "2026-10-05" }), "2026-10-17")).toEqual(["Agreement ended 5 Oct 2026"]);
      expect(tenancyChips(summary({ agreementEnd: "2026-12-31" }), "2027-01-01")).toEqual(["Agreement ended 31 Dec 2026"]);
    });

    it("says the agreement ends on its last day and before it", () => {
      expect(tenancyChips(summary({ agreementEnd: "2027-03-15" }), "2027-03-15")).toEqual(["Agreement ends 15 Mar 2027"]);
      expect(tenancyChips(summary({ agreementEnd: "2027-03-15" }), "2026-10-17")).toEqual(["Agreement ends 15 Mar 2027"]);
    });

    it("changes nothing without today, and nothing else with it", () => {
      const past = summary({ advance: 20000, advanceStatus: "Held", agreementEnd: "2020-01-01" });
      expect(tenancyChips(past)).toEqual(["Advance ₹\u00a020,000 held", "Agreement ends 1 Jan 2020"]);
      expect(tenancyChips(past, undefined)).toEqual(tenancyChips(past));
      expect(tenancyChips(past, "2026-10-17")).toEqual(["Advance ₹\u00a020,000 held", "Agreement ended 1 Jan 2020"]);
      expect(tenancyChips(summary({ phone: "98765 43210" }), "2026-10-17")).toEqual([]);
      expect(tenancyChips(summary({ agreementEnd: "   " }), "2026-10-17")).toEqual([]);
    });

    it("keeps saying 'ends' for an end that is not a real day, and for a today that is not one", () => {
      expect(tenancyChips(summary({ agreementEnd: "March next year" }), "2026-10-17")).toEqual(["Agreement ends March next year"]);
      expect(tenancyChips(summary({ agreementEnd: "2027-02-30" }), "2027-12-01")).toEqual(["Agreement ends 2027-02-30"]);
      expect(tenancyChips(summary({ agreementEnd: "2020-01-01" }), "soon")).toEqual(["Agreement ends 1 Jan 2020"]);
      expect(tenancyChips(summary({ agreementEnd: "2020-01-01" }), "")).toEqual(["Agreement ends 1 Jan 2020"]);
    });

    it("trims the agreement end", () => {
      expect(tenancyChips(summary({ agreementEnd: " 2020-01-01 " }), "2026-10-17")).toEqual(["Agreement ended 1 Jan 2020"]);
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  addDetailsHint,
  advanceOutcome,
  advanceSummary,
  lastUpdatedText,
  MOVE_OUT_OUTCOME_HINT,
  MOVE_OUT_RUPEES_HINT,
  moveOutHint,
  noCurrentTenancyNote,
  phoneHref,
  recordMoveOutHint,
  tenancyPeriod,
  vacantSinceNote,
} from "@/lib/tenancy-view";

describe("advanceSummary", () => {
  it("shows the amount, the status and the day it was paid", () => {
    expect(advanceSummary({ advance: 20000, advanceStatus: "Held", advanceDate: "2026-01-10" })).toBe(
      "₹ 20,000 · Held · paid 10 Jan 2026",
    );
  });
  it("leaves out what is not there", () => {
    expect(advanceSummary({ advance: 20000, advanceStatus: null, advanceDate: "" })).toBe("₹ 20,000");
    expect(advanceSummary({ advance: 5000, advanceStatus: "Adjusted", advanceDate: "" })).toBe("₹ 5,000 · Adjusted");
  });
  it("is null when there is no advance", () => {
    expect(advanceSummary({ advance: null, advanceStatus: null, advanceDate: "" })).toBeNull();
    expect(advanceSummary({ advance: null, advanceStatus: "Held", advanceDate: "2026-01-10" })).toBeNull();
  });
  it("shows an advance of zero", () => {
    expect(advanceSummary({ advance: 0, advanceStatus: "Held", advanceDate: "" })).toBe("₹ 0 · Held");
  });
  it("shows a date typed by hand as it is", () => {
    expect(advanceSummary({ advance: 100, advanceStatus: null, advanceDate: "ten Jan" })).toBe("₹ 100 · paid ten Jan");
  });
});

describe("tenancyPeriod", () => {
  it("shows move-in to move-out", () => {
    expect(tenancyPeriod("2026-01-15", "2026-09-30")).toBe("15 Jan 2026 to 30 Sep 2026");
  });
  it("shows an open tenancy as from the move-in date", () => {
    expect(tenancyPeriod("2026-01-15", "")).toBe("From 15 Jan 2026");
  });
  it("shows a missing move-in date as a dash", () => {
    expect(tenancyPeriod("", "2026-09-30")).toBe("— to 30 Sep 2026");
    expect(tenancyPeriod("", "")).toBe("From —");
  });
});

describe("advanceOutcome", () => {
  it("shows the advance, its outcome, the refund and the deductions", () => {
    expect(
      advanceOutcome({ advance: 20000, advanceStatus: "Adjusted", refund: 15000, deductions: 5000 }),
    ).toBe("Advance ₹ 20,000 · Adjusted · Refund ₹ 15,000 · Deductions ₹ 5,000");
  });
  it("shows a refunded advance", () => {
    expect(advanceOutcome({ advance: 20000, advanceStatus: "Refunded", refund: 20000, deductions: null })).toBe(
      "Advance ₹ 20,000 · Refunded · Refund ₹ 20,000",
    );
  });
  it("shows a refund of zero and zero deductions, because they were recorded", () => {
    expect(advanceOutcome({ advance: 20000, advanceStatus: "Adjusted", refund: 0, deductions: 0 })).toBe(
      "Advance ₹ 20,000 · Adjusted · Refund ₹ 0 · Deductions ₹ 0",
    );
  });
  it("shows only what is there", () => {
    expect(advanceOutcome({ advance: 20000, advanceStatus: null, refund: null, deductions: null })).toBe(
      "Advance ₹ 20,000",
    );
    expect(advanceOutcome({ advance: null, advanceStatus: null, refund: 500, deductions: null })).toBe(
      "Refund ₹ 500",
    );
  });
  it("does not show a status without an advance", () => {
    expect(advanceOutcome({ advance: null, advanceStatus: "Held", refund: null, deductions: 700 })).toBe(
      "Deductions ₹ 700",
    );
  });
  it("is null when nothing was recorded", () => {
    expect(advanceOutcome({ advance: null, advanceStatus: null, refund: null, deductions: null })).toBeNull();
  });
});

describe("phoneHref", () => {
  it("makes a tel: link from the digits and a leading plus", () => {
    expect(phoneHref("98765 43210")).toBe("tel:9876543210");
    expect(phoneHref("+91 (98765) 43-210")).toBe("tel:+919876543210");
  });
  it("is null when the phone has no digits", () => {
    expect(phoneHref("")).toBeNull();
    expect(phoneHref("   ")).toBeNull();
    expect(phoneHref("ask the neighbour")).toBeNull();
  });
  it("ignores everything that is not a digit, so hand-typed text cannot change the link", () => {
    expect(phoneHref("9876543210;javascript:alert(1)")).toBe("tel:98765432101");
  });
});

describe("lastUpdatedText", () => {
  it("shows who and when, in India time", () => {
    expect(lastUpdatedText({ updatedBy: "owner@example.com", updatedAt: "2026-10-05T04:30:00.000Z" })).toMatch(
      /^owner@example\.com · 5 Oct.*10:00\s?am$/i,
    );
  });
  it("shows only who when there is no time, and only when when there is no name", () => {
    expect(lastUpdatedText({ updatedBy: "member@example.com", updatedAt: "" })).toBe("member@example.com");
    expect(lastUpdatedText({ updatedBy: "", updatedAt: "2026-10-05T04:30:00.000Z" })).toMatch(/^5 Oct/);
  });
  it("says so when neither was recorded", () => {
    expect(lastUpdatedText({ updatedBy: "", updatedAt: "" })).toBe("Not recorded");
  });
  it("shows a time that is not a date as it is", () => {
    expect(lastUpdatedText({ updatedBy: "owner@example.com", updatedAt: "last week" })).toBe(
      "owner@example.com · last week",
    );
  });
});

describe("noCurrentTenancyNote", () => {
  it("says earlier details for another tenant will be marked as moved out", () => {
    expect(
      noCurrentTenancyNote({ scheduleTenant: "Hari", mismatched: { tenant: "Asha" }, lastPast: undefined }),
    ).toBe("Earlier details for Asha will be marked as moved out when you save.");
  });

  it("says the tenant moved out, and that saving starts a new tenancy, when the latest past tenancy is the same person", () => {
    expect(
      noCurrentTenancyNote({
        scheduleTenant: "Asha",
        mismatched: null,
        lastPast: { tenant: " asha ", moveOut: "2026-09-30" },
      }),
    ).toBe("Asha moved out on 30 Sep 2026. Saving details here starts a new tenancy for Asha.");
  });

  it("prefers the mismatch over the moved-out note", () => {
    expect(
      noCurrentTenancyNote({
        scheduleTenant: "Hari",
        mismatched: { tenant: "Asha" },
        lastPast: { tenant: "Hari", moveOut: "2026-09-30" },
      }),
    ).toMatch(/^Earlier details for Asha/);
  });

  it("has no note for a tenant with no history, or when the latest past tenancy is someone else", () => {
    expect(noCurrentTenancyNote({ scheduleTenant: "Asha", mismatched: null, lastPast: undefined })).toBeNull();
    expect(
      noCurrentTenancyNote({
        scheduleTenant: "Hari",
        mismatched: null,
        lastPast: { tenant: "Asha", moveOut: "2026-09-30" },
      }),
    ).toBeNull();
  });

  it("has no note when the Schedule names no tenant", () => {
    expect(
      noCurrentTenancyNote({ scheduleTenant: null, mismatched: null, lastPast: { tenant: "Asha", moveOut: "2026-09-30" } }),
    ).toBeNull();
  });
});

describe("addDetailsHint", () => {
  it("names the tenant the Schedule has and says where a new tenant is added", () => {
    expect(addDetailsHint("Asha")).toBe(
      "Adding details for Asha. A new tenant is added with New tenant on the month screen.",
    );
  });
});

describe("the move-out form hints", () => {
  it("explain the three outcomes of the advance in plain words", () => {
    expect(MOVE_OUT_OUTCOME_HINT).toBe(
      "Refunded: given back to the tenant. Adjusted: used against rent or damage. Held: still kept.",
    );
  });

  it("say that Refund and Deductions are whole rupees and may stay blank", () => {
    expect(MOVE_OUT_RUPEES_HINT).toBe("Whole rupees, leave blank if none.");
  });
});

describe("moveOutHint", () => {
  it("says what a move-out does to the month screen, and that payments already in the Schedule stay", () => {
    expect(moveOutHint("Asha", "Ground floor")).toBe(
      "Record that Asha has moved out. Ground floor shows as Vacant from the first month that starts on or after the move-out date, until you add a new tenant. Payments already in your Schedule stay.",
    );
  });
});

describe("recordMoveOutHint", () => {
  it("says the tenant's details are not needed first", () => {
    expect(recordMoveOutHint("Asha")).toBe("Record that Asha has moved out. You don't need to add their details first.");
  });
});

describe("vacantSinceNote", () => {
  const TODAY = "2026-10-17";

  it("says since when the portion is vacant, and where the next tenant is added, once the day has come", () => {
    expect(vacantSinceNote("2026-10-20", "2026-10-20")).toBe(
      "Vacant since 20 Oct 2026. Add the next tenant with New tenant on the month screen.",
    );
    expect(vacantSinceNote("2026-09-30", TODAY)).toBe(
      "Vacant since 30 Sep 2026. Add the next tenant with New tenant on the month screen.",
    );
  });

  it("says when the tenant moves out, and does not invite adding the next tenant, while the day is still to come", () => {
    expect(vacantSinceNote("2026-12-20", TODAY)).toBe("Moves out on 20 Dec 2026.");
    expect(vacantSinceNote("2026-10-18", TODAY)).toBe("Moves out on 18 Oct 2026.");
  });
});

describe("noCurrentTenancyNote when the portion is vacant", () => {
  const lastPast = { tenant: "Asha", moveOut: "2026-10-20" };

  it("says that adding details for the same name ends the vacancy", () => {
    expect(noCurrentTenancyNote({ scheduleTenant: "Asha", mismatched: null, lastPast, vacant: true })).toBe(
      "Asha moved out on 20 Oct 2026. Saving details here starts a new tenancy for Asha. The portion then stops showing as Vacant.",
    );
  });

  it("says no more than before when the portion is not vacant (the tenant came back and rent was logged)", () => {
    expect(noCurrentTenancyNote({ scheduleTenant: "Asha", mismatched: null, lastPast })).toBe(
      "Asha moved out on 20 Oct 2026. Saving details here starts a new tenancy for Asha.",
    );
    expect(noCurrentTenancyNote({ scheduleTenant: "Asha", mismatched: null, lastPast, vacant: false })).toBe(
      "Asha moved out on 20 Oct 2026. Saving details here starts a new tenancy for Asha.",
    );
  });
});

describe("noCurrentTenancyNote for a move-out dated after today", () => {
  const lastPast = { tenant: "Asha", moveOut: "2026-12-20" };
  const input = { scheduleTenant: "Asha", mismatched: null, lastPast, today: "2026-10-17" };

  it("says the tenant will move out, and does not say the portion is vacant or that details end a vacancy", () => {
    expect(noCurrentTenancyNote({ ...input, vacant: false })).toBe(
      "Asha will move out on 20 Dec 2026. Saving details here starts a new tenancy for Asha.",
    );
    // even when the caller says vacant: a vacancy that has not begun is not claimed
    expect(noCurrentTenancyNote({ ...input, vacant: true })).toBe(
      "Asha will move out on 20 Dec 2026. Saving details here starts a new tenancy for Asha.",
    );
  });

  it("is in the past tense from the day itself", () => {
    expect(noCurrentTenancyNote({ ...input, lastPast: { tenant: "Asha", moveOut: "2026-10-17" }, vacant: true })).toBe(
      "Asha moved out on 17 Oct 2026. Saving details here starts a new tenancy for Asha. The portion then stops showing as Vacant.",
    );
    expect(noCurrentTenancyNote({ ...input, lastPast: { tenant: "Asha", moveOut: "2026-10-16" } })).toBe(
      "Asha moved out on 16 Oct 2026. Saving details here starts a new tenancy for Asha.",
    );
  });

  it("is as it was when it is not given today", () => {
    expect(noCurrentTenancyNote({ scheduleTenant: "Asha", mismatched: null, lastPast })).toBe(
      "Asha moved out on 20 Dec 2026. Saving details here starts a new tenancy for Asha.",
    );
  });
});

describe("tenancyPeriod for a move-out recorded without details", () => {
  it("shows a dash for the move-in day it does not have", () => {
    expect(tenancyPeriod("", "2026-10-20")).toBe("— to 20 Oct 2026");
  });
});

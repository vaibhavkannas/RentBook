import { describe, expect, it } from "vitest";
import {
  DETAILS_SAVED_TOAST,
  editToastText,
  logToastText,
  moveOutToastText,
  newTenantToastText,
  paymentToastText,
  replaceToastText,
  SETTINGS_SAVED_TOAST,
} from "@/lib/toast-copy";
import { undoToastText } from "@/lib/undo-copy";

// What the toast says after each save: the portion first (several cards share the screen), then what happened.

describe("the toast after logging a payment", () => {
  it("names the portion, the amount and the month", () => {
    expect(logToastText("Ground floor", 10000, "October 2026")).toBe("Ground floor: ₹ 10,000 logged for October 2026");
    expect(logToastText("First floor, double bedroom", 13335, "November 2026")).toBe(
      "First floor, double bedroom: ₹ 13,335 logged for November 2026",
    );
  });
});

describe("the toast after editing an amount", () => {
  it("says the amount changed, and to what", () => {
    expect(editToastText("Ground floor", 10500)).toBe("Ground floor: amount changed to ₹ 10,500");
  });
});

describe("the toast after Replace amount on a duplicate warning", () => {
  it("says the amount was replaced, and with what", () => {
    expect(replaceToastText("Ground floor", 9800)).toBe("Ground floor: amount replaced with ₹ 9,800");
  });
});

describe("the toast after adding a new tenant", () => {
  it("names the portion, the tenant and the first payment", () => {
    expect(newTenantToastText("Ground floor", "Asha", 10000)).toBe("Ground floor: Asha added, ₹ 10,000 logged");
  });
});

describe("the toast after an undo", () => {
  it("keeps the wording the undo sheet has always used", () => {
    expect(undoToastText("Ground floor")).toBe("Ground floor: payment undone");
  });
});

describe("the toast after saving settings, tenancy details and a move-out", () => {
  it("says the settings were saved", () => {
    expect(SETTINGS_SAVED_TOAST).toBe("Settings saved");
  });

  it("says the details were saved, after a create and after an edit", () => {
    expect(DETAILS_SAVED_TOAST).toBe("Details saved");
  });

  it("says who has moved out", () => {
    expect(moveOutToastText("Asha")).toBe("Asha has moved out");
  });
});

describe("paymentToastText, the one the payment sheet asks for", () => {
  const base = { portion: "Ground floor", tenant: "Asha", amount: 10000, monthLabel: "October 2026", replaced: false };

  it("is the log text for a payment that was logged", () => {
    expect(paymentToastText({ ...base, mode: "log" })).toBe(logToastText("Ground floor", 10000, "October 2026"));
  });

  it("is the edit text for an edit", () => {
    expect(paymentToastText({ ...base, mode: "edit" })).toBe(editToastText("Ground floor", 10000));
  });

  it("is the replace text after a Replace on a duplicate warning, whether it came from a log or an edit", () => {
    expect(paymentToastText({ ...base, mode: "log", replaced: true })).toBe(replaceToastText("Ground floor", 10000));
    expect(paymentToastText({ ...base, mode: "edit", replaced: true })).toBe(replaceToastText("Ground floor", 10000));
  });

  it("is the new tenant text for a new tenant, even when it replaced a duplicate, because the tenant is what changed", () => {
    expect(paymentToastText({ ...base, mode: "new-tenant" })).toBe(newTenantToastText("Ground floor", "Asha", 10000));
    expect(paymentToastText({ ...base, mode: "new-tenant", replaced: true })).toBe(
      newTenantToastText("Ground floor", "Asha", 10000),
    );
  });

  it("does not say the tenant's name when the toast is not about a new tenant", () => {
    expect(paymentToastText({ ...base, mode: "log" })).not.toContain("Asha");
  });
});

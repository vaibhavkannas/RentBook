import { describe, expect, it } from "vitest";
import {
  DETAILS_SAVED_TOAST,
  editToastText,
  exitToastText,
  logToastText,
  logUnsavedToastText,
  moveOutToastText,
  newTenantToastText,
  paymentToasts,
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

// "Skip for now" on a log-retry notice: the payment is saved in the Schedule but its Payments Log entry is not, so a toast
// that says "logged" would not be true.
describe("the toast when the Payments Log entry did not save", () => {
  it("says the payment is in the Schedule and not in the Payments Log, in plain words", () => {
    expect(logUnsavedToastText("Ground floor", 10000)).toBe(
      "Ground floor: ₹ 10,000 saved to your Schedule, but not to the Payments Log",
    );
  });

  it("does not claim the payment was logged, added or changed", () => {
    const text = logUnsavedToastText("Ground floor", 10000);
    expect(text).not.toMatch(/\blogged\b|\badded\b|\bchanged\b|\breplaced\b/);
  });

  const saved = { mode: "log" as const, replaced: false, portion: "Ground floor", tenant: "", amount: 10000, monthLabel: "October 2026" };

  it("keeps both texts for a payment, the one for a saved log entry and the one for an unsaved one", () => {
    expect(paymentToasts(saved)).toEqual({
      saved: "Ground floor: ₹ 10,000 logged for October 2026",
      logUnsaved: "Ground floor: ₹ 10,000 saved to your Schedule, but not to the Payments Log",
    });
    expect(paymentToasts({ ...saved, mode: "new-tenant", tenant: "Asha" }).saved).toBe("Ground floor: Asha added, ₹ 10,000 logged");
    expect(paymentToasts({ ...saved, mode: "new-tenant", tenant: "Asha" }).logUnsaved).toBe(logUnsavedToastText("Ground floor", 10000));
  });

  it("picks the text that is true when the sheet closes: the log entry saved or not", () => {
    const toasts = paymentToasts(saved);
    expect(exitToastText(toasts, true)).toBe(toasts.saved);
    expect(exitToastText(toasts, false)).toBe(toasts.logUnsaved);
  });
});

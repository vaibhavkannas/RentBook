import { describe, expect, it } from "vitest";
import {
  DETAILS_SAVED_TOAST,
  editToastText,
  exitToastText,
  logEntryState,
  logToastText,
  logUnconfirmedToastText,
  logUnsavedToastText,
  moveOutToastText,
  newTenantToastText,
  paymentToasts,
  paymentToastText,
  prepareToastText,
  replaceToastText,
  SETTINGS_SAVED_TOAST,
} from "@/lib/toast-copy";
import { undoToastText } from "@/lib/undo-copy";

// What the toast says after each save: the portion first (several cards share the screen), then what happened.

describe("the toast after logging a payment", () => {
  it("names the portion, the amount and the month", () => {
    expect(logToastText("Ground floor", 10000, "October 2026")).toBe("Ground floor: ₹ 10,000 logged for October 2026");
    expect(logToastText("First floor, double bedroom", 13335, "November 2026")).toBe(
      "First floor, double bedroom: ₹ 13,335 logged for November 2026",
    );
  });
});

describe("the toast after editing an amount", () => {
  it("says the amount changed, and to what", () => {
    expect(editToastText("Ground floor", 10500)).toBe("Ground floor: amount changed to ₹ 10,500");
  });
});

describe("the toast after Replace amount on a duplicate warning", () => {
  it("says the amount was replaced, and with what", () => {
    expect(replaceToastText("Ground floor", 9800)).toBe("Ground floor: amount replaced with ₹ 9,800");
  });
});

describe("the toast after adding a new tenant", () => {
  it("names the portion, the tenant and the first payment", () => {
    expect(newTenantToastText("Ground floor", "Asha", 10000)).toBe("Ground floor: Asha added, ₹ 10,000 logged");
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

  it("says who has moved out, and from which month the portion is vacant", () => {
    // Deliberate change (3-10): the toast was "Asha has moved out" and now also says what happens to the portion.
    expect(moveOutToastText("Asha", "Ground floor", "2026-10-20")).toBe(
      "Asha has moved out. Ground floor is vacant from November 2026.",
    );
  });

  it("names the month of the move-out when it is on the 1st, and the month after otherwise, over a year end", () => {
    expect(moveOutToastText("Asha", "Attic", "2026-11-01")).toBe("Asha has moved out. Attic is vacant from November 2026.");
    expect(moveOutToastText("Asha", "Attic", "2026-11-02")).toBe("Asha has moved out. Attic is vacant from December 2026.");
    expect(moveOutToastText("Asha", "Attic", "2026-12-31")).toBe("Asha has moved out. Attic is vacant from January 2027.");
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
      "Ground floor: ₹ 10,000 saved to your Schedule, but not to the Payments Log",
    );
  });

  it("does not claim the payment was logged, added or changed", () => {
    const text = logUnsavedToastText("Ground floor", 10000);
    expect(text).not.toMatch(/\blogged\b|\badded\b|\bchanged\b|\breplaced\b/);
  });

  const saved = { mode: "log" as const, replaced: false, portion: "Ground floor", tenant: "", amount: 10000, monthLabel: "October 2026" };

  it("keeps both texts for a payment, the one for a saved log entry and the one for an unsaved one", () => {
    expect(paymentToasts(saved)).toEqual({
      saved: "Ground floor: ₹ 10,000 logged for October 2026",
      logUnsaved: "Ground floor: ₹ 10,000 saved to your Schedule, but not to the Payments Log",
      logUnconfirmed: "Ground floor: ₹ 10,000 saved to your Schedule, but not confirmed in the Payments Log",
    });
    expect(paymentToasts({ ...saved, mode: "new-tenant", tenant: "Asha" }).saved).toBe("Ground floor: Asha added, ₹ 10,000 logged");
    expect(paymentToasts({ ...saved, mode: "new-tenant", tenant: "Asha" }).logUnsaved).toBe(logUnsavedToastText("Ground floor", 10000));
    expect(paymentToasts({ ...saved, mode: "new-tenant", tenant: "Asha" }).logUnconfirmed).toBe(logUnconfirmedToastText("Ground floor", 10000));
  });

  it("picks the text that is true when the sheet closes: the log entry saved, not saved, or not confirmed", () => {
    const toasts = paymentToasts(saved);
    expect(exitToastText(toasts, "saved")).toBe(toasts.saved);
    expect(exitToastText(toasts, "unsaved")).toBe(toasts.logUnsaved);
    expect(exitToastText(toasts, "unconfirmed")).toBe(toasts.logUnconfirmed);
  });
});

// A retry that got no answer may have gone through, and the notice said so ("Couldn't confirm that the log entry saved. Check
// the Activity screen before trying again."): a toast that says the entry was not recorded would then say more than is known.
describe("the toast when a retry of the Payments Log entry got no answer", () => {
  it("says the payment is in the Schedule and that the Payments Log entry is not confirmed, in plain words", () => {
    expect(logUnconfirmedToastText("Ground floor", 10000)).toBe(
      "Ground floor: ₹ 10,000 saved to your Schedule, but not confirmed in the Payments Log",
    );
  });

  it("does not say the entry was not recorded, and does not claim the payment was logged, added or changed", () => {
    const text = logUnconfirmedToastText("Ground floor", 10000);
    expect(text).not.toMatch(/not (?:recorded|saved|to)\b/);
    expect(text).not.toMatch(/\blogged\b|\badded\b|\bchanged\b|\breplaced\b/);
  });
});

describe("logEntryState", () => {
  it.each([
    [false, false, "saved"],
    [false, true, "saved"],
    [true, false, "unsaved"],
    [true, true, "unconfirmed"],
  ] as const)("a retry on offer: %s, the last retry got no answer: %s, is %s", (retryOffered, noAnswer, state) => {
    expect(logEntryState(retryOffered, noAnswer)).toBe(state);
  });
});

describe("the toast after Prepare my Sheet", () => {
  it("names the tabs it created, as the owner names them", () => {
    expect(prepareToastText(["Tenants"])).toBe("Your Sheet is ready: created Tenants.");
    expect(prepareToastText(["Settings", "Payments Log", "Tenants"])).toBe(
      "Your Sheet is ready: created Settings, Payments Log and Tenants.",
    );
  });

  it("says nothing needed creating when it made no tab", () => {
    expect(prepareToastText([])).toBe("Nothing needed creating.");
  });
});

import { describe, expect, it } from "vitest";
import { LOG_RETRY_UNCONFIRMED_MESSAGE, LOG_RETRY_UNUSABLE_MESSAGE } from "@/lib/payment-request";
import {
  undoConfirmationText,
  undoExitToastText,
  undoLogRetryFailureMessage,
  undoLogUnsavedToastText,
  undoToastText,
  UNDO_CONFLICT_MESSAGE,
} from "@/lib/undo-copy";

describe("undoConfirmationText", () => {
  it("names the tenant, the payment number, the amount, the portion and the month", () => {
    expect(
      undoConfirmationText(
        { tenant: "Asha", count: 3, amount: 10835 },
        "First floor, single bedroom",
        "October 2026",
      ),
    ).toBe(
      "This clears Asha's payment 3 (₹ 10,835) for First floor, single bedroom in October 2026. The Payments Log keeps a record.",
    );
  });

  it("never reads as a count out of a total", () => {
    const text = undoConfirmationText({ tenant: "Bala", count: 11, amount: 12700 }, "Rear room", "May 2027");
    expect(text).not.toMatch(/payment \d+ of /);
  });
});

describe("UNDO_CONFLICT_MESSAGE", () => {
  it("tells the person to close the sheet and look at the card", () => {
    expect(UNDO_CONFLICT_MESSAGE).toBe(
      "This payment just changed. Close this and look at the updated card.",
    );
  });
});

describe("undoToastText", () => {
  it("puts the portion name first so the person knows which card was undone", () => {
    expect(undoToastText("First floor, single bedroom")).toBe(
      "First floor, single bedroom: payment undone",
    );
  });
});

// "Skip for now" on the undo's log-retry notice: the undo is in the Schedule but its Payments Log entry is not, so a toast
// that only says "undone" would leave out half of what is true.
describe("the toast when the undo's Payments Log entry did not save", () => {
  it("says the undo is in the Schedule and not in the Payments Log, like the payment sheet's toast does", () => {
    expect(undoLogUnsavedToastText("First floor, single bedroom")).toBe(
      "First floor, single bedroom: payment undone in your Schedule, but not recorded in the Payments Log",
    );
  });

  it("picks the text that is true when the sheet closes: the log entry saved or not", () => {
    expect(undoExitToastText("Ground floor", true)).toBe(undoToastText("Ground floor"));
    expect(undoExitToastText("Ground floor", false)).toBe(undoLogUnsavedToastText("Ground floor"));
    expect(undoExitToastText("Ground floor", false)).not.toBe(undoExitToastText("Ground floor", true));
  });
});

describe("undoLogRetryFailureMessage", () => {
  it("says the undo is safe when the retry got an answer and the log entry still did not save", () => {
    expect(undoLogRetryFailureMessage({ ok: false })).toBe(
      "The log entry still didn't save. The undo itself is safe in your Schedule.",
    );
    expect(undoLogRetryFailureMessage({ ok: true, logWritten: false })).toBe(
      "The log entry still didn't save. The undo itself is safe in your Schedule.",
    );
  });

  it("says the retry can no longer be used when the server refused the token, for the undo too", () => {
    expect(
      undoLogRetryFailureMessage({ ok: false, error: { code: "validation", message: "This retry has expired." } }),
    ).toBe(LOG_RETRY_UNUSABLE_MESSAGE);
  });

  it("sends the person to the Activity screen when the retry got no answer at all", () => {
    expect(undoLogRetryFailureMessage(null)).toBe(LOG_RETRY_UNCONFIRMED_MESSAGE);
    expect(undoLogRetryFailureMessage(null)).toMatch(/Check the Activity screen/);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  apiErrorMessage,
  OFFLINE_MESSAGE,
  PAYMENT_NO_CONFIRMATION,
  PREPARE_NO_CONFIRMATION,
  SIGNED_OUT_MESSAGE,
  SLOW_HINT_MESSAGE,
  SLOW_HINT_MS,
  SOMETHING_WENT_WRONG_MESSAGE,
  TIMEOUT_MESSAGE,
  UNDO_NO_CONFIRMATION,
  sendFailureMessage,
} from "@/lib/request-copy";
import { LOG_RETRY_UNCONFIRMED_MESSAGE } from "@/lib/payment-request";
import { POST_TIMEOUT_MS } from "@/lib/post-json";
import { RELOAD_STEP, SIGN_IN_HINT } from "@/lib/recovery-hint";
import { TENANCY_NO_CONFIRMATION } from "@/lib/tenancy-response";

// What a form says when no answer came, or the server's answer was an error. Each says what happened and what to do.

describe("the texts for a request that got no answer", () => {
  it("says when the device is offline that nothing was sent, and what to do", () => {
    expect(OFFLINE_MESSAGE).toBe("You're offline, so nothing was sent. Connect to the internet and try again.");
  });

  it("says when the wait ran out that the save may still have gone through, and to check before trying again", () => {
    expect(TIMEOUT_MESSAGE).toBe(
      "No answer after 30 seconds. It may still have saved. Tap another tab at the bottom of the screen and come back, then check before trying again.",
    );
  });

  it("counts the seconds from the time the request really waits, so the words and the wait cannot drift apart", () => {
    expect(TIMEOUT_MESSAGE).toContain(`No answer after ${POST_TIMEOUT_MS / 1000} seconds.`);
    expect(readFileSync(new URL("../../src/lib/request-copy.ts", import.meta.url), "utf8")).toMatch(/POST_TIMEOUT_MS/);
  });

  it("every text that sends a person to bring the screen up to date uses the one recovery phrase", () => {
    for (const text of [TIMEOUT_MESSAGE, PAYMENT_NO_CONFIRMATION, UNDO_NO_CONFIRMATION, PREPARE_NO_CONFIRMATION]) {
      expect(text.toLowerCase()).toContain(RELOAD_STEP);
      expect(text).not.toMatch(/refresh|reload/i);
    }
  });

  it("sends a person who has been signed out to a tab, and does not say to come back: they land on the sign-in page", () => {
    expect(SIGNED_OUT_MESSAGE).toContain(SIGN_IN_HINT);
    expect(SIGNED_OUT_MESSAGE).not.toMatch(/come back|refresh|reload/i);
  });

  it("keeps today's texts for an answer that never arrived", () => {
    expect(PAYMENT_NO_CONFIRMATION).toBe(
      "Couldn't confirm that the save went through. Check your connection. Tap another tab at the bottom of the screen and come back, then check before trying again.",
    );
    expect(UNDO_NO_CONFIRMATION).toBe(
      "Couldn't confirm that the undo went through. Check your connection. Tap another tab at the bottom of the screen and come back, then check before trying again.",
    );
    expect(TENANCY_NO_CONFIRMATION).toBe(PAYMENT_NO_CONFIRMATION);
  });
});

describe("sendFailureMessage", () => {
  it("is the offline text for offline, the timeout text for a timeout, and the caller's own text for no answer", () => {
    expect(sendFailureMessage({ kind: "offline" }, PAYMENT_NO_CONFIRMATION)).toBe(OFFLINE_MESSAGE);
    expect(sendFailureMessage({ kind: "timeout" }, PAYMENT_NO_CONFIRMATION)).toBe(TIMEOUT_MESSAGE);
    expect(sendFailureMessage({ kind: "no-answer" }, PAYMENT_NO_CONFIRMATION)).toBe(PAYMENT_NO_CONFIRMATION);
    expect(sendFailureMessage({ kind: "no-answer" }, LOG_RETRY_UNCONFIRMED_MESSAGE)).toBe(LOG_RETRY_UNCONFIRMED_MESSAGE);
  });
});

describe("apiErrorMessage", () => {
  it("tells a person who has been signed out to reload and sign in again", () => {
    expect(SIGNED_OUT_MESSAGE).toBe("You've been signed out. Tap another tab at the bottom of the screen to sign in again.");
    expect(apiErrorMessage({ code: "unauthorized", message: "Sign in with an allowed Google account." })).toBe(SIGNED_OUT_MESSAGE);
  });

  it("says something went wrong on our side when there is no error, or the server's own is an internal one", () => {
    expect(SOMETHING_WENT_WRONG_MESSAGE).toBe("Something went wrong on our side. Try again.");
    expect(apiErrorMessage(undefined)).toBe(SOMETHING_WENT_WRONG_MESSAGE);
    expect(apiErrorMessage(null)).toBe(SOMETHING_WENT_WRONG_MESSAGE);
    expect(apiErrorMessage({ code: "internal", message: "Something went wrong on our side. Try again." })).toBe(SOMETHING_WENT_WRONG_MESSAGE);
    expect(apiErrorMessage({ code: "internal", message: "anything at all" })).toBe(SOMETHING_WENT_WRONG_MESSAGE);
  });

  it("shows the server's own words for every other error", () => {
    for (const code of ["validation", "conflict", "forbidden", "sheet-structure", "config", "rate-limited", "unavailable"]) {
      expect(apiErrorMessage({ code, message: "Words from the server." }), code).toBe("Words from the server.");
    }
  });

  it("does not show an empty message", () => {
    expect(apiErrorMessage({ code: "validation", message: "" })).toBe(SOMETHING_WENT_WRONG_MESSAGE);
    expect(apiErrorMessage({ code: "validation" })).toBe(SOMETHING_WENT_WRONG_MESSAGE);
  });
});

describe("the hint for a slow save", () => {
  it("shows after 8 seconds, and says Google can take a few seconds", () => {
    expect(SLOW_HINT_MS).toBe(8_000);
    expect(SLOW_HINT_MESSAGE).toBe("Still working. Google can take a few seconds.");
  });
});

describe("the text for a Prepare my Sheet that got no answer", () => {
  it("says it could not confirm the Sheet was prepared, and what to do", () => {
    expect(PREPARE_NO_CONFIRMATION).toBe(
      "Couldn't confirm that your Sheet was prepared. Check your connection. Tap another tab at the bottom of the screen and come back, then check Set up.",
    );
  });
});

import { POST_TIMEOUT_MS } from "@/lib/post-json";
import { reloadThen } from "@/lib/recovery-hint";

/**
 * What a form says when a request got no answer, or the server's answer was an error: what happened, and what to do.
 * Pure on purpose, so the words can be tested. (The words for a refused Payments Log retry are in payment-request.ts.)
 */

/** Nothing was sent: the device has no connection. */
export const OFFLINE_MESSAGE = "You're offline, so nothing was sent. Connect to the internet and try again.";

/** The wait ran out (see POST_TIMEOUT_MS): the save may have gone through, so check before trying again. */
export const TIMEOUT_MESSAGE = `No answer after ${POST_TIMEOUT_MS / 1000} seconds. It may still have saved. ${reloadThen("check before trying again")}`;

/** The answer never arrived (a dropped connection, a reply that was not JSON): a payment may or may not have saved. */
export const PAYMENT_NO_CONFIRMATION = `Couldn't confirm that the save went through. Check your connection. ${reloadThen("check before trying again")}`;

export const UNDO_NO_CONFIRMATION = `Couldn't confirm that the undo went through. Check your connection. ${reloadThen("check before trying again")}`;

export const SETTINGS_NO_CONFIRMATION = "Couldn't reach the server. Try again.";

export const SIGNED_OUT_MESSAGE = `You've been signed out. ${reloadThen("sign in again")}`;

export const SOMETHING_WENT_WRONG_MESSAGE = "Something went wrong on our side. Try again.";

/** What a form says under its button once a save has taken a while (SLOW_HINT_MS). */
export const SLOW_HINT_MESSAGE = "Still working. Google can take a few seconds.";
export const SLOW_HINT_MS = 8_000;

/**
 * The words for a request that got no answer. `noAnswer` is the form's own text for an answer that never arrived (a
 * payment, an undo and a tenancy each say what they could not confirm); offline and a timeout are the same everywhere.
 */
export function sendFailureMessage(failure: { kind: "offline" | "timeout" | "no-answer" }, noAnswer: string): string {
  if (failure.kind === "offline") return OFFLINE_MESSAGE;
  if (failure.kind === "timeout") return TIMEOUT_MESSAGE;
  return noAnswer;
}

/**
 * The words for an error answer from the server. A person who was signed out is told to sign in again; an error nobody
 * expected (or an answer with no error in it) says something went wrong on our side; any other error already has plain
 * words from the server, which are shown as they are.
 */
export function apiErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code === "unauthorized") return SIGNED_OUT_MESSAGE;
  if (!error || error.code === "internal" || !error.message) return SOMETHING_WENT_WRONG_MESSAGE;
  return error.message;
}

import { AppError, configError, rateLimited, tabMissing, unavailable } from "@/lib/errors";

type GoogleLikeError = {
  status?: number | string;
  code?: number | string;
  message?: string;
  response?: { status?: number; data?: unknown };
  config?: unknown;
  cause?: { code?: unknown; name?: unknown };
};

/** What Google says (as a 400) when a request names a tab that is not in the spreadsheet. */
const TAB_GONE = /Unable to parse range|Requested entity was not found/i;

/** What the sign-in step says when the service account key is wrong, revoked or expired. */
const KEY_REJECTED = /invalid_grant|invalid_client|unauthorized_client/i;

/** Error codes of a request that never got an answer: the connection was lost, refused, or timed out. */
const LOST_CONNECTION = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "TimeoutError",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** The client gives up on a slow request by aborting it: its cause is an AbortError, and it carries no code. */
const GAVE_UP_WAITING = /operation was aborted|timed? ?out|fetch failed/i;

const statusOf = (e: GoogleLikeError) => Number(e.status ?? e.response?.status ?? e.code);

const textOf = (value: unknown) => (typeof value === "string" ? value : "");

/** The error code as a word (the code itself, or the code of what caused it), or "" when it is a number. */
const codesOf = (e: GoogleLikeError) => [textOf(e.code), textOf(e.cause?.code)];

/** True when the request got no HTTP answer at all. An answer with a status is never a lost connection. */
function isLostConnection(e: GoogleLikeError): boolean {
  if (Number.isFinite(statusOf(e))) return false;
  return (
    codesOf(e).some((code) => LOST_CONNECTION.has(code)) ||
    ["AbortError", "TimeoutError"].includes(textOf(e.cause?.name)) ||
    GAVE_UP_WAITING.test(e.message ?? "")
  );
}

/** The `error` word in the body of a failed sign-in answer, such as "invalid_grant". */
function answerErrorOf(e: GoogleLikeError): string {
  const data = e.response?.data;
  return typeof data === "object" && data !== null ? textOf((data as { error?: unknown }).error) : "";
}

/**
 * True for a failure that a second try can fix and that is safe to repeat for a read or an idempotent write:
 * Google limiting requests (429), Google failing (5xx), or a connection that was reset. A timeout is not one: it
 * has already used up its share of the time a request is allowed.
 */
export function isTransientGoogleError(error: unknown): boolean {
  if (error instanceof AppError || typeof error !== "object" || error === null) return false;
  const e = error as GoogleLikeError;
  const status = statusOf(e);
  return status === 429 || status >= 500 || codesOf(e).includes("ECONNRESET");
}

/**
 * The tab a Google failure is about, when it is the 400 Google sends for a tab that was deleted or renamed;
 * otherwise null. `tabs` are the tabs the request named. With one tab the answer is that tab. With several,
 * it is the one Google's message names; a message that names none of them gives null rather than a guess.
 */
export function missingTabOf(error: unknown, tabs: string[]): string | null {
  if (error instanceof AppError || typeof error !== "object" || error === null) return null;
  const e = error as GoogleLikeError;
  if (statusOf(e) !== 400 || !TAB_GONE.test(e.message ?? "")) return null;
  if (tabs.length === 1) return tabs[0];
  return tabs.find((tab) => (e.message ?? "").includes(tab)) ?? null;
}

/**
 * Turns a Google API failure into a message the owner can act on.
 *
 * - Errors that are already AppErrors, and plain non-Google errors, pass through.
 * - A 400 that says a range or entity does not exist, for a request that named `tab`, becomes a sheet-structure
 *   error saying that tab was not found (it was deleted or renamed).
 * - A 401, or a sign-in answer of invalid_grant or invalid_client, is a config error: the key was rejected.
 * - A 429 is "rate-limited" and a 5xx or a lost connection is "unavailable": neither is the owner's doing.
 * - Any other error from the Google client is replaced by a plain Error that
 *   keeps only the HTTP status and Google's message. The original carries the
 *   request (its URL holds the Sheet ID, its body can hold tenant names), and
 *   logging it would leak both.
 */
export function translateGoogleError(
  error: unknown,
  serviceAccountEmail?: string,
  tab?: string,
): unknown {
  if (error instanceof AppError || typeof error !== "object" || error === null) return error;
  const e = error as GoogleLikeError;
  const status = statusOf(e);
  const message = e.message ?? "";

  if (tab !== undefined && missingTabOf(error, [tab]) !== null) return tabMissing(tab);

  if (status === 401 || KEY_REJECTED.test(message) || KEY_REJECTED.test(answerErrorOf(e))) {
    return configError(
      "Google rejected the service account key. Create a new key and update GOOGLE_SERVICE_ACCOUNT_JSON.",
    );
  }
  if (status === 400 && /not supported for this document/i.test(message)) {
    return configError(
      "This file is an Excel (.xlsx) file, not a Google Sheet. In Google Drive open it, choose File, Save as Google Sheets, then use the new file's ID as SHEET_ID.",
    );
  }
  if (status === 403) {
    if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(message)) {
      return configError(
        "The Google Sheets API is not enabled for the service account's Cloud project. In Google Cloud Console open APIs & Services, then Library, and enable the Google Sheets API.",
      );
    }
    const reason = message ? ` (${message})` : "";
    return configError(
      serviceAccountEmail
        ? `Google denied access${reason}. Share the Sheet with ${serviceAccountEmail} as Editor.`
        : `Google denied access${reason}. Share the Sheet with the service account as Editor.`,
    );
  }
  if (status === 404) {
    return configError("Google could not find that Sheet. Check SHEET_ID.");
  }
  if (status === 429) return rateLimited();
  if (status >= 500 || isLostConnection(e)) return unavailable();

  const fromGoogleClient = "config" in e || "response" in e || Number.isFinite(status);
  if (fromGoogleClient) {
    const where = Number.isFinite(status) ? ` (HTTP ${status})` : "";
    return new Error(`Google Sheets request failed${where}: ${message || "no details"}`);
  }
  return error;
}

import { AppError, configError } from "@/lib/errors";

type GoogleLikeError = {
  status?: number | string;
  code?: number | string;
  message?: string;
  response?: { status?: number };
  config?: unknown;
};

/**
 * Turns a Google API failure into a message the owner can act on.
 *
 * - Errors that are already AppErrors, and plain non-Google errors, pass through.
 * - Any other error from the Google client is replaced by a plain Error that
 *   keeps only the HTTP status and Google's message. The original carries the
 *   request (its URL holds the Sheet ID, its body can hold tenant names), and
 *   logging it would leak both.
 */
export function translateGoogleError(error: unknown, serviceAccountEmail?: string): unknown {
  if (error instanceof AppError || typeof error !== "object" || error === null) return error;
  const e = error as GoogleLikeError;
  const status = Number(e.status ?? e.response?.status ?? e.code);
  const message = e.message ?? "";

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
  if (status === 429) {
    return configError("Google is limiting requests right now. Wait a minute and try again.");
  }

  const fromGoogleClient = "config" in e || "response" in e || Number.isFinite(status);
  if (fromGoogleClient) {
    const where = Number.isFinite(status) ? ` (HTTP ${status})` : "";
    return new Error(`Google Sheets request failed${where}: ${message || "no details"}`);
  }
  return error;
}

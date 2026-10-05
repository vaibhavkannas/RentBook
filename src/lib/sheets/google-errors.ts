import { AppError, configError } from "@/lib/errors";

type GoogleLikeError = {
  status?: number | string;
  code?: number | string;
  message?: string;
  response?: { status?: number };
};

/**
 * Turns a Google API failure into a message the owner can act on. Errors that
 * are already AppErrors, and anything unrecognised, pass through unchanged.
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
    return configError(
      serviceAccountEmail
        ? `Google denied access. Share the Sheet with ${serviceAccountEmail} as Editor.`
        : "Google denied access. Share the Sheet with the service account as Editor.",
    );
  }
  if (status === 404) {
    return configError("Google could not find that Sheet. Check SHEET_ID.");
  }
  if (status === 429) {
    return configError("Google is limiting requests right now. Wait a minute and try again.");
  }
  return error;
}

export class AppError extends Error {
  constructor(
    readonly code:
      | "unauthorized"
      | "forbidden"
      | "validation"
      | "conflict"
      | "sheet-structure"
      | "config"
      | "rate-limited"
      | "unavailable",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () =>
  new AppError("unauthorized", "Sign in with an allowed Google account.");

export const forbidden = () => new AppError("forbidden", "Only the owner can do that.");

export const validation = (message: string) => new AppError("validation", message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError("conflict", message, details);

export const sheetStructure = (message: string) =>
  new AppError("sheet-structure", message);

export const configError = (message: string) => new AppError("config", message);

/** Google answered 429: too many requests. Waiting a minute helps, so say that. */
export const rateLimited = () =>
  new AppError("rate-limited", "Google is limiting requests right now. Wait a minute and try again.");

/** Google answered 5xx or could not be reached at all. Nothing the owner did; trying again later usually works. */
export const unavailable = () =>
  new AppError("unavailable", "Google isn't responding. Try again in a minute.");

/**
 * What a person who is not the owner is told about a connection problem (a config error): the detail is about
 * the owner's key, Sheet and settings, and is only for the owner and the server log.
 */
export const CONNECTION_NEEDS_ATTENTION = "The Sheet connection needs attention. Ask the owner.";

/** The text of an error for someone who is, or is not, the owner. Only a config error is held back from others. */
export const messageFor = (error: AppError, isOwner: boolean) =>
  error.code === "config" && !isOwner ? CONNECTION_NEEDS_ATTENTION : error.message;

/** A tab the app needs is not in the Sheet: it was deleted or renamed. The owner can put it back. */
export const tabMissing = (tab: string) =>
  sheetStructure(
    `The tab "${tab}" was not found in your Sheet. Restore it from File > Version history or rename it back.`,
  );

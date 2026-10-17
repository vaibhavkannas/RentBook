import { getBrand } from "@/lib/brand";
import { RELOAD_HINT, reloadThen } from "@/lib/recovery-hint";

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
    /** The HTTP status to answer with, when it is not the usual one of the code (415 and 413 are "validation"). */
    readonly status?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () =>
  new AppError("unauthorized", "Sign in with an allowed Google account.");

export const forbidden = () => new AppError("forbidden", "Only the owner can do that.");

/**
 * `field` says which input the message is about (`amount`, `fields.phone`, `portions.0.name`): it goes in the answer's
 * details, so a screen can show the message beside that field.
 */
export const validation = (message: string, field?: string) =>
  new AppError("validation", message, field === undefined ? undefined : { field });

/** The request could not be read: it was not sent as JSON, or its body is not JSON. A person cannot act on more than this. */
export const UNREADABLE_REQUEST_MESSAGE = `That request couldn't be read. ${RELOAD_HINT}`;

/** The request was not sent as JSON. */
export const unsupportedMediaType = () => new AppError("validation", UNREADABLE_REQUEST_MESSAGE, undefined, 415);

/** What a person is told when the page they acted on no longer matches the Sheet (a form without its updated-at). */
export const PAGE_OUT_OF_DATE_MESSAGE = `This page is out of date. ${RELOAD_HINT}`;

/** A portion that is not in Settings: removed or renamed since the page was loaded. The page's id for it means nothing to a person. */
export const unknownPortion = () =>
  validation(`That portion isn't in your Settings any more. ${reloadThen("check the cards")}`);

/** The request body is bigger than any request the app makes. */
export const payloadTooLarge = () => new AppError("validation", "That request is too large.", undefined, 413);

/** The request did not come from the app's own page (another site, or a tool that says so). */
export const crossOriginRequest = () =>
  new AppError("forbidden", `That request didn't come from ${getBrand().name}'s own page. ${RELOAD_HINT}`);

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

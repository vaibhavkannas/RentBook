import "server-only";
import { z } from "zod";
import { validation } from "@/lib/errors";
import type { TenancyLogRow } from "@/lib/domain/tenancy-log";
import type { LogRow } from "@/lib/sheets/service";
import { logRowSchema, tenancyLogRowSchema } from "./schemas";
import { MAX_CLOCK_SKEW_MS, macMatches, sign } from "./signing";

/** How long a retry token is good for: long enough to get past a bad connection, too short to keep for later. */
export const RETRY_TOKEN_MAX_AGE_MS = 15 * 60_000;

/** What a reader says when a token cannot be used, and when it is too old. Neither says which check failed. */
type TokenMessages = { notUsable: string; expired: string };

/**
 * A signed note of something the server did not finish, to be handed back by the browser: base64url(JSON{...payload, viewer,
 * iat}), a dot, and the signature, which is made for `purpose` ("log-retry:"). A token made for one purpose is no good for
 * another. The browser only ever hands it back, so nobody can have the server write a row of their own.
 */
export function createSignedToken(purpose: string, payload: Record<string, unknown>, viewer: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, viewer, iat: now })).toString("base64url");
  return `${body}.${sign(purpose + body)}`;
}

/**
 * The payload inside a token, if the token is genuine for `purpose`, has the shape `schema` describes (plus the person and the
 * time), was made for `viewer` and is not older than 15 minutes. Anything else is a validation error with a plain message, and
 * says nothing about which check failed.
 */
export function readSignedToken<Shape extends z.ZodRawShape>(
  token: string,
  purpose: string,
  schema: z.ZodObject<Shape>,
  viewer: string,
  now: number,
  messages: TokenMessages,
): z.infer<z.ZodObject<Shape>> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw validation(messages.notUsable);
  const [payload, mac] = parts;
  if (!macMatches(purpose + payload, mac)) throw validation(messages.notUsable);

  let parsed: z.infer<z.ZodObject<Shape>> & { viewer: string; iat: number };
  try {
    parsed = schema.extend({ viewer: z.string(), iat: z.number() }).parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))) as typeof parsed;
  } catch {
    throw validation(messages.notUsable);
  }
  if (parsed.viewer !== viewer) throw validation(messages.notUsable);
  const age = now - parsed.iat;
  if (age < -MAX_CLOCK_SKEW_MS) throw validation(messages.notUsable);
  if (age > RETRY_TOKEN_MAX_AGE_MS) throw validation(messages.expired);
  return parsed;
}

const PAYMENTS_PURPOSE = "log-retry:";
const PAYMENTS_MESSAGES: TokenMessages = {
  notUsable: "That retry can't be used. The payment itself is safe in your Schedule.",
  expired: "That retry has expired. Check the Activity screen, and add the Payments Log entry by hand if it is missing.",
};
const paymentsPayload = z.object({ row: logRowSchema });

/** A signed note of the Payments Log row that did not save: the payload is `{ row }`. */
export function createRetryToken(row: LogRow, viewer: string, now = Date.now()): string {
  return createSignedToken(PAYMENTS_PURPOSE, { row }, viewer, now);
}

/**
 * The row inside a retry token, if the token is genuine, was made for `viewer` and is not older than 15 minutes.
 * Anything else is a validation error with a plain message, and says nothing about which check failed.
 */
export function readRetryToken(token: string, viewer: string, now = Date.now()): LogRow {
  return readSignedToken(token, PAYMENTS_PURPOSE, paymentsPayload, viewer, now, PAYMENTS_MESSAGES).row;
}

/**
 * A payment or undo result as the browser gets it: the raw Payments Log row never leaves the server. When the log
 * entry did not save, a retry token takes its place.
 */
export function withRetryToken<T extends { logWritten: boolean; logRow: LogRow }>(
  result: T,
  viewer: string,
): Omit<T, "logRow"> & { retryToken?: string } {
  const { logRow, ...rest } = result;
  return result.logWritten ? rest : { ...rest, retryToken: createRetryToken(logRow, viewer) };
}

/** The most rows one history retry token holds: a save changes a handful of fields, and a token has to fit the request (4 000 characters). */
export const HISTORY_RETRY_MAX_ROWS = 12;

const HISTORY_PURPOSE = "tenancy-log-retry:";
const HISTORY_MESSAGES: TokenMessages = {
  notUsable: "That retry can't be used. The change itself is saved.",
  expired: "That retry has expired. The change itself is saved, but it is not in the History.",
};
const historyPayload = z.object({ rows: z.array(tenancyLogRowSchema).min(1).max(HISTORY_RETRY_MAX_ROWS) });

/** A signed note of the Tenancy Log rows of a save that did not reach the Tenancy Log: the payload is `{ rows }`, 1 to 12 of them. */
export function createHistoryRetryToken(rows: readonly TenancyLogRow[], viewer: string, now = Date.now()): string {
  // The same check a reader makes, so a token that could never be read is never made.
  const checked = historyPayload.parse({ rows });
  return createSignedToken(HISTORY_PURPOSE, checked, viewer, now);
}

/**
 * The rows inside a history retry token, if the token is genuine for the Tenancy Log, was made for `viewer` and is not older
 * than 15 minutes. Anything else is a validation error with a plain message.
 */
export function readHistoryRetryToken(token: string, viewer: string, now = Date.now()): TenancyLogRow[] {
  return readSignedToken(token, HISTORY_PURPOSE, historyPayload, viewer, now, HISTORY_MESSAGES).rows;
}

/**
 * A tenancy or payment result as the browser gets it: the Tenancy Log rows never leave the server (they hold tenancy ids and
 * changed values). When the history did not save and there are rows to retry, a signed token takes their place. A result
 * without these fields passes through as it is. This never throws: the change it describes is saved, and a token that cannot
 * be made (too many rows, no secret) only means no automatic retry.
 */
export function withHistoryToken<T extends object>(
  result: T,
  viewer: string,
): Omit<T, "historyRows"> & { historyRetryToken?: string } {
  if (!("historyWritten" in result) && !("historyRows" in result)) return result;
  const { historyRows, ...rest } = result as T & { historyRows?: TenancyLogRow[] };
  if ((result as { historyWritten?: boolean }).historyWritten !== false || !historyRows || historyRows.length === 0) return rest;
  try {
    return { ...rest, historyRetryToken: createHistoryRetryToken(historyRows, viewer) };
  } catch {
    return rest;
  }
}

import "server-only";
import { z } from "zod";
import { validation } from "@/lib/errors";
import type { LogRow } from "@/lib/sheets/service";
import { logRowSchema } from "./schemas";
import { MAX_CLOCK_SKEW_MS, macMatches, sign } from "./signing";

/** How long a retry token is good for: long enough to get past a bad connection, too short to keep for later. */
export const RETRY_TOKEN_MAX_AGE_MS = 15 * 60_000;

const payloadSchema = z.object({ row: logRowSchema, viewer: z.string(), iat: z.number() });

const PURPOSE = "log-retry:";

const NOT_USABLE = "That retry can't be used. The payment itself is safe in your Schedule.";
const EXPIRED = "That retry has expired. Check the Activity screen, and add the Payments Log entry by hand if it is missing.";

/**
 * A signed note of the Payments Log row that did not save: base64url(JSON{row, viewer, iat}), a dot, and the
 * signature. The browser only ever hands it back, so nobody can have the server write a row of their own.
 */
export function createRetryToken(row: LogRow, viewer: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ row, viewer, iat: now })).toString("base64url");
  return `${payload}.${sign(PURPOSE + payload)}`;
}

/**
 * The row inside a retry token, if the token is genuine, was made for `viewer` and is not older than 15 minutes.
 * Anything else is a validation error with a plain message, and says nothing about which check failed.
 */
export function readRetryToken(token: string, viewer: string, now = Date.now()): LogRow {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw validation(NOT_USABLE);
  const [payload, mac] = parts;
  if (!macMatches(PURPOSE + payload, mac)) throw validation(NOT_USABLE);

  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    throw validation(NOT_USABLE);
  }
  if (parsed.viewer !== viewer) throw validation(NOT_USABLE);
  const age = now - parsed.iat;
  if (age < -MAX_CLOCK_SKEW_MS) throw validation(NOT_USABLE);
  if (age > RETRY_TOKEN_MAX_AGE_MS) throw validation(EXPIRED);
  return parsed.row;
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

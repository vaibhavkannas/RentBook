import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./env";

/**
 * How far ahead of this server's clock a time that was signed (or stamped into a signed session) is still believed.
 * Servers' clocks can differ a little, so a time slightly in the future is fine; one further ahead is refused.
 */
export const MAX_CLOCK_SKEW_MS = 5_000;

/**
 * base64url(HMAC-SHA256(AUTH_SECRET, message)). The caller puts what the signature is for at the front of
 * `message` ("log-retry:..."), so a signature made for one purpose is not good for another.
 * Throws a config error (never showing the secret) when AUTH_SECRET is missing or too short.
 */
export function sign(message: string, env: Record<string, string | undefined> = process.env): string {
  return createHmac("sha256", authSecret(env)).update(message).digest("base64url");
}

/** Whether `mac` is the signature of `message`. Compared in constant time. */
export function macMatches(
  message: string,
  mac: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = Buffer.from(sign(message, env));
  const given = Buffer.from(mac);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

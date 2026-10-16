import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./env";

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

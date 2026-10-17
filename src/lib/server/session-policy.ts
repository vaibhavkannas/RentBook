import "server-only";
import { logEvent } from "./log";
import { MAX_CLOCK_SKEW_MS } from "./signing";

/**
 * How long a sign-in lasts, counted from the moment of signing in. Two things set it, and both are needed:
 * - The cookie's own expiry. Auth.js's `GET /api/auth/session` answers with a renewed cookie (a new expiry, the same
 *   `issuedAt`), and anyone holding a copy of the cookie can ask for that again and again, so on its own the cookie
 *   never runs out. `auth()` without arguments, which getViewer calls, reads the cookie and does not send the renewed
 *   one back, so the app's own pages do not extend it.
 * - `isSessionCurrent`, which getViewer applies on every request and which refuses a session whose `issuedAt` is
 *   more than this long ago. This is what ends a session that is renewed.
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The token of a session with the time it was signed in. A token that already has a time keeps it, whoever asks.
 * A token from before times were kept has none: it gets one the first time Auth.js renews it, so that from then
 * on it counts like any other (and a copy of such a cookie cannot be renewed for ever). While SESSION_NOT_BEFORE is
 * set (`notBefore`) it is left without one on purpose: a session with no time counts as signed in at time zero, so
 * the switch refuses it, and renewing it must not make it look new. A token that is never renewed ends with its
 * own cookie's seven days. `auth()` runs this too, but its renewed cookie is thrown away.
 */
export function stampIssuedAt<T extends Record<string, unknown>>(
  token: T,
  signingIn: boolean,
  now = Date.now(),
  notBefore?: string,
): T {
  const fields: Record<string, unknown> = token;
  if (signingIn || !notBefore?.trim()) fields.issuedAt ??= now;
  return token;
}

/**
 * Whether a session signed in at `issuedAt` (ms since epoch) is still good at `now`.
 * - It is refused once more than SESSION_MAX_AGE_SECONDS have passed since it was signed in, whatever Auth.js does
 *   with its cookie. A sign-in time more than a few seconds ahead of this server's clock is refused too: servers'
 *   clocks differ a little, but a time well in the future would make a session last longer.
 * - It is also refused when `notBefore` (SESSION_NOT_BEFORE) is set and the session was signed in before it: the
 *   "sign everyone out" switch. Set it to a date and time (for example 2026-10-16T10:00:00Z) and redeploy. A session
 *   with no sign-in time counts as signed in at time zero, so it is refused too; while the switch is not set, such a
 *   session is fine (it has no time to measure, and Auth.js ends its cookie), so a deploy never signs anyone out.
 *   A value that cannot be read as a date signs everyone out, and says so in the log without repeating the value:
 *   a switch someone meant to pull must not be ignored because of a typo.
 */
export function isSessionCurrent(issuedAt: unknown, notBefore: string | undefined, now = Date.now()): boolean {
  const signedInAt = typeof issuedAt === "number" && Number.isFinite(issuedAt) ? issuedAt : undefined;
  if (signedInAt !== undefined) {
    if (signedInAt > now + MAX_CLOCK_SKEW_MS) return false;
    if (now - signedInAt > SESSION_MAX_AGE_SECONDS * 1000) return false;
  }
  if (!notBefore?.trim()) return true;
  const cutOff = Date.parse(notBefore.trim());
  if (Number.isNaN(cutOff)) {
    logEvent("error", "session-not-before-unreadable", {
      message: "SESSION_NOT_BEFORE is not a date and time (for example 2026-10-16T10:00:00Z), so every session is refused.",
    });
    return false;
  }
  return (signedInAt ?? 0) >= cutOff;
}

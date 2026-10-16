import "server-only";
import { logEvent } from "./log";

/**
 * How long a sign-in lasts, counted from the moment of signing in. Using the app does not extend it: `auth()` without
 * arguments (as getViewer calls it) reads the cookie and does not send a renewed one back.
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The token of a session with the time it was signed in, when it is being signed in now (`signingIn`). A token
 * that already has a time keeps it. A token from before times were kept is left without one on purpose: that is
 * how SESSION_NOT_BEFORE can still sign it out.
 */
export function stampIssuedAt<T extends Record<string, unknown>>(token: T, signingIn: boolean, now = Date.now()): T {
  const fields: Record<string, unknown> = token;
  if (signingIn) fields.issuedAt ??= now;
  return token;
}

/**
 * Whether a session signed in at `issuedAt` (ms since epoch) is still good, given SESSION_NOT_BEFORE: the "sign
 * everyone out" switch. Set it to a date and time (for example 2026-10-16T10:00:00Z) and redeploy: every session
 * signed in before it is refused. A session with no sign-in time counts as signed in at time zero, so it is
 * refused too; while the switch is not set, such a session is fine, so a deploy never signs anyone out.
 * A value that cannot be read as a date signs everyone out, and says so in the log without repeating the value:
 * a switch someone meant to pull must not be ignored because of a typo.
 */
export function isSessionCurrent(issuedAt: unknown, notBefore: string | undefined): boolean {
  if (!notBefore?.trim()) return true;
  const cutOff = Date.parse(notBefore.trim());
  if (Number.isNaN(cutOff)) {
    logEvent("error", "session-not-before-unreadable", {
      message: "SESSION_NOT_BEFORE is not a date and time (for example 2026-10-16T10:00:00Z), so every session is refused.",
    });
    return false;
  }
  const signedInAt = typeof issuedAt === "number" && Number.isFinite(issuedAt) ? issuedAt : 0;
  return signedInAt >= cutOff;
}

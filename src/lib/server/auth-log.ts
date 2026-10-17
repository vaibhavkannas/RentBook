import "server-only";
import type { NextAuthConfig } from "next-auth";
import { logEvent } from "./log";

// Auth.js's default logger prints an error's stack, its cause and a JSON dump of the cause's data with console.error:
// that data can hold the sign-in provider's reply or a token, and a garbage session cookie is enough to trigger it.
// This one writes a structured line (see log.ts) with the kind of error or the warning code and nothing else.

/** What a kind of error or a warning code looks like: letters, digits, - and _, so it cannot write a line of its own. */
const PLAIN_NAME = /^[A-Za-z0-9_-]{1,60}$/;

const plainName = (value: unknown): string | undefined =>
  typeof value === "string" && PLAIN_NAME.test(value) ? value : undefined;

/** An Auth.js error names its kind in `type` (for example "JWTSessionError"); any other error has its `name`. */
function kindOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { type, name } = error as { type?: unknown; name?: unknown };
  return plainName(type) ?? plainName(name);
}

/**
 * The `logger` option of Auth.js: its errors and warnings become `auth-error` and `auth-warning` lines at level warn
 * (most are a bad or expired session cookie), and its debug output, which holds request detail, is discarded.
 */
export const authLogger: Required<NonNullable<NextAuthConfig["logger"]>> = {
  error(error) {
    const kind = kindOf(error);
    logEvent("warn", "auth-error", {
      code: kind,
      message: kind ? `Auth.js reported ${kind}.` : "Auth.js reported an error.",
    });
  },
  warn(code) {
    const kind = plainName(code);
    logEvent("warn", "auth-warning", {
      code: kind,
      message: kind ? `Auth.js warned: ${kind}.` : "Auth.js gave a warning.",
    });
  },
  debug() {},
};

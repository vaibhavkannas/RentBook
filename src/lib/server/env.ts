import { configError } from "@/lib/errors";

export type AppEnv = {
  serviceAccountJson: string;
  sheetId: string;
  scheduleTab: string;
  totalHeader: string;
  /** Lower-cased, without duplicates (Gmail dot and plus variants count as one). The first address is the owner. */
  allowedEmails: string[];
};

const REQUIRED = ["GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID", "TOTAL_HEADER"] as const;

/** The shortest AUTH_SECRET the app accepts: it signs the sign-in session, the retry token and the freshness cookie. */
export const MIN_AUTH_SECRET_LENGTH = 32;

/** What is wrong with AUTH_SECRET, in words, or null when it is usable. Never contains the value. */
export function authSecretProblem(env: Record<string, string | undefined>): string | null {
  const secret = env.AUTH_SECRET;
  if (!secret?.trim()) return "AUTH_SECRET is missing.";
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    return `AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters.`;
  }
  return null;
}

/** AUTH_SECRET, for signing. A config error (without the value) when it is missing or too short. */
export function authSecret(env: Record<string, string | undefined>): string {
  const problem = authSecretProblem(env);
  if (problem) throw configError(problem);
  return env.AUTH_SECRET!;
}

/**
 * Checks the sign-in settings: AUTH_SECRET (at least 32 characters), AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET. Lists
 * every problem at once, in words, never with a value. This is not part of `readEnv`: the scripts that only read
 * the Sheet (recon, verify:testcopy) have no sign-in settings. The server checks it before it trusts a session,
 * and /api/health reports it.
 */
export function assertAuthConfig(env: Record<string, string | undefined>): void {
  const problems = [authSecretProblem(env)];
  for (const name of ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const) {
    if (!env[name]?.trim()) problems.push(`${name} is missing.`);
  }
  const found = problems.filter((problem): problem is string => problem !== null);
  if (found.length > 0) throw configError(found.join(" "));
}

/**
 * Addresses allowed to sign in, from ALLOWED_EMAILS (commas, spaces or semicolons).
 * The old single ALLOWED_EMAIL is used only when ALLOWED_EMAILS is empty or missing.
 */
export function parseAllowedEmails(env: Record<string, string | undefined>): string[] {
  const raw = env.ALLOWED_EMAILS?.trim() ? env.ALLOWED_EMAILS : env.ALLOWED_EMAIL;
  const emails = (raw ?? "")
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  return emails.filter((email) => {
    const key = canonicalEmail(email);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Reads and checks the environment. Lists every missing variable at once. */
export function readEnv(env: Record<string, string | undefined>): AppEnv {
  const missing: string[] = REQUIRED.filter((name) => !env[name]?.trim());
  const allowedEmails = parseAllowedEmails(env);
  if (allowedEmails.length === 0) missing.push("ALLOWED_EMAILS");
  if (missing.length > 0) {
    throw configError(`Missing environment variables: ${missing.join(", ")}.`);
  }
  return {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON!.trim(),
    sheetId: env.SHEET_ID!.trim(),
    scheduleTab: env.SCHEDULE_TAB?.trim() || "Schedule",
    totalHeader: env.TOTAL_HEADER!.trim(),
    allowedEmails,
  };
}

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Lower-case form used to compare addresses. Gmail ignores dots and "+tags", so they are removed. */
export function canonicalEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at === -1) return value;
  const domain = value.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return value;
  const local = value.slice(0, at).split("+")[0].replace(/\./g, "");
  return `${local}@gmail.com`;
}

/**
 * True only for a listed address that Google has verified. The caller must say whether it is verified: there is no
 * default, so a forgotten argument cannot let an unverified address in.
 */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedEmails: readonly string[],
  emailVerified: boolean,
): boolean {
  if (!email || allowedEmails.length === 0 || emailVerified !== true) return false;
  const wanted = canonicalEmail(email);
  return allowedEmails.some((allowed) => canonicalEmail(allowed) === wanted);
}

/** The owner is the first listed address. */
export function isOwnerEmail(
  email: string | null | undefined,
  allowedEmails: readonly string[],
): boolean {
  return !!email && allowedEmails.length > 0 && canonicalEmail(allowedEmails[0]) === canonicalEmail(email);
}

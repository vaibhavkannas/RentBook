import { configError } from "@/lib/errors";

export type AppEnv = {
  serviceAccountJson: string;
  sheetId: string;
  scheduleTab: string;
  totalHeader: string;
  /** Lower-cased, without duplicates. The first address is the owner. */
  allowedEmails: string[];
};

const REQUIRED = ["GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID", "TOTAL_HEADER"] as const;

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
  return [...new Set(emails)];
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

const norm = (value: string) => value.trim().toLowerCase();

/** True only for a listed address that Google has verified. */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedEmails: readonly string[],
  emailVerified: boolean | null | undefined = true,
): boolean {
  if (!email || allowedEmails.length === 0 || emailVerified === false || emailVerified === null) {
    return false;
  }
  const wanted = norm(email);
  return allowedEmails.some((allowed) => norm(allowed) === wanted);
}

/** The owner is the first listed address. */
export function isOwnerEmail(
  email: string | null | undefined,
  allowedEmails: readonly string[],
): boolean {
  return !!email && allowedEmails.length > 0 && norm(allowedEmails[0]) === norm(email);
}

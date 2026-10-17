import "server-only";
import { configError } from "@/lib/errors";
import { DEFAULT_TAB_NAMES, tabNamesProblem } from "@/lib/sheets/named-tabs";

export type AppEnv = {
  serviceAccountJson: string;
  sheetId: string;
  scheduleTab: string;
  /** The names of the app's own tabs in the owner's Sheet (SETTINGS_TAB, LOG_TAB, TENANTS_TAB): "Settings", "Payments Log" and "Tenants" unless set. */
  settingsTab: string;
  logTab: string;
  tenantsTab: string;
  /** The header of the Schedule's monthly total column, or null when TOTAL_HEADER is not set: then no total is written. */
  totalHeader: string | null;
  /** Lower-cased, without duplicates (Gmail dot and plus variants count as one). The first address is the owner. */
  allowedEmails: string[];
};

const REQUIRED = ["GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID"] as const;

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
 * the Sheet (recon, verify:testcopy) have no sign-in settings. The server checks it before it trusts a session.
 * /api/health does not: it is liveness-only and answers just { ok, version }, without reading any setting or the Sheet.
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

/** The longest title Google allows a tab. */
const MAX_TAB_NAME_LENGTH = 100;

/** A tab name from the environment: trimmed, `fallback` when blank, a config error (naming the variable) when it is too long. */
function tabName(env: Record<string, string | undefined>, variable: string, fallback: string): string {
  const name = env[variable]?.trim() || fallback;
  if (name.length > MAX_TAB_NAME_LENGTH) {
    throw configError(`${variable} is too long: a tab name can have at most ${MAX_TAB_NAME_LENGTH} characters.`);
  }
  return name;
}

/** Reads and checks the environment. Lists every missing variable at once. */
export function readEnv(env: Record<string, string | undefined>): AppEnv {
  const missing: string[] = REQUIRED.filter((name) => !env[name]?.trim());
  const allowedEmails = parseAllowedEmails(env);
  if (allowedEmails.length === 0) missing.push("ALLOWED_EMAILS");
  if (missing.length > 0) {
    throw configError(`Missing environment variables: ${missing.join(", ")}.`);
  }
  const tabs = {
    schedule: tabName(env, "SCHEDULE_TAB", "Schedule"),
    settings: tabName(env, "SETTINGS_TAB", DEFAULT_TAB_NAMES.settings),
    log: tabName(env, "LOG_TAB", DEFAULT_TAB_NAMES.log),
    tenants: tabName(env, "TENANTS_TAB", DEFAULT_TAB_NAMES.tenants),
  };
  const tabsProblem = tabNamesProblem(tabs);
  if (tabsProblem !== null) throw configError(tabsProblem);
  return {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON!.trim(),
    sheetId: env.SHEET_ID!.trim(),
    scheduleTab: tabs.schedule,
    settingsTab: tabs.settings,
    logTab: tabs.log,
    tenantsTab: tabs.tenants,
    totalHeader: env.TOTAL_HEADER?.trim() || null,
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

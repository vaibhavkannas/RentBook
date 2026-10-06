import { configError } from "@/lib/errors";

export type AppEnv = {
  serviceAccountJson: string;
  sheetId: string;
  scheduleTab: string;
  totalHeader: string;
  allowedEmail: string;
};

const REQUIRED = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "SHEET_ID",
  "TOTAL_HEADER",
  "ALLOWED_EMAIL",
] as const;

/** Reads and checks the environment. Lists every missing variable at once. */
export function readEnv(env: Record<string, string | undefined>): AppEnv {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw configError(`Missing environment variables: ${missing.join(", ")}.`);
  }
  return {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON!.trim(),
    sheetId: env.SHEET_ID!.trim(),
    scheduleTab: env.SCHEDULE_TAB?.trim() || "Schedule",
    totalHeader: env.TOTAL_HEADER!.trim(),
    allowedEmail: env.ALLOWED_EMAIL!.trim().toLowerCase(),
  };
}

/** True only for the one allowed, Google-verified email address. */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedEmail: string | undefined,
  emailVerified: boolean | null | undefined = true,
): boolean {
  if (!email || !allowedEmail || emailVerified === false || emailVerified === null) return false;
  return email.trim().toLowerCase() === allowedEmail.trim().toLowerCase();
}

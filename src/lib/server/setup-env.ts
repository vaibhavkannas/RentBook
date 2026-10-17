import "server-only";
import { getBrand } from "@/lib/brand";
import type { Check, CheckStatus, SetupStep } from "@/lib/setup-checks";
import { headerKey } from "@/lib/sheets/headers";
import { DEFAULT_TAB_NAMES } from "@/lib/sheets/named-tabs";
import { CSP_REPORT_ONLY_HEADER, cspHeaderName } from "./csp";
import { DEFAULT_SCHEDULE_TAB, MAX_TAB_NAME_LENGTH, MIN_AUTH_SECRET_LENGTH, parseAllowedEmails } from "./env";

type Env = Record<string, string | undefined>;

function check(id: string, step: SetupStep, title: string, status: CheckStatus, detail: string, fix?: string): Check {
  return { id, step, title, status, detail, ...(fix === undefined ? {} : { fix }) };
}

const isSet = (env: Env, name: string) => Boolean(env[name]?.trim());

/** The check of a setting that must be there, and says only that it is. */
function requiredCheck(env: Env, id: string, step: SetupStep, name: string, fix: string): Check {
  return isSet(env, name) ? check(id, step, name, "ok", "Set.") : check(id, step, name, "fail", "Not set.", fix);
}

function authSecretCheck(env: Env): Check {
  const fix = `Make a random string of at least ${MIN_AUTH_SECRET_LENGTH} characters (SETUP.md step 6) and set AUTH_SECRET.`;
  const secret = env.AUTH_SECRET;
  if (!secret?.trim()) return check("auth-secret", 1, "AUTH_SECRET", "fail", "Not set.", fix);
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    return check("auth-secret", 1, "AUTH_SECRET", "fail", `Shorter than ${MIN_AUTH_SECRET_LENGTH} characters.`, fix);
  }
  return check("auth-secret", 1, "AUTH_SECRET", "ok", "Set.");
}

/** The app's own address: http or https, a host, and nothing after it (no path, query, fragment or sign-in details). */
function isPlainWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function authUrlCheck(env: Env): Check {
  const raw = env.AUTH_URL;
  if (raw === undefined) return check("auth-url", 1, "AUTH_URL", "ok", "Not set: fine on your own computer.");
  const value = raw.trim();
  if (value === "") {
    return check("auth-url", 1, "AUTH_URL", "warn", "Set but empty, which turns off the host check.", "Delete the line.");
  }
  if (!isPlainWebAddress(value)) {
    return check(
      "auth-url",
      1,
      "AUTH_URL",
      "fail",
      "Not a plain web address.",
      "Use the app's address only, such as https://rentbook.example.com, with no path.",
    );
  }
  return check("auth-url", 1, "AUTH_URL", "ok", "Set.");
}

function allowedEmailsCheck(env: Env): Check {
  const emails = parseAllowedEmails(env);
  if (emails.length === 0) {
    return check(
      "allowed-emails",
      1,
      "ALLOWED_EMAILS",
      "fail",
      "Not set.",
      "List the Google addresses that may sign in in ALLOWED_EMAILS, the owner first (SETUP.md step 6).",
    );
  }
  if (!isSet(env, "ALLOWED_EMAILS")) {
    return check(
      "allowed-emails",
      1,
      "ALLOWED_EMAILS",
      "warn",
      "Only the older ALLOWED_EMAIL is set.",
      "Move to ALLOWED_EMAILS (SETUP.md).",
    );
  }
  const detail = emails.length === 1 ? "1 address. It is the owner." : `${emails.length} addresses. The first is the owner.`;
  return check("allowed-emails", 1, "ALLOWED_EMAILS", "ok", detail);
}

function sessionNotBeforeCheck(env: Env): Check {
  const value = env.SESSION_NOT_BEFORE?.trim();
  if (!value) return check("session-not-before", 1, "SESSION_NOT_BEFORE", "ok", "Not set.");
  if (Number.isNaN(Date.parse(value))) {
    return check(
      "session-not-before",
      1,
      "SESSION_NOT_BEFORE",
      "fail",
      "Not a date and time, so everyone is signed out.",
      "Use the form 2026-10-16T10:00:00Z, or delete it.",
    );
  }
  return check("session-not-before", 1, "SESSION_NOT_BEFORE", "ok", "Set: sign-ins from before it are refused.");
}

function cspReportOnlyCheck(env: Env): Check {
  if (cspHeaderName(env) === CSP_REPORT_ONLY_HEADER) {
    return check(
      "csp-report-only",
      1,
      "CSP_REPORT_ONLY",
      "warn",
      "On: the browser only reports what the security policy would block.",
      "Delete it and redeploy once the problem is fixed.",
    );
  }
  const detail = isSet(env, "CSP_REPORT_ONLY")
    ? "Set, but only 1 turns it on: the security policy is enforced."
    : "Not set: the security policy is enforced.";
  return check("csp-report-only", 1, "CSP_REPORT_ONLY", "ok", detail);
}

/** The text of a field of a parsed key when it is a non-blank string, otherwise null. */
const textField = (key: object, name: string): string | null => {
  const value = (key as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

/** A service account's address: one word with an @ in it, not long. Anything else is not shown. */
const ADDRESS = /^[^\s@]{1,100}@[^\s@]{1,100}$/;

/** Reads the key only to say whether it is one and whose it is: no part of it, bar the account's address, is kept. */
function serviceAccountCheck(env: Env): Check {
  const title = "GOOGLE_SERVICE_ACCOUNT_JSON";
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) {
    return check("service-account", 2, title, "fail", "Not set.", "Paste the key file as one line (SETUP.md step 6).");
  }
  let key: unknown;
  try {
    key = JSON.parse(raw);
  } catch {
    // The parse error is dropped on purpose: its text can quote part of the key.
    return check("service-account", 2, title, "fail", "Not valid JSON.", "Paste it as one line, without quotes around it.");
  }
  const email = key !== null && typeof key === "object" ? textField(key, "client_email") : null;
  const privateKey = key !== null && typeof key === "object" ? textField(key, "private_key") : null;
  if (email === null || privateKey === null || !ADDRESS.test(email)) {
    return check(
      "service-account",
      2,
      title,
      "fail",
      "Not a service account key: client_email or private_key is missing.",
      "Create a JSON key (SETUP.md step 3).",
    );
  }
  return check("service-account", 2, title, "ok", `Set. The service account is ${email}.`);
}

function sheetIdCheck(env: Env): Check {
  const title = "SHEET_ID";
  const value = env.SHEET_ID?.trim();
  if (!value) {
    return check("sheet-id", 3, title, "fail", "Not set.", "Copy the ID from the Sheet's address (SETUP.md step 1).");
  }
  if (/[/:]|docs\.google\./i.test(value)) {
    return check("sheet-id", 3, title, "fail", "Looks like a whole address.", "Use only the part between /d/ and /edit.");
  }
  return check("sheet-id", 3, title, "ok", "Set.");
}

type TabSetting = { id: string; step: 4 | 5; name: string; fallback: string };

const TAB_SETTINGS: TabSetting[] = [
  { id: "schedule-tab-name", step: 4, name: "SCHEDULE_TAB", fallback: DEFAULT_SCHEDULE_TAB },
  { id: "settings-tab-name", step: 5, name: "SETTINGS_TAB", fallback: DEFAULT_TAB_NAMES.settings },
  { id: "log-tab-name", step: 5, name: "LOG_TAB", fallback: DEFAULT_TAB_NAMES.log },
  { id: "tenants-tab-name", step: 5, name: "TENANTS_TAB", fallback: DEFAULT_TAB_NAMES.tenants },
];

/** The name a tab setting gives its tab: what is set (trimmed), or the default. */
const tabNameOf = (env: Env, setting: TabSetting) => env[setting.name]?.trim() || setting.fallback;

/**
 * The tab settings, one check each. The same rules as `readEnv` and `tabNamesProblem`, in words and without the names
 * typed: a name longer than a tab can have, two settings that name the same tab (a setting left out names its default),
 * and a Schedule tab named like one of the app's own tabs that has been given another name.
 */
function tabChecks(env: Env): Check[] {
  const names = TAB_SETTINGS.map((setting) => tabNameOf(env, setting));
  const keys = names.map(headerKey);
  return TAB_SETTINGS.map((setting, index) => {
    const { id, step, name, fallback } = setting;
    if (names[index].length > MAX_TAB_NAME_LENGTH) {
      return check(id, step, name, "fail", `Too long: a tab name can have at most ${MAX_TAB_NAME_LENGTH} characters.`, "Use a shorter name.");
    }
    if (keys.some((key, other) => other !== index && key === keys[index])) {
      return check(id, step, name, "fail", "Two names the same.", "Give each a different tab.");
    }
    if (index === 0) {
      // Here no setting names the same tab as the Schedule's, so a setting whose default it matches has been renamed.
      const renamed = TAB_SETTINGS.find((other, at) => at > 0 && headerKey(other.fallback) === keys[0]);
      if (renamed) {
        return check(
          id,
          step,
          name,
          "fail",
          `Named "${renamed.fallback}", the name ${getBrand().name} keeps for its own tab (${renamed.name} gives that tab another name).`,
          "Give your Schedule tab a different name and set SCHEDULE_TAB to it.",
        );
      }
    }
    return env[name]?.trim()
      ? check(id, step, name, "ok", "Set.")
      : check(id, step, name, "ok", `Not set, so "${fallback}" is used.`);
  });
}

function totalHeaderCheck(env: Env): Check {
  return isSet(env, "TOTAL_HEADER")
    ? check("total-header", 4, "TOTAL_HEADER", "ok", "Set.")
    : check("total-header", 4, "TOTAL_HEADER", "ok", "Not set: no total column is kept up to date.");
}

/**
 * One check for each setting the app reads from its environment, in the order of the setup steps. Each says what was found
 * and, for a problem, what to do. No check carries a setting's value: the only text taken from the environment is the
 * address of the service account, which the owner has to share the Sheet with. Reads nothing but `env`.
 */
export function envChecks(env: Env): Check[] {
  const [schedule, settings, log, tenants] = tabChecks(env);
  return [
    authSecretCheck(env),
    requiredCheck(
      env,
      "auth-google-id",
      1,
      "AUTH_GOOGLE_ID",
      "Copy it from your sign-in (OAuth) client in Google Cloud (SETUP.md step 5).",
    ),
    requiredCheck(
      env,
      "auth-google-secret",
      1,
      "AUTH_GOOGLE_SECRET",
      "Copy it from your sign-in (OAuth) client in Google Cloud (SETUP.md step 5).",
    ),
    authUrlCheck(env),
    allowedEmailsCheck(env),
    sessionNotBeforeCheck(env),
    cspReportOnlyCheck(env),
    serviceAccountCheck(env),
    sheetIdCheck(env),
    schedule,
    totalHeaderCheck(env),
    settings,
    log,
    tenants,
  ];
}

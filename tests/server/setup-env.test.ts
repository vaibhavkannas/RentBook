import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/server/env";
import { envChecks } from "@/lib/server/setup-env";
import type { Check } from "@/lib/setup-checks";

// What the Set up page says about the environment: one check for each setting, in plain words, with what to do. It
// never carries a setting's value, except the service account's address, which the owner has to share the Sheet with.

const EMAIL = "rentbook-robot@example-project.iam.gserviceaccount.com";
const KEY = JSON.stringify({
  type: "service_account",
  client_email: EMAIL,
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIE-fake\n-----END PRIVATE KEY-----\n",
});

const GOOD: Record<string, string> = {
  AUTH_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
  AUTH_GOOGLE_ID: "client-id.apps.example.com",
  AUTH_GOOGLE_SECRET: "client-secret",
  ALLOWED_EMAILS: "owner@example.com, member@example.com",
  GOOGLE_SERVICE_ACCOUNT_JSON: KEY,
  SHEET_ID: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
};

const run = (env: Record<string, string | undefined> = {}) => envChecks({ ...GOOD, ...env });

function only(checks: Check[], id: string): Check {
  const found = checks.filter((candidate) => candidate.id === id);
  expect(found, `one check with the id ${id}`).toHaveLength(1);
  return found[0];
}

/** The check for `id`, run with `env` laid over a healthy one. */
const one = (id: string, env: Record<string, string | undefined> = {}) => only(run(env), id);

describe("envChecks, as a whole", () => {
  it("has one check for each setting, each in its step, with the setting's name as its title", () => {
    const checks = run();
    expect(checks.map((entry) => [entry.id, entry.step, entry.title])).toEqual([
      ["auth-secret", 1, "AUTH_SECRET"],
      ["auth-google-id", 1, "AUTH_GOOGLE_ID"],
      ["auth-google-secret", 1, "AUTH_GOOGLE_SECRET"],
      ["auth-url", 1, "AUTH_URL"],
      ["allowed-emails", 1, "ALLOWED_EMAILS"],
      ["session-not-before", 1, "SESSION_NOT_BEFORE"],
      ["csp-report-only", 1, "CSP_REPORT_ONLY"],
      ["service-account", 2, "GOOGLE_SERVICE_ACCOUNT_JSON"],
      ["sheet-id", 3, "SHEET_ID"],
      ["schedule-tab", 4, "SCHEDULE_TAB"],
      ["total-header", 4, "TOTAL_HEADER"],
      ["settings-tab", 5, "SETTINGS_TAB"],
      ["log-tab", 5, "LOG_TAB"],
      ["tenants-tab", 5, "TENANTS_TAB"],
    ]);
  });

  it("finds nothing wrong with a healthy setup, and a fix only where something is", () => {
    for (const entry of run()) {
      expect(entry.status, entry.id).toBe("ok");
      expect(entry.fix, entry.id).toBeUndefined();
    }
    const broken = envChecks({});
    for (const entry of broken) {
      if (entry.status === "fail" || entry.status === "warn") expect(entry.fix, entry.id).toBeTruthy();
      else expect(entry.fix, entry.id).toBeUndefined();
    }
  });

  it("reports an empty environment as the settings that are missing, and nothing more", () => {
    const failing = envChecks({})
      .filter((entry) => entry.status !== "ok")
      .map((entry) => entry.id);
    expect(failing).toEqual([
      "auth-secret",
      "auth-google-id",
      "auth-google-secret",
      "allowed-emails",
      "service-account",
      "sheet-id",
    ]);
    expect(envChecks({}).every((entry) => entry.status === "ok" || entry.status === "fail")).toBe(true);
  });
});

describe("AUTH_SECRET (step 1)", () => {
  const FIX = "Make a random string of at least 32 characters (SETUP.md step 6) and set AUTH_SECRET.";

  it("is fine when it is set and long enough", () => {
    expect(one("auth-secret")).toMatchObject({ status: "ok", detail: "Set." });
    expect(one("auth-secret", { AUTH_SECRET: "x".repeat(32) })).toMatchObject({ status: "ok", detail: "Set." });
  });

  it("must be set", () => {
    for (const value of [undefined, "", "   "]) {
      expect(one("auth-secret", { AUTH_SECRET: value })).toMatchObject({ status: "fail", detail: "Not set.", fix: FIX });
    }
  });

  it("must have at least 32 characters", () => {
    expect(one("auth-secret", { AUTH_SECRET: "x".repeat(31) })).toMatchObject({
      status: "fail",
      detail: "Shorter than 32 characters.",
      fix: FIX,
    });
  });
});

describe("AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET (step 1)", () => {
  it.each(["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"])("%s is fine when it is set", (name) => {
    const id = name === "AUTH_GOOGLE_ID" ? "auth-google-id" : "auth-google-secret";
    expect(one(id)).toMatchObject({ status: "ok", detail: "Set." });
  });

  it.each(["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"])("%s must be set", (name) => {
    const id = name === "AUTH_GOOGLE_ID" ? "auth-google-id" : "auth-google-secret";
    for (const value of [undefined, "", "  "]) {
      expect(one(id, { [name]: value })).toMatchObject({
        status: "fail",
        detail: "Not set.",
        fix: "Copy it from your sign-in (OAuth) client in Google Cloud (SETUP.md step 5).",
      });
    }
  });
});

describe("AUTH_URL (step 1)", () => {
  it("is fine when it is not set: that is right on your own computer", () => {
    expect(one("auth-url")).toMatchObject({ status: "ok", detail: "Not set: fine on your own computer." });
  });

  it("is fine when it is the app's address and nothing more", () => {
    for (const value of ["https://rentbook.example.com", "https://rentbook.example.com/", "http://localhost:3000"]) {
      expect(one("auth-url", { AUTH_URL: value }), value).toMatchObject({ status: "ok", detail: "Set." });
    }
  });

  it("warns when it is set but empty, because that turns off the host check", () => {
    for (const value of ["", "   "]) {
      expect(one("auth-url", { AUTH_URL: value })).toMatchObject({
        status: "warn",
        detail: "Set but empty, which turns off the host check.",
        fix: "Delete the line.",
      });
    }
  });

  it("fails when it is not a plain web address", () => {
    for (const value of [
      "rentbook.example.com",
      "localhost:3000",
      "ftp://rentbook.example.com",
      "https://rentbook.example.com/app",
      "https://rentbook.example.com?x=1",
      "https://rentbook.example.com/#top",
      "https://user:pass@rentbook.example.com",
      "not an address",
    ]) {
      expect(one("auth-url", { AUTH_URL: value }), value).toMatchObject({
        status: "fail",
        detail: "Not a plain web address.",
        fix: "Use the app's address only, such as https://rentbook.example.com, with no path.",
      });
    }
  });
});

describe("ALLOWED_EMAILS (step 1)", () => {
  it("counts the addresses and says the first is the owner", () => {
    expect(one("allowed-emails")).toMatchObject({ status: "ok", detail: "2 addresses. The first is the owner." });
    expect(one("allowed-emails", { ALLOWED_EMAILS: "a@example.com;b@example.com c@example.com" }).detail).toBe(
      "3 addresses. The first is the owner.",
    );
  });

  it("says it right for one address, and counts an address once however it is typed", () => {
    expect(one("allowed-emails", { ALLOWED_EMAILS: "owner@example.com" })).toMatchObject({
      status: "ok",
      detail: "1 address. It is the owner.",
    });
    expect(one("allowed-emails", { ALLOWED_EMAILS: "Owner@Example.com, owner@example.com" }).detail).toBe(
      "1 address. It is the owner.",
    );
  });

  it("warns when only the older ALLOWED_EMAIL is set", () => {
    expect(one("allowed-emails", { ALLOWED_EMAILS: undefined, ALLOWED_EMAIL: "owner@example.com" })).toMatchObject({
      status: "warn",
      detail: "Only the older ALLOWED_EMAIL is set.",
      fix: "Move to ALLOWED_EMAILS (SETUP.md).",
    });
    expect(one("allowed-emails", { ALLOWED_EMAILS: "  ", ALLOWED_EMAIL: "owner@example.com" }).status).toBe("warn");
  });

  it("is not affected by the older ALLOWED_EMAIL when ALLOWED_EMAILS is set", () => {
    expect(one("allowed-emails", { ALLOWED_EMAIL: "old@example.com" })).toMatchObject({
      status: "ok",
      detail: "2 addresses. The first is the owner.",
    });
  });

  it("fails when no address is listed, because nobody could sign in", () => {
    for (const env of [{ ALLOWED_EMAILS: undefined }, { ALLOWED_EMAILS: " ; , " }]) {
      expect(one("allowed-emails", env)).toMatchObject({
        status: "fail",
        detail: "Not set.",
        fix: "List the Google addresses that may sign in in ALLOWED_EMAILS, the owner first (SETUP.md step 6).",
      });
    }
  });
});

describe("SESSION_NOT_BEFORE (step 1)", () => {
  it("is fine when it is not set", () => {
    for (const value of [undefined, "", "  "]) {
      expect(one("session-not-before", { SESSION_NOT_BEFORE: value })).toMatchObject({ status: "ok", detail: "Not set." });
    }
  });

  it("is fine when it is a date and time, and says what it does", () => {
    expect(one("session-not-before", { SESSION_NOT_BEFORE: "2026-10-16T10:00:00Z" })).toMatchObject({
      status: "ok",
      detail: "Set: sign-ins from before it are refused.",
    });
  });

  it("fails when it is not a date and time, because that signs everyone out", () => {
    for (const value of ["yesterday", "not a date", "2026-13-45T99:99:99Z"]) {
      expect(one("session-not-before", { SESSION_NOT_BEFORE: value }), value).toMatchObject({
        status: "fail",
        detail: "Not a date and time, so everyone is signed out.",
        fix: "Use the form 2026-10-16T10:00:00Z, or delete it.",
      });
    }
  });
});

describe("CSP_REPORT_ONLY (step 1)", () => {
  it("is fine when it is not set: the security policy is enforced", () => {
    expect(one("csp-report-only")).toMatchObject({ status: "ok", detail: "Not set: the security policy is enforced." });
  });

  it("warns when it is on, because the browser then blocks nothing", () => {
    for (const value of ["1", " 1 "]) {
      expect(one("csp-report-only", { CSP_REPORT_ONLY: value })).toMatchObject({
        status: "warn",
        detail: "On: the browser only reports what the security policy would block.",
        fix: "Delete it and redeploy once the problem is fixed.",
      });
    }
  });

  it("is fine with any other value, since only 1 turns it on", () => {
    for (const value of ["0", "true", "off", ""]) {
      const found = one("csp-report-only", { CSP_REPORT_ONLY: value });
      expect(found.status, value).toBe("ok");
      expect(found.detail, value).toContain("security policy is enforced");
    }
  });
});

describe("GOOGLE_SERVICE_ACCOUNT_JSON (step 2)", () => {
  it("is fine when it is a service account key, and names the account to share the Sheet with", () => {
    expect(one("service-account")).toMatchObject({
      status: "ok",
      detail: `Set. The service account is ${EMAIL}.`,
    });
  });

  it("must be set", () => {
    for (const value of [undefined, "", "  "]) {
      expect(one("service-account", { GOOGLE_SERVICE_ACCOUNT_JSON: value })).toMatchObject({
        status: "fail",
        detail: "Not set.",
        fix: "Paste the key file as one line (SETUP.md step 6).",
      });
    }
  });

  it("must be JSON", () => {
    for (const value of ["{not json", "client_email: x", `"${KEY.replaceAll('"', '\\"')}`]) {
      expect(one("service-account", { GOOGLE_SERVICE_ACCOUNT_JSON: value }), value).toMatchObject({
        status: "fail",
        detail: "Not valid JSON.",
        fix: "Paste it as one line, without quotes around it.",
      });
    }
  });

  it("must be a service account key, with client_email and private_key", () => {
    for (const value of [
      "{}",
      "null",
      "[]",
      "42",
      '"a string"',
      JSON.stringify({ client_email: EMAIL }),
      JSON.stringify({ private_key: "k" }),
      JSON.stringify({ client_email: 5, private_key: "k" }),
    ]) {
      expect(one("service-account", { GOOGLE_SERVICE_ACCOUNT_JSON: value }), value).toMatchObject({
        status: "fail",
        detail: "Not a service account key: client_email or private_key is missing.",
        fix: "Create a JSON key (SETUP.md step 3).",
      });
    }
  });
});

describe("SHEET_ID (step 3)", () => {
  it("is fine when it is set", () => {
    expect(one("sheet-id")).toMatchObject({ status: "ok", detail: "Set." });
  });

  it("must be set", () => {
    for (const value of [undefined, "", " "]) {
      expect(one("sheet-id", { SHEET_ID: value })).toMatchObject({
        status: "fail",
        detail: "Not set.",
        fix: "Copy the ID from the Sheet's address (SETUP.md step 1).",
      });
    }
  });

  it("must be the ID, not the whole address", () => {
    for (const value of [
      "https://docs.google.com/spreadsheets/d/1AbCdEf/edit#gid=0",
      "docs.google.com/spreadsheets/d/1AbCdEf/edit",
      "d/1AbCdEf/edit",
    ]) {
      expect(one("sheet-id", { SHEET_ID: value }), value).toMatchObject({
        status: "fail",
        detail: "Looks like a whole address.",
        fix: "Use only the part between /d/ and /edit.",
      });
    }
  });
});

describe("the tab and total settings (steps 4 and 5)", () => {
  it.each([
    ["schedule-tab", "SCHEDULE_TAB", "Schedule"],
    ["settings-tab", "SETTINGS_TAB", "Settings"],
    ["log-tab", "LOG_TAB", "Payments Log"],
    ["tenants-tab", "TENANTS_TAB", "Tenants"],
  ])("%s says which name is used when %s is not set", (id, name, fallback) => {
    for (const value of [undefined, "", "  "]) {
      expect(one(id, { [name]: value })).toMatchObject({ status: "ok", detail: `Not set, so "${fallback}" is used.` });
    }
    expect(one(id, { [name]: "My own tab" })).toMatchObject({ status: "ok", detail: "Set." });
  });

  it("TOTAL_HEADER says that without it no total column is kept up to date", () => {
    for (const value of [undefined, "", "  "]) {
      expect(one("total-header", { TOTAL_HEADER: value })).toMatchObject({
        status: "ok",
        detail: "Not set: no total column is kept up to date.",
      });
    }
    expect(one("total-header", { TOTAL_HEADER: "Total Rent" })).toMatchObject({ status: "ok", detail: "Set." });
  });

  it("fails the two tab settings that name the same tab, in any case or spacing", () => {
    const env = { SETTINGS_TAB: "Rent  Data", LOG_TAB: " rent data " };
    for (const id of ["settings-tab", "log-tab"]) {
      expect(one(id, env), id).toMatchObject({
        status: "fail",
        detail: "Two names the same.",
        fix: "Give each a different tab.",
      });
    }
    expect(one("tenants-tab", env).status).toBe("ok");
    expect(one("schedule-tab", env).status).toBe("ok");
  });

  it("counts the name a tab has when its setting is left out: the Schedule tab named Tenants clashes with the Tenants tab", () => {
    const env = { SCHEDULE_TAB: "tenants" };
    expect(one("schedule-tab", env)).toMatchObject({ status: "fail", detail: "Two names the same." });
    expect(one("tenants-tab", env)).toMatchObject({ status: "fail", detail: "Two names the same." });
  });

  it("fails a Schedule tab named like one of the app's own tabs that has been given another name", () => {
    const found = one("schedule-tab", { SCHEDULE_TAB: "Tenants", TENANTS_TAB: "Renters" });
    expect(found.status).toBe("fail");
    expect(found.detail).toContain('"Tenants"');
    expect(found.fix).toBeTruthy();
    expect(one("tenants-tab", { SCHEDULE_TAB: "Tenants", TENANTS_TAB: "Renters" }).status).toBe("ok");
  });

  it("fails a tab name longer than a tab can have", () => {
    for (const [id, name] of [
      ["schedule-tab", "SCHEDULE_TAB"],
      ["settings-tab", "SETTINGS_TAB"],
      ["log-tab", "LOG_TAB"],
      ["tenants-tab", "TENANTS_TAB"],
    ]) {
      expect(one(id, { [name]: "x".repeat(101) }), id).toMatchObject({
        status: "fail",
        detail: "Too long: a tab name can have at most 100 characters.",
      });
      expect(one(id, { [name]: "x".repeat(100) }).status, id).toBe("ok");
    }
  });

  it("agrees with readEnv: wherever readEnv refuses the tab names, one of these checks fails", () => {
    const cases: Record<string, string>[] = [
      { SETTINGS_TAB: "Same", LOG_TAB: "same" },
      { SCHEDULE_TAB: "Tenants" },
      { SCHEDULE_TAB: "Tenants", TENANTS_TAB: "Renters" },
      { LOG_TAB: "x".repeat(101) },
      { TENANTS_TAB: "Schedule" },
    ];
    for (const extra of cases) {
      const env = { ...GOOD, ...extra };
      expect(() => readEnv(env), JSON.stringify(Object.keys(extra))).toThrow();
      const tabChecks = envChecks(env).filter((entry) => entry.step === 4 || entry.step === 5);
      expect(tabChecks.some((entry) => entry.status === "fail"), JSON.stringify(Object.keys(extra))).toBe(true);
    }
    expect(() => readEnv(GOOD)).not.toThrow();
  });
});

describe("what a check may carry", () => {
  const CANARIES = [
    "CANARY-auth-secret-0123456789-0123456789",
    "CANARY-google-id",
    "CANARY-google-secret",
    "canary-owner@example.com",
    "canary-member@example.com",
    "CANARY-sheet-id",
    "CANARY-schedule-tab",
    "CANARY-total-header",
    "CANARY-settings-tab",
    "CANARY-log-tab",
    "CANARY-tenants-tab",
    "CANARY-private-key-material",
    "canary-project-id",
    "canary-key-id",
    "CANARY-host",
  ];
  const [secret, googleId, googleSecret, owner, member, sheetId, schedule, total, settings, log, tenants, privateKey, project, keyId, host] =
    CANARIES;
  const CANARY_EMAIL = "robot@canary-account.iam.gserviceaccount.com";
  const canaryKey = JSON.stringify({
    type: "service_account",
    project_id: project,
    private_key_id: keyId,
    private_key: privateKey,
    client_email: CANARY_EMAIL,
  });

  const healthy = {
    AUTH_SECRET: secret,
    AUTH_GOOGLE_ID: googleId,
    AUTH_GOOGLE_SECRET: googleSecret,
    AUTH_URL: `https://${host}.example.com`,
    ALLOWED_EMAILS: `${owner}, ${member}`,
    SESSION_NOT_BEFORE: "2031-01-01T00:00:00Z",
    CSP_REPORT_ONLY: "CANARY-csp",
    GOOGLE_SERVICE_ACCOUNT_JSON: canaryKey,
    SHEET_ID: sheetId,
    SCHEDULE_TAB: schedule,
    TOTAL_HEADER: total,
    SETTINGS_TAB: settings,
    LOG_TAB: log,
    TENANTS_TAB: tenants,
  };

  /** What every kind of problem looks like with a canary in the value that caused it. */
  const broken: Record<string, string | undefined>[] = [
    { ...healthy, AUTH_SECRET: "CANARY-short" },
    { ...healthy, AUTH_URL: "CANARY-not-an-address" },
    { ...healthy, AUTH_URL: "https://CANARY-host.example.com/with/a/path?q=CANARY" },
    { ...healthy, ALLOWED_EMAILS: undefined, ALLOWED_EMAIL: owner },
    { ...healthy, SESSION_NOT_BEFORE: "CANARY-not-a-date" },
    { ...healthy, CSP_REPORT_ONLY: "1" },
    { ...healthy, GOOGLE_SERVICE_ACCOUNT_JSON: `{CANARY-not-json ${privateKey}` },
    { ...healthy, GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: privateKey, note: "CANARY-no-email" }) },
    { ...healthy, SHEET_ID: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` },
    { ...healthy, SETTINGS_TAB: "CANARY-same", LOG_TAB: "canary-same" },
    { ...healthy, SCHEDULE_TAB: "Tenants" },
    { ...healthy, TENANTS_TAB: `CANARY-${"x".repeat(100)}` },
  ];

  /** The text of the checks, with the one thing that may be there taken out. */
  const text = (env: Record<string, string | undefined>) => JSON.stringify(envChecks(env)).replaceAll(CANARY_EMAIL, "");

  it("is the service account's address, and nothing else from the environment", () => {
    const checks = envChecks(healthy);
    expect(JSON.stringify(checks)).toContain(CANARY_EMAIL);
    expect(only(checks, "service-account").detail).toBe(`Set. The service account is ${CANARY_EMAIL}.`);
    const rest = text(healthy);
    for (const canary of [...CANARIES, "2031", "CANARY-csp"]) expect(rest, canary).not.toContain(canary);
  });

  it("holds no value whatever is wrong with a setting", () => {
    for (const env of broken) {
      const rest = text(env);
      for (const canary of [...CANARIES, "CANARY"]) expect(rest, `${canary} in ${rest}`).not.toContain(canary);
      expect(rest).not.toMatch(/BEGIN PRIVATE KEY|MIIE/);
    }
  });

  it("only ever shows the address of a service account key that has one", () => {
    const withoutEmail = JSON.stringify(
      envChecks({ ...healthy, GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: privateKey }) }),
    );
    expect(withoutEmail).not.toContain("canary-account");
    expect(withoutEmail).not.toContain(privateKey);
  });
});

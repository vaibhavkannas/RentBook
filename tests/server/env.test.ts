import { describe, expect, it } from "vitest";
import {
  assertAuthConfig,
  authSecret,
  canonicalEmail,
  isAllowedEmail,
  isOwnerEmail,
  parseAllowedEmails,
  readEnv,
} from "@/lib/server/env";

describe("parseAllowedEmails", () => {
  it("splits on commas, spaces and semicolons, lower-cases, and removes duplicates", () => {
    expect(
      parseAllowedEmails({ ALLOWED_EMAILS: " Owner@Example.com, member@example.com;  OWNER@example.com\nother@example.com " }),
    ).toEqual(["owner@example.com", "member@example.com", "other@example.com"]);
  });

  it("falls back to ALLOWED_EMAIL only when ALLOWED_EMAILS is empty or missing", () => {
    expect(parseAllowedEmails({ ALLOWED_EMAIL: "Me@Example.com" })).toEqual(["me@example.com"]);
    expect(parseAllowedEmails({ ALLOWED_EMAILS: "  ", ALLOWED_EMAIL: "me@example.com" })).toEqual([
      "me@example.com",
    ]);
    expect(
      parseAllowedEmails({ ALLOWED_EMAILS: "a@example.com", ALLOWED_EMAIL: "me@example.com" }),
    ).toEqual(["a@example.com"]);
  });

  it("returns an empty list when nothing is set", () => {
    expect(parseAllowedEmails({})).toEqual([]);
  });
});

describe("readEnv", () => {
  const base = {
    GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
    SHEET_ID: "abc",
    TOTAL_HEADER: "Per Month",
    ALLOWED_EMAILS: "Owner@Example.com, member@example.com",
  };

  it("reads required values and applies defaults", () => {
    expect(readEnv(base)).toMatchObject({
      sheetId: "abc",
      scheduleTab: "Schedule",
      totalHeader: "Per Month",
      allowedEmails: ["owner@example.com", "member@example.com"],
    });
    expect(readEnv({ ...base, SCHEDULE_TAB: "Rent" }).scheduleTab).toBe("Rent");
  });

  it("still accepts the old single ALLOWED_EMAIL", () => {
    const rest: Record<string, string | undefined> = { ...base };
    delete rest.ALLOWED_EMAILS;
    expect(readEnv({ ...rest, ALLOWED_EMAIL: "Me@Example.com" }).allowedEmails).toEqual([
      "me@example.com",
    ]);
  });

  it("lists every missing variable together", () => {
    expect(() => readEnv({ SHEET_ID: "abc" })).toThrow(
      "Missing environment variables: GOOGLE_SERVICE_ACCOUNT_JSON, ALLOWED_EMAILS.",
    );
  });

  it("does not require TOTAL_HEADER: left out, it is null", () => {
    const rest: Record<string, string | undefined> = { ...base };
    delete rest.TOTAL_HEADER;
    expect(readEnv(rest).totalHeader).toBeNull();
    expect(() => readEnv({ ...rest, GOOGLE_SERVICE_ACCOUNT_JSON: undefined })).toThrow(
      "Missing environment variables: GOOGLE_SERVICE_ACCOUNT_JSON.",
    );
  });

  it("reads a blank or spaces-only TOTAL_HEADER as no total column", () => {
    expect(readEnv({ ...base, TOTAL_HEADER: "" }).totalHeader).toBeNull();
    expect(readEnv({ ...base, TOTAL_HEADER: "   " }).totalHeader).toBeNull();
  });

  it("trims a TOTAL_HEADER that is set", () => {
    expect(readEnv({ ...base, TOTAL_HEADER: "  Per Month " }).totalHeader).toBe("Per Month");
  });

  it("names the app's own tabs Settings, Payments Log and Tenants unless told otherwise", () => {
    expect(readEnv(base)).toMatchObject({ scheduleTab: "Schedule", settingsTab: "Settings", logTab: "Payments Log", tenantsTab: "Tenants" });
  });

  it("reads SETTINGS_TAB, LOG_TAB and TENANTS_TAB, trimmed", () => {
    expect(readEnv({ ...base, SETTINGS_TAB: " Rent Settings ", LOG_TAB: "Rent Log", TENANTS_TAB: "  RentBook Tenants" })).toMatchObject({
      settingsTab: "Rent Settings",
      logTab: "Rent Log",
      tenantsTab: "RentBook Tenants",
    });
  });

  it("takes a blank tab name as not set", () => {
    expect(readEnv({ ...base, SETTINGS_TAB: "", LOG_TAB: "   ", TENANTS_TAB: "\t" })).toMatchObject({
      settingsTab: "Settings",
      logTab: "Payments Log",
      tenantsTab: "Tenants",
    });
  });

  it("accepts a tab name of 100 characters and refuses one of 101, naming the variable", () => {
    expect(readEnv({ ...base, TENANTS_TAB: "t".repeat(100) }).tenantsTab).toBe("t".repeat(100));
    for (const name of ["SCHEDULE_TAB", "SETTINGS_TAB", "LOG_TAB", "TENANTS_TAB"]) {
      expect(() => readEnv({ ...base, [name]: "t".repeat(101) })).toThrow(
        `${name} is too long: a tab name can have at most 100 characters.`,
      );
    }
  });

  it("refuses two of the four tab names that name the same tab, in any case or spacing", () => {
    const said = "SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB and TENANTS_TAB must each name a different tab.";
    expect(() => readEnv({ ...base, TENANTS_TAB: "Schedule" })).toThrow(said);
    expect(() => readEnv({ ...base, SCHEDULE_TAB: "Settings" })).toThrow(said);
    expect(() => readEnv({ ...base, LOG_TAB: "  tenants " })).toThrow(said);
    expect(() => readEnv({ ...base, SETTINGS_TAB: "Payments\u00a0 Log" })).toThrow(said);
    expect(() => readEnv({ ...base, SCHEDULE_TAB: "Rent", SETTINGS_TAB: "rent" })).toThrow(said);
  });

  it("is a config error, so only the owner reads it", () => {
    expect(() => readEnv({ ...base, TENANTS_TAB: "Schedule" })).toThrow(expect.objectContaining({ code: "config" }));
  });

  it("refuses a Schedule named like an app tab that was given another name", () => {
    expect(() => readEnv({ ...base, SCHEDULE_TAB: "Tenants", TENANTS_TAB: "RentBook Tenants" })).toThrow(
      /SCHEDULE_TAB can't be "Tenants"/,
    );
  });

  it("lists missing variables before it looks at tab names", () => {
    expect(() => readEnv({ SHEET_ID: "abc", TENANTS_TAB: "Schedule" })).toThrow(/Missing environment variables/);
  });

  it("treats blank values as missing", () => {
    expect(() => readEnv({ ...base, SHEET_ID: "   " })).toThrow(/SHEET_ID/);
  });

  it("does not ask for the sign-in settings: scripts that only read the Sheet (recon, verify:testcopy) have none", () => {
    expect(() => readEnv(base)).not.toThrow();
    expect(readEnv(base)).not.toHaveProperty("authSecret");
  });
});

describe("assertAuthConfig", () => {
  const good = {
    AUTH_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
    AUTH_GOOGLE_ID: "client-id",
    AUTH_GOOGLE_SECRET: "client-secret",
  };

  it("accepts a secret of 32 characters and both Google values", () => {
    expect(() => assertAuthConfig(good)).not.toThrow();
    expect(() => assertAuthConfig({ ...good, AUTH_SECRET: "x".repeat(32) })).not.toThrow();
  });

  it("refuses a secret of 31 characters, with the length it needs", () => {
    expect(() => assertAuthConfig({ ...good, AUTH_SECRET: "x".repeat(31) })).toThrow(
      "AUTH_SECRET must be at least 32 characters.",
    );
  });

  it("names every problem at once, with a specific message for each", () => {
    expect(() => assertAuthConfig({})).toThrow(
      "AUTH_SECRET is missing. AUTH_GOOGLE_ID is missing. AUTH_GOOGLE_SECRET is missing.",
    );
    expect(() => assertAuthConfig({ ...good, AUTH_GOOGLE_ID: "  ", AUTH_SECRET: "" })).toThrow(
      "AUTH_SECRET is missing. AUTH_GOOGLE_ID is missing.",
    );
    expect(() => assertAuthConfig({ ...good, AUTH_GOOGLE_SECRET: undefined })).toThrow("AUTH_GOOGLE_SECRET is missing.");
  });

  it("is a config error, and never repeats a value", () => {
    const env = { AUTH_SECRET: "hunter2-hunter2", AUTH_GOOGLE_ID: "", AUTH_GOOGLE_SECRET: "" };
    expect.assertions(3);
    try {
      assertAuthConfig(env);
    } catch (error) {
      expect(error).toMatchObject({ code: "config" });
      expect((error as Error).message).not.toContain("hunter2");
      expect((error as Error).message).toContain("at least 32 characters");
    }
  });
});

describe("authSecret", () => {
  it("returns a usable secret as it is, without trimming it", () => {
    const secret = ` ${"x".repeat(40)} `;
    expect(authSecret({ AUTH_SECRET: secret })).toBe(secret);
  });

  it("refuses a missing or short one with a config error that has no value in it", () => {
    expect(() => authSecret({})).toThrow("AUTH_SECRET is missing.");
    expect(() => authSecret({ AUTH_SECRET: "short" })).toThrow("AUTH_SECRET must be at least 32 characters.");
  });
});

describe("isAllowedEmail", () => {
  const allowed = ["owner@example.com", "member@example.com"];

  it("allows only listed, verified addresses (case-insensitive)", () => {
    expect(isAllowedEmail("Owner@Example.com", allowed, true)).toBe(true);
    expect(isAllowedEmail("member@example.com", allowed, true)).toBe(true);
    expect(isAllowedEmail("other@example.com", allowed, true)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, false)).toBe(false);
    expect(isAllowedEmail(undefined, allowed, true)).toBe(false);
    expect(isAllowedEmail("owner@example.com", [], true)).toBe(false);
  });

  it("never treats an address as verified unless the caller says so: the answer is a required argument", () => {
    // @ts-expect-error the verified flag has no default
    expect(isAllowedEmail("owner@example.com", allowed)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, null as unknown as boolean)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, undefined as unknown as boolean)).toBe(false);
  });
});

describe("isOwnerEmail", () => {
  it("is true only for the first listed address", () => {
    const allowed = ["owner@example.com", "member@example.com"];
    expect(isOwnerEmail("OWNER@example.com", allowed)).toBe(true);
    expect(isOwnerEmail("member@example.com", allowed)).toBe(false);
    expect(isOwnerEmail(undefined, allowed)).toBe(false);
    expect(isOwnerEmail("owner@example.com", [])).toBe(false);
  });
});

describe("canonicalEmail", () => {
  it("lower-cases and trims", () => {
    expect(canonicalEmail("  Owner@Example.com ")).toBe("owner@example.com");
  });

  it("ignores dots and +tags in Gmail and Googlemail addresses", () => {
    expect(canonicalEmail("First.Last.S@gmail.com")).toBe("firstlasts@gmail.com");
    expect(canonicalEmail("a.b+rent@googlemail.com")).toBe("ab@gmail.com");
  });

  it("keeps dots and +tags for other domains", () => {
    expect(canonicalEmail("a.b+c@example.com")).toBe("a.b+c@example.com");
  });

  it("leaves text without an @ alone", () => {
    expect(canonicalEmail(" Not An Email ")).toBe("not an email");
  });
});

describe("Gmail variants in the allow-list", () => {
  it("treats dot and plus variants as the same account", () => {
    const allowed = ["firstlast.s@gmail.com", "owner@example.com"];
    expect(isAllowedEmail("first.last.s@gmail.com", allowed, true)).toBe(true);
    expect(isAllowedEmail("Firstlast.S+rent@gmail.com", allowed, true)).toBe(true);
    expect(isAllowedEmail("owner.x@example.com", allowed, true)).toBe(false);
  });

  it("recognises the owner under a different spelling", () => {
    expect(isOwnerEmail("first.last@gmail.com", ["firstlast@gmail.com", "b@example.com"])).toBe(true);
    expect(isOwnerEmail("b@example.com", ["firstlast@gmail.com", "b@example.com"])).toBe(false);
  });

  it("keeps only the first spelling of the same Gmail account when parsing", () => {
    expect(
      parseAllowedEmails({ ALLOWED_EMAILS: "first.last@gmail.com, firstlast@gmail.com, x@example.com" }),
    ).toEqual(["first.last@gmail.com", "x@example.com"]);
  });
});

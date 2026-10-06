import { describe, expect, it } from "vitest";
import {
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
      "Missing environment variables: GOOGLE_SERVICE_ACCOUNT_JSON, TOTAL_HEADER, ALLOWED_EMAILS.",
    );
  });

  it("treats blank values as missing", () => {
    expect(() => readEnv({ ...base, SHEET_ID: "   " })).toThrow(/SHEET_ID/);
  });
});

describe("isAllowedEmail", () => {
  const allowed = ["owner@example.com", "member@example.com"];

  it("allows only listed, verified addresses (case-insensitive)", () => {
    expect(isAllowedEmail("Owner@Example.com", allowed)).toBe(true);
    expect(isAllowedEmail("member@example.com", allowed)).toBe(true);
    expect(isAllowedEmail("other@example.com", allowed)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, false)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, null)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, true)).toBe(true);
    expect(isAllowedEmail(undefined, allowed)).toBe(false);
    expect(isAllowedEmail("owner@example.com", [])).toBe(false);
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
    expect(isAllowedEmail("first.last.s@gmail.com", allowed)).toBe(true);
    expect(isAllowedEmail("Firstlast.S+rent@gmail.com", allowed)).toBe(true);
    expect(isAllowedEmail("owner.x@example.com", allowed)).toBe(false);
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

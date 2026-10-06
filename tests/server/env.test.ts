import { describe, expect, it } from "vitest";
import { isAllowedEmail, readEnv } from "@/lib/server/env";

describe("readEnv", () => {
  const base = {
    GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
    SHEET_ID: "abc",
    TOTAL_HEADER: "Per Month",
    ALLOWED_EMAIL: "Me@Example.com",
  };

  it("reads required values and applies defaults", () => {
    expect(readEnv(base)).toMatchObject({
      sheetId: "abc",
      scheduleTab: "Schedule",
      totalHeader: "Per Month",
      allowedEmail: "me@example.com",
    });
    expect(readEnv({ ...base, SCHEDULE_TAB: "Rent" }).scheduleTab).toBe("Rent");
  });

  it("lists every missing variable together", () => {
    expect(() => readEnv({ SHEET_ID: "abc" })).toThrow(
      "Missing environment variables: GOOGLE_SERVICE_ACCOUNT_JSON, TOTAL_HEADER, ALLOWED_EMAIL.",
    );
  });

  it("treats blank values as missing", () => {
    expect(() => readEnv({ ...base, SHEET_ID: "   " })).toThrow(/SHEET_ID/);
  });
});

describe("isAllowedEmail", () => {
  it("allows only the configured, verified address (case-insensitive)", () => {
    expect(isAllowedEmail("Me@Example.com", "me@example.com")).toBe(true);
    expect(isAllowedEmail("other@example.com", "me@example.com")).toBe(false);
    expect(isAllowedEmail("me@example.com", "me@example.com", false)).toBe(false);
    expect(isAllowedEmail("me@example.com", "me@example.com", null)).toBe(false);
    expect(isAllowedEmail("me@example.com", "me@example.com", true)).toBe(true);
    expect(isAllowedEmail(undefined, "me@example.com")).toBe(false);
    expect(isAllowedEmail("me@example.com", undefined)).toBe(false);
    expect(isAllowedEmail("me@example.com", "")).toBe(false);
  });
});

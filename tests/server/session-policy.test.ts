import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { isSessionCurrent, SESSION_MAX_AGE_SECONDS, stampIssuedAt } from "@/lib/server/session-policy";

const NOW = Date.parse("2026-10-16T10:00:00Z");

describe("SESSION_MAX_AGE_SECONDS", () => {
  it("is seven days", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});

describe("stampIssuedAt", () => {
  it("stamps the time of a sign-in on its new token", () => {
    expect(stampIssuedAt({ email: "a@example.com" }, true, NOW)).toEqual({ email: "a@example.com", issuedAt: NOW });
  });

  it("keeps the time a token already has, even at a sign-in", () => {
    expect(stampIssuedAt({ issuedAt: 5 }, true, NOW).issuedAt).toBe(5);
    expect(stampIssuedAt({ issuedAt: 5 }, false, NOW).issuedAt).toBe(5);
  });

  it("leaves a token from before sign-in times were kept without one, so \"sign everyone out\" can still reach it", () => {
    expect(stampIssuedAt({ email: "a@example.com" }, false, NOW)).toEqual({ email: "a@example.com" });
    expect(stampIssuedAt({}, false, NOW)).not.toHaveProperty("issuedAt");
  });
});

describe("isSessionCurrent", () => {
  let log: MockInstance<typeof console.error>;
  beforeEach(() => {
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  const CUT = "2026-10-16T10:00:00Z";

  it("accepts every session when no cut-off is set, including one with no sign-in time (nobody is signed out on deploy)", () => {
    for (const unset of [undefined, "", "   "]) {
      expect(isSessionCurrent(undefined, unset)).toBe(true);
      expect(isSessionCurrent(0, unset)).toBe(true);
      expect(isSessionCurrent(NOW, unset)).toBe(true);
    }
  });

  it("accepts a session signed in at or after the cut-off and refuses one signed in before it", () => {
    expect(isSessionCurrent(NOW, CUT)).toBe(true);
    expect(isSessionCurrent(NOW + 1, CUT)).toBe(true);
    expect(isSessionCurrent(NOW - 1, CUT)).toBe(false);
  });

  it("counts a session with no sign-in time as signed in at time zero once a cut-off is set", () => {
    expect(isSessionCurrent(undefined, CUT)).toBe(false);
    expect(isSessionCurrent(null, CUT)).toBe(false);
    expect(isSessionCurrent("yesterday", CUT)).toBe(false);
    expect(isSessionCurrent(Number.NaN, CUT)).toBe(false);
  });

  it("reads the cut-off as a date and time, with surrounding spaces and any offset", () => {
    expect(isSessionCurrent(NOW, ` ${CUT} `)).toBe(true);
    expect(isSessionCurrent(NOW, "2026-10-16T15:30:00+05:30")).toBe(true);
    expect(isSessionCurrent(NOW - 1, "2026-10-16T15:30:00+05:30")).toBe(false);
  });

  it("signs everyone out when the cut-off cannot be read, rather than ignore a switch someone meant to pull", () => {
    for (const bad of ["tomorrow", "2026-13-45", "not a date", "NaN"]) {
      expect(isSessionCurrent(NOW, bad)).toBe(false);
      expect(isSessionCurrent(undefined, bad)).toBe(false);
    }
  });

  it("says in the server log when the cut-off cannot be read, without repeating its value", () => {
    isSessionCurrent(NOW, "tomorrow-ish");
    expect(log).toHaveBeenCalled();
    const text = log.mock.calls.flat().join(" ");
    expect(text).toMatch(/SESSION_NOT_BEFORE/);
    expect(text).not.toContain("tomorrow-ish");
  });

  it("logs nothing for a cut-off that reads fine, or for none", () => {
    isSessionCurrent(NOW, CUT);
    isSessionCurrent(NOW, undefined);
    expect(log).not.toHaveBeenCalled();
  });
});

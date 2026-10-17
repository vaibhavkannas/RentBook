import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSessionCurrent, SESSION_MAX_AGE_SECONDS, stampIssuedAt } from "@/lib/server/session-policy";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

const NOW = Date.parse("2026-10-16T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

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

  it("stamps a token from before sign-in times were kept the first time it is renewed, so it can be capped from then on", () => {
    expect(stampIssuedAt({ email: "a@example.com" }, false, NOW)).toEqual({ email: "a@example.com", issuedAt: NOW });
    expect(stampIssuedAt({}, false, NOW, "")).toHaveProperty("issuedAt", NOW);
    expect(stampIssuedAt({}, false, NOW, "   ")).toHaveProperty("issuedAt", NOW);
  });

  it("leaves such a token without a time while SESSION_NOT_BEFORE is set, so \"sign everyone out\" still reaches it", () => {
    expect(stampIssuedAt({ email: "a@example.com" }, false, NOW, "2026-10-16T10:00:00Z")).toEqual({ email: "a@example.com" });
    expect(stampIssuedAt({}, false, NOW, "not a date")).not.toHaveProperty("issuedAt");
  });

  it("still stamps a sign-in while SESSION_NOT_BEFORE is set", () => {
    expect(stampIssuedAt<{ issuedAt?: number }>({}, true, NOW, "2026-10-16T10:00:00Z").issuedAt).toBe(NOW);
  });
});

describe("isSessionCurrent", () => {
  let logs: LogSpies;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => vi.restoreAllMocks());

  const CUT = "2026-10-16T10:00:00Z";

  it("accepts every session that is in time when no cut-off is set, including one with no sign-in time (nobody is signed out on deploy)", () => {
    for (const unset of [undefined, "", "   "]) {
      expect(isSessionCurrent(undefined, unset, NOW)).toBe(true);
      expect(isSessionCurrent(NOW - DAY, unset, NOW)).toBe(true);
      expect(isSessionCurrent(NOW, unset, NOW)).toBe(true);
    }
  });

  it("accepts a session signed in at or after the cut-off and refuses one signed in before it", () => {
    expect(isSessionCurrent(NOW, CUT, NOW)).toBe(true);
    expect(isSessionCurrent(NOW + 1, CUT, NOW)).toBe(true);
    expect(isSessionCurrent(NOW - 1, CUT, NOW)).toBe(false);
  });

  it("counts a session with no sign-in time as signed in at time zero once a cut-off is set", () => {
    expect(isSessionCurrent(undefined, CUT, NOW)).toBe(false);
    expect(isSessionCurrent(null, CUT, NOW)).toBe(false);
    expect(isSessionCurrent("yesterday", CUT, NOW)).toBe(false);
    expect(isSessionCurrent(Number.NaN, CUT, NOW)).toBe(false);
  });

  it("reads the cut-off as a date and time, with surrounding spaces and any offset", () => {
    expect(isSessionCurrent(NOW, ` ${CUT} `, NOW)).toBe(true);
    expect(isSessionCurrent(NOW, "2026-10-16T15:30:00+05:30", NOW)).toBe(true);
    expect(isSessionCurrent(NOW - 1, "2026-10-16T15:30:00+05:30", NOW)).toBe(false);
  });

  it("signs everyone out when the cut-off cannot be read, rather than ignore a switch someone meant to pull", () => {
    for (const bad of ["tomorrow", "2026-13-45", "not a date", "NaN"]) {
      expect(isSessionCurrent(NOW, bad, NOW)).toBe(false);
      expect(isSessionCurrent(undefined, bad, NOW)).toBe(false);
    }
  });

  it("says in the server log, as one error line, when the cut-off cannot be read, without repeating its value", () => {
    isSessionCurrent(NOW, "tomorrow-ish", NOW);
    const lines = loggedLines(logs.error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      event: "session-not-before-unreadable",
      message: expect.stringMatching(/SESSION_NOT_BEFORE/),
    });
    expect(String(logs.error.mock.calls[0][0])).not.toContain("tomorrow-ish");
    expect(logs.info).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it("logs nothing for a cut-off that reads fine, or for none", () => {
    isSessionCurrent(NOW, CUT, NOW);
    isSessionCurrent(NOW, undefined, NOW);
    expect(logs.error).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
    expect(logs.info).not.toHaveBeenCalled();
  });

  describe("how long a session lasts, whatever Auth.js does with its cookie", () => {
    it("accepts a session up to seven days after it was signed in, to the millisecond", () => {
      expect(isSessionCurrent(NOW - MAX_AGE_MS + 1, undefined, NOW)).toBe(true);
      expect(isSessionCurrent(NOW - MAX_AGE_MS, undefined, NOW)).toBe(true);
    });

    it("refuses a session once seven days have passed since it was signed in", () => {
      expect(isSessionCurrent(NOW - MAX_AGE_MS - 1, undefined, NOW)).toBe(false);
      expect(isSessionCurrent(NOW - 30 * DAY, undefined, NOW)).toBe(false);
      expect(isSessionCurrent(0, undefined, NOW)).toBe(false);
    });

    it("counts the age from the sign-in, not from when the cookie was last renewed: a renewed cookie keeps its sign-in time", () => {
      // Auth.js's /api/auth/session re-signs the cookie with a new expiry and the same issuedAt, so the cookie alone never runs out.
      const signedIn = NOW - 6 * DAY;
      expect(isSessionCurrent(signedIn, undefined, NOW)).toBe(true);
      expect(isSessionCurrent(signedIn, undefined, NOW + 2 * DAY)).toBe(false);
    });

    it("refuses a session that is too old even when it is after SESSION_NOT_BEFORE, and one before it even when it is young", () => {
      const cut = new Date(NOW - 10 * DAY).toISOString();
      expect(isSessionCurrent(NOW - MAX_AGE_MS - 1, cut, NOW)).toBe(false);
      expect(isSessionCurrent(NOW - 1, cut, NOW)).toBe(true);
      const recent = new Date(NOW - 1000).toISOString();
      expect(isSessionCurrent(NOW - 2000, recent, NOW)).toBe(false);
      expect(isSessionCurrent(NOW - 500, recent, NOW)).toBe(true);
    });

    it("believes a sign-in time a few seconds ahead of this server's clock, and refuses one further ahead", () => {
      expect(isSessionCurrent(NOW + 5_000, undefined, NOW)).toBe(true);
      expect(isSessionCurrent(NOW + 5_001, undefined, NOW)).toBe(false);
      expect(isSessionCurrent(NOW + DAY, undefined, NOW)).toBe(false);
    });

    it("still accepts a session with no sign-in time when no cut-off is set, because Auth.js expires such a cookie itself", () => {
      expect(isSessionCurrent(undefined, undefined, NOW)).toBe(true);
    });

    it("uses the real clock when it is not given one", () => {
      expect(isSessionCurrent(Date.now(), undefined)).toBe(true);
      expect(isSessionCurrent(Date.now() - MAX_AGE_MS - 60_000, undefined)).toBe(false);
    });

    it("says nothing in the log about a session that is too old", () => {
      isSessionCurrent(NOW - 30 * DAY, undefined, NOW);
      expect(logs.error).not.toHaveBeenCalled();
      expect(logs.warn).not.toHaveBeenCalled();
      expect(logs.info).not.toHaveBeenCalled();
    });
  });
});

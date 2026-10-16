import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));

import { getViewer, requireOwner, requireUser } from "@/lib/server/auth-guard";

const SECRET = "a-test-secret-that-is-at-least-32-characters-long";
const NOW = Date.parse("2026-10-16T10:00:00Z");

const signedInAs = (email: string | null, issuedAt?: number) =>
  auth.mockResolvedValue(email ? { user: { email }, ...(issuedAt === undefined ? {} : { issuedAt }) } : null);

beforeEach(() => {
  vi.stubEnv("ALLOWED_EMAILS", "owner@example.com, member@example.com");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
  vi.stubEnv("SESSION_NOT_BEFORE", "");
  auth.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("getViewer", () => {
  it("returns the signed-in person, lower-cased, and whether they are the owner", async () => {
    signedInAs("Owner@Example.com");
    expect(await getViewer()).toEqual({ email: "owner@example.com", isOwner: true });
    signedInAs("member@example.com");
    expect(await getViewer()).toEqual({ email: "member@example.com", isOwner: false });
  });

  it("returns null for nobody, or for an address that is not on the list", async () => {
    signedInAs(null);
    expect(await getViewer()).toBeNull();
    signedInAs("stranger@example.com");
    expect(await getViewer()).toBeNull();
  });

  describe("the sign-everyone-out switch", () => {
    it("keeps a session that has no sign-in time when the switch is not set: nobody is signed out by a deploy", async () => {
      signedInAs("member@example.com");
      expect(await getViewer()).toMatchObject({ email: "member@example.com" });
      vi.stubEnv("SESSION_NOT_BEFORE", "   ");
      expect(await getViewer()).toMatchObject({ email: "member@example.com" });
    });

    it("keeps a session with a sign-in time when the switch is not set", async () => {
      signedInAs("member@example.com", NOW);
      expect(await getViewer()).not.toBeNull();
    });

    it("signs out a session that has no sign-in time once the switch is set", async () => {
      vi.stubEnv("SESSION_NOT_BEFORE", "2026-10-16T10:00:00Z");
      signedInAs("member@example.com");
      expect(await getViewer()).toBeNull();
    });

    it("signs out a session signed in before the switch and keeps one signed in at or after it", async () => {
      vi.stubEnv("SESSION_NOT_BEFORE", "2026-10-16T10:00:00Z");
      signedInAs("member@example.com", NOW - 1);
      expect(await getViewer()).toBeNull();
      signedInAs("member@example.com", NOW);
      expect(await getViewer()).not.toBeNull();
      signedInAs("owner@example.com", NOW + 60_000);
      expect(await getViewer()).toMatchObject({ isOwner: true });
    });

    it("makes requireUser and requireOwner refuse a signed-out session with 401", async () => {
      vi.stubEnv("SESSION_NOT_BEFORE", "2026-10-16T10:00:00Z");
      signedInAs("owner@example.com", NOW - 1);
      await expect(requireUser()).rejects.toMatchObject({ code: "unauthorized" });
      await expect(requireOwner()).rejects.toMatchObject({ code: "unauthorized" });
    });
  });

  describe("when the sign-in settings are not usable", () => {
    it.each([
      ["AUTH_SECRET is missing", "AUTH_SECRET", "", /AUTH_SECRET is missing/],
      ["AUTH_SECRET is too short", "AUTH_SECRET", "short-secret-0123456789", /AUTH_SECRET must be at least 32 characters/],
      ["AUTH_GOOGLE_ID is missing", "AUTH_GOOGLE_ID", "", /AUTH_GOOGLE_ID is missing/],
      ["AUTH_GOOGLE_SECRET is missing", "AUTH_GOOGLE_SECRET", "", /AUTH_GOOGLE_SECRET is missing/],
    ])("refuses everyone with a config error when %s", async (_name, variable, value, message) => {
      vi.stubEnv(variable, value);
      signedInAs("owner@example.com");
      const error = await getViewer().then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(error).toMatchObject({ code: "config" });
      expect(error!.message).toMatch(message);
      expect(error!.message).not.toContain(value || "unreachable-value");
      expect(auth).not.toHaveBeenCalled();
    });
  });
});

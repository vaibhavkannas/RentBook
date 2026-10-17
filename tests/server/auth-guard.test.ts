import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const connection = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/server", () => ({ connection }));

import { getViewer, requireOwner, requireUser } from "@/lib/server/auth-guard";

const SECRET = "a-test-secret-that-is-at-least-32-characters-long";
const NOW = Date.parse("2026-10-16T10:00:00Z");

const signedInAs = (email: string | null, issuedAt?: number) =>
  auth.mockResolvedValue(email ? { user: { email }, ...(issuedAt === undefined ? {} : { issuedAt }) } : null);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ALLOWED_EMAILS", "owner@example.com, member@example.com");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
  vi.stubEnv("SESSION_NOT_BEFORE", "");
  auth.mockReset();
  connection.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

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

  describe("how long a session lasts", () => {
    const DAY = 24 * 60 * 60 * 1000;

    it("keeps a session signed in six days ago and signs out one signed in more than seven days ago", async () => {
      signedInAs("member@example.com", NOW - 6 * DAY);
      expect(await getViewer()).not.toBeNull();
      signedInAs("member@example.com", NOW - 7 * DAY);
      expect(await getViewer()).not.toBeNull();
      signedInAs("member@example.com", NOW - 7 * DAY - 1);
      expect(await getViewer()).toBeNull();
    });

    it("signs out an old session whose cookie Auth.js keeps renewing, whether or not SESSION_NOT_BEFORE is set", async () => {
      signedInAs("owner@example.com", NOW - 30 * DAY);
      expect(await getViewer()).toBeNull();
      vi.stubEnv("SESSION_NOT_BEFORE", "2026-01-01T00:00:00Z");
      expect(await getViewer()).toBeNull();
    });

    it("makes requireUser and requireOwner refuse it with 401", async () => {
      signedInAs("owner@example.com", NOW - 8 * DAY);
      await expect(requireUser()).rejects.toMatchObject({ code: "unauthorized" });
      await expect(requireOwner()).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("keeps a session with no sign-in time, which Auth.js expires itself, when no switch is set", async () => {
      signedInAs("member@example.com");
      expect(await getViewer()).not.toBeNull();
    });
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
      signedInAs("owner@example.com", NOW + 5_000); // a few seconds ahead of this server: clocks differ a little
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

  // A page that asks who is viewing must render for each request: only then does it receive the request's
  // nonce (see src/proxy.ts). It also keeps `next build` from running the sign-in settings check, which throws
  // when the build machine has no AUTH_ variables, while it tries to build the page ahead of time.
  describe("rendering for each request", () => {
    it("waits for a request first, before it looks at the sign-in settings or the session", async () => {
      signedInAs("member@example.com");
      await getViewer();
      expect(connection).toHaveBeenCalledOnce();
      expect(connection.mock.invocationCallOrder[0]).toBeLessThan(auth.mock.invocationCallOrder[0]);
    });

    it("waits for a request even when the sign-in settings are missing, as on a build machine", async () => {
      for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) vi.stubEnv(name, "");
      await expect(getViewer()).rejects.toMatchObject({ code: "config" });
      expect(connection).toHaveBeenCalledOnce();
    });

    it("does nothing more while it is still waiting: a page being built ahead of time stops here", async () => {
      connection.mockReturnValueOnce(new Promise<void>(() => {}));
      for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) vi.stubEnv(name, "");
      const settled = vi.fn();
      void getViewer().then(settled, settled);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).not.toHaveBeenCalled();
      expect(auth).not.toHaveBeenCalled();
    });

    it.each([
      ["requireUser", requireUser],
      ["requireOwner", requireOwner],
    ])("is the same for %s, which asks getViewer", async (_name, require) => {
      signedInAs("owner@example.com");
      await require();
      expect(connection).toHaveBeenCalledOnce();
    });
  });
});

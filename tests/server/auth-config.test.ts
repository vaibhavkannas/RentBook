import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";
import { authLogger } from "@/lib/server/auth-log";
import { isSessionCurrent } from "@/lib/server/session-policy";

// What src/auth.ts asks Auth.js for: seven-day JWT sessions that remember when they were created, and the
// allow-list at sign-in. Auth.js itself is replaced, so the configuration can be read.

const captured = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/google", () => ({ default: { id: "google" } }));

type Callbacks = Required<NonNullable<NextAuthConfig["callbacks"]>>;
let config: NextAuthConfig;
let callbacks: Callbacks;

beforeAll(async () => {
  vi.stubEnv("ALLOWED_EMAILS", "owner@example.com, member@example.com");
  await import("@/auth");
  config = captured.config as NextAuthConfig;
  callbacks = config.callbacks as Callbacks;
});

const call = <T,>(fn: unknown, args: unknown): T => (fn as (a: unknown) => T)(args);

describe("src/auth.ts", () => {
  it("keeps the session in a JWT cookie for seven days", () => {
    expect(config.session).toEqual({ strategy: "jwt", maxAge: 7 * 24 * 60 * 60 });
  });

  it("stamps a new sign-in with the time, and keeps the time it already has", () => {
    const before = Date.now();
    const stamped = call<{ issuedAt: number }>(callbacks.jwt, { token: { email: "a@example.com" }, trigger: "signIn" });
    expect(stamped.issuedAt).toBeGreaterThanOrEqual(before);
    expect(stamped.issuedAt).toBeLessThanOrEqual(Date.now());
    expect(call<{ issuedAt: number }>(callbacks.jwt, { token: { issuedAt: 7 }, trigger: "signIn" }).issuedAt).toBe(7);
    expect(call<{ issuedAt: number }>(callbacks.jwt, { token: { issuedAt: 7 } }).issuedAt).toBe(7);
  });

  it("stamps a first sign-in of a new user too", () => {
    expect(call<{ issuedAt?: number }>(callbacks.jwt, { token: {}, trigger: "signUp" }).issuedAt).toEqual(expect.any(Number));
  });

  it("stamps a session from before the stamp the first time Auth.js renews it, so it is capped from then on", () => {
    const before = Date.now();
    const stamped = call<{ issuedAt: number }>(callbacks.jwt, { token: { email: "a@example.com" } });
    expect(stamped.issuedAt).toBeGreaterThanOrEqual(before);
    expect(call<{ issuedAt: number }>(callbacks.jwt, { token: { email: "a@example.com" }, trigger: "update" }).issuedAt).toBeGreaterThanOrEqual(before);
    // and a renewal never moves a time the session already has
    expect(call<{ issuedAt: number }>(callbacks.jwt, { token: { issuedAt: 7 }, trigger: "update" }).issuedAt).toBe(7);
  });

  it("does not stamp such a session while SESSION_NOT_BEFORE is set, so \"sign everyone out\" still reaches it", () => {
    vi.stubEnv("SESSION_NOT_BEFORE", "2026-10-16T10:00:00Z");
    try {
      expect(call<object>(callbacks.jwt, { token: { email: "a@example.com" } })).not.toHaveProperty("issuedAt");
      expect(call<{ issuedAt?: number }>(callbacks.jwt, { token: {}, trigger: "signIn" }).issuedAt).toEqual(expect.any(Number));
    } finally {
      vi.stubEnv("SESSION_NOT_BEFORE", undefined);
    }
  });

  it("shows the time on the session", () => {
    const session = { user: { email: "a@example.com" }, expires: "x" };
    expect(call<{ issuedAt?: number }>(callbacks.session, { session, token: { issuedAt: 42 } }).issuedAt).toBe(42);
    expect(call<{ issuedAt?: number }>(callbacks.session, { session, token: {} }).issuedAt).toBeUndefined();
  });

  describe("with Auth.js's own session route, which renews a cookie each time it is asked", () => {
    const SECRET = "a-test-secret-that-is-at-least-32-characters-long";
    const COOKIE = "authjs.session-token";
    const DAY = 24 * 60 * 60 * 1000;

    /** Asks the real GET /api/auth/session with `token` in a cookie, and returns what it sent back. */
    async function renew(token: Record<string, unknown>) {
      const { Auth } = await import("@auth/core");
      const { decode, encode } = await import("@auth/core/jwt");
      const cookie = await encode({ token: { email: "member@example.com", ...token }, secret: SECRET, salt: COOKIE, maxAge: 7 * 24 * 60 * 60 });
      const response = await Auth(
        new Request("http://localhost/api/auth/session", { headers: { cookie: `${COOKIE}=${cookie}` } }),
        { ...config, providers: [], secret: SECRET, trustHost: true, basePath: "/api/auth" },
      );
      const renewed = response.headers.getSetCookie().find((line) => line.startsWith(`${COOKIE}=`));
      const value = renewed?.split(";")[0].slice(COOKIE.length + 1);
      return {
        body: (await response.json()) as { issuedAt?: number } | null,
        payload: value ? await decode({ token: value, secret: SECRET, salt: COOKIE }) : null,
      };
    }

    it("keeps the sign-in time in the renewed cookie, so the age cap still counts from the sign-in", async () => {
      const signedIn = Date.now() - 6 * DAY;
      const { body, payload } = await renew({ issuedAt: signedIn });
      expect(body?.issuedAt).toBe(signedIn);
      expect(payload?.issuedAt).toBe(signedIn);
      // The cookie is good for seven more days, but the session is not: it ends seven days after the sign-in.
      expect(payload?.exp).toBeGreaterThan(Date.now() / 1000 + 6 * 24 * 60 * 60);
      expect(isSessionCurrent(payload?.issuedAt, undefined, Date.now())).toBe(true);
      expect(isSessionCurrent(payload?.issuedAt, undefined, Date.now() + 2 * DAY)).toBe(false);
    });

    it("stamps a cookie from before sign-in times were kept when it renews it, and then caps it", async () => {
      const before = Date.now();
      const { payload } = await renew({});
      expect(payload?.issuedAt).toBeGreaterThanOrEqual(before);
      expect(isSessionCurrent(payload?.issuedAt, undefined, Date.now() + 8 * DAY)).toBe(false);
    });

    it("does not stamp that cookie while SESSION_NOT_BEFORE is set, so it stays refused", async () => {
      vi.stubEnv("SESSION_NOT_BEFORE", "2026-10-16T10:00:00Z");
      try {
        const { payload } = await renew({});
        expect(payload).not.toHaveProperty("issuedAt");
        expect(isSessionCurrent(payload?.issuedAt, process.env.SESSION_NOT_BEFORE, Date.now())).toBe(false);
      } finally {
        vi.stubEnv("SESSION_NOT_BEFORE", undefined);
      }
    });
  });

  it("sends Auth.js's errors and warnings through the structured logger, and keeps its debug output off", () => {
    expect(config.logger).toBe(authLogger);
    expect(Object.keys(config.logger ?? {}).sort()).toEqual(["debug", "error", "warn"]);
  });

  it("lets only a listed address that Google has verified sign in", () => {
    const signIn = (email: string, verified: unknown) => call<boolean>(callbacks.signIn, { profile: { email, email_verified: verified } });
    expect(signIn("member@example.com", true)).toBe(true);
    expect(signIn("member@example.com", false)).toBe(false);
    expect(signIn("member@example.com", undefined)).toBe(false);
    expect(signIn("member@example.com", "true")).toBe(false);
    expect(signIn("stranger@example.com", true)).toBe(false);
    expect(call<boolean>(callbacks.signIn, { profile: undefined })).toBe(false);
  });
});

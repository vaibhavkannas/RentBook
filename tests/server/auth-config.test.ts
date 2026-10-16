import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";

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

  it("does not stamp a session that is only being read, so a session from before the stamp stays recognisable", () => {
    expect(call<object>(callbacks.jwt, { token: { email: "a@example.com" } })).not.toHaveProperty("issuedAt");
    expect(call<object>(callbacks.jwt, { token: { email: "a@example.com" }, trigger: "update" })).not.toHaveProperty("issuedAt");
  });

  it("shows the time on the session", () => {
    const session = { user: { email: "a@example.com" }, expires: "x" };
    expect(call<{ issuedAt?: number }>(callbacks.session, { session, token: { issuedAt: 42 } }).issuedAt).toBe(42);
    expect(call<{ issuedAt?: number }>(callbacks.session, { session, token: {} }).issuedAt).toBeUndefined();
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

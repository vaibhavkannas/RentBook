import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETRY_TOKEN_MAX_AGE_MS, createRetryToken, readRetryToken } from "@/lib/server/retry-token";
import { sign } from "@/lib/server/signing";
import type { LogRow } from "@/lib/sheets/service";

const SECRET = "a-test-secret-that-is-at-least-32-characters-long";
const VIEWER = "member@example.com";
const NOW = Date.parse("2026-10-05T04:30:00Z");
const ROW: LogRow = [
  "2026-10-05T04:30:00.000Z",
  "2026-10",
  "First floor, single bedroom",
  "Asha",
  5450,
  4,
  "2026-10-05",
  VIEWER,
  "Logged",
];

beforeEach(() => vi.stubEnv("AUTH_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

/** A token whose payload says what the caller wants and whose MAC is correct: only the server could make it. */
function signedToken(payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(`log-retry:${body}`)}`;
}

describe("retry token", () => {
  it("carries the row back to the same person", () => {
    const token = createRetryToken(ROW, VIEWER, NOW);
    expect(readRetryToken(token, VIEWER, NOW + 1_000)).toEqual(ROW);
  });

  it("is made of a payload and a MAC, both URL-safe, and short enough for the 2000 character limit", () => {
    const token = createRetryToken(ROW, VIEWER, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThan(2000);
  });

  it("is accepted right up to 15 minutes old and refused after that", () => {
    const token = createRetryToken(ROW, VIEWER, NOW);
    expect(RETRY_TOKEN_MAX_AGE_MS).toBe(15 * 60_000);
    expect(readRetryToken(token, VIEWER, NOW + RETRY_TOKEN_MAX_AGE_MS)).toEqual(ROW);
    expect(() => readRetryToken(token, VIEWER, NOW + RETRY_TOKEN_MAX_AGE_MS + 1)).toThrow(/expired/);
  });

  it("is refused when it claims to come from the future", () => {
    const token = createRetryToken(ROW, VIEWER, NOW + 60_000);
    expect(() => readRetryToken(token, VIEWER, NOW)).toThrow(/can't be used/);
  });

  it("is refused for anyone but the person it was made for", () => {
    const token = createRetryToken(ROW, VIEWER, NOW);
    expect(() => readRetryToken(token, "owner@example.com", NOW)).toThrow(/can't be used/);
  });

  it("is refused when the payload was changed, even by one character", () => {
    const [payload, mac] = createRetryToken(ROW, VIEWER, NOW).split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    edited.row[4] = 999999;
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${mac}`;
    expect(() => readRetryToken(forged, VIEWER, NOW)).toThrow(/can't be used/);
  });

  it("is refused when the MAC was changed or cut short", () => {
    const [payload, mac] = createRetryToken(ROW, VIEWER, NOW).split(".");
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    for (const bad of [flipped, mac.slice(0, -2), "", `${mac}A`]) {
      expect(() => readRetryToken(`${payload}.${bad}`, VIEWER, NOW)).toThrow(/can't be used/);
    }
  });

  it("is refused when it was signed with another secret", () => {
    const token = createRetryToken(ROW, VIEWER, NOW);
    vi.stubEnv("AUTH_SECRET", "another-secret-that-is-also-32-characters-long");
    expect(() => readRetryToken(token, VIEWER, NOW)).toThrow(/can't be used/);
  });

  it("is refused when it is not shaped like a token", () => {
    for (const bad of ["", ".", "abc", "a.b.c", "a.b.", ".b", "not a token at all"]) {
      expect(() => readRetryToken(bad, VIEWER, NOW)).toThrow(/can't be used/);
    }
  });

  it("is refused when the signed payload is not a log row, a person and a time", () => {
    const good = { row: ROW, viewer: VIEWER, iat: NOW };
    expect(readRetryToken(signedToken(good), VIEWER, NOW)).toEqual(ROW);
    for (const bad of [
      { ...good, row: ROW.slice(0, 8) },
      { ...good, row: [...ROW.slice(0, 8), "Deleted"] },
      { ...good, viewer: 5 },
      { ...good, iat: "now" },
      { row: ROW },
      "text",
      null,
    ]) {
      expect(() => readRetryToken(signedToken(bad), VIEWER, NOW)).toThrow(/can't be used/);
    }
  });

  it("does not throw anything but a plain validation error for a bad token", () => {
    expect.assertions(1);
    try {
      readRetryToken("garbage", VIEWER, NOW);
    } catch (error) {
      expect(error).toMatchObject({ code: "validation" });
    }
  });

  it("cannot be made or read when AUTH_SECRET is missing or short", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => createRetryToken(ROW, VIEWER, NOW)).toThrow(/AUTH_SECRET/);
    vi.stubEnv("AUTH_SECRET", "too-short");
    expect(() => readRetryToken("a.b", VIEWER, NOW)).toThrow(/AUTH_SECRET/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyLogRow } from "@/lib/domain/tenancy-log";
import {
  HISTORY_RETRY_MAX_ROWS,
  RETRY_TOKEN_MAX_AGE_MS,
  createHistoryRetryToken,
  createRetryToken,
  createSignedToken,
  readHistoryRetryToken,
  readRetryToken,
  readSignedToken,
  withHistoryToken,
  withRetryToken,
} from "@/lib/server/retry-token";
import { sign } from "@/lib/server/signing";
import type { LogRow } from "@/lib/sheets/service";
import { z } from "zod";

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

/**
 * What createRetryToken(ROW, VIEWER, NOW) gave under SECRET before the token code was made general (for the Tenancy Log's
 * retry): a token a browser holds when this deployment is updated must still be read, so the string must not change.
 */
const PAYMENTS_TOKEN_BEFORE =
  "eyJyb3ciOlsiMjAyNi0xMC0wNVQwNDozMDowMC4wMDBaIiwiMjAyNi0xMCIsIkZpcnN0IGZsb29yLCBzaW5nbGUgYmVkcm9vbSIsIkFzaGEiLDU0NTAsNCwiMjAyNi0xMC0wNSIsIm1lbWJlckBleGFtcGxlLmNvbSIsIkxvZ2dlZCJdLCJ2aWV3ZXIiOiJtZW1iZXJAZXhhbXBsZS5jb20iLCJpYXQiOjE3OTExNzQ2MDAwMDB9.n7LUj84j2uY1GFJD65nxAXqtaSh09MVAs3PRK-eANl4";

beforeEach(() => vi.stubEnv("AUTH_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

/** A token whose payload says what the caller wants and whose MAC is correct: only the server could make it. */
function signedToken(payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(`log-retry:${body}`)}`;
}

describe("retry token", () => {
  it("is, for fixed inputs, exactly the string it was before the refactor", () => {
    expect(createRetryToken(ROW, VIEWER, NOW)).toBe(PAYMENTS_TOKEN_BEFORE);
    expect(readRetryToken(PAYMENTS_TOKEN_BEFORE, VIEWER, NOW + 1_000)).toEqual(ROW);
  });

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

describe("signed tokens in general", () => {
  const shape = z.object({ note: z.string() });
  const MESSAGES = { notUsable: "Not usable.", expired: "Expired." };

  it("carries the payload, the person and the time, signed for one purpose", () => {
    const token = createSignedToken("demo:", { note: "hello" }, VIEWER, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [payload] = token.split(".");
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({ note: "hello", viewer: VIEWER, iat: NOW });
    expect(readSignedToken(token, "demo:", shape, VIEWER, NOW + 1, MESSAGES)).toMatchObject({ note: "hello" });
  });

  it("is refused under another purpose: a signature made for one is no good for another", () => {
    const token = createSignedToken("demo:", { note: "hello" }, VIEWER, NOW);
    expect(() => readSignedToken(token, "other:", shape, VIEWER, NOW, MESSAGES)).toThrow("Not usable.");
  });

  it("says what it is given when the token is not usable or too old, and nothing about which check failed", () => {
    const token = createSignedToken("demo:", { note: "hello" }, VIEWER, NOW);
    expect(() => readSignedToken(token, "demo:", shape, "owner@example.com", NOW, MESSAGES)).toThrow("Not usable.");
    expect(() => readSignedToken(token, "demo:", shape, VIEWER, NOW + RETRY_TOKEN_MAX_AGE_MS + 1, MESSAGES)).toThrow("Expired.");
    expect(() => readSignedToken("garbage", "demo:", shape, VIEWER, NOW, MESSAGES)).toThrow("Not usable.");
  });

  it("is refused when the payload does not have the shape asked for", () => {
    const token = createSignedToken("demo:", { note: 5 }, VIEWER, NOW);
    expect(() => readSignedToken(token, "demo:", shape, VIEWER, NOW, MESSAGES)).toThrow("Not usable.");
  });
});

const HISTORY_ROWS: TenancyLogRow[] = [
  ["2026-11-03T09:30:00.000Z", "t-1", "p1", "Edited", "Phone", "", "", VIEWER],
  ["2026-11-03T09:30:00.000Z", "t-1", "p1", "Edited", "Agreement end", "2027-01-14", "2027-03-31", VIEWER],
  ["2026-11-03T09:30:00.000Z", "t-1", "p1", "Edited", "Advance", 20000, "", VIEWER],
];

function signedHistoryToken(payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(`tenancy-log-retry:${body}`)}`;
}

describe("history retry token", () => {
  it("carries the rows back to the same person", () => {
    const token = createHistoryRetryToken(HISTORY_ROWS, VIEWER, NOW);
    expect(readHistoryRetryToken(token, VIEWER, NOW + 1_000)).toEqual(HISTORY_ROWS);
  });

  it("is URL-safe and fits the 4000 character limit of the request even with the most rows allowed", () => {
    expect(HISTORY_RETRY_MAX_ROWS).toBe(12);
    const many = Array.from({ length: 12 }, (_, index): TenancyLogRow => [
      "2026-11-03T09:30:00.000Z",
      "t-00000000-0000-4000-8000-000000000001",
      "p1",
      "Edited",
      "Agreement end",
      `2027-01-${String(index + 10)}`,
      "2027-03-31",
      "a-fairly-long-address-for-a-member@example.com",
    ]);
    const token = createHistoryRetryToken(many, "a-fairly-long-address-for-a-member@example.com", NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThan(4_000);
  });

  it("is accepted right up to 15 minutes old and refused after that, in words about the history", () => {
    const token = createHistoryRetryToken(HISTORY_ROWS, VIEWER, NOW);
    expect(readHistoryRetryToken(token, VIEWER, NOW + RETRY_TOKEN_MAX_AGE_MS)).toEqual(HISTORY_ROWS);
    expect(() => readHistoryRetryToken(token, VIEWER, NOW + RETRY_TOKEN_MAX_AGE_MS + 1)).toThrow(/expired/);
  });

  it("is refused when it claims to come from the future, and for anyone but the person it was made for", () => {
    expect(() => readHistoryRetryToken(createHistoryRetryToken(HISTORY_ROWS, VIEWER, NOW + 60_000), VIEWER, NOW)).toThrow(/can't be used/);
    expect(() => readHistoryRetryToken(createHistoryRetryToken(HISTORY_ROWS, VIEWER, NOW), "owner@example.com", NOW)).toThrow(/can't be used/);
  });

  it("is refused when the payload or the MAC was changed", () => {
    const [payload, mac] = createHistoryRetryToken(HISTORY_ROWS, VIEWER, NOW).split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    edited.rows[1][6] = "2099-01-01";
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${mac}`;
    expect(() => readHistoryRetryToken(forged, VIEWER, NOW)).toThrow(/can't be used/);
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    for (const bad of [flipped, mac.slice(0, -2), "", `${mac}A`]) {
      expect(() => readHistoryRetryToken(`${payload}.${bad}`, VIEWER, NOW)).toThrow(/can't be used/);
    }
  });

  it("is refused when it was signed with another secret, or is not shaped like a token", () => {
    const token = createHistoryRetryToken(HISTORY_ROWS, VIEWER, NOW);
    vi.stubEnv("AUTH_SECRET", "another-secret-that-is-also-32-characters-long");
    expect(() => readHistoryRetryToken(token, VIEWER, NOW)).toThrow(/can't be used/);
    for (const bad of ["", ".", "abc", "a.b.c", "not a token at all"]) {
      expect(() => readHistoryRetryToken(bad, VIEWER, NOW)).toThrow(/can't be used/);
    }
  });

  it("holds from 1 to 12 rows, each a Tenancy Log row", () => {
    const good = { rows: HISTORY_ROWS, viewer: VIEWER, iat: NOW };
    expect(readHistoryRetryToken(signedHistoryToken(good), VIEWER, NOW)).toEqual(HISTORY_ROWS);
    for (const bad of [
      { ...good, rows: [] },
      { ...good, rows: Array.from({ length: 13 }, () => HISTORY_ROWS[0]) },
      { ...good, rows: [HISTORY_ROWS[0].slice(0, 7)] },
      { ...good, rows: [[...HISTORY_ROWS[0].slice(0, 3), "Deleted", ...HISTORY_ROWS[0].slice(4)]] },
      { ...good, rows: [[...HISTORY_ROWS[0].slice(0, 5), { phone: "x" }, ...HISTORY_ROWS[0].slice(6)]] },
      { ...good, rows: "text" },
      { ...good, viewer: 5 },
      { ...good, iat: "now" },
      { rows: HISTORY_ROWS },
      null,
    ]) {
      expect(() => readHistoryRetryToken(signedHistoryToken(bad), VIEWER, NOW)).toThrow(/can't be used/);
    }
    expect(readHistoryRetryToken(signedHistoryToken({ ...good, rows: Array.from({ length: 12 }, () => HISTORY_ROWS[0]) }), VIEWER, NOW)).toHaveLength(12);
  });

  it("is not accepted as a payments retry, and a payments retry is not accepted as one", () => {
    const history = createHistoryRetryToken(HISTORY_ROWS, VIEWER, NOW);
    const payments = createRetryToken(ROW, VIEWER, NOW);
    expect(() => readRetryToken(history, VIEWER, NOW)).toThrow(/can't be used/);
    expect(() => readHistoryRetryToken(payments, VIEWER, NOW)).toThrow(/can't be used/);
    // not even by presenting the payload under the other purpose's signature
    const [payload] = history.split(".");
    expect(() => readRetryToken(`${payload}.${sign(`tenancy-log-retry:${payload}`)}`, VIEWER, NOW)).toThrow(/can't be used/);
  });

  it("can only be made for 1 to 12 rows", () => {
    expect(() => createHistoryRetryToken([], VIEWER, NOW)).toThrow();
    expect(() => createHistoryRetryToken(Array.from({ length: 13 }, () => HISTORY_ROWS[0]), VIEWER, NOW)).toThrow();
  });
});

describe("withHistoryToken", () => {
  const written = { tenancy: { id: "t-1" }, historyWritten: true, historyRows: HISTORY_ROWS };
  const failed = { tenancy: { id: "t-1" }, historyWritten: false, historyRows: HISTORY_ROWS };

  it("passes a result that has neither field through unchanged", () => {
    const plain = { tenancy: { id: "t-1" } };
    expect(withHistoryToken(plain, VIEWER)).toBe(plain);
    const payment = { logWritten: true, entry: { tenant: "Asha", count: 4, amount: 5450 } };
    expect(withHistoryToken(payment, VIEWER)).toBe(payment);
  });

  it("drops the rows and adds no token when the history was written", () => {
    expect(withHistoryToken(written, VIEWER)).toEqual({ tenancy: { id: "t-1" }, historyWritten: true });
    expect(withHistoryToken({ ...written, historyRows: [] }, VIEWER)).toEqual({ tenancy: { id: "t-1" }, historyWritten: true });
  });

  it("gives a token for the rows, and not the rows, when the history was not written", () => {
    const answer = withHistoryToken(failed, VIEWER) as Record<string, unknown>;
    expect(answer).not.toHaveProperty("historyRows");
    expect(answer).toMatchObject({ tenancy: { id: "t-1" }, historyWritten: false });
    expect(typeof answer.historyRetryToken).toBe("string");
    expect(readHistoryRetryToken(answer.historyRetryToken as string, VIEWER)).toEqual(HISTORY_ROWS);
    expect(JSON.stringify(answer)).not.toContain("Agreement end");
  });

  it("gives no token when the history was not written but there are no rows to retry", () => {
    for (const rows of [[], undefined]) {
      const answer = withHistoryToken({ tenancy: { id: "t-1" }, historyWritten: false, historyRows: rows }, VIEWER);
      expect(answer).toEqual({ tenancy: { id: "t-1" }, historyWritten: false });
    }
  });

  it("gives no token, and does not throw, for more rows than a token holds", () => {
    const many = Array.from({ length: 13 }, () => HISTORY_ROWS[0]);
    expect(withHistoryToken({ historyWritten: false, historyRows: many }, VIEWER)).toEqual({ historyWritten: false });
  });

  it("does not throw when the token cannot be made", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(withHistoryToken(failed, VIEWER)).toEqual({ tenancy: { id: "t-1" }, historyWritten: false });
  });

  it("works after withRetryToken for a payment: the log row and the history rows both turn into tokens", () => {
    const result = { logWritten: false, logRow: ROW, historyWritten: false, historyRows: HISTORY_ROWS, entry: { tenant: "Asha" } };
    const answer = withHistoryToken(withRetryToken(result, VIEWER), VIEWER) as Record<string, unknown>;
    expect(answer).not.toHaveProperty("logRow");
    expect(answer).not.toHaveProperty("historyRows");
    expect(typeof answer.retryToken).toBe("string");
    expect(typeof answer.historyRetryToken).toBe("string");
  });
});

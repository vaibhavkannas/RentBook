import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, conflict, rateLimited } from "@/lib/errors";
import { describeError, logEvent, messageForLog, requestIdFrom } from "@/lib/server/log";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ALL = {
  requestId: "req-1",
  route: "/api/payments",
  code: "conflict",
  message: "The page was out of date.",
  viewer: "owner@example.com",
};

describe("logEvent", () => {
  it("writes exactly one JSON line with ts, level, event, requestId, route, code, message and viewer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T05:30:00.000Z"));
    logEvent("info", "api-error", ALL);
    expect(logs.info).toHaveBeenCalledTimes(1);
    const [line] = logs.info.mock.calls[0];
    expect(typeof line).toBe("string");
    expect(String(line)).not.toContain("\n");
    expect(JSON.parse(String(line))).toEqual({
      ts: "2026-10-16T05:30:00.000Z",
      level: "info",
      event: "api-error",
      ...ALL,
    });
    expect(Object.keys(JSON.parse(String(line)))).toEqual([
      "ts",
      "level",
      "event",
      "requestId",
      "route",
      "code",
      "message",
      "viewer",
    ]);
  });

  it("writes an info line with console.info, a warn line with console.warn and an error line with console.error", () => {
    logEvent("info", "a");
    logEvent("warn", "b");
    logEvent("error", "c");
    expect(loggedLines(logs.info).map((line) => line.event)).toEqual(["a"]);
    expect(loggedLines(logs.warn).map((line) => line.event)).toEqual(["b"]);
    expect(loggedLines(logs.error).map((line) => line.event)).toEqual(["c"]);
    expect(loggedLines(logs.info)[0].level).toBe("info");
    expect(loggedLines(logs.warn)[0].level).toBe("warn");
    expect(loggedLines(logs.error)[0].level).toBe("error");
  });

  it("leaves out a field it was not given, the viewer above all", () => {
    logEvent("error", "x", { requestId: "req-2", code: "internal" });
    const [line] = loggedLines(logs.error);
    expect(Object.keys(line)).toEqual(["ts", "level", "event", "requestId", "code"]);
    expect(line).not.toHaveProperty("viewer");
  });

  it("writes the viewer as a lower-cased address", () => {
    logEvent("info", "x", { viewer: "  Owner@Example.COM " });
    expect(loggedLines(logs.info)[0].viewer).toBe("owner@example.com");
  });

  it("keeps anything that is not on the list of fields out of the line, even when it is passed by mistake", () => {
    const mistaken = {
      ...ALL,
      body: { tenantName: "Asha Verma", phone: "98765 43210", amount: 5450 },
      tenant: "Asha Verma",
      phone: "98765 43210",
      token: "eyJhbGciOiJIUzI1NiJ9.secret",
      authorization: "Bearer abc",
      headers: { cookie: "session=abc" },
      details: { existingTenant: "Asha Verma" },
    };
    logEvent("error", "x", mistaken as never);
    const [line] = loggedLines(logs.error);
    expect(Object.keys(line)).toEqual(["ts", "level", "event", "requestId", "route", "code", "message", "viewer"]);
    const text = String(logs.error.mock.calls[0][0]);
    for (const secret of ["Asha", "98765", "eyJhbGci", "Bearer", "session=abc", "5450"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("drops a listed field that is not text, so an object cannot smuggle a body in through it", () => {
    logEvent("error", "x", { ...ALL, message: { tenant: "Asha" }, code: 500, viewer: ["a@example.com"] } as never);
    const [line] = loggedLines(logs.error);
    expect(line).not.toHaveProperty("message");
    expect(line).not.toHaveProperty("code");
    expect(line).not.toHaveProperty("viewer");
    expect(String(logs.error.mock.calls[0][0])).not.toContain("Asha");
  });

  it("cuts a query string or fragment off the route, since it can carry a token", () => {
    logEvent("info", "x", { route: "/api/payments/log-retry?token=abc.def#frag" });
    expect(loggedLines(logs.info)[0].route).toBe("/api/payments/log-retry");
  });

  it("stays one line when the message has line breaks, and keeps them as \\n inside the JSON", () => {
    logEvent("error", "x", { message: "first\nsecond\r\nthird" });
    const [line] = loggedLines(logs.error);
    expect(line.message).toBe("first\nsecond\r\nthird");
  });

  it("shortens a very long message", () => {
    logEvent("error", "x", { message: "a".repeat(5000) });
    const message = String(loggedLines(logs.error)[0].message);
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message.endsWith("…")).toBe(true);
  });
});

describe("requestIdFrom", () => {
  it("uses the id Vercel gave the request", () => {
    expect(requestIdFrom("iad1::sfo1::abcde-1760592600000-0123456789ab")).toBe("iad1::sfo1::abcde-1760592600000-0123456789ab");
  });

  it("makes a new id, a UUID, when there is none", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(requestIdFrom(null)).toMatch(uuid);
    expect(requestIdFrom(undefined)).toMatch(uuid);
    expect(requestIdFrom("")).toMatch(uuid);
    expect(requestIdFrom(null)).not.toBe(requestIdFrom(null));
  });

  it("does not trust an id that is long or has odd characters: anyone can send that header when nothing sits in front", () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(requestIdFrom("x".repeat(500))).toMatch(uuid);
    expect(requestIdFrom('abc"}\n{"level":"error"')).toMatch(uuid);
    expect(requestIdFrom("two words")).toMatch(uuid);
  });
});

describe("describeError", () => {
  it("names the kind of error and its message, for the log", () => {
    expect(describeError(new TypeError("bad thing"))).toBe("TypeError: bad thing");
    expect(describeError(rateLimited())).toBe(`rate-limited: ${rateLimited().message}`);
    expect(describeError(new AppError("unavailable", "Down."))).toBe("unavailable: Down.");
    expect(describeError("text")).toBe("unknown error");
    expect(describeError(conflict("x"))).toBe("conflict: x");
  });

  it("never includes the rest of the error object: a library's error can carry the request it made", () => {
    const error = Object.assign(new Error("socket hang up"), { config: { headers: { Authorization: "Bearer abc" } } });
    expect(describeError(error)).toBe("Error: socket hang up");
  });
});

describe("messageForLog", () => {
  it("keeps a conflict's text, which can name a tenant, out of the log", () => {
    const text = messageForLog(conflict("Asha Verma has already moved out. Refresh the page."));
    expect(text).not.toContain("Asha");
    expect(text.length).toBeGreaterThan(10);
  });

  it("gives the text of every other error as it is", () => {
    expect(messageForLog(rateLimited())).toBe(rateLimited().message);
    expect(messageForLog(new AppError("sheet-structure", 'The tab "Tenants" was not found.'))).toBe(
      'The tab "Tenants" was not found.',
    );
  });
});

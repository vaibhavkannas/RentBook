import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, conflict, rateLimited } from "@/lib/errors";
import { describeError, errorLogFields, logEvent, messageForLog, requestIdFrom } from "@/lib/server/log";
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

describe("errorLogFields", () => {
  it("gives the code and the text of an AppError, after the sentence that says where it happened", () => {
    expect(errorLogFields(rateLimited(), "A page could not read the Sheet")).toEqual({
      code: "rate-limited",
      message: `A page could not read the Sheet (${rateLimited().message}).`,
    });
  });

  it("keeps a conflict's text, which can name a tenant, out, as handle() does", () => {
    const fields = errorLogFields(conflict("Asha Verma has already moved out."), "Saving failed");
    expect(fields.code).toBe("conflict");
    expect(fields.message).toBe(`Saving failed (${messageForLog(conflict("x"))}).`);
    expect(fields.message).not.toContain("Asha");
  });

  it("names the kind of an error that is not ours and leaves out its code", () => {
    const fields = errorLogFields(new TypeError("bad thing"), "A page could not read the Sheet");
    expect(fields).toEqual({ message: "A page could not read the Sheet (TypeError: bad thing)." });
    expect(fields).not.toHaveProperty("code");
  });

  it("never includes the rest of the error object", () => {
    const error = Object.assign(new Error("socket hang up"), {
      config: { headers: { Authorization: "Bearer abc" } },
      details: { tenant: "Asha Verma" },
    });
    expect(JSON.stringify(errorLogFields(error, "x"))).not.toMatch(/Bearer|Authorization|Asha/);
  });

  it("copes with a thrown value that is not an Error", () => {
    expect(errorLogFields("Asha Verma", "x")).toEqual({ message: "x (unknown error)." });
    expect(errorLogFields(undefined, "x")).toEqual({ message: "x (unknown error)." });
  });
});

describe("problemCounts", () => {
  /** Where the counts are kept: on the process, not in the module (see the test of two copies below). */
  const COUNTS_KEY = Symbol.for("rentbook.problem-counts");

  /** A copy of the log module with nothing counted yet: the counts start when the first copy loads, so they are cleared first. */
  async function freshLog() {
    delete (globalThis as Record<symbol, unknown>)[COUNTS_KEY];
    vi.resetModules();
    return import("@/lib/server/log");
  }

  it("starts with nothing counted, and says when it started (the time the module loaded)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T05:30:00.000Z"));
    const log = await freshLog();
    vi.setSystemTime(new Date("2026-10-16T09:00:00.000Z"));
    expect(log.problemCounts()).toEqual({ since: "2026-10-16T05:30:00.000Z", warn: {}, error: {} });
  });

  it("counts each warn line and each error line, by its code, or by its event when it has no code", async () => {
    const log = await freshLog();
    log.logEvent("warn", "api-error", { code: "rate-limited" });
    log.logEvent("warn", "api-error", { code: "rate-limited", route: "/api/payments" });
    log.logEvent("warn", "api-error", { code: "unavailable" });
    log.logEvent("warn", "payments-log-header-taken", { message: "A cell holds other text." });
    log.logEvent("error", "api-error", { code: "config" });
    log.logEvent("error", "page-load-failed", { message: "A page could not read the Sheet." });
    log.logEvent("error", "page-load-failed");
    expect(log.problemCounts()).toMatchObject({
      warn: { "rate-limited": 2, unavailable: 1, "payments-log-header-taken": 1 },
      error: { config: 1, "page-load-failed": 2 },
    });
  });

  it("keeps the two levels apart: the same code as a warning and as an error is counted twice, once in each", async () => {
    const log = await freshLog();
    log.logEvent("warn", "x", { code: "shared" });
    log.logEvent("error", "x", { code: "shared" });
    log.logEvent("error", "x", { code: "shared" });
    expect(log.problemCounts()).toMatchObject({ warn: { shared: 1 }, error: { shared: 2 } });
  });

  it("does not count info lines, which are a person's own mistakes and nothing to fix", async () => {
    const log = await freshLog();
    log.logEvent("info", "api-error", { code: "validation" });
    log.logEvent("info", "api-error", { code: "conflict" });
    log.logEvent("info", "something-happened");
    expect(log.problemCounts()).toMatchObject({ warn: {}, error: {} });
  });

  it("counts by the event when the code is not text, as the line itself would leave it out", async () => {
    const log = await freshLog();
    log.logEvent("error", "odd-code", { code: 500 } as never);
    log.logEvent("error", "odd-code", { code: "" });
    expect(log.problemCounts().error).toEqual({ "odd-code": 2 });
  });

  it("changes nothing about what is printed", async () => {
    const log = await freshLog();
    log.logEvent("warn", "api-error", { code: "rate-limited", requestId: "req-1" });
    log.logEvent("error", "api-error", { code: "config", message: "Fix it." });
    expect(logs.warn).toHaveBeenCalledTimes(1);
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(logs.info).not.toHaveBeenCalled();
    const [warnLine] = loggedLines(logs.warn);
    expect(Object.keys(warnLine)).toEqual(["ts", "level", "event", "requestId", "code"]);
    const [errorLine] = loggedLines(logs.error);
    expect(Object.keys(errorLine)).toEqual(["ts", "level", "event", "code", "message"]);
  });

  it("answers with copies, so a caller cannot change the counts", async () => {
    const log = await freshLog();
    log.logEvent("error", "x", { code: "config" });
    const first = log.problemCounts();
    first.error.config = 99;
    first.warn.extra = 1;
    expect(log.problemCounts()).toMatchObject({ warn: {}, error: { config: 1 } });
  });

  it("treats a code such as __proto__ as an ordinary name", async () => {
    const log = await freshLog();
    log.logEvent("warn", "x", { code: "__proto__" });
    log.logEvent("warn", "x", { code: "constructor" });
    const counts = log.problemCounts();
    expect(Object.keys(counts.warn).sort()).toEqual(["__proto__", "constructor"]);
    expect(Object.getOwnPropertyDescriptor(counts.warn, "__proto__")?.value).toBe(1);
    expect(counts.warn.constructor).toBe(1);
  });

  it("is shared by every copy of the module in the process: a server bundles its route handlers and its pages apart, each with a copy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T05:30:00.000Z"));
    const page = await freshLog();
    vi.setSystemTime(new Date("2026-10-16T09:00:00.000Z"));
    vi.resetModules();
    const route = await import("@/lib/server/log");
    expect(route).not.toBe(page);
    route.logEvent("error", "api-error", { code: "config" });
    page.logEvent("warn", "api-error", { code: "rate-limited" });
    route.logEvent("error", "api-error", { code: "config" });
    for (const copy of [page, route]) {
      expect(copy.problemCounts()).toEqual({ since: "2026-10-16T05:30:00.000Z", warn: { "rate-limited": 1 }, error: { config: 2 } });
    }
  });

  it("counts lines from every caller of logEvent, since they all go through it", async () => {
    const log = await freshLog();
    log.logEvent("error", "sheet-connection-problem", log.errorLogFields(new Error("x"), "A page could not read the Sheet"));
    expect(log.problemCounts().error).toEqual({ "sheet-connection-problem": 1 });
  });
});

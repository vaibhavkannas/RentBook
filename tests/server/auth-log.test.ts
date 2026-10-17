import { CallbackRouteError, JWTSessionError } from "@auth/core/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authLogger } from "@/lib/server/auth-log";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// Auth.js's default logger prints an error's stack, its cause and a JSON dump of the cause's data (an OAuth reply,
// a token) with console.error. authLogger replaces it: one structured line, with the kind of error and nothing else.

let logs: LogSpies;
let rawLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logs = captureLogs();
  rawLog = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const CANARY = "Canary Tenant 98765 43210 eyJhbGciOiJIUzI1NiJ9.canary-token";
const everything = () =>
  [logs.info, logs.warn, logs.error, rawLog].flatMap((spy) => (spy.mock.calls as unknown[][]).flat()).join(" ");

describe("authLogger.error", () => {
  it("writes one warning line with the kind of an Auth.js error, and nothing it carries", () => {
    const cause = Object.assign(new Error(`Invalid JWT ${CANARY}`), { stack: `Error: stack ${CANARY}\n    at somewhere` });
    authLogger.error(new JWTSessionError(cause as never));
    const lines = loggedLines(logs.warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", event: "auth-error", code: "JWTSessionError" });
    expect(Object.keys(lines[0]).sort()).toEqual(["code", "event", "level", "message", "ts"]);
    expect(everything()).not.toMatch(/Canary|98765|eyJhbGci|canary-token|at somewhere|stack/);
    expect(logs.error).not.toHaveBeenCalled();
    expect(logs.info).not.toHaveBeenCalled();
    expect(rawLog).not.toHaveBeenCalled();
  });

  it("leaves out the cause's data, which can hold the reply of the sign-in provider", () => {
    authLogger.error(
      new CallbackRouteError(new Error("callback failed") as never, {
        provider: "google",
        tokenResponse: { access_token: CANARY },
        details: { email: "member@example.com" },
      } as never),
    );
    expect(loggedLines(logs.warn)[0]).toMatchObject({ event: "auth-error", code: "CallbackRouteError" });
    expect(everything()).not.toMatch(/Canary|access_token|member@example\.com|callback failed/);
  });

  it("names a plain error by its name, and not its text", () => {
    authLogger.error(Object.assign(new TypeError(`bad ${CANARY}`), { details: CANARY }));
    expect(loggedLines(logs.warn)[0]).toMatchObject({ event: "auth-error", code: "TypeError" });
    expect(everything()).not.toContain("Canary");
  });

  it("leaves out a code that is not a plain name, so an error cannot write its own line", () => {
    const odd = Object.assign(new Error("x"), { name: 'bad"}\n{"level":"error"' });
    authLogger.error(odd);
    const [line] = loggedLines(logs.warn);
    expect(line).not.toHaveProperty("code");
    expect(line.event).toBe("auth-error");
    authLogger.error(Object.assign(new Error("x"), { type: "a".repeat(500), name: "b".repeat(500) }));
    expect(loggedLines(logs.warn)[1]).not.toHaveProperty("code");
  });

  it("copes with a thrown value that is not an Error", () => {
    authLogger.error(CANARY as never);
    authLogger.error(undefined as never);
    const lines = loggedLines(logs.warn);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatchObject({ event: "auth-error" });
    expect(everything()).not.toContain("Canary");
  });
});

describe("authLogger.warn", () => {
  it("writes one warning line with the warning code", () => {
    authLogger.warn("env-url-basepath-redundant");
    const lines = loggedLines(logs.warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", event: "auth-warning", code: "env-url-basepath-redundant" });
    expect(rawLog).not.toHaveBeenCalled();
  });

  it("leaves out a code that is not a plain name", () => {
    authLogger.warn(`${CANARY}\n{"x":1}` as never);
    expect(loggedLines(logs.warn)[0]).not.toHaveProperty("code");
    expect(everything()).not.toContain("Canary");
  });
});

describe("authLogger.debug", () => {
  it("stays quiet, even when Auth.js passes it a body", () => {
    authLogger.debug("adapter_getUserByEmail", { args: [CANARY] });
    expect([logs.info, logs.warn, logs.error, rawLog].every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });
});

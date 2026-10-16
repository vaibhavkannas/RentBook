import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configError, conflict, rateLimited, sheetStructure, unavailable } from "@/lib/errors";
import type { Viewer } from "@/lib/server/auth-guard";
import { problemMessage } from "@/lib/server/problem";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// What a page says when reading the Sheet failed, and the one line it leaves in the server log.

const OWNER: Viewer = { email: "owner@example.com", isOwner: true };
const MEMBER: Viewer = { email: "member@example.com", isOwner: false };
const DETAIL = "Google rejected the service account key. Create a new key and update GOOGLE_SERVICE_ACCOUNT_JSON.";

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => vi.restoreAllMocks());

/** What a Google client's error can carry along: the request it sent, with a tenant and a token in it. */
const CANARY = "Canary Tenant 98765 43210 Bearer abc.def";
const carrying = <T extends Error>(error: T): T =>
  Object.assign(error, {
    details: { tenant: CANARY },
    config: { data: { values: [[CANARY]] }, headers: { Authorization: `Bearer ${CANARY}` } },
    response: { data: CANARY },
  });

const allOutput = () => [logs.info, logs.warn, logs.error].flatMap((spy) => spy.mock.calls.flat()).join(" ");

describe("problemMessage: a connection problem (config)", () => {
  it("logs one error line with the full text, whoever is told what", () => {
    for (const viewer of [OWNER, MEMBER]) {
      logs.error.mockClear();
      problemMessage(configError(DETAIL), viewer);
      const lines = loggedLines(logs.error);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "error",
        event: "sheet-connection-problem",
        code: "config",
        message: expect.stringContaining(DETAIL),
      });
    }
    expect(logs.info).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it("still tells the owner the detail and a member only to ask the owner", () => {
    expect(problemMessage(configError(DETAIL), OWNER)).toBe(DETAIL);
    expect(problemMessage(configError(DETAIL), MEMBER)).toBe("The Sheet connection needs attention. Ask the owner.");
  });

  it("does not log what the error object carries", () => {
    problemMessage(carrying(configError(DETAIL)), OWNER);
    expect(allOutput()).not.toMatch(/Canary|98765|Bearer|Authorization/);
  });

  it("leaves the signed-in person's address out of the line", () => {
    problemMessage(configError(DETAIL), OWNER);
    expect(allOutput()).not.toContain("owner@example.com");
  });
});

describe("problemMessage: a failure that is not ours to explain", () => {
  it("logs one error line that names the kind of error, and shows only the generic message", () => {
    const message = problemMessage(carrying(new Error("socket hang up")), MEMBER);
    expect(message).toBe("Couldn't reach Google Sheets. Try again.");
    const lines = loggedLines(logs.error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", event: "page-load-failed", message: expect.stringContaining("Error: socket hang up") });
    expect(lines[0]).not.toHaveProperty("code");
  });

  it("does not log what the error object carries, nor a request body", () => {
    problemMessage(carrying(new Error("socket hang up")), OWNER);
    expect(allOutput()).not.toMatch(/Canary|98765|Bearer|Authorization/);
  });

  it("logs a thrown value that is not an Error without printing it", () => {
    expect(problemMessage(CANARY, OWNER)).toBe("Couldn't reach Google Sheets. Try again.");
    const [line] = loggedLines(logs.error);
    expect(line.event).toBe("page-load-failed");
    expect(allOutput()).not.toContain("Canary");
  });
});

describe("problemMessage: a problem that is the Sheet's or Google's, which the person can act on", () => {
  it.each([
    [rateLimited(), "Google is limiting requests right now. Wait a minute and try again."],
    [unavailable(), "Google isn't responding. Try again in a minute."],
    [sheetStructure('The tab "Tenants" was not found in your Sheet.'), 'The tab "Tenants" was not found in your Sheet.'],
    [conflict("Asha has already moved out."), "Asha has already moved out."],
  ])("tells everyone what it is and writes no line (%s)", (error, said) => {
    expect(problemMessage(error, MEMBER)).toBe(said);
    expect(logs.info).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configError, rateLimited, unavailable } from "@/lib/errors";
import { appendWithRetry } from "@/lib/sheets/append-log";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// The loop that adds rows to an app log tab: the Payments Log and the Tenancy Log both use it. It tries again only after
// Google said it was limiting requests (that refusal means nothing was done), and stops at once on anything else, because an
// error such as a timeout can come back after the rows were already added.

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const base = {
  attempts: 3,
  retryDelayMs: 0,
  maxWaitMs: 1_000,
  budgetMs: 4_000,
  event: "some-log-append-failed",
  what: (attempt: number) => `Some Log: try ${attempt} of 3 did not add the rows`,
};

/** An append that fails with each of `failures` in turn, then works; `calls` counts the tries. */
function appendFailing(...failures: unknown[]) {
  const queue = [...failures];
  const append = vi.fn(async () => {
    const failure = queue.shift();
    if (failure !== undefined) throw failure;
  });
  return append;
}

describe("appendWithRetry", () => {
  it("is true after one try that works, and logs nothing", async () => {
    const append = appendFailing();
    expect(await appendWithRetry({ ...base, append })).toBe(true);
    expect(append).toHaveBeenCalledTimes(1);
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("tries again after a refusal for too many requests, and stops when a try works", async () => {
    const append = appendFailing(rateLimited(), rateLimited());
    expect(await appendWithRetry({ ...base, append })).toBe(true);
    expect(append).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last try, and is false", async () => {
    const append = appendFailing(rateLimited(), rateLimited(), rateLimited(), rateLimited());
    expect(await appendWithRetry({ ...base, append })).toBe(false);
    expect(append).toHaveBeenCalledTimes(3);
    expect(await appendWithRetry({ ...base, attempts: 2, append: appendFailing(rateLimited(), rateLimited(), rateLimited()) })).toBe(false);
  });

  it("stops at once on any error that may have been carried out", async () => {
    for (const failure of [unavailable(), configError("denied"), new Error("socket hang up"), new TypeError("odd")]) {
      const append = appendFailing(failure);
      expect(await appendWithRetry({ ...base, append })).toBe(false);
      expect(append).toHaveBeenCalledTimes(1);
    }
  });

  it("logs each failed try as a line of the event it is given, with the code of the error and the words it is given", async () => {
    await appendWithRetry({ ...base, append: appendFailing(rateLimited(), rateLimited(), rateLimited()) });
    const lines = loggedLines(logs.error);
    expect(lines).toHaveLength(3);
    for (const [index, line] of lines.entries()) {
      expect(line).toMatchObject({ level: "error", event: "some-log-append-failed", code: "rate-limited" });
      expect(String(line.message)).toMatch(new RegExp(`^Some Log: try ${index + 1} of 3 did not add the rows \\(`));
    }
  });

  it("names the kind of an error that is not ours, and never prints what the error carries", async () => {
    const error = Object.assign(new Error("socket hang up"), { config: { headers: { Authorization: "Bearer canary-token" } } });
    await appendWithRetry({ ...base, append: appendFailing(error) });
    const [line] = loggedLines(logs.error);
    expect(line).not.toHaveProperty("code");
    expect(String(line.message)).toContain("Error: socket hang up");
    expect(JSON.stringify(line)).not.toMatch(/canary-token|Authorization/);
  });

  it("waits the delay times the number of the try, and never more than the cap", async () => {
    const waits: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void, ms?: number) => {
      waits.push(ms ?? 0);
      run();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    await appendWithRetry({ ...base, retryDelayMs: 300, append: appendFailing(rateLimited(), rateLimited(), rateLimited()) });
    expect(waits).toEqual([300, 600]);
    waits.length = 0;
    await appendWithRetry({ ...base, retryDelayMs: 60_000, append: appendFailing(rateLimited(), rateLimited(), rateLimited()) });
    expect(waits).toEqual([1_000, 1_000]);
  });

  it("does not wait for a delay of 0", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    await appendWithRetry({ ...base, append: appendFailing(rateLimited(), rateLimited()) });
    expect(spy).not.toHaveBeenCalled();
  });

  it("starts no new try when the tries so far plus the wait would pass the budget", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const append = vi.fn(async () => {
      calls += 1;
      // Each try takes 1.5 seconds before Google refuses it.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      throw rateLimited();
    });
    const run = appendWithRetry({ ...base, attempts: 3, retryDelayMs: 1_000, budgetMs: 2_000, append });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await run).toBe(false);
    expect(calls).toBe(1);
  });
});

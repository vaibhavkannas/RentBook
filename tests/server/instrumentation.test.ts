import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conflict, configError } from "@/lib/errors";
import { onRequestError } from "@/instrumentation";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// Next calls onRequestError for an error nobody caught on the server: a page that failed to render, or a route
// that threw outside handle(). It logs the same line as handle() does.

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => vi.restoreAllMocks());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const request = (headers: Record<string, string | string[]> = {}) => ({
  path: "/tenants/p1?token=abc.def",
  method: "GET",
  headers,
});
const context = {
  routerKind: "App Router" as const,
  routePath: "/tenants/[portionId]",
  routeType: "render" as const,
  renderSource: "react-server-components" as const,
  revalidateReason: undefined,
  renderType: "dynamic" as const,
};

describe("onRequestError", () => {
  it("logs one error line in the shape handle() uses: event, request id, route, code and message", async () => {
    await onRequestError(new Error("boom"), request(), context);
    const lines = loggedLines(logs.error);
    expect(lines).toEqual([
      {
        ts: expect.any(String),
        level: "error",
        event: "request-error",
        requestId: expect.stringMatching(UUID),
        route: "/tenants/[portionId]",
        code: "internal",
        message: "Error: boom",
      },
    ]);
    expect(logs.info).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it("uses the x-vercel-id of the request, as a string or the first of a list", async () => {
    await onRequestError(new Error("a"), request({ "x-vercel-id": "iad1::abcde-1-2" }), context);
    await onRequestError(new Error("b"), request({ "x-vercel-id": ["iad1::fghij-3-4", "other"] }), context);
    expect(loggedLines(logs.error).map((line) => line.requestId)).toEqual(["iad1::abcde-1-2", "iad1::fghij-3-4"]);
  });

  it("adds the digest React gave the error, which is what the error page's own digest matches", async () => {
    const error = Object.assign(new Error("render failed"), { digest: "1234567890" });
    await onRequestError(error, request(), context);
    expect(loggedLines(logs.error)[0].message).toBe("Error: render failed (digest 1234567890)");
  });

  it("uses the code of an error of ours", async () => {
    await onRequestError(configError("Share the Sheet with bot@example.com."), request(), context);
    expect(loggedLines(logs.error)[0]).toMatchObject({
      code: "config",
      message: "Share the Sheet with bot@example.com.",
    });
  });

  it("keeps the text of a conflict, which can name a tenant, out of the log", async () => {
    await onRequestError(conflict("Asha Verma has already moved out."), request(), context);
    const [line] = loggedLines(logs.error);
    expect(line.code).toBe("conflict");
    expect(JSON.stringify(line)).not.toContain("Asha");
  });

  it("logs neither the address of the request with its query, nor its headers, nor its method", async () => {
    await onRequestError(new Error("boom"), request({ cookie: "session=abc", authorization: "Bearer abc" }), context);
    const text = String(logs.error.mock.calls[0][0]);
    for (const leak of ["token=abc", "session=abc", "Bearer", "/tenants/p1", "GET"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("copes with something that is not an Error, and does not throw", async () => {
    await expect(onRequestError("just text", request(), context)).resolves.toBeUndefined();
    await expect(onRequestError(undefined, request(), context)).resolves.toBeUndefined();
    expect(loggedLines(logs.error).map((line) => line.message)).toEqual(["unknown error", "unknown error"]);
  });
});

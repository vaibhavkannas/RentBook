import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getViewer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/auth-guard", () => ({ getViewer }));

import {
  AppError,
  conflict,
  configError,
  crossOriginRequest,
  forbidden,
  payloadTooLarge,
  rateLimited,
  sheetStructure,
  unauthorized,
  unavailable,
  unsupportedMediaType,
  validation,
} from "@/lib/errors";
import { assertJsonSameOrigin, handle, MAX_BODY_BYTES, parseBody, readJsonBody } from "@/lib/server/http";
import { logRetryBody, paymentBody, settingsBody, undoBody } from "@/lib/server/schemas";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// handle() logs every error it answers, so the log is held back for the whole file and read where a test cares.
let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
  getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  getViewer.mockReset();
});

describe("handle", () => {
  it("wraps a result with ok: true", async () => {
    const res = await handle(async () => ({ value: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, value: 1 });
  });

  it.each([
    [unauthorized(), 401, "unauthorized"],
    [forbidden(), 403, "forbidden"],
    [validation("bad"), 400, "validation"],
    [conflict("dup", { existingAmount: 5 }), 409, "conflict"],
    [sheetStructure("moved"), 422, "sheet-structure"],
    [configError("setup"), 500, "config"],
    [rateLimited(), 429, "rate-limited"],
    [unavailable(), 503, "unavailable"],
  ])("maps %s to status %i", async (error, status, code) => {
    const res = await handle(async () => {
      throw error;
    });
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toBe(error.message);
  });

  it("includes conflict details", async () => {
    const res = await handle(async () => {
      throw conflict("dup", { existingAmount: 5 });
    });
    expect((await res.json()).error.details).toEqual({ existingAmount: 5 });
  });

  it("asks the browser to wait 30 seconds before trying again, for a rate-limited answer only", async () => {
    const limited = await handle(async () => {
      throw rateLimited();
    });
    expect(limited.headers.get("Retry-After")).toBe("30");
    for (const error of [unavailable(), configError("setup"), validation("bad")]) {
      const res = await handle(async () => {
        throw error;
      });
      expect(res.headers.get("Retry-After")).toBeNull();
    }
  });

  it("says in plain words that Google is limiting requests or not responding", async () => {
    const limited = await (await handle(async () => { throw rateLimited(); })).json();
    expect(limited.error.message).toBe("Google is limiting requests right now. Wait a minute and try again.");
    const down = await (await handle(async () => { throw unavailable(); })).json();
    expect(down.error.message).toBe("Google isn't responding. Try again in a minute.");
  });

  it("hides unknown error text and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handle(async () => {
      throw new Error("secret stack detail");
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(log).toHaveBeenCalled();
  });
});

describe("handle: a Sheet connection problem", () => {
  const DETAIL =
    "Google denied access (The caller does not have permission). Share the Sheet with bot@example.com as Editor.";
  const GENERIC = "The Sheet connection needs attention. Ask the owner.";
  const run = () =>
    handle(async () => {
      throw configError(DETAIL);
    });

  it("gives the owner the detail", async () => {
    getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
    const res = await run();
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toBe(DETAIL);
  });

  it("gives a member only a short message, and logs the detail on the server", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
    const res = await run();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("config");
    expect(body.error.message).toBe(GENERIC);
    expect(JSON.stringify(body)).not.toContain("bot@example.com");
    expect(log.mock.calls.flat().join(" ")).toContain(DETAIL);
  });

  it("gives nobody else the detail either: not signed in, or the sign-in check failing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue(null);
    expect((await (await run()).json()).error.message).toBe(GENERIC);
    getViewer.mockRejectedValue(new Error("no session"));
    expect((await (await run()).json()).error.message).toBe(GENERIC);
  });

  it("does not look at the viewer for any other error", async () => {
    await handle(async () => {
      throw sheetStructure("moved");
    });
    expect(getViewer).not.toHaveBeenCalled();
  });
});

describe("handle: the log and the request id", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const fail = (error: unknown, request?: Request) =>
    handle(async () => {
      throw error;
    }, request);
  /** The one line logged at any level. */
  const theLine = () => {
    const all = [...loggedLines(logs.info), ...loggedLines(logs.warn), ...loggedLines(logs.error)];
    expect(all).toHaveLength(1);
    return all[0];
  };

  it.each([
    [validation("bad"), "info", "validation"],
    [conflict("dup"), "info", "conflict"],
    [unauthorized(), "info", "unauthorized"],
    [forbidden(), "info", "forbidden"],
    [rateLimited(), "warn", "rate-limited"],
    [unavailable(), "warn", "unavailable"],
    [configError("setup"), "error", "config"],
    [sheetStructure("moved"), "error", "sheet-structure"],
    [new Error("boom"), "error", "internal"],
  ])("logs %s at level %s with the code %s", async (error, level, code) => {
    const res = await fail(error);
    expect(res.ok).toBe(false);
    const line = theLine();
    expect(line).toMatchObject({ level, code });
    expect(typeof line.event).toBe("string");
    const spies = { info: logs.info, warn: logs.warn, error: logs.error };
    expect(spies[level as keyof typeof spies]).toHaveBeenCalledTimes(1);
  });

  it("puts the request id in the error body, and the same id in the log line", async () => {
    const res = await fail(validation("bad"));
    const body = await res.json();
    expect(body.requestId).toMatch(UUID);
    expect(theLine().requestId).toBe(body.requestId);
  });

  it("puts it there for an error nobody expected too", async () => {
    const res = await fail(new Error("boom"));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: { code: "internal", message: "Something went wrong. Try again." },
      requestId: expect.stringMatching(UUID),
    });
    expect(theLine().requestId).toBe(body.requestId);
  });

  it("makes a new id for each answer", async () => {
    const first = (await (await fail(validation("bad"))).json()).requestId;
    const second = (await (await fail(validation("bad"))).json()).requestId;
    expect(first).not.toBe(second);
  });

  it("uses the x-vercel-id of the request when there is one", async () => {
    const id = "iad1::sfo1::abcde-1760592600000-0123456789ab";
    const request = new Request("http://localhost/api/payments", { method: "POST", headers: { "x-vercel-id": id } });
    const res = await fail(conflict("dup"), request);
    expect((await res.json()).requestId).toBe(id);
    expect(theLine().requestId).toBe(id);
  });

  it("ignores an x-vercel-id that is not a plain id", async () => {
    const request = new Request("http://localhost/api/payments", { headers: { "x-vercel-id": 'a"b c' } });
    const res = await fail(conflict("dup"), request);
    expect((await res.json()).requestId).toMatch(UUID);
  });

  it("logs the path of the route, without its query string", async () => {
    const request = new Request("http://localhost/api/payments/undo?token=abc", { method: "POST" });
    await fail(validation("bad"), request);
    expect(theLine().route).toBe("/api/payments/undo");
  });

  it("logs no route when it was not given the request", async () => {
    await fail(validation("bad"));
    expect(theLine()).not.toHaveProperty("route");
  });

  it("logs a success as nothing and leaves the id out of the body", async () => {
    const res = await handle(async () => ({ value: 1 }));
    expect(await res.json()).toEqual({ ok: true, value: 1 });
    expect(logs.info).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("logs what an error that is not ours was, without its stack or anything else it carries", async () => {
    const error = Object.assign(new Error("socket hang up"), { config: { headers: { Authorization: "Bearer abc" } } });
    await fail(error);
    const line = theLine();
    expect(line.message).toBe("Error: socket hang up");
    expect(JSON.stringify(line)).not.toMatch(/Bearer|Authorization|\bat /);
  });

  it("does not log the text of a conflict, which can name a tenant, and still tells the person", async () => {
    const res = await fail(conflict("Asha Verma has already moved out. Refresh the page.", { existingTenant: "Asha Verma" }));
    expect((await res.json()).error.message).toBe("Asha Verma has already moved out. Refresh the page.");
    const line = theLine();
    expect(line.code).toBe("conflict");
    expect(JSON.stringify(line)).not.toContain("Asha");
    expect(typeof line.message).toBe("string");
  });

  it("logs the text of the other errors, which tell the owner what is wrong with the Sheet", async () => {
    await fail(sheetStructure('The tab "Tenants" was not found in your Sheet.'));
    expect(theLine().message).toBe('The tab "Tenants" was not found in your Sheet.');
  });

  it("logs the person's address, in lower case, for a connection problem, where it already asks who they are", async () => {
    getViewer.mockResolvedValue({ email: "Member@Example.com", isOwner: false });
    await fail(configError("Share the Sheet with bot@example.com as Editor."));
    expect(theLine()).toMatchObject({
      code: "config",
      message: "Share the Sheet with bot@example.com as Editor.",
      viewer: "member@example.com",
    });
  });

  it("logs no viewer when the person cannot be found out", async () => {
    getViewer.mockResolvedValue(null);
    await fail(configError("setup"));
    expect(theLine()).not.toHaveProperty("viewer");
    getViewer.mockRejectedValue(new Error("no session"));
    logs.error.mockClear();
    await fail(configError("setup"));
    expect(theLine()).not.toHaveProperty("viewer");
  });
});

describe("handle: a status the error carries", () => {
  it("uses it in place of the code's usual status", async () => {
    const res = await handle(async () => {
      throw new AppError("validation", "too big", undefined, 413);
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatchObject({ code: "validation", message: "too big" });
  });

  it("answers 415 and 413 as validation errors, and 403 as forbidden, for the request-integrity refusals", async () => {
    for (const [error, status, code] of [
      [unsupportedMediaType(), 415, "validation"],
      [payloadTooLarge(), 413, "validation"],
      [crossOriginRequest(), 403, "forbidden"],
    ] as const) {
      const res = await handle(async () => {
        throw error;
      });
      expect(res.status).toBe(status);
      expect((await res.json()).error.code).toBe(code);
    }
  });
});

const jsonRequest = (headers: Record<string, string> = {}, body = "{}") =>
  new Request("http://localhost/api/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });

/** What a refusal of this request looks like to the browser: its HTTP status and code, or null when it is let through. */
async function refusal(request: Request) {
  const res = await handle(async () => {
    assertJsonSameOrigin(request);
    return {};
  });
  return res.ok ? null : { status: res.status, code: (await res.json()).error.code };
}

describe("assertJsonSameOrigin", () => {
  it("lets through a JSON request from the page itself", async () => {
    expect(await refusal(jsonRequest())).toBeNull();
    expect(await refusal(jsonRequest({ "Sec-Fetch-Site": "same-origin", Origin: "http://localhost" }))).toBeNull();
  });

  it("accepts the JSON content type with a charset, in any letter case", async () => {
    expect(await refusal(jsonRequest({ "Content-Type": "application/json; charset=utf-8" }))).toBeNull();
    expect(await refusal(jsonRequest({ "Content-Type": "Application/JSON" }))).toBeNull();
  });

  it.each([
    ["no content type", ""],
    ["plain text, which a cross-site form can send", "text/plain"],
    ["a form", "application/x-www-form-urlencoded"],
    ["a multipart form", "multipart/form-data; boundary=x"],
    ["a JSON look-alike", "application/jsonx"],
    ["a JSON patch", "application/json-patch+json"],
  ])("answers 415 for %s", async (_name, type) => {
    const request = new Request("http://localhost/api/payments", {
      method: "POST",
      headers: type ? { "Content-Type": type } : {},
      body: type ? "{}" : undefined,
    });
    expect(await refusal(request)).toEqual({ status: 415, code: "validation" });
  });

  it.each([
    ["cross-site", "cross-site"],
    ["same-site", "same-site"],
    ["none", "none"],
    ["empty", ""],
  ])("answers 403 when Sec-Fetch-Site is %s", async (_name, value) => {
    expect(await refusal(jsonRequest({ "Sec-Fetch-Site": value }))).toEqual({ status: 403, code: "forbidden" });
  });

  it.each([
    ["another host", "https://evil.example"],
    ["the same host on another port", "http://localhost:3001"],
    ["a look-alike host", "http://localhost.evil.example"],
    ["a null origin", "null"],
    ["something that is not an address", "not a url"],
  ])("answers 403 when Origin is %s", async (_name, origin) => {
    expect(await refusal(jsonRequest({ Origin: origin }))).toEqual({ status: 403, code: "forbidden" });
  });

  it("compares the origin with the host the browser asked for, as a proxy reports it", async () => {
    const behind = (headers: Record<string, string>) =>
      new Request("http://internal:3000/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: "{}",
      });
    expect(await refusal(behind({ "X-Forwarded-Host": "rent.example.com", Origin: "https://rent.example.com" }))).toBeNull();
    expect(await refusal(behind({ Host: "rent.example.com", Origin: "https://rent.example.com" }))).toBeNull();
    expect(
      await refusal(behind({ "X-Forwarded-Host": "rent.example.com, other.example", Origin: "https://rent.example.com" })),
    ).toBeNull();
    expect(await refusal(behind({ "X-Forwarded-Host": "rent.example.com", Origin: "https://internal:3000" }))).toEqual({
      status: 403,
      code: "forbidden",
    });
  });

  it("needs neither Origin nor Sec-Fetch-Site: a tool that sends neither is judged by its content type alone", async () => {
    expect(await refusal(jsonRequest())).toBeNull();
  });

  it("refuses a cross-site request that is also not JSON with 403, the more telling answer", async () => {
    const request = new Request("http://localhost/api/payments", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" },
      body: "{}",
    });
    expect(await refusal(request)).toEqual({ status: 403, code: "forbidden" });
  });
});

/** A request whose body arrives in `chunks`, and which says how many were pulled before the reader gave up. */
function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const state = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[state.pulled++];
      if (next) controller.enqueue(next);
      else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  }, { highWaterMark: 0 }); // nothing is pulled until a reader asks
  const request = new Request("http://localhost/api/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
  return { request, state };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("readJsonBody", () => {
  it("returns the parsed body", async () => {
    expect(await readJsonBody(jsonRequest({}, JSON.stringify({ a: [1, "b"] })))).toEqual({ a: [1, "b"] });
  });

  it("checks the origin and the content type before it reads anything", async () => {
    const { request, state } = streamedRequest([bytes("{}")], { "Sec-Fetch-Site": "cross-site" });
    await expect(readJsonBody(request)).rejects.toMatchObject({ code: "forbidden" });
    expect(state.pulled).toBe(0);
  });

  it("says the body must be JSON when it is empty or not JSON", async () => {
    await expect(readJsonBody(jsonRequest({}, ""))).rejects.toThrow(/must be JSON/);
    await expect(readJsonBody(jsonRequest({}, "{oops"))).rejects.toThrow(/must be JSON/);
    await expect(readJsonBody(jsonRequest({}, "{oops"))).rejects.toMatchObject({ code: "validation", status: undefined });
  });

  it("accepts a body of exactly 32 KB and refuses one byte more", async () => {
    const fill = MAX_BODY_BYTES - JSON.stringify({ text: "" }).length;
    const exact = JSON.stringify({ text: "x".repeat(fill) });
    expect(bytes(exact).length).toBe(MAX_BODY_BYTES);
    expect(await readJsonBody(jsonRequest({}, exact))).toBeTruthy();
    const over = JSON.stringify({ text: "x".repeat(fill + 1) });
    await expect(readJsonBody(jsonRequest({}, over))).rejects.toMatchObject({ status: 413, code: "validation" });
  });

  it("counts bytes, not characters", async () => {
    const wide = JSON.stringify({ text: "€".repeat(11_000) }); // 11,000 characters, more than 33,000 bytes
    expect(wide.length).toBeLessThan(MAX_BODY_BYTES);
    await expect(readJsonBody(jsonRequest({}, wide))).rejects.toMatchObject({ status: 413 });
  });

  it("refuses on Content-Length alone, without reading the body", async () => {
    const { request, state } = streamedRequest([bytes("{}")], { "Content-Length": String(MAX_BODY_BYTES + 1) });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413 });
    expect(state.pulled).toBe(0);
  });

  it("stops reading an oversized stream that gave no length, or a false one, and cancels it", async () => {
    const chunk = new Uint8Array(1_024).fill(32);
    for (const headers of [{}, { "Content-Length": "10" }] as Record<string, string>[]) {
      const { request, state } = streamedRequest(
        Array.from({ length: 1_000 }, () => chunk),
        headers,
      );
      await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413 });
      expect(state.cancelled).toBe(true);
      expect(state.pulled).toBeLessThan(40); // 32 KB is 32 chunks; nothing near the 1,000 offered
    }
  });

  it("reads a body that arrives in pieces", async () => {
    const { request } = streamedRequest([bytes('{"a":'), bytes("1,"), bytes('"b":2}')]);
    expect(await readJsonBody(request)).toEqual({ a: 1, b: 2 });
  });
});

describe("parseBody", () => {
  it("returns typed data for a valid body", () => {
    const data = parseBody({ month: "2026-10", portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, paymentBody);
    expect(data.amount).toBe(5450);
  });

  it("reports the first problem with its field name", () => {
    expect(() => parseBody({ month: "Oct", portionId: "p1", amount: 1, dateReceived: "x" }, paymentBody)).toThrow(
      /month: month must look like/,
    );
  });

  it("validates the log retry token and settings payload", () => {
    expect(parseBody({ token: "a.b" }, logRetryBody).token).toBe("a.b");
    expect(() => parseBody({ token: "" }, logRetryBody)).toThrow();
    expect(() => parseBody({ token: "a".repeat(2001) }, logRetryBody)).toThrow();
    expect(() => parseBody({ token: 5 }, logRetryBody)).toThrow();
    // a row is no longer accepted in place of a token
    expect(() => parseBody({ row: ["x"] }, logRetryBody)).toThrow();
    expect(() => parseBody({ portions: [] }, settingsBody)).toThrow();
  });

  it("limits the length of every text the log schemas take from the client", () => {
    const long = "x".repeat(201);
    const payment = { month: "2026-10", portionId: "p1", amount: 5450, dateReceived: "2026-10-05" };
    // a tenant's name is 1 to 60 characters, the same limit the service holds it to
    expect(parseBody({ ...payment, newTenantName: "x".repeat(60) }, paymentBody).amount).toBe(5450);
    for (const bad of [
      { ...payment, dateReceived: long },
      { ...payment, newTenantName: "x".repeat(61) },
      { ...payment, newTenantName: long },
      { ...payment, expected: { tenant: long, count: 1, amount: 1 } },
      { ...payment, tenancy: { moveIn: long } },
      { ...payment, tenancy: { moveIn: "2026-10-01", phone: long } },
      { ...payment, tenancy: { moveIn: "2026-10-01", agreementEnd: long } },
      { ...payment, tenancy: { moveIn: "2026-10-01", advanceDate: long } },
    ]) {
      expect(() => parseBody(bad, paymentBody)).toThrow();
    }
    expect(() =>
      parseBody({ month: "2026-10", portionId: "p1", expected: { tenant: long, count: 1, amount: 1 } }, undoBody),
    ).toThrow();
  });
});

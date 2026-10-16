import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getViewer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/auth-guard", () => ({ getViewer }));

import {
  conflict,
  configError,
  forbidden,
  rateLimited,
  sheetStructure,
  unauthorized,
  unavailable,
  validation,
} from "@/lib/errors";
import { handle, parseJson } from "@/lib/server/http";
import { logRetryBody, paymentBody, settingsBody, undoBody } from "@/lib/server/schemas";

beforeEach(() => getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true }));
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

describe("parseJson", () => {
  const req = (body: string) => new Request("http://x", { method: "POST", body });

  it("returns typed data for a valid body", async () => {
    const data = await parseJson(
      req(JSON.stringify({ month: "2026-10", portionId: "p1", amount: 5450, dateReceived: "2026-10-05" })),
      paymentBody,
    );
    expect(data.amount).toBe(5450);
  });

  it("reports the first problem with its field name", async () => {
    await expect(
      parseJson(req(JSON.stringify({ month: "Oct", portionId: "p1", amount: 1, dateReceived: "x" })), paymentBody),
    ).rejects.toThrow(/month: month must look like/);
  });

  it("rejects non-JSON", async () => {
    await expect(parseJson(req("{oops"), paymentBody)).rejects.toThrow(/must be JSON/);
  });

  it("validates the log retry token and settings payload", async () => {
    expect((await parseJson(req(JSON.stringify({ token: "a.b" })), logRetryBody)).token).toBe("a.b");
    await expect(parseJson(req(JSON.stringify({ token: "" })), logRetryBody)).rejects.toThrow();
    await expect(parseJson(req(JSON.stringify({ token: "a".repeat(2001) })), logRetryBody)).rejects.toThrow();
    await expect(parseJson(req(JSON.stringify({ token: 5 })), logRetryBody)).rejects.toThrow();
    // a row is no longer accepted in place of a token
    await expect(parseJson(req(JSON.stringify({ row: ["x"] })), logRetryBody)).rejects.toThrow();
    await expect(parseJson(req(JSON.stringify({ portions: [] })), settingsBody)).rejects.toThrow();
  });

  it("limits the length of every text the log schemas take from the client", async () => {
    const long = "x".repeat(201);
    const payment = { month: "2026-10", portionId: "p1", amount: 5450, dateReceived: "2026-10-05" };
    expect((await parseJson(req(JSON.stringify({ ...payment, newTenantName: "x".repeat(200) })), paymentBody)).amount).toBe(5450);
    for (const bad of [
      { ...payment, dateReceived: long },
      { ...payment, newTenantName: long },
      { ...payment, expected: { tenant: long, count: 1, amount: 1 } },
      { ...payment, tenancy: { moveIn: long } },
      { ...payment, tenancy: { moveIn: "2026-10-01", phone: long } },
      { ...payment, tenancy: { moveIn: "2026-10-01", agreementEnd: long } },
      { ...payment, tenancy: { moveIn: "2026-10-01", advanceDate: long } },
    ]) {
      await expect(parseJson(req(JSON.stringify(bad)), paymentBody)).rejects.toThrow();
    }
    await expect(
      parseJson(
        req(JSON.stringify({ month: "2026-10", portionId: "p1", expected: { tenant: long, count: 1, amount: 1 } })),
        undoBody,
      ),
    ).rejects.toThrow();
  });
});

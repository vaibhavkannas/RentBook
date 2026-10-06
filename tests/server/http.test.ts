import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conflict,
  configError,
  forbidden,
  sheetStructure,
  unauthorized,
  validation,
} from "@/lib/errors";
import { handle, parseJson } from "@/lib/server/http";
import { logRetryBody, paymentBody, settingsBody } from "@/lib/server/schemas";

afterEach(() => vi.restoreAllMocks());

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

  it("validates the log retry row shape and settings payload", async () => {
    const row = ["t", "2026-10", "P", "A", 1, 1, "2026-10-05"];
    expect((await parseJson(req(JSON.stringify({ row })), logRetryBody)).row).toHaveLength(7);
    await expect(parseJson(req(JSON.stringify({ row: ["x"] })), logRetryBody)).rejects.toThrow();
    await expect(parseJson(req(JSON.stringify({ portions: [] })), settingsBody)).rejects.toThrow();
  });
});

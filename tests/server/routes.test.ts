import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const saveSettings = vi.hoisted(() => vi.fn(async () => []));
const logPayment = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ logWritten: boolean; tenancyWritten?: boolean }>>(async () => ({
    logWritten: true,
  })),
);
const undoPayment = vi.hoisted(() => vi.fn());
const retryLogRow = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
);
const markWritten = vi.hoisted(() => vi.fn(async () => undefined));
const saveTenancy = vi.hoisted(() => vi.fn());
const moveOutTenancy = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ markWritten, readWrittenAt: vi.fn(async () => undefined) }));
vi.mock("@/lib/sheets/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets/service")>()),
  saveSettings,
  logPayment,
  undoPayment,
  retryLogRow,
}));
vi.mock("@/lib/sheets/tenancy-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets/tenancy-service")>()),
  saveTenancy,
  moveOutTenancy,
}));

import { conflict, configError, rateLimited, unavailable, validation } from "@/lib/errors";
import { POST as postRetry } from "@/app/api/payments/log-retry/route";
import { POST as postPayment } from "@/app/api/payments/route";
import { POST as postUndo } from "@/app/api/payments/undo/route";
import { POST as postMoveOut } from "@/app/api/tenancies/move-out/route";
import { POST as postTenancy } from "@/app/api/tenancies/route";
import { PUT as putSettings } from "@/app/api/settings/route";

const settingsRequest = () =>
  new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      portions: [{ id: "p1", name: "Ground", cycleLength: 11, hikePercent: 5 }],
    }),
  });

const signedInAs = (email: string | null) =>
  auth.mockResolvedValue(email ? { user: { email } } : null);

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.ALLOWED_EMAILS;
  process.env.ALLOWED_EMAILS = "owner@example.com, member@example.com";
  saveSettings.mockClear();
  logPayment.mockClear();
  undoPayment.mockReset();
  retryLogRow.mockClear();
  markWritten.mockClear();
  saveTenancy.mockReset();
  moveOutTenancy.mockReset();
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.ALLOWED_EMAILS;
  else process.env.ALLOWED_EMAILS = savedEnv;
});

describe("PUT /api/settings", () => {
  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(401);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("rejects a signed-in address that is not on the list", async () => {
    signedInAs("stranger@example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(401);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("rejects a listed member who is not the owner", async () => {
    signedInAs("member@example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("lets the owner save", async () => {
    signedInAs("Owner@Example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(200);
    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it("marks the write time after a successful save, and not when the owner is refused", async () => {
    signedInAs("member@example.com");
    await putSettings(settingsRequest());
    expect(markWritten).not.toHaveBeenCalled();

    signedInAs("owner@example.com");
    await putSettings(settingsRequest());
    expect(markWritten).toHaveBeenCalledOnce();
  });
});

describe("POST /api/payments", () => {
  const paymentRequest = () =>
    new Request("http://localhost/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: "2026-10",
        portionId: "p1",
        amount: 5450,
        dateReceived: "2026-10-05",
      }),
    });

  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await postPayment(paymentRequest());
    expect(res.status).toBe(401);
    expect(logPayment).not.toHaveBeenCalled();
  });

  it("records the signed-in email, lower-cased, as who logged it", async () => {
    signedInAs("Member@Example.com");
    const res = await postPayment(paymentRequest());
    expect(res.status).toBe(200);
    expect(logPayment).toHaveBeenCalledOnce();
    const options = logPayment.mock.calls[0][2] as { loggedBy: string };
    expect(options.loggedBy).toBe("member@example.com");
  });

  it("passes the entry the person saw on to the service, so an edit can be checked", async () => {
    signedInAs("member@example.com");
    const seen = { tenant: "Asha", count: 4, amount: 5450 };
    const res = await postPayment(
      new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: "2026-10",
          portionId: "p1",
          amount: 6000,
          dateReceived: "2026-10-05",
          overwrite: true,
          expected: seen,
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(logPayment.mock.calls[0][1]).toMatchObject({ overwrite: true, expected: seen });
  });

  it("rejects an entry that is not tenant, count and amount", async () => {
    signedInAs("member@example.com");
    const res = await postPayment(
      new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: "2026-10",
          portionId: "p1",
          amount: 6000,
          dateReceived: "2026-10-05",
          overwrite: true,
          expected: { tenant: "Asha" },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(logPayment).not.toHaveBeenCalled();
  });

  it("marks the write time after a successful log, and not when the log is refused for another reason", async () => {
    signedInAs("member@example.com");
    logPayment.mockRejectedValueOnce(validation("Amount must be a whole number."));
    expect((await postPayment(paymentRequest())).status).toBe(400);
    expect(markWritten).not.toHaveBeenCalled();

    await postPayment(paymentRequest());
    expect(markWritten).toHaveBeenCalledOnce();
  });

  it("marks the write time when the log hits a conflict, so the refresh skips the cache", async () => {
    signedInAs("member@example.com");
    logPayment.mockRejectedValueOnce(conflict("Already recorded."));
    const res = await postPayment(paymentRequest());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    expect(markWritten).toHaveBeenCalledOnce();
  });

  describe("when Google cannot be used", () => {
    const DETAIL = "Google rejected the service account key. Create a new key and update GOOGLE_SERVICE_ACCOUNT_JSON.";
    let log: MockInstance<typeof console.error>;
    beforeEach(() => {
      log = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => log.mockRestore());

    it("shows the owner the detail of a connection problem and a member only a short message", async () => {
      logPayment.mockRejectedValueOnce(configError(DETAIL));
      signedInAs("owner@example.com");
      const asOwner = await postPayment(paymentRequest());
      expect(asOwner.status).toBe(500);
      expect((await asOwner.json()).error.message).toBe(DETAIL);

      logPayment.mockRejectedValueOnce(configError(DETAIL));
      signedInAs("member@example.com");
      const asMember = await postPayment(paymentRequest());
      expect(asMember.status).toBe(500);
      const body = await asMember.json();
      expect(body.error.code).toBe("config");
      expect(body.error.message).toBe("The Sheet connection needs attention. Ask the owner.");
      expect(JSON.stringify(body)).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
      expect(log.mock.calls.flat().join(" ")).toContain(DETAIL);
    });

    it("answers 429 with Retry-After when Google is limiting requests, and 503 when it is not responding", async () => {
      signedInAs("member@example.com");
      logPayment.mockRejectedValueOnce(rateLimited());
      const limited = await postPayment(paymentRequest());
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBe("30");
      expect((await limited.json()).error.code).toBe("rate-limited");

      logPayment.mockRejectedValueOnce(unavailable());
      const down = await postPayment(paymentRequest());
      expect(down.status).toBe(503);
      expect((await down.json()).error.code).toBe("unavailable");
      expect(markWritten).not.toHaveBeenCalled();
    });
  });

  it("answers 401 with the sign-in message for a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await postPayment(paymentRequest());
    expect((await res.json()).error.message).toBe("Sign in with an allowed Google account.");
  });

  describe("tenancy details for a new tenant", () => {
    const newTenantRequest = (extra: Record<string, unknown>) =>
      new Request("http://localhost/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: "2026-10",
          portionId: "p1",
          amount: 6000,
          dateReceived: "2026-10-05",
          newTenantName: "Hari",
          ...extra,
        }),
      });
    const tenancy = {
      phone: "98000 12345",
      moveIn: "2026-10-01",
      agreementEnd: "2027-09-30",
      advance: 12000,
      advanceDate: "2026-09-28",
      notes: "Cheque",
    };

    it("passes the tenancy details on to the service", async () => {
      signedInAs("member@example.com");
      const res = await postPayment(newTenantRequest({ tenancy }));
      expect(res.status).toBe(200);
      expect(logPayment.mock.calls[0][1]).toMatchObject({ newTenantName: "Hari", tenancy });
    });

    it("accepts a tenancy with only a move-in date, and a null advance", async () => {
      signedInAs("member@example.com");
      const res = await postPayment(newTenantRequest({ tenancy: { moveIn: "2026-10-01", advance: null } }));
      expect(res.status).toBe(200);
      expect(logPayment.mock.calls[0][1]).toMatchObject({ tenancy: { moveIn: "2026-10-01", advance: null } });
    });

    it("sends no tenancy when the request has none", async () => {
      signedInAs("member@example.com");
      await postPayment(newTenantRequest({}));
      expect((logPayment.mock.calls[0][1] as { tenancy?: unknown }).tenancy).toBeUndefined();
    });

    it("returns tenancyWritten from the result, true or false", async () => {
      signedInAs("member@example.com");
      logPayment.mockResolvedValueOnce({ logWritten: true, tenancyWritten: false });
      expect(await (await postPayment(newTenantRequest({ tenancy }))).json()).toMatchObject({
        ok: true,
        logWritten: true,
        tenancyWritten: false,
      });
      logPayment.mockResolvedValueOnce({ logWritten: true, tenancyWritten: true });
      expect((await (await postPayment(newTenantRequest({ tenancy }))).json()).tenancyWritten).toBe(true);
    });

    it("rejects tenancy details of the wrong shape", async () => {
      signedInAs("member@example.com");
      for (const bad of [
        { moveIn: 20261001 },
        { advance: "12000", moveIn: "2026-10-01" },
        { notes: 5, moveIn: "2026-10-01" },
        { phone: "1" }, // no move-in
        "details",
      ]) {
        expect((await postPayment(newTenantRequest({ tenancy: bad }))).status).toBe(400);
      }
      expect(logPayment).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/payments/undo", () => {
  const undoRequest = (body: unknown) =>
    new Request("http://localhost/api/payments/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const good = {
    month: "2026-10",
    portionId: "p1",
    expected: { tenant: "Asha", count: 4, amount: 5450 },
  };

  it("rejects visitors who are not on the list", async () => {
    signedInAs("stranger@example.com");
    expect((await postUndo(undoRequest(good))).status).toBe(401);
    expect(undoPayment).not.toHaveBeenCalled();
  });

  it("rejects a visitor who is not signed in at all", async () => {
    signedInAs(null);
    const res = await postUndo(undoRequest(good));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(undoPayment).not.toHaveBeenCalled();
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("lets any listed member undo and records who did it", async () => {
    signedInAs("member@example.com");
    undoPayment.mockResolvedValue({ removed: good.expected, logWritten: true, logRow: [] });
    const res = await postUndo(undoRequest(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      removed: good.expected,
      logWritten: true,
      logRow: [],
    });
    expect(undoPayment).toHaveBeenCalledOnce();
    expect(undoPayment.mock.calls[0][1]).toEqual({
      month: { year: 2026, month: 10 },
      portionId: "p1",
      expected: good.expected,
    });
    expect(undoPayment.mock.calls[0][2]).toMatchObject({ loggedBy: "member@example.com" });
  });

  it("answers 409 when the service reports a conflict, and marks the write time for the refresh", async () => {
    signedInAs("member@example.com");
    undoPayment.mockRejectedValue(conflict("Changed by someone else."));
    const res = await postUndo(undoRequest(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({
      code: "conflict",
      message: "Changed by someone else.",
    });
    expect(markWritten).toHaveBeenCalledOnce();
  });

  it("does not mark the write time when the undo fails for another reason", async () => {
    signedInAs("member@example.com");
    undoPayment.mockRejectedValue(validation("Unknown portion."));
    expect((await postUndo(undoRequest(good))).status).toBe(400);
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("marks the write time after a successful undo", async () => {
    signedInAs("member@example.com");
    undoPayment.mockResolvedValue({ removed: good.expected, logWritten: true, logRow: [] });
    await postUndo(undoRequest(good));
    expect(markWritten).toHaveBeenCalledOnce();
  });

  it("rejects a malformed body", async () => {
    signedInAs("member@example.com");
    expect((await postUndo(undoRequest({ month: "nope" }))).status).toBe(400);
  });
});

describe("POST /api/tenancies", () => {
  const request = (body: unknown) =>
    new Request("http://localhost/api/tenancies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const create = {
    portionId: "p1",
    tenant: "Asha",
    fields: { moveIn: "2026-01-15", advance: 20000, phone: "98765 43210", notes: "Cheque" },
  };
  const update = {
    portionId: "p1",
    tenant: "Asha",
    id: "t-abc",
    expectedUpdatedAt: "2026-01-15T05:00:00.000Z",
    fields: { moveIn: "2026-01-15", advance: null },
  };
  const saved = { tenancy: { id: "t-abc", tenant: "Asha", rowNumber: 2 } };

  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await postTenancy(request(create));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(saveTenancy).not.toHaveBeenCalled();
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("rejects a signed-in address that is not on the list", async () => {
    signedInAs("stranger@example.com");
    expect((await postTenancy(request(create))).status).toBe(401);
    expect(saveTenancy).not.toHaveBeenCalled();
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("lets any listed member save, and records the lower-cased email as who changed it", async () => {
    signedInAs("Member@Example.com");
    saveTenancy.mockResolvedValue(saved);
    const res = await postTenancy(request(create));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...saved });
    expect(saveTenancy).toHaveBeenCalledOnce();
    expect(saveTenancy.mock.calls[0][1]).toEqual({
      portionId: "p1",
      tenant: "Asha",
      fields: create.fields,
      id: undefined,
      expectedUpdatedAt: undefined,
    });
    const options = saveTenancy.mock.calls[0][2] as { updatedBy: string; now: Date };
    expect(options.updatedBy).toBe("member@example.com");
    expect(options.now).toBeInstanceOf(Date);
  });

  it("passes the id and the updated-at the person saw when updating", async () => {
    signedInAs("owner@example.com");
    saveTenancy.mockResolvedValue(saved);
    expect((await postTenancy(request(update))).status).toBe(200);
    expect(saveTenancy.mock.calls[0][1]).toMatchObject({
      id: "t-abc",
      expectedUpdatedAt: "2026-01-15T05:00:00.000Z",
      fields: { moveIn: "2026-01-15", advance: null },
    });
  });

  it("accepts an empty updated-at, which a hand-typed row has", async () => {
    signedInAs("member@example.com");
    saveTenancy.mockResolvedValue(saved);
    expect((await postTenancy(request({ ...update, expectedUpdatedAt: "" }))).status).toBe(200);
    expect(saveTenancy.mock.calls[0][1]).toMatchObject({ id: "t-abc", expectedUpdatedAt: "" });
  });

  it.each([
    ["a missing portionId", { ...create, portionId: undefined }],
    ["an empty portionId", { ...create, portionId: "" }],
    ["a portionId over 20 characters", { ...create, portionId: "p".repeat(21) }],
    ["a missing tenant", { ...create, tenant: undefined }],
    ["no fields", { portionId: "p1", tenant: "Asha" }],
    ["a move-in date that is not text", { ...create, fields: { moveIn: 20260115 } }],
    ["no move-in date", { ...create, fields: { advance: 5 } }],
    ["an advance that is text", { ...create, fields: { moveIn: "2026-01-15", advance: "20000" } }],
    ["notes that are not text", { ...create, fields: { moveIn: "2026-01-15", notes: 5 } }],
    ["an id without expectedUpdatedAt", { ...update, expectedUpdatedAt: undefined }],
    ["an empty id", { ...update, id: "" }],
    ["an expectedUpdatedAt that is not text", { ...update, expectedUpdatedAt: 5 }],
    ["a body that is not an object", "details"],
  ])("answers 400 for %s, and does not call the service", async (_name, body) => {
    signedInAs("member@example.com");
    const res = await postTenancy(request(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect(saveTenancy).not.toHaveBeenCalled();
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not JSON", async () => {
    signedInAs("member@example.com");
    const res = await postTenancy(
      new Request("http://localhost/api/tenancies", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
    expect(saveTenancy).not.toHaveBeenCalled();
  });

  it("names expectedUpdatedAt when an update does not carry it", async () => {
    signedInAs("member@example.com");
    const res = await postTenancy(request({ ...update, expectedUpdatedAt: undefined }));
    expect((await res.json()).error.message).toMatch(/expectedUpdatedAt/);
  });

  it("answers 409 on a conflict, and marks the write time for the refresh", async () => {
    signedInAs("member@example.com");
    saveTenancy.mockRejectedValue(conflict("Asha was changed by someone else. Refresh the page and try again."));
    const res = await postTenancy(request(update));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "conflict" });
    expect(markWritten).toHaveBeenCalledOnce();
  });

  it("does not mark the write time when the save fails validation", async () => {
    signedInAs("member@example.com");
    saveTenancy.mockRejectedValue(validation("Phone has a letter."));
    expect((await postTenancy(request(create))).status).toBe(400);
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("marks the write time after a successful save", async () => {
    signedInAs("member@example.com");
    saveTenancy.mockResolvedValue(saved);
    await postTenancy(request(create));
    expect(markWritten).toHaveBeenCalledOnce();
  });
});

describe("POST /api/tenancies/move-out", () => {
  const request = (body: unknown) =>
    new Request("http://localhost/api/tenancies/move-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const good = {
    id: "t-abc",
    expectedUpdatedAt: "2026-01-15T05:00:00.000Z",
    moveOut: "2026-09-30",
    advanceStatus: "Refunded",
    refund: 18000,
    deductions: 2000,
    notes: "Left the keys",
  };
  const closed = { tenancy: { id: "t-abc", moveOut: "2026-09-30" } };

  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await postMoveOut(request(good));
    expect(res.status).toBe(401);
    expect(moveOutTenancy).not.toHaveBeenCalled();
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("rejects a signed-in address that is not on the list", async () => {
    signedInAs("stranger@example.com");
    expect((await postMoveOut(request(good))).status).toBe(401);
    expect(moveOutTenancy).not.toHaveBeenCalled();
  });

  it("lets any listed member move a tenant out, and records the lower-cased email", async () => {
    signedInAs("Member@Example.com");
    moveOutTenancy.mockResolvedValue(closed);
    const res = await postMoveOut(request(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...closed });
    expect(moveOutTenancy).toHaveBeenCalledOnce();
    expect(moveOutTenancy.mock.calls[0][1]).toEqual(good);
    expect((moveOutTenancy.mock.calls[0][2] as { updatedBy: string }).updatedBy).toBe("member@example.com");
  });

  it("accepts only the date, an empty updated-at, nulls and each advance outcome", async () => {
    signedInAs("member@example.com");
    moveOutTenancy.mockResolvedValue(closed);
    const bodies = [
      { id: "t-abc", expectedUpdatedAt: "", moveOut: "2026-09-30" },
      { ...good, advanceStatus: null, refund: null, deductions: null },
      { ...good, advanceStatus: "Held" },
      { ...good, advanceStatus: "Adjusted" },
    ];
    for (const body of bodies) expect((await postMoveOut(request(body))).status).toBe(200);
    expect(moveOutTenancy).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["a missing id", { ...good, id: undefined }],
    ["an empty id", { ...good, id: "" }],
    ["a missing expectedUpdatedAt", { ...good, expectedUpdatedAt: undefined }],
    ["a missing move-out date", { ...good, moveOut: undefined }],
    ["a move-out date that is not text", { ...good, moveOut: 20260930 }],
    ["an unknown advance outcome", { ...good, advanceStatus: "Lost" }],
    ["a refund that is text", { ...good, refund: "18000" }],
    ["deductions that are text", { ...good, deductions: "2000" }],
    ["notes that are not text", { ...good, notes: 5 }],
    ["a body that is not an object", 5],
  ])("answers 400 for %s, and does not call the service", async (_name, body) => {
    signedInAs("member@example.com");
    const res = await postMoveOut(request(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect(moveOutTenancy).not.toHaveBeenCalled();
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("answers 409 on a conflict, and marks the write time for the refresh", async () => {
    signedInAs("member@example.com");
    moveOutTenancy.mockRejectedValue(conflict("Asha has already moved out. Refresh the page."));
    const res = await postMoveOut(request(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "conflict" });
    expect(markWritten).toHaveBeenCalledOnce();
  });

  it("does not mark the write time when the move-out fails validation", async () => {
    signedInAs("member@example.com");
    moveOutTenancy.mockRejectedValue(validation("Move-out date cannot be before the move-in date."));
    expect((await postMoveOut(request(good))).status).toBe(400);
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("marks the write time after a successful move-out", async () => {
    signedInAs("member@example.com");
    moveOutTenancy.mockResolvedValue(closed);
    await postMoveOut(request(good));
    expect(markWritten).toHaveBeenCalledOnce();
  });
});

describe("POST /api/payments/log-retry", () => {
  const row = [
    "2026-10-05T04:30:00.000Z",
    "2026-10",
    "First floor, single bedroom",
    "Asha",
    5450,
    4,
    "",
    "forged@example.com",
    "Undone",
  ];
  const retryRequest = () =>
    new Request("http://localhost/api/payments/log-retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row }),
    });

  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await postRetry(retryRequest());
    expect(res.status).toBe(401);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("rejects a signed-in address that is not on the list", async () => {
    signedInAs("stranger@example.com");
    const res = await postRetry(retryRequest());
    expect(res.status).toBe(401);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("writes the signed-in email as who logged it, whatever the request says", async () => {
    signedInAs("Member@Example.com");
    const res = await postRetry(retryRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, logWritten: true });
    expect(retryLogRow).toHaveBeenCalledOnce();
    const sent = retryLogRow.mock.calls[0][1] as unknown[];
    expect(sent[7]).toBe("member@example.com");
    expect(sent).toEqual([...row.slice(0, 7), "member@example.com", "Undone"]);
  });
});

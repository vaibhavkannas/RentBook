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
const moveOutWithoutDetails = vi.hoisted(() => vi.fn());
const prepareSheet = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ created: string[]; filled: string[] }>>(async () => ({ created: ["Tenants"], filled: [] })));

vi.mock("@/auth", () => ({ auth }));
// getViewer waits for a request with connection(), which Next refuses outside a request: the routes run here without one.
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ markWritten, readWrittenAt: vi.fn(async () => undefined) }));
vi.mock("@/lib/sheets/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets/service")>()),
  saveSettings,
  logPayment,
  undoPayment,
  retryLogRow,
}));
vi.mock("@/lib/sheets/prepare", () => ({ prepareSheet }));
vi.mock("@/lib/sheets/tenancy-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets/tenancy-service")>()),
  saveTenancy,
  moveOutTenancy,
  moveOutWithoutDetails,
}));

import { AppError, conflict, configError, rateLimited, unavailable, validation } from "@/lib/errors";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";
import { createRetryToken, RETRY_TOKEN_MAX_AGE_MS } from "@/lib/server/retry-token";
import { POST as postRetry } from "@/app/api/payments/log-retry/route";
import { POST as postPayment } from "@/app/api/payments/route";
import { POST as postUndo } from "@/app/api/payments/undo/route";
import { POST as postMoveOut } from "@/app/api/tenancies/move-out/route";
import { POST as postTenancy } from "@/app/api/tenancies/route";
import { POST as postPrepare } from "@/app/api/setup/prepare/route";
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

const SECRET = "a-test-secret-that-is-at-least-32-characters-long";

// Every refused request is logged as one line (see handle): held back, so the output stays clean.
let logs: LogSpies;
let savedEnv: string | undefined;
beforeEach(() => {
  logs = captureLogs();
  savedEnv = process.env.ALLOWED_EMAILS;
  process.env.ALLOWED_EMAILS = "owner@example.com, member@example.com";
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
  saveSettings.mockClear();
  logPayment.mockClear();
  undoPayment.mockReset();
  retryLogRow.mockClear();
  markWritten.mockClear();
  saveTenancy.mockReset();
  moveOutTenancy.mockReset();
  moveOutWithoutDetails.mockReset();
  prepareSheet.mockClear();
});
afterEach(() => {
  for (const spy of Object.values(logs)) spy.mockRestore();
  vi.unstubAllEnvs();
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
    expect(markWritten.mock.calls).toEqual([["owner@example.com"]]);
  });
});

describe("POST /api/setup/prepare", () => {
  const prepareRequest = (body: unknown = {}) =>
    new Request("http://localhost/api/setup/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rejects a visitor who is not signed in, and an address that is not on the list", async () => {
    for (const email of [null, "stranger@example.com"]) {
      signedInAs(email);
      const res = await postPrepare(prepareRequest());
      expect(res.status).toBe(401);
    }
    expect(prepareSheet).not.toHaveBeenCalled();
  });

  it("rejects a listed member who is not the owner", async () => {
    signedInAs("member@example.com");
    const res = await postPrepare(prepareRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(prepareSheet).not.toHaveBeenCalled();
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("lets the owner prepare the Sheet, and answers with the tabs it made and the tabs it filled", async () => {
    signedInAs("Owner@Example.com");
    prepareSheet.mockResolvedValueOnce({ created: ["Settings"], filled: ["Tenants"] });
    const res = await postPrepare(prepareRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, created: ["Settings"], filled: ["Tenants"] });
    expect(prepareSheet).toHaveBeenCalledOnce();
  });

  it("marks the write time after a success, so the owner's next page is read fresh, and not when it is refused", async () => {
    signedInAs("member@example.com");
    await postPrepare(prepareRequest());
    expect(markWritten).not.toHaveBeenCalled();
    signedInAs("owner@example.com");
    await postPrepare(prepareRequest());
    expect(markWritten.mock.calls).toEqual([["owner@example.com"]]);
  });

  it("does not mark the write time when the Sheet refuses, and tells the owner why", async () => {
    signedInAs("owner@example.com");
    prepareSheet.mockRejectedValueOnce(new AppError("sheet-structure", "The Settings tab is missing."));
    const res = await postPrepare(prepareRequest());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("The Settings tab is missing.");
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("marks the write time after a conflict, as every write does", async () => {
    signedInAs("owner@example.com");
    prepareSheet.mockRejectedValueOnce(conflict("Your Sheet may not be fully prepared."));
    expect((await postPrepare(prepareRequest())).status).toBe(409);
    expect(markWritten).toHaveBeenCalledOnce();
  });

  it("takes an empty request and nothing else", async () => {
    signedInAs("owner@example.com");
    for (const body of [{ created: ["Tenants"] }, [], null, "x"]) {
      const res = await postPrepare(prepareRequest(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(prepareSheet).not.toHaveBeenCalled();
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
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
  });

  it("marks the write time when the log hits a conflict, so the refresh skips the cache", async () => {
    signedInAs("member@example.com");
    logPayment.mockRejectedValueOnce(conflict("Already recorded."));
    const res = await postPayment(paymentRequest());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
  });

  describe("when the Payments Log entry did not save", () => {
    const LOG_ROW = [
      "2026-10-05T04:30:00.000Z",
      "2026-10",
      "First floor, single bedroom",
      "Asha",
      5450,
      4,
      "2026-10-05",
      "member@example.com",
      "Logged",
    ];

    it("returns a retry token instead of the row", async () => {
      signedInAs("Member@Example.com");
      logPayment.mockResolvedValueOnce({
        logWritten: false,
        logRow: LOG_ROW,
        entry: { tenant: "Asha", count: 4, amount: 5450 },
      } as never);
      const body = await (await postPayment(paymentRequest())).json();
      expect(body).toMatchObject({ ok: true, logWritten: false, entry: { tenant: "Asha", count: 4, amount: 5450 } });
      expect(typeof body.retryToken).toBe("string");
      expect(body.retryToken.length).toBeLessThan(2000);
      expect(body).not.toHaveProperty("logRow");
      expect(JSON.stringify(body)).not.toContain("First floor");
    });

    it("returns neither a token nor the row when the entry saved", async () => {
      signedInAs("member@example.com");
      logPayment.mockResolvedValueOnce({ logWritten: true, logRow: LOG_ROW } as never);
      const body = await (await postPayment(paymentRequest())).json();
      expect(body).toEqual({ ok: true, logWritten: true });
    });

    it("makes a token that only this person's retry accepts", async () => {
      logPayment.mockResolvedValue({ logWritten: false, logRow: LOG_ROW } as never);
      signedInAs("member@example.com");
      const { retryToken } = await (await postPayment(paymentRequest())).json();
      expect((await postRetry(retryTokenRequest(retryToken))).status).toBe(200);
      signedInAs("owner@example.com");
      expect((await postRetry(retryTokenRequest(retryToken))).status).toBe(400);
    });
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
    expect(await res.json()).toEqual({ ok: true, removed: good.expected, logWritten: true });
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
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
  });

  it("does not mark the write time when the undo fails for another reason", async () => {
    signedInAs("member@example.com");
    undoPayment.mockRejectedValue(validation("That portion isn't in your Settings any more. Tap another tab at the bottom of the screen and come back, then check the cards."));
    expect((await postUndo(undoRequest(good))).status).toBe(400);
    expect(markWritten).not.toHaveBeenCalled();
  });

  it("returns a retry token instead of the row when the log entry did not save", async () => {
    signedInAs("member@example.com");
    undoPayment.mockResolvedValue({
      removed: good.expected,
      logWritten: false,
      logRow: ["2026-10-05T04:30:00.000Z", "2026-10", "First floor, single bedroom", "Asha", 5450, 4, "", "member@example.com", "Undone"],
    });
    const body = await (await postUndo(undoRequest(good))).json();
    expect(body).toMatchObject({ ok: true, removed: good.expected, logWritten: false });
    expect(typeof body.retryToken).toBe("string");
    expect(body).not.toHaveProperty("logRow");
    expect(JSON.stringify(body)).not.toContain("First floor");
  });

  it("marks the write time after a successful undo", async () => {
    signedInAs("member@example.com");
    undoPayment.mockResolvedValue({ removed: good.expected, logWritten: true, logRow: [] });
    await postUndo(undoRequest(good));
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
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
      new Request("http://localhost/api/tenancies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(saveTenancy).not.toHaveBeenCalled();
  });

  it("says the page is out of date, and gives expectedUpdatedAt as the field, when an update does not carry it", async () => {
    signedInAs("member@example.com");
    const res = await postTenancy(request({ ...update, expectedUpdatedAt: undefined }));
    expect((await res.json()).error).toMatchObject({
      message: "This page is out of date. Tap another tab at the bottom of the screen and come back, then try again.",
      details: { field: "expectedUpdatedAt" },
    });
  });

  it("answers 409 on a conflict, and marks the write time for the refresh", async () => {
    signedInAs("member@example.com");
    saveTenancy.mockRejectedValue(conflict("Asha was changed by someone else. Tap another tab at the bottom of the screen and come back, then try again."));
    const res = await postTenancy(request(update));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "conflict" });
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
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
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
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
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
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
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
  });

  describe("with no details on file: the portion, the tenant and the day, with no id", () => {
    const record = { portionId: "p1", tenant: "Asha", moveOut: "2026-10-20", notes: "Left the keys" };
    const recorded = { tenancy: { id: "t-new", moveOut: "2026-10-20" } };

    it("rejects a visitor who is not signed in, and a signed-in address that is not on the list", async () => {
      signedInAs(null);
      expect((await postMoveOut(request(record))).status).toBe(401);
      signedInAs("stranger@example.com");
      expect((await postMoveOut(request(record))).status).toBe(401);
      expect(moveOutWithoutDetails).not.toHaveBeenCalled();
      expect(markWritten).not.toHaveBeenCalled();
    });

    it("lets any listed member record it, with the lower-cased email, and does not close details", async () => {
      signedInAs("Member@Example.com");
      moveOutWithoutDetails.mockResolvedValue(recorded);
      const res = await postMoveOut(request(record));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, ...recorded });
      expect(moveOutWithoutDetails).toHaveBeenCalledOnce();
      expect(moveOutWithoutDetails.mock.calls[0][1]).toEqual(record);
      expect((moveOutWithoutDetails.mock.calls[0][2] as { updatedBy: string }).updatedBy).toBe("member@example.com");
      expect(moveOutTenancy).not.toHaveBeenCalled();
    });

    it("takes the notes as optional", async () => {
      signedInAs("member@example.com");
      moveOutWithoutDetails.mockResolvedValue(recorded);
      const bare = { portionId: record.portionId, tenant: record.tenant, moveOut: record.moveOut };
      expect((await postMoveOut(request(bare))).status).toBe(200);
      expect(moveOutWithoutDetails.mock.calls[0][1]).toEqual(bare);
    });

    it("sends a body with an id to the details on file, and a body without one here, never both", async () => {
      signedInAs("member@example.com");
      moveOutTenancy.mockResolvedValue(closed);
      moveOutWithoutDetails.mockResolvedValue(recorded);
      await postMoveOut(request(good));
      await postMoveOut(request(record));
      expect(moveOutTenancy).toHaveBeenCalledOnce();
      expect(moveOutWithoutDetails).toHaveBeenCalledOnce();
    });

    it.each([
      ["neither an id nor a portion", { tenant: "Asha", moveOut: "2026-10-20" }],
      ["a portion with no tenant", { portionId: "p1", moveOut: "2026-10-20" }],
      ["a tenant with no portion", { tenant: "Asha", moveOut: "2026-10-20" }],
      ["a blank tenant", { ...record, tenant: "  " }],
      ["a missing move-out date", { ...record, moveOut: undefined }],
      ["a day that is not a day", { ...record, moveOut: "2026-02-30" }],
      ["notes that are not text", { ...record, notes: 5 }],
    ])("answers 400 for %s, and does not call a service", async (_name, body) => {
      signedInAs("member@example.com");
      const res = await postMoveOut(request(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("validation");
      expect(moveOutTenancy).not.toHaveBeenCalled();
      expect(moveOutWithoutDetails).not.toHaveBeenCalled();
      expect(markWritten).not.toHaveBeenCalled();
    });

    it("answers 409 on a conflict and marks the write time, so the page behind it is fresh", async () => {
      signedInAs("member@example.com");
      moveOutWithoutDetails.mockRejectedValue(conflict("Asha has already moved out. Tap another tab."));
      const res = await postMoveOut(request(record));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatchObject({ code: "conflict" });
      expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
    });

    it("answers a day before the tenant's rent with the field, and does not mark the write time", async () => {
      signedInAs("member@example.com");
      moveOutWithoutDetails.mockRejectedValue(
        validation("Rent is logged for September 2026. Choose a move-out date in September 2026 or later, or undo that payment first.", "moveOut"),
      );
      const res = await postMoveOut(request(record));
      expect(res.status).toBe(400);
      expect((await res.json()).error.details).toEqual({ field: "moveOut" });
      expect(markWritten).not.toHaveBeenCalled();
    });

    it("marks the write time after a successful record", async () => {
      signedInAs("member@example.com");
      moveOutWithoutDetails.mockResolvedValue(recorded);
      await postMoveOut(request(record));
      expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
    });
  });
});

function retryTokenRequest(token: unknown) {
  return new Request("http://localhost/api/payments/log-retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

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
  ] as const;
  const tokenFor = (viewer: string, now = Date.now()) => createRetryToken([...row], viewer, now);

  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await postRetry(retryTokenRequest(tokenFor("member@example.com")));
    expect(res.status).toBe(401);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("rejects a signed-in address that is not on the list", async () => {
    signedInAs("stranger@example.com");
    const res = await postRetry(retryTokenRequest(tokenFor("stranger@example.com")));
    expect(res.status).toBe(401);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("writes the row of the token, with the signed-in email as who logged it", async () => {
    signedInAs("Member@Example.com");
    const res = await postRetry(retryTokenRequest(tokenFor("member@example.com")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, logWritten: true });
    expect(retryLogRow).toHaveBeenCalledOnce();
    const sent = retryLogRow.mock.calls[0][1] as unknown[];
    expect(sent).toEqual([...row.slice(0, 7), "member@example.com", "Undone"]);
  });

  it("rejects a request that carries a row and no token, so a row can never be forged", async () => {
    signedInAs("member@example.com");
    const forged = new Request("http://localhost/api/payments/log-retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row }),
    });
    const res = await postRetry(forged);
    expect(res.status).toBe(400);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("uses only the token when a row is sent along with it", async () => {
    signedInAs("member@example.com");
    const both = new Request("http://localhost/api/payments/log-retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenFor("member@example.com"), row: ["x", "x", "x", "x", 1, 1, "x", "x", "Logged"] }),
    });
    expect((await postRetry(both)).status).toBe(200);
    expect((retryLogRow.mock.calls[0][1] as unknown[])[3]).toBe("Asha");
  });

  it.each([
    ["an empty token", ""],
    ["a token that is not text", 5],
    ["a token over 2000 characters", "a".repeat(2001)],
  ])("rejects %s", async (_name, token) => {
    signedInAs("member@example.com");
    expect((await postRetry(retryTokenRequest(token))).status).toBe(400);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("rejects a token whose payload was changed", async () => {
    signedInAs("member@example.com");
    const [payload, mac] = tokenFor("member@example.com").split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    edited.row[4] = 1;
    const tampered = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${mac}`;
    const res = await postRetry(retryTokenRequest(tampered));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("rejects a token that is not signed with this deployment's secret", async () => {
    signedInAs("member@example.com");
    vi.stubEnv("AUTH_SECRET", "another-secret-that-is-also-32-characters-long");
    const foreign = tokenFor("member@example.com");
    vi.stubEnv("AUTH_SECRET", SECRET);
    expect((await postRetry(retryTokenRequest(foreign))).status).toBe(400);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    signedInAs("member@example.com");
    const old = tokenFor("member@example.com", Date.now() - RETRY_TOKEN_MAX_AGE_MS - 1_000);
    const res = await postRetry(retryTokenRequest(old));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/expired/);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("rejects a token that was made for someone else", async () => {
    signedInAs("owner@example.com");
    const res = await postRetry(retryTokenRequest(tokenFor("member@example.com")));
    expect(res.status).toBe(400);
    expect(retryLogRow).not.toHaveBeenCalled();
  });

  it("marks the write time for the person, so their next Activity view is not answered from the cache", async () => {
    signedInAs("Member@Example.com");
    await postRetry(retryTokenRequest(tokenFor("member@example.com")));
    expect(markWritten.mock.calls).toEqual([["member@example.com"]]);
  });

  it("lets the same token be sent again: the service adds the row only once", async () => {
    signedInAs("member@example.com");
    const token = tokenFor("member@example.com");
    expect((await postRetry(retryTokenRequest(token))).status).toBe(200);
    expect((await postRetry(retryTokenRequest(token))).status).toBe(200);
    expect(retryLogRow).toHaveBeenCalledTimes(2);
    expect(retryLogRow.mock.calls[1][1]).toEqual(retryLogRow.mock.calls[0][1]);
  });
});

// Request integrity: every route refuses a request that did not come from the app's own page as JSON, and a body
// over 32 KB, before it asks who is signed in.
// A refusal says what is wrong in plain words and names the field in details.field, so a screen can show it beside the
// field. The words carry no field path, no "JSON" and no ISO month.
describe("a 400 answer: plain words, and the field", () => {
  const json = (url: string, body: unknown, method = "POST") =>
    new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const answer = async (res: Response) => (await res.json()).error as { code: string; message: string; details?: { field?: string } };
  const payment = { month: "2026-10", portionId: "p1", amount: 5450, dateReceived: "2026-10-05" };

  it("names the month on a payment for a month that is not one", async () => {
    signedInAs("member@example.com");
    const res = await postPayment(json("http://localhost/api/payments", { ...payment, month: "Oct" }));
    expect(res.status).toBe(400);
    expect(await answer(res)).toMatchObject({
      code: "validation",
      message: "That month isn't valid. Open it again from the month screen.",
      details: { field: "month" },
    });
    expect(logPayment).not.toHaveBeenCalled();
  });

  it("names the date received, in words that need no format", async () => {
    signedInAs("member@example.com");
    const res = await postPayment(json("http://localhost/api/payments", { ...payment, dateReceived: "05/10/2026" }));
    expect(await answer(res)).toMatchObject({ message: "Date received isn't a real date.", details: { field: "dateReceived" } });
  });

  it("names the amount when it is not a number", async () => {
    signedInAs("member@example.com");
    const res = await postPayment(json("http://localhost/api/payments", { ...payment, amount: "5k" }));
    expect(await answer(res)).toMatchObject({ message: "The amount field isn't valid.", details: { field: "amount" } });
  });

  it("names a field inside the tenancy details by its path, and says the field's name in the message", async () => {
    signedInAs("member@example.com");
    const res = await postTenancy(
      json("http://localhost/api/tenancies", { portionId: "p1", tenant: "Asha", fields: { moveIn: "2026-01-15", phone: "9".repeat(31) } }),
    );
    expect(res.status).toBe(400);
    expect(await answer(res)).toMatchObject({ message: "Phone can have at most 30 characters.", details: { field: "fields.phone" } });
  });

  it("names a portion's row in the settings, with its position", async () => {
    signedInAs("owner@example.com");
    const res = await putSettings(
      json(
        "http://localhost/api/settings",
        { portions: [{ id: "p1", name: "Ground", cycleLength: 11, hikePercent: 5 }, { id: "p2", name: " ", cycleLength: 11, hikePercent: 5 }] },
        "PUT",
      ),
    );
    expect(await answer(res)).toMatchObject({ message: "Portion name must be 1 to 60 characters.", details: { field: "portions.1.name" } });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("says the page is out of date, not that a value is missing, when an edit has no updated-at", async () => {
    signedInAs("member@example.com");
    const res = await postTenancy(
      json("http://localhost/api/tenancies", { portionId: "p1", tenant: "Asha", id: "t-abc", fields: { moveIn: "2026-01-15" } }),
    );
    const error = await answer(res);
    expect(error.message).toBe("This page is out of date. Tap another tab at the bottom of the screen and come back, then try again.");
    expect(error.message).not.toMatch(/updated-at|expectedUpdatedAt|\bid\b/);
  });

  it("passes on the field a service gave its refusal (the amount, the new tenant's name, the move-out date)", async () => {
    signedInAs("member@example.com");
    logPayment.mockRejectedValueOnce(validation("Amount must be whole rupees, from ₹ 1 to ₹ 1,00,00,000.", "amount"));
    expect(await answer(await postPayment(json("http://localhost/api/payments", payment)))).toMatchObject({
      message: "Amount must be whole rupees, from ₹ 1 to ₹ 1,00,00,000.",
      details: { field: "amount" },
    });
    logPayment.mockRejectedValueOnce(validation("This portion has no tenant yet. Enter a tenant name.", "newTenantName"));
    expect((await answer(await postPayment(json("http://localhost/api/payments", payment)))).details).toEqual({ field: "newTenantName" });
    moveOutTenancy.mockRejectedValueOnce(validation("Move-out date cannot be before the move-in date.", "moveOut"));
    const moveOut = { id: "t-abc", expectedUpdatedAt: "2026-01-15T05:00:00.000Z", moveOut: "2026-09-30" };
    expect((await answer(await postMoveOut(json("http://localhost/api/tenancies/move-out", moveOut)))).details).toEqual({
      field: "moveOut",
    });
  });

  it("says the request could not be read, without the word JSON, when the body is not JSON", async () => {
    signedInAs("member@example.com");
    const res = await postPayment(
      new Request("http://localhost/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" }),
    );
    expect(res.status).toBe(400);
    expect((await answer(res)).message).toBe("That request couldn't be read. Tap another tab at the bottom of the screen and come back, then try again.");
  });

  it("says the same, with the 415 it had, when the request is not sent as JSON at all", async () => {
    signedInAs("member@example.com");
    const res = await postPayment(
      new Request("http://localhost/api/payments", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" }),
    );
    expect(res.status).toBe(415);
    expect((await answer(res)).message).toBe("That request couldn't be read. Tap another tab at the bottom of the screen and come back, then try again.");
  });
});

describe("request integrity on every route", () => {
  const ROUTES: [string, (request: Request) => Promise<Response>, string, string][] = [
    ["POST /api/payments", postPayment, "POST", "http://localhost/api/payments"],
    ["POST /api/payments/undo", postUndo, "POST", "http://localhost/api/payments/undo"],
    ["POST /api/payments/log-retry", postRetry, "POST", "http://localhost/api/payments/log-retry"],
    ["POST /api/tenancies", postTenancy, "POST", "http://localhost/api/tenancies"],
    ["POST /api/tenancies/move-out", postMoveOut, "POST", "http://localhost/api/tenancies/move-out"],
    ["PUT /api/settings", putSettings, "PUT", "http://localhost/api/settings"],
    ["POST /api/setup/prepare", postPrepare, "POST", "http://localhost/api/setup/prepare"],
  ];
  const SERVICES = [saveSettings, logPayment, undoPayment, retryLogRow, saveTenancy, moveOutTenancy, moveOutWithoutDetails, prepareSheet];

  const make = (method: string, url: string, headers: Record<string, string>, body: string) =>
    new Request(url, { method, headers, body });
  const JSON_TYPE = { "Content-Type": "application/json" };

  describe.each(ROUTES)("%s", (_name, handler, method, url) => {
    it("refuses a cross-site request with 403 before it asks who is signed in", async () => {
      signedInAs("owner@example.com");
      const res = await handler(make(method, url, { ...JSON_TYPE, "Sec-Fetch-Site": "cross-site" }, "{}"));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("forbidden");
      expect(auth).not.toHaveBeenCalled();
      for (const service of SERVICES) expect(service).not.toHaveBeenCalled();
    });

    it("refuses an Origin that is not this host with 403", async () => {
      signedInAs("owner@example.com");
      const res = await handler(make(method, url, { ...JSON_TYPE, Origin: "https://evil.example" }, "{}"));
      expect(res.status).toBe(403);
      expect(auth).not.toHaveBeenCalled();
    });

    it.each([
      ["plain text", { "Content-Type": "text/plain" }],
      ["a form", { "Content-Type": "application/x-www-form-urlencoded" }],
      ["no content type", {}],
    ])("refuses %s with 415 before it asks who is signed in", async (_case, headers) => {
      signedInAs("owner@example.com");
      const res = await handler(make(method, url, headers, "{}"));
      expect(res.status).toBe(415);
      expect((await res.json()).error.code).toBe("validation");
      expect(auth).not.toHaveBeenCalled();
    });

    it("answers a refusal with the request id of the request, and logs it with the route", async () => {
      signedInAs("owner@example.com");
      const id = "iad1::sfo1::abcde-1760592600000-0123456789ab";
      const res = await handler(make(method, `${url}?x=1`, { "Content-Type": "text/plain", "x-vercel-id": id }, "{}"));
      expect(res.status).toBe(415);
      expect((await res.json()).requestId).toBe(id);
      expect(loggedLines(logs.info)).toEqual([
        expect.objectContaining({ level: "info", code: "validation", requestId: id, route: new URL(url).pathname }),
      ]);
    });

    it("refuses a body over 32 KB with 413, even from someone who is not signed in", async () => {
      signedInAs(null);
      const big = JSON.stringify({ filler: "x".repeat(32 * 1024) });
      const res = await handler(make(method, url, JSON_TYPE, big));
      expect(res.status).toBe(413);
      expect((await res.json()).error.code).toBe("validation");
      expect(auth).not.toHaveBeenCalled();
    });

    it("refuses on the announced length alone", async () => {
      signedInAs(null);
      const res = await handler(make(method, url, { ...JSON_TYPE, "Content-Length": String(40 * 1024) }, "{}"));
      expect(res.status).toBe(413);
      expect(auth).not.toHaveBeenCalled();
    });

    it("lets the app's own request through to the sign-in check", async () => {
      signedInAs(null);
      const res = await handler(
        make(method, url, { ...JSON_TYPE, "Sec-Fetch-Site": "same-origin", Origin: "http://localhost" }, "{}"),
      );
      expect(res.status).toBe(401);
      expect(auth).toHaveBeenCalled();
    });
  });
});

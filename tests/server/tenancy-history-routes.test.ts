import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real routes and the real services on an in-memory Sheet (only the sign-in, the freshness cookie and the connection are
// replaced): a tenancy change whose history cannot be written is still saved, the answer carries a token and never the rows,
// and the browser's one retry puts the rows in the Tenancy Log exactly once.

const auth = vi.hoisted(() => vi.fn());
const holder = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => holder.ctx }));
vi.mock("@/lib/server/freshness", () => ({ markWritten: vi.fn(async () => undefined), readWrittenAt: vi.fn(async () => undefined) }));

import { POST as postHistoryRetry } from "@/app/api/tenancies/history-retry/route";
import { POST as postMoveOut } from "@/app/api/tenancies/move-out/route";
import { POST as postPayment } from "@/app/api/payments/route";
import { POST as postTenancy } from "@/app/api/tenancies/route";
import { getSettings, type SheetsContext } from "@/lib/sheets/service";
import { HISTORY_LIMIT_MS, TENANCY_LOG_HEADERS, TENANCY_LOG_TAB } from "@/lib/sheets/tenancy-log-store";
import { TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";
import { captureLogs, type LogSpies } from "../support/logs";

const SECRET = "a-test-secret-that-is-at-least-32-characters-long";
let logs: LogSpies;
let fake: FakeGateway;

beforeEach(async () => {
  logs = captureLogs();
  process.env.ALLOWED_EMAILS = "owner@example.com, member@example.com";
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
  auth.mockResolvedValue({ user: { email: "member@example.com" } });
  fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  holder.ctx = ctx;
  await getSettings(ctx);
  fake.calls = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete process.env.ALLOWED_EMAILS;
});

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const CREATE = { portionId: "p1", tenant: "Asha", fields: { moveIn: "2026-01-15", agreementEnd: "2027-01-14", phone: "CANARY-PHONE", notes: "CANARY-NOTE" } };
const history = () => fake.tabs.get(TENANCY_LOG_TAB)!.slice(1);

/** A function that makes Tenancy Log appends fail while it is on. */
const failHistory = () => fake.failOn.add("appendRows");
const stopFailing = () => fake.failOn.delete("appendRows");

describe("a tenancy saved while the Tenancy Log works", () => {
  it("answers with the tenancy and historyWritten, and the Tenancy Log holds the Added row with the person", async () => {
    const res = await postTenancy(post("/api/tenancies", CREATE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, historyWritten: true, tenancy: { tenant: "Asha" } });
    expect(body).not.toHaveProperty("historyRows");
    expect(body).not.toHaveProperty("historyRetryToken");
    expect(history()).toEqual([[expect.any(String), body.tenancy.id, "p1", "Added", "", "", "", "member@example.com"]]);
    expect(fake.tabs.get(TENANCY_LOG_TAB)![0]).toEqual(TENANCY_LOG_HEADERS);
  });
});

describe("a tenancy saved while the Tenancy Log cannot be written", () => {
  it("is saved, tells the browser how to retry, and a retry adds the rows once, however often it is sent", async () => {
    failHistory();
    const res = await postTenancy(post("/api/tenancies", CREATE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, historyWritten: false, tenancy: { tenant: "Asha", phone: "CANARY-PHONE" } });
    expect(body).not.toHaveProperty("historyRows");
    expect(typeof body.historyRetryToken).toBe("string");
    expect(fake.tabs.get(TENANTS_TAB)!.slice(1).map((row) => row[2])).toEqual(["Asha"]);
    expect(history()).toEqual([]);
    // the token and the answer hold no phone number, note or name
    expect(JSON.stringify(body.historyRetryToken) + Buffer.from(body.historyRetryToken.split(".")[0], "base64url").toString()).not.toMatch(/CANARY|Asha/);

    stopFailing();
    const retry = await postHistoryRetry(post("/api/tenancies/history-retry", { token: body.historyRetryToken }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, historyWritten: true });
    expect(history()).toEqual([[expect.any(String), body.tenancy.id, "p1", "Added", "", "", "", "member@example.com"]]);
    // again, and again: nothing more is added
    for (let again = 0; again < 2; again++) {
      expect(await (await postHistoryRetry(post("/api/tenancies/history-retry", { token: body.historyRetryToken }))).json()).toEqual({ ok: true, historyWritten: true });
    }
    expect(history()).toHaveLength(1);
  });

  it("adds nothing when the same token is sent again after more than 30 newer rows have been added", async () => {
    failHistory();
    const { historyRetryToken, tenancy } = await (await postTenancy(post("/api/tenancies", CREATE))).json();
    stopFailing();
    const first = await postHistoryRetry(post("/api/tenancies/history-retry", { token: historyRetryToken }));
    expect(await first.json()).toEqual({ ok: true, historyWritten: true });
    // Forty more rows come after it (other saves, as many as a busy afternoon makes).
    for (let index = 0; index < 40; index++) {
      fake.tabs.get(TENANCY_LOG_TAB)!.push(["2026-11-04T00:00:00.000Z", `t-${index}`, "p2", "Edited", "Phone", "", "", "owner@example.com"]);
    }
    const again = await postHistoryRetry(post("/api/tenancies/history-retry", { token: historyRetryToken }));
    expect(await again.json()).toEqual({ ok: true, historyWritten: true });
    expect(history()).toHaveLength(41);
    expect(history().filter((row) => row[1] === tenancy.id)).toHaveLength(1);
  });

  it("is retried by the same person only: another person's retry is refused and adds nothing", async () => {
    failHistory();
    const { historyRetryToken } = await (await postTenancy(post("/api/tenancies", CREATE))).json();
    stopFailing();
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    const res = await postHistoryRetry(post("/api/tenancies/history-retry", { token: historyRetryToken }));
    expect(res.status).toBe(400);
    expect(history()).toEqual([]);
  });

  it("says the history is still not written when the retry cannot write it either, and a later retry still can", async () => {
    failHistory();
    const { historyRetryToken } = await (await postTenancy(post("/api/tenancies", CREATE))).json();
    const res = await postHistoryRetry(post("/api/tenancies/history-retry", { token: historyRetryToken }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, historyWritten: false });
    stopFailing();
    expect(await (await postHistoryRetry(post("/api/tenancies/history-retry", { token: historyRetryToken }))).json()).toEqual({ ok: true, historyWritten: true });
    expect(history()).toHaveLength(1);
  });

  it("keeps an edit saved, and the retry brings its rows in", async () => {
    const created = await (await postTenancy(post("/api/tenancies", CREATE))).json();
    failHistory();
    const edit = {
      ...CREATE,
      id: created.tenancy.id,
      expectedUpdatedAt: created.tenancy.updatedAt,
      fields: { ...CREATE.fields, phone: "CANARY-PHONE-2", agreementEnd: "2027-03-31" },
    };
    const body = await (await postTenancy(post("/api/tenancies", edit))).json();
    expect(body).toMatchObject({ ok: true, historyWritten: false, tenancy: { phone: "CANARY-PHONE-2", agreementEnd: "2027-03-31" } });
    stopFailing();
    await postHistoryRetry(post("/api/tenancies/history-retry", { token: body.historyRetryToken }));
    expect(history().slice(1).map((row) => row.slice(3, 7))).toEqual([
      ["Edited", "Phone", "", ""],
      ["Edited", "Agreement end", "2027-01-14", "2027-03-31"],
    ]);
  });

  it("does the same for a move-out and for a payment that starts a new tenant", async () => {
    const created = await (await postTenancy(post("/api/tenancies", CREATE))).json();
    failHistory();
    const out = await (
      await postMoveOut(post("/api/tenancies/move-out", { id: created.tenancy.id, expectedUpdatedAt: created.tenancy.updatedAt, moveOut: "2026-11-30" }))
    ).json();
    expect(out).toMatchObject({ ok: true, historyWritten: false });
    expect(out).not.toHaveProperty("historyRows");
    const paid = await (
      await postPayment(
        post("/api/payments", {
          month: "2026-10",
          portionId: "p4",
          amount: 8800,
          dateReceived: "2026-10-07",
          newTenantName: "Dev",
          tenancy: { moveIn: "2026-10-01", phone: "CANARY-PHONE-3" },
        }),
      )
    ).json();
    expect(paid).toMatchObject({ ok: true, logWritten: true, tenancyWritten: true, historyWritten: false });
    expect(paid).not.toHaveProperty("historyRows");
    expect(paid).not.toHaveProperty("logRow");
    stopFailing();
    for (const token of [out.historyRetryToken, paid.historyRetryToken]) {
      expect(await (await postHistoryRetry(post("/api/tenancies/history-retry", { token }))).json()).toEqual({ ok: true, historyWritten: true });
    }
    // the first Added row is the tenancy created while the history worked
    expect(history().map((row) => row[3])).toEqual(["Added", "Moved out", "Added"]);
  });

  it("never lets a name, a phone number or a note into the server log", async () => {
    failHistory();
    const created = await (await postTenancy(post("/api/tenancies", CREATE))).json();
    await postHistoryRetry(post("/api/tenancies/history-retry", { token: created.historyRetryToken }));
    const all = [logs.info, logs.warn, logs.error].flatMap((spy) => spy.mock.calls.flat()).join("\n");
    expect(all).toContain("tenancy-log-append-failed");
    expect(all).not.toMatch(/CANARY|Asha/);
  });
});

describe("a tenancy saved while Google is too slow for the Tenancy Log", () => {
  it("answers 'saved' within the history's limit, with historyWritten false and a token the retry route accepts", async () => {
    vi.useFakeTimers();
    // The first append never answers (Google's own limit would be 10 seconds); the retry's append works.
    const working = fake.appendRows.bind(fake);
    let calls = 0;
    fake.appendRows = (tab, rows) => (++calls === 1 ? new Promise<void>(() => {}) : working(tab, rows));

    const answering = postTenancy(post("/api/tenancies", CREATE));
    let answered = false;
    void answering.then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(HISTORY_LIMIT_MS - 1);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);

    const res = await answering;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, historyWritten: false, tenancy: { tenant: "Asha" } });
    expect(body).not.toHaveProperty("historyRows");
    expect(typeof body.historyRetryToken).toBe("string");
    expect(fake.tabs.get(TENANTS_TAB)!.slice(1).map((row) => row[2])).toEqual(["Asha"]);
    expect(history()).toEqual([]);

    // The write lock is free: the retry runs at once and adds the row.
    const retrying = postHistoryRetry(post("/api/tenancies/history-retry", { token: body.historyRetryToken }));
    await vi.advanceTimersByTimeAsync(0);
    const retry = await retrying;
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, historyWritten: true });
    expect(history()).toEqual([[expect.any(String), body.tenancy.id, "p1", "Added", "", "", "", "member@example.com"]]);
    const all = [logs.info, logs.warn, logs.error].flatMap((spy) => spy.mock.calls.flat()).join("\n");
    expect(all).not.toMatch(/CANARY|Asha/);
  });
});

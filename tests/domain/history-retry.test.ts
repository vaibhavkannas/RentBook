import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HISTORY_NOT_SAVED, HISTORY_RETRY_TIMEOUT_MS, settleHistory } from "@/lib/history-retry";
import type { SendResult } from "@/lib/post-json";

// After a tenancy change is saved, the browser looks at whether its history reached the Tenancy Log. When it did not, it sends the
// signed token the save gave back, once, and the person is told only if that does not work either.

type Answer = { ok: boolean; historyWritten?: boolean };
const stub = (result: SendResult<Answer>) => vi.fn(async () => result as never);
const answer = (body: Answer): SendResult<Answer> => ({ kind: "answer", body });

describe("settleHistory", () => {
  it("is true, and sends nothing, when the history was written or the answer says nothing about it", async () => {
    for (const body of [{}, { historyWritten: true }, { historyWritten: true, historyRetryToken: "a.b" }, { historyRetryToken: "a.b" }]) {
      const send = stub(answer({ ok: true, historyWritten: true }));
      expect(await settleHistory(body, send)).toBe(true);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("is false, and sends nothing, when the history was not written and there is no token to send", async () => {
    for (const body of [{ historyWritten: false }, { historyWritten: false, historyRetryToken: "" }, { historyWritten: false, historyRetryToken: 5 as never }]) {
      const send = stub(answer({ ok: true, historyWritten: true }));
      expect(await settleHistory(body, send)).toBe(false);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("sends the token once, to the history retry route, waiting at most 10 seconds", async () => {
    const send = stub(answer({ ok: true, historyWritten: true }));
    await settleHistory({ historyWritten: false, historyRetryToken: "payload.mac" }, send);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("/api/tenancies/history-retry", { token: "payload.mac" }, { timeoutMs: 10_000 });
    expect(HISTORY_RETRY_TIMEOUT_MS).toBe(10_000);
  });

  it("is true only for an answer that says the rows are in the Tenancy Log now", async () => {
    const body = { historyWritten: false, historyRetryToken: "a.b" };
    expect(await settleHistory(body, stub(answer({ ok: true, historyWritten: true })))).toBe(true);
    expect(await settleHistory(body, stub(answer({ ok: true, historyWritten: false })))).toBe(false);
    expect(await settleHistory(body, stub(answer({ ok: true })))).toBe(false);
    expect(await settleHistory(body, stub(answer({ ok: false })))).toBe(false);
    expect(await settleHistory(body, stub(answer({ ok: false, historyWritten: true })))).toBe(false);
  });

  it("is false when no answer came: offline, timed out, or not understood", async () => {
    const body = { historyWritten: false, historyRetryToken: "a.b" };
    for (const kind of ["offline", "timeout", "no-answer"] as const) {
      expect(await settleHistory(body, stub({ kind }))).toBe(false);
    }
  });

  it("does not throw when the send does", async () => {
    const send = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await settleHistory({ historyWritten: false, historyRetryToken: "a.b" }, send as never)).toBe(false);
  });
});

describe("the words", () => {
  it("say the change was saved, and that the History is what is missing it", () => {
    expect(HISTORY_NOT_SAVED).toBe("The change was saved, but it couldn't be added to the History.");
  });
});

describe("history-retry.ts", () => {
  const source = readFileSync(new URL("../../src/lib/history-retry.ts", import.meta.url), "utf8");

  it("is safe for the browser: it imports nothing of the server", () => {
    expect(source).not.toMatch(/server-only|@\/lib\/server|@\/lib\/sheets|node:/);
  });

  it("sends through sendJson, which gives up on a stalled request and says why no answer came", () => {
    expect(source).toMatch(/import \{[^}]*\bsendJson\b[^}]*\} from "@\/lib\/post-json"/);
  });
});

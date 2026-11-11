import { describe, expect, it } from "vitest";
import { sendJson } from "@/lib/post-json";
import {
  OFFLINE_MESSAGE,
  PAYMENT_NO_CONFIRMATION,
  SOMETHING_WENT_WRONG_MESSAGE,
  TIMEOUT_MESSAGE,
  UNDO_NO_CONFIRMATION,
} from "@/lib/request-copy";
import { applyStep, classifyPayment, classifyUndo, type PaymentAnswer, type UndoAnswer, type WriteHooks } from "@/lib/write-flow";
import { beginWrite, liveOverlay, rollbackWrite, settleWrite } from "@/lib/optimistic";

// The month screen changes a card at once and sends the request. These are the ways the answer can end that: which case each
// answer is, and what each does to the card.

const answer = <T>(body: T) => ({ kind: "answer", body }) as const;

function hooks() {
  const calls: string[] = [];
  const h: WriteHooks = {
    begin: () => calls.push("begin"),
    settle: () => calls.push("settle"),
    rollback: () => calls.push("rollback"),
    refresh: () => calls.push("refresh"),
  };
  return { h, calls };
}

describe("a payment's answer", () => {
  it("is saved when the server says ok, whatever else it carries", () => {
    expect(classifyPayment(answer<PaymentAnswer>({ ok: true }))).toEqual({ kind: "saved", body: { ok: true } });
    const unsaved = { ok: true, logWritten: false, retryToken: "tok" };
    expect(classifyPayment(answer<PaymentAnswer>(unsaved))).toEqual({ kind: "saved", body: unsaved });
  });

  it("is a duplicate warning when the conflict names the entry that is there, which is what Replace is checked against", () => {
    const step = classifyPayment(
      answer<PaymentAnswer>({
        ok: false,
        error: { code: "conflict", details: { existingTenant: "Asha", existingCount: 4, existingAmount: 5450 } },
      }),
    );
    expect(step).toEqual({ kind: "duplicate", entry: { tenant: "Asha", count: 4, amount: 5450 } });
  });

  it("is a stale screen when the conflict names nothing it can be replaced against", () => {
    expect(classifyPayment(answer<PaymentAnswer>({ ok: false, error: { code: "conflict" } })).kind).toBe("stale");
  });

  it("is refused when the server finds something wrong in a field, to be shown beside it", () => {
    expect(classifyPayment(answer<PaymentAnswer>({ ok: false, error: { code: "validation", message: "Amount too large." } })).kind).toBe("refused");
    expect(classifyPayment(answer<PaymentAnswer>({ ok: false, error: { code: "internal", details: { field: "amount" } } })).kind).toBe("refused");
  });

  it("has failed for any other error, in the server's own plain words, or ours when it has none", () => {
    expect(classifyPayment(answer<PaymentAnswer>({ ok: false, error: { code: "unavailable", message: "Google isn't responding." } }))).toEqual({
      kind: "failed",
      message: "Google isn't responding.",
      refresh: false,
    });
    expect(classifyPayment(answer<PaymentAnswer>({ ok: false, error: { code: "internal" } }))).toMatchObject({ message: SOMETHING_WENT_WRONG_MESSAGE });
  });

  it("has failed for a request that got no answer; only offline did not send anything, so only the others look at the Sheet again", () => {
    expect(classifyPayment({ kind: "offline" })).toEqual({ kind: "failed", message: OFFLINE_MESSAGE, refresh: false });
    expect(classifyPayment({ kind: "timeout" })).toEqual({ kind: "failed", message: TIMEOUT_MESSAGE, refresh: true });
    expect(classifyPayment({ kind: "no-answer" })).toEqual({ kind: "failed", message: PAYMENT_NO_CONFIRMATION, refresh: true });
  });
});

describe("an undo's answer", () => {
  it("is saved, or a conflict when the Sheet has changed, or failed", () => {
    expect(classifyUndo(answer<UndoAnswer>({ ok: true })).kind).toBe("saved");
    expect(classifyUndo(answer<UndoAnswer>({ ok: false, error: { code: "conflict" } })).kind).toBe("conflict");
    expect(classifyUndo(answer<UndoAnswer>({ ok: false, error: { code: "unavailable", message: "Google isn't responding." } }))).toEqual({
      kind: "failed",
      message: "Google isn't responding.",
      refresh: false,
    });
    expect(classifyUndo({ kind: "no-answer" })).toEqual({ kind: "failed", message: UNDO_NO_CONFIRMATION, refresh: true });
  });

  it("keeps the log entry's retry token in a saved answer", () => {
    const step = classifyUndo(answer({ ok: true, logWritten: false, retryToken: "tok" }));
    expect(step).toMatchObject({ kind: "saved", body: { logWritten: false, retryToken: "tok" } });
  });
});

describe("what each ending does to the screen", () => {
  it("settles the card and loads the real data when it was saved (the retry-token case is saved too: the payment is in the Schedule)", () => {
    const { h, calls } = hooks();
    applyStep(classifyPayment(answer<PaymentAnswer>({ ok: true, logWritten: false, retryToken: "tok" })), h);
    expect(calls).toEqual(["settle", "refresh"]);
  });

  it("puts the card back and loads the real data when a duplicate is found, so the screen shows the payment that is there and Replace starts a new change", () => {
    const { h, calls } = hooks();
    applyStep({ kind: "duplicate" }, h);
    expect(calls).toEqual(["rollback", "refresh"]);
  });

  it("puts the card back and loads the real data when someone else changed it", () => {
    for (const kind of ["stale", "conflict"]) {
      const { h, calls } = hooks();
      applyStep({ kind }, h);
      expect(calls).toEqual(["rollback", "refresh"]);
    }
  });

  it("puts the card back when the server refused a field", () => {
    const { h, calls } = hooks();
    applyStep({ kind: "refused" }, h);
    expect(calls).toEqual(["rollback"]);
  });

  it("puts the card back on a failure, and looks at the Sheet again only when the request may have saved", () => {
    const sure = hooks();
    applyStep({ kind: "failed", refresh: false }, sure.h);
    expect(sure.calls).toEqual(["rollback"]);
    const unsure = hooks();
    applyStep({ kind: "failed", refresh: true }, unsure.h);
    expect(unsure.calls).toEqual(["rollback", "refresh"]);
  });
});

describe("a whole write on the overlay", () => {
  const log = { kind: "log", portionId: "p1", amount: 5450 } as const;
  const v1 = { server: 1 };
  const v2 = { server: 2 };

  it("shows the change at once, keeps it through the answer and drops it when the real data arrives", () => {
    let overlay = beginWrite({}, "2026-10", log, v1);
    expect(Object.keys(liveOverlay(overlay, v1))).toHaveLength(1);
    overlay = settleWrite(overlay, "2026-10", "p1", v1);
    expect(Object.keys(liveOverlay(overlay, v1))).toHaveLength(1);
    expect(liveOverlay(overlay, v2)).toEqual({});
  });

  it("drops the change when the write fails, and the later Replace or Try again starts a fresh one", () => {
    let overlay = beginWrite({}, "2026-10", log, v1);
    overlay = rollbackWrite(overlay, "2026-10", "p1");
    expect(overlay).toEqual({});
    overlay = beginWrite(overlay, "2026-10", { kind: "edit", portionId: "p1", amount: 6000 }, v1);
    expect(Object.values(overlay)[0].change).toMatchObject({ kind: "edit", amount: 6000 });
  });
});

describe("sendJson, which the sheets use for the request", () => {
  it("reports no connection without sending anything, so the card can go back and nothing is looked up", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
    try {
      expect(await sendJson("/api/payments", {})).toEqual({ kind: "offline" });
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});

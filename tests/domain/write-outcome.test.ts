import { describe, expect, it, vi } from "vitest";
import { createNoticeStore } from "@/lib/write-notices";
import { paymentOutcomeAway, undoOutcomeAway } from "@/lib/write-outcome";
import { TENANCY_NOT_SAVED_MESSAGE } from "@/lib/payment-request";
import { UNDO_CONFLICT_MESSAGE } from "@/lib/undo-copy";
import { classifyPayment, classifyUndo, type PaymentAnswer } from "@/lib/write-flow";

// A save that is answered after its sheet is gone (another sheet was opened, or the person moved to another tab) must still tell
// the owner what happened. These are the words and actions of each such outcome.

const ctx = { portion: "Ground floor", monthLabel: "October 2026" };
const answer = <T>(body: T) => ({ kind: "answer", body }) as const;

describe("a payment answered after its sheet is gone", () => {
  it("keeps the Payments Log retry, with the same token", () => {
    const out = paymentOutcomeAway(classifyPayment(answer<PaymentAnswer>({ ok: true, logWritten: false, retryToken: "tok" })), ctx);
    expect(out.notices).toEqual([{ text: "Ground floor: saved to your Schedule, but the Payments Log entry didn't save.", retryToken: "tok" }]);
  });

  it("keeps the warning that the tenancy details did not save", () => {
    const out = paymentOutcomeAway(classifyPayment(answer<PaymentAnswer>({ ok: true, tenancyWritten: false })), ctx);
    expect(out.notices).toEqual([{ text: TENANCY_NOT_SAVED_MESSAGE }]);
  });

  it("says nothing more for a payment that saved cleanly", () => {
    expect(paymentOutcomeAway(classifyPayment(answer<PaymentAnswer>({ ok: true })), ctx)).toEqual({ notices: [], toast: null, refresh: false });
  });

  it("tells a duplicate plainly, and looks at the Sheet again", () => {
    const step = classifyPayment(answer<PaymentAnswer>({ ok: false, error: { code: "conflict", details: { existingTenant: "Asha", existingCount: 4, existingAmount: 5450 } } }));
    const out = paymentOutcomeAway(step, ctx);
    expect(out.notices).toHaveLength(1);
    expect(out.notices[0].text).toContain("Ground floor already has ₹ 5,450 recorded for October 2026 (Asha). Nothing was changed.");
    expect(out.refresh).toBe(true);
  });

  it("tells a failure in a toast, and looks again only when it may have saved", () => {
    expect(paymentOutcomeAway(classifyPayment({ kind: "offline" }), ctx)).toMatchObject({ refresh: false });
    const out = paymentOutcomeAway(classifyPayment({ kind: "timeout" }), ctx);
    expect(out.toast).toContain("It may still have saved");
    expect(out.refresh).toBe(true);
  });
});

describe("an undo answered after its sheet is gone", () => {
  it("keeps the Payments Log retry, and the conflict, and a failure", () => {
    expect(undoOutcomeAway(classifyUndo(answer({ ok: true, logWritten: false, retryToken: "t2" })), ctx).notices).toEqual([
      { text: "Ground floor: undone in your Schedule, but the Payments Log entry didn't save.", retryToken: "t2" },
    ]);
    const conflict = undoOutcomeAway(classifyUndo(answer({ ok: false, error: { code: "conflict" } })), ctx);
    expect(conflict.notices[0].text).toContain(UNDO_CONFLICT_MESSAGE);
    expect(conflict.refresh).toBe(true);
    expect(undoOutcomeAway(classifyUndo(answer({ ok: false, error: { code: "unavailable", message: "Google isn't responding." } })), ctx).toast).toBe("Google isn't responding.");
  });
});

describe("the notices that wait for the owner", () => {
  it("are added with an id, kept until removed, and the listeners are told", () => {
    const store = createNoticeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const id = store.add({ text: "a", retryToken: "t" });
    store.add({ text: "b" });
    expect(store.get().map((n) => n.text)).toEqual(["a", "b"]);
    store.update(id, { text: "still" });
    expect(store.get()[0]).toMatchObject({ text: "still", retryToken: "t" });
    store.remove(id);
    expect(store.get().map((n) => n.text)).toEqual(["b"]);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

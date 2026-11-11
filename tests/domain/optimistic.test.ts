import { describe, expect, it } from "vitest";
import type { MonthView, PortionCard } from "@/lib/domain/types";
import {
  applyChange,
  applyOverlay,
  beginWrite,
  liveOverlay,
  rollbackWrite,
  settleWrite,
  type Change,
  type Overlay,
} from "@/lib/optimistic";

const pending = (portionId = "p1", overrides: Partial<PortionCard> = {}): PortionCard => ({
  portionId,
  name: `Portion ${portionId}`,
  cycleLength: 11,
  status: "pending",
  entry: null,
  next: { tenant: "Asha", count: 4, suggestedAmount: 5450, previousAmount: 5450, startsNewCycle: false },
  undoBlockedReason: null,
  tenancy: null,
  rentReference: 5450,
  rentDifference: null,
  ...overrides,
});
const paid = (portionId = "p2", amount = 12700): PortionCard => ({
  portionId,
  name: `Portion ${portionId}`,
  cycleLength: 11,
  status: "paid",
  entry: { tenant: "Bala", count: 2, amount },
  next: null,
  undoBlockedReason: null,
  tenancy: null,
  rentReference: 12700,
  rentDifference: amount - 12700,
});
const vacant = (portionId = "p3"): PortionCard => ({
  portionId,
  name: `Portion ${portionId}`,
  cycleLength: null,
  status: "vacant",
  entry: null,
  next: null,
  undoBlockedReason: null,
  tenancy: null,
  rentReference: null,
  rentDifference: null,
  vacancy: { since: "2026-10-01", previousTenant: "Esha" },
});
const view = (cards: PortionCard[], overrides: Partial<MonthView> = {}): MonthView => ({
  month: { year: 2026, month: 10 },
  cards,
  received: 12700,
  due: 18150,
  difference: 0,
  paidCount: 1,
  ...overrides,
});

describe("what a card looks like while its change is on the way", () => {
  it("turns a pending card paid, with the tenant and count it was about to log, and the amount typed", () => {
    const after = applyChange(pending(), { kind: "log", portionId: "p1", amount: 5450 });
    expect(after.status).toBe("paid");
    expect(after.entry).toEqual({ tenant: "Asha", count: 4, amount: 5450 });
    expect(after.next).toBeNull();
    expect(after.rentDifference).toBe(0);
    expect(after.undoBlockedReason).toBeNull();
  });

  it("measures a logged amount against the suggested rent, and says nothing about the first payment of a new cycle, which is the rent", () => {
    expect(applyChange(pending(), { kind: "log", portionId: "p1", amount: 5480 }).rentDifference).toBe(30);
    const hike = pending("p1", {
      next: { tenant: "Bala", count: 1, suggestedAmount: 13335, previousAmount: 12700, startsNewCycle: true },
      rentReference: 13335,
    });
    const after = applyChange(hike, { kind: "log", portionId: "p1", amount: 13000 });
    expect(after.rentReference).toBe(13000);
    expect(after.rentDifference).toBe(0);
  });

  it("changes the amount of a paid card and keeps its tenant and count", () => {
    const after = applyChange(paid(), { kind: "edit", portionId: "p2", amount: 12000 });
    expect(after.status).toBe("paid");
    expect(after.entry).toEqual({ tenant: "Bala", count: 2, amount: 12000 });
    expect(after.rentDifference).toBe(-700);
  });

  it("turns a paid card pending again for an undo, suggesting what was received", () => {
    const after = applyChange(paid(), { kind: "undo", portionId: "p2" });
    expect(after.status).toBe("pending");
    expect(after.entry).toBeNull();
    expect(after.next).toMatchObject({ tenant: "Bala", count: 2, suggestedAmount: 12700, startsNewCycle: false });
    expect(after.rentDifference).toBeNull();
  });

  it("gives a vacant card its new tenant, at payment 1, paid", () => {
    const after = applyChange(vacant(), { kind: "new-tenant", portionId: "p3", tenant: "Dev", amount: 7000 });
    expect(after.status).toBe("paid");
    expect(after.entry).toEqual({ tenant: "Dev", count: 1, amount: 7000 });
    expect(after.vacancy).toBeNull();
    expect(after.tenancy).toBeNull();
  });

  it("leaves a card its change is not for, and the card it was given, untouched", () => {
    const original = pending();
    const copy = structuredClone(original);
    applyChange(original, { kind: "log", portionId: "p1", amount: 1 });
    expect(original).toEqual(copy);
  });
});

describe("what the month's figures look like while changes are on the way", () => {
  const base = view([pending("p1"), paid("p2"), vacant("p3")]);
  const at = (changes: Change[]): Overlay => changes.reduce((overlay, change) => beginWrite(overlay, "2026-10", change, base), {});

  it("adds a logged amount to what was received, and counts the portion as paid", () => {
    const out = applyOverlay(base, at([{ kind: "log", portionId: "p1", amount: 5480 }]), "2026-10");
    expect(out.received).toBe(12700 + 5480);
    expect(out.paidCount).toBe(2);
    expect(out.due).toBe(18150);
    expect(out.difference).toBe(30);
    expect(out.cards[0].status).toBe("paid");
  });

  it("moves what was received by the difference an edit makes", () => {
    const out = applyOverlay(base, at([{ kind: "edit", portionId: "p2", amount: 12000 }]), "2026-10");
    expect(out.received).toBe(12000);
    expect(out.paidCount).toBe(1);
    expect(out.difference).toBe(-700);
  });

  it("takes an undone amount off what was received", () => {
    const out = applyOverlay(base, at([{ kind: "undo", portionId: "p2" }]), "2026-10");
    expect(out.received).toBe(0);
    expect(out.paidCount).toBe(0);
    expect(out.cards[1].status).toBe("pending");
  });

  it("starts owing, and has received, for a new tenant", () => {
    const out = applyOverlay(base, at([{ kind: "new-tenant", portionId: "p3", tenant: "Dev", amount: 7000 }]), "2026-10");
    expect(out.received).toBe(12700 + 7000);
    expect(out.due).toBe(18150 + 7000);
    expect(out.paidCount).toBe(2);
  });

  it("is the very same view when nothing is on the way for the month, and only reads its own month's changes", () => {
    expect(applyOverlay(base, {}, "2026-10")).toBe(base);
    const other = beginWrite({}, "2026-09", { kind: "log", portionId: "p1", amount: 5450 }, base);
    expect(applyOverlay(base, other, "2026-10")).toBe(base);
  });

  it("is pure: the view it was given is not changed", () => {
    const copy = structuredClone(base);
    applyOverlay(base, at([{ kind: "log", portionId: "p1", amount: 5450 }]), "2026-10");
    expect(base).toEqual(copy);
  });
});

describe("the changes on the way", () => {
  const v1 = view([pending()]);
  const v2 = view([paid("p1")]);
  const log: Change = { kind: "log", portionId: "p1", amount: 5450 };

  it("starts one as saving, and the same portion in the same month has only one", () => {
    const overlay = beginWrite(beginWrite({}, "2026-10", log, v1), "2026-10", { kind: "edit", portionId: "p1", amount: 1 }, v1);
    expect(Object.keys(overlay)).toHaveLength(1);
    expect(Object.values(overlay)[0]).toMatchObject({ saving: true, change: { kind: "edit" } });
  });

  it("rolls one back, and only that one", () => {
    let overlay = beginWrite({}, "2026-10", log, v1);
    overlay = beginWrite(overlay, "2026-10", { kind: "undo", portionId: "p2" }, v1);
    overlay = rollbackWrite(overlay, "2026-10", "p1");
    expect(Object.values(overlay).map((entry) => entry.change.portionId)).toEqual(["p2"]);
    expect(rollbackWrite(overlay, "2026-10", "nothing")).toEqual(overlay);
  });

  it("is kept while it is saving, whatever arrives", () => {
    const overlay = beginWrite({}, "2026-10", log, v1);
    expect(liveOverlay(overlay, v2)).toEqual(overlay);
  });

  it("is kept after it was answered until the screen has the server's data of its own, and then goes", () => {
    const settled = settleWrite(beginWrite({}, "2026-10", log, v1), "2026-10", "p1", v1);
    expect(Object.values(settled)[0].saving).toBe(false);
    expect(liveOverlay(settled, v1)).toEqual(settled);
    expect(liveOverlay(settled, v2)).toEqual({});
  });

  it("is not dropped by data that arrived while it was saving, once it is answered against that data", () => {
    // a refresh landed (v2) between the start and the answer: the answer is settled against v2, so the next arrival drops it
    const settled = settleWrite(beginWrite({}, "2026-10", log, v1), "2026-10", "p1", v2);
    expect(liveOverlay(settled, v2)).toEqual(settled);
    expect(liveOverlay(settled, view([]))).toEqual({});
  });

  it("settles nothing that is not there", () => {
    expect(settleWrite({}, "2026-10", "p1", v1)).toEqual({});
  });
});

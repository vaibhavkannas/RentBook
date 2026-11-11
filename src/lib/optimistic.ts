import type { MonthView, PortionCard } from "@/lib/domain/types";

/**
 * What the month screen shows while a change is on its way to the Sheet. A card is changed on the screen at once (a payment
 * is logged, an amount edited, a payment undone, a tenant added), marked "Saving", and the request is sent. When the server
 * answers, the screen asks for the real data and drops the change when it arrives; when the request fails, the change is
 * rolled back. Everything here is pure, so the figures and the lifecycle can be tested; the screen only holds the overlay.
 */

export type Change =
  | { kind: "log"; portionId: string; amount: number }
  | { kind: "edit"; portionId: string; amount: number }
  | { kind: "undo"; portionId: string }
  | { kind: "new-tenant"; portionId: string; tenant: string; amount: number };

/** The card as it will be once the change is saved. The card it is given is not changed. */
export function applyChange(card: PortionCard, change: Change): PortionCard {
  switch (change.kind) {
    case "log": {
      if (!card.next) return card;
      // The first payment of a new cycle is the rent of the cycle; any other is measured against the suggested rent.
      const reference = card.next.startsNewCycle ? change.amount : card.next.suggestedAmount;
      return {
        ...card,
        status: "paid",
        entry: { tenant: card.next.tenant, count: card.next.count, amount: change.amount },
        next: null,
        rentReference: reference,
        rentDifference: change.amount - reference,
        undoBlockedReason: null,
      };
    }
    case "edit": {
      if (!card.entry) return card;
      return {
        ...card,
        entry: { ...card.entry, amount: change.amount },
        rentDifference: card.rentReference === null ? null : change.amount - card.rentReference,
      };
    }
    case "undo": {
      if (!card.entry) return card;
      return {
        ...card,
        status: "pending",
        entry: null,
        next: {
          tenant: card.entry.tenant,
          count: card.entry.count,
          suggestedAmount: card.entry.amount,
          previousAmount: card.entry.amount,
          startsNewCycle: false,
        },
        rentDifference: null,
        undoBlockedReason: null,
      };
    }
    case "new-tenant":
      return {
        ...card,
        status: "paid",
        entry: { tenant: change.tenant, count: 1, amount: change.amount },
        next: null,
        vacancy: null,
        tenancy: null,
        rentReference: null,
        rentDifference: null,
        undoBlockedReason: null,
      };
  }
}

/** One change on its way. `since` is the data the screen had when it was started or answered: new data after that ends it. */
export type WriteEntry = { change: Change; saving: boolean; since: unknown };
export type Overlay = Record<string, WriteEntry>;

const keyOf = (monthKey: string, portionId: string) => `${monthKey}|${portionId}`;

/** Starts a change as saving. A portion has one change at a time in a month: a later one replaces an earlier. */
export function beginWrite(overlay: Overlay, monthKey: string, change: Change, since: unknown): Overlay {
  return { ...overlay, [keyOf(monthKey, change.portionId)]: { change, saving: true, since } };
}

/** The request was answered and saved: the "Saving" mark goes, and the change waits for the server's data to replace it. */
export function settleWrite(overlay: Overlay, monthKey: string, portionId: string, since: unknown): Overlay {
  const key = keyOf(monthKey, portionId);
  const entry = overlay[key];
  return entry ? { ...overlay, [key]: { ...entry, saving: false, since } } : overlay;
}

/** The request failed: the card goes back to what the server had. */
export function rollbackWrite(overlay: Overlay, monthKey: string, portionId: string): Overlay {
  const key = keyOf(monthKey, portionId);
  if (!(key in overlay)) return overlay;
  const rest = { ...overlay };
  delete rest[key];
  return rest;
}

/** What is still on its way: a change that was answered goes once the screen has data other than what it was answered against. */
export function liveOverlay(overlay: Overlay, data: unknown): Overlay {
  const kept = Object.entries(overlay).filter(([, entry]) => entry.saving || entry.since === data);
  return kept.length === Object.keys(overlay).length ? overlay : Object.fromEntries(kept);
}

/** The ids of a month's portions whose change is not confirmed yet. */
export function savingIds(overlay: Overlay, monthKey: string): Set<string> {
  return new Set(
    Object.entries(overlay)
      .filter(([key, entry]) => entry.saving && key.startsWith(`${monthKey}|`))
      .map(([, entry]) => entry.change.portionId),
  );
}

/**
 * The month as it will be once its changes are saved: the cards changed, and what was received, what is due, the difference and
 * the count of paid portions moved by what each change does. The very same view when the month has nothing on its way.
 */
export function applyOverlay(view: MonthView, overlay: Overlay, monthKey: string): MonthView {
  const mine = Object.entries(overlay).filter(([key]) => key.startsWith(`${monthKey}|`));
  if (mine.length === 0) return view;
  let { received, due, difference, paidCount } = view;
  const cards = view.cards.map((card) => {
    const entry = mine.find(([, e]) => e.change.portionId === card.portionId)?.[1];
    if (!entry) return card;
    const after = applyChange(card, entry.change);
    if (after === card) return card;
    received += (after.entry?.amount ?? 0) - (card.entry?.amount ?? 0);
    paidCount += (after.status === "paid" ? 1 : 0) - (card.status === "paid" ? 1 : 0);
    difference += (after.rentDifference ?? 0) - (card.rentDifference ?? 0);
    // A new tenant, and the first payment of a new cycle, make the amount the rent that is due.
    if (entry.change.kind === "new-tenant") due += entry.change.amount;
    else if (entry.change.kind === "log" && card.next?.startsNewCycle) due += entry.change.amount - card.next.suggestedAmount;
    return after;
  });
  return { ...view, cards, received, due, difference, paidCount };
}

/** What the month screen gives a sheet to change a card with while its request is on the way. */
export type Writes = {
  begin(monthKey: string, change: Change): void;
  settle(monthKey: string, portionId: string): void;
  rollback(monthKey: string, portionId: string): void;
  /** Whether a change to the portion is still on its way: a second one is not started. */
  busy(monthKey: string, portionId: string): boolean;
};

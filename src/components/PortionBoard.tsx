"use client";

import { useEffect, useState } from "react";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import { sheetKey } from "@/lib/month-nav";
import PaymentSheet, { type SheetMode } from "./PaymentSheet";
import UndoSheet from "./UndoSheet";

type Props = {
  monthKey: string;
  monthLabel: string;
  cards: PortionCard[];
  defaultDate: string;
};

/**
 * The undo sheet keeps the paid card, month key and label as they were when Undo was tapped. After
 * a successful undo the refreshed card is no longer paid, but the sheet may still have to show its
 * "Retry log entry" step, and it must only ever undo the entry the person was shown.
 */
type Active =
  | { mode: SheetMode; portionId: string | null }
  | { mode: "undo"; portionId: string; card: PortionCard; monthKey: string; monthLabel: string }
  | null;

const PILL = {
  paid: "bg-success-bg text-success-ink",
  pending: "bg-warn-bg text-warn-ink",
  "needs-tenant": "bg-line text-foreground",
} as const;

const PILL_LABEL = {
  paid: "Paid",
  pending: "Pending",
  "needs-tenant": "No tenant",
} as const;

export default function PortionBoard({ monthKey, monthLabel, cards, defaultDate }: Props) {
  const [active, setActive] = useState<Active>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      <ul className="mt-3 space-y-3">
        {cards.map((card) => {
          const count = card.entry?.count ?? card.next?.count;
          const tenant = card.entry?.tenant ?? card.next?.tenant;
          const lastOfCycle =
            card.cycleLength !== null && count !== undefined && count === card.cycleLength;
          return (
            <li key={card.portionId}>
              <article className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium">{card.name}</h2>
                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium ${PILL[card.status]}`}
                  >
                    {PILL_LABEL[card.status]}
                  </span>
                </div>

                {card.status === "needs-tenant" ? (
                  <p className="mt-1 text-sm text-muted">No tenant recorded yet.</p>
                ) : (
                  <p className="mt-1 text-sm text-muted">
                    {tenant} · Payment {count}
                    {card.cycleLength !== null ? ` of ${card.cycleLength}` : ""}
                  </p>
                )}

                {card.status !== "needs-tenant" && (
                  <p className="mt-2 text-lg font-medium">
                    {formatRupees(card.entry?.amount ?? card.next!.suggestedAmount)}
                  </p>
                )}

                {card.status === "pending" && card.next?.startsNewCycle && (
                  <p className="mt-1 text-sm text-muted">
                    New cycle. Suggested rent includes the hike (was{" "}
                    {formatRupees(card.next.previousAmount)}).
                  </p>
                )}
                {lastOfCycle && (
                  <p className="mt-1 text-sm text-muted">Last payment of this cycle.</p>
                )}

                <div className="mt-3 flex gap-2">
                  {card.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => setActive({ mode: "log", portionId: card.portionId })}
                      className="min-h-11 flex-1 rounded-xl bg-accent px-4 font-medium text-accent-ink"
                    >
                      Log payment
                    </button>
                  )}
                  {card.status === "paid" && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActive({ mode: "edit", portionId: card.portionId })}
                        className="min-h-11 flex-1 rounded-xl border border-control px-4 font-medium"
                      >
                        Edit amount
                      </button>
                      {card.undoBlockedReason === null && (
                        <button
                          type="button"
                          onClick={() =>
                            setActive({
                              mode: "undo",
                              portionId: card.portionId,
                              card,
                              monthKey,
                              monthLabel,
                            })
                          }
                          className="min-h-11 rounded-xl px-4 font-medium text-danger-ink underline"
                        >
                          Undo
                        </button>
                      )}
                    </>
                  )}
                  {card.status === "needs-tenant" && (
                    <button
                      type="button"
                      onClick={() => setActive({ mode: "new-tenant", portionId: card.portionId })}
                      className="min-h-11 flex-1 rounded-xl bg-accent px-4 font-medium text-accent-ink"
                    >
                      Add tenant
                    </button>
                  )}
                </div>

                {card.status === "paid" && card.undoBlockedReason && (
                  <p className="mt-2 text-sm text-muted">{card.undoBlockedReason}</p>
                )}
              </article>
            </li>
          );
        })}
      </ul>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setActive({ mode: "new-tenant", portionId: null })}
          className="min-h-11 w-full rounded-xl border border-control px-4 font-medium"
        >
          New tenant
        </button>
      </div>

      {active &&
        (active.mode === "undo" ? (
          <UndoSheet
            key={sheetKey(active.monthKey, "undo", active.portionId)}
            monthKey={active.monthKey}
            monthLabel={active.monthLabel}
            card={active.card}
            onClose={() => setActive(null)}
            onDone={setToast}
          />
        ) : (
          <PaymentSheet
            key={sheetKey(monthKey, active.mode, active.portionId)}
            mode={active.mode}
            monthKey={monthKey}
            monthLabel={monthLabel}
            cards={cards}
            initialPortionId={active.portionId}
            defaultDate={defaultDate}
            onClose={() => setActive(null)}
          />
        ))}

      {toast && (
        <p
          role="status"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl bg-foreground px-4 py-3 text-center text-sm text-background"
        >
          {toast}
        </p>
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import { sheetKey } from "@/lib/month-nav";
import { cardDifferenceText } from "@/lib/rent-difference";
import { tenancyChips } from "@/lib/tenancy-chips";
import { tenantsPagePath } from "@/lib/tenancy-response";
import type { PillTone } from "@/lib/ui-classes";
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

/** The toast carries an id so a second one, even with the same text, restarts the timer. */
type Toast = { id: number; text: string };

const PILL_TONE: Record<PortionCard["status"], PillTone> = {
  paid: "success",
  pending: "warn",
  "needs-tenant": "neutral",
};

const PILL_LABEL = {
  paid: "Paid",
  pending: "Pending",
  "needs-tenant": "No tenant",
} as const;

export default function PortionBoard({ monthKey, monthLabel, cards, defaultDate }: Props) {
  const [active, setActive] = useState<Active>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastCount = useRef(0);

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
          // Only a paid card says how the amount received compares with the rent.
          const rentLine =
            card.status === "paid" ? cardDifferenceText(card.rentDifference, card.rentReference) : null;
          return (
            <li key={card.portionId}>
              <Card as="article">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium">{card.name}</h2>
                  <Pill tone={PILL_TONE[card.status]}>{PILL_LABEL[card.status]}</Pill>
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
                  <>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {card.tenancy &&
                        tenancyChips(card.tenancy).map((chip) => (
                          <Pill key={chip} tone="neutral">
                            {chip}
                          </Pill>
                        ))}
                      <Link
                        href={tenantsPagePath(card.portionId, monthKey)}
                        aria-label={`${card.tenancy ? "Details" : "Add details"} for ${card.name}`}
                        className="inline-flex min-h-11 min-w-11 items-center text-sm text-muted underline"
                      >
                        {card.tenancy ? "Details" : "Add details"}
                      </Link>
                    </div>
                    <p className="mt-2 text-lg font-medium">
                      {formatRupees(card.entry?.amount ?? card.next!.suggestedAmount)}
                    </p>
                    {rentLine && <p className="mt-0.5 text-sm text-muted">{rentLine}</p>}
                  </>
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
                    <Button
                      className="flex-1"
                      onClick={() => setActive({ mode: "log", portionId: card.portionId })}
                    >
                      Log payment
                    </Button>
                  )}
                  {card.status === "paid" && (
                    <>
                      <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={() => setActive({ mode: "edit", portionId: card.portionId })}
                      >
                        Edit amount
                      </Button>
                      {card.undoBlockedReason === null && (
                        <Button
                          variant="dangerText"
                          onClick={() =>
                            setActive({
                              mode: "undo",
                              portionId: card.portionId,
                              card,
                              monthKey,
                              monthLabel,
                            })
                          }
                        >
                          Undo
                        </Button>
                      )}
                    </>
                  )}
                  {card.status === "needs-tenant" && (
                    <Button
                      className="flex-1"
                      onClick={() => setActive({ mode: "new-tenant", portionId: card.portionId })}
                    >
                      Add tenant
                    </Button>
                  )}
                </div>

                {card.status === "paid" && card.undoBlockedReason && (
                  <p className="mt-2 text-sm text-muted">{card.undoBlockedReason}</p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="mt-4">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => setActive({ mode: "new-tenant", portionId: null })}
        >
          New tenant
        </Button>
      </div>

      {active &&
        (active.mode === "undo" ? (
          <UndoSheet
            key={sheetKey(active.monthKey, "undo", active.portionId)}
            monthKey={active.monthKey}
            monthLabel={active.monthLabel}
            card={active.card}
            onClose={() => setActive(null)}
            onDone={(text) => setToast({ id: ++toastCount.current, text })}
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

      {/* The live region is always on the page, so screen readers announce text that appears in it. */}
      <div role="status" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md">
        {toast && (
          <p
            key={toast.id}
            className="rounded-xl bg-foreground px-4 py-3 text-center text-sm text-background"
          >
            {toast.text}
          </p>
        )}
      </div>
    </>
  );
}

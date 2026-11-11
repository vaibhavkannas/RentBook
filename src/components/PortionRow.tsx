"use client";

import { memo, useId, useSyncExternalStore } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Spinner } from "@/components/ui/Spinner";
import { StatusDot } from "@/components/ui/StatusDot";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import type { OpenRowStore } from "@/lib/open-row";
import { rowAmount, rowPill, rowStatus, rowSubtitle } from "@/lib/portion-row";
import { cardDifferenceText } from "@/lib/rent-difference";
import { tenancyChips } from "@/lib/tenancy-chips";
import { tenantsPagePath } from "@/lib/tenancy-response";
import { cx } from "@/lib/ui-classes";

/** What a row asks the board to open. */
export type RowAction =
  | { mode: "log" | "edit" | "new-tenant"; portionId: string }
  | { mode: "undo"; portionId: string; card: PortionCard };

type Props = {
  card: PortionCard;
  monthKey: string;
  defaultDate: string;
  /** Which row is open, shared by the rows of the screen. */
  store: OpenRowStore;
  /** The change shown on this card is on its way to the Sheet and is not confirmed yet. */
  saving: boolean;
  /** The month is one whose rent counts as overdue, and this card has no payment (see isOverdueCard). */
  overdue: boolean;
  onAction: (action: RowAction) => void;
};

/**
 * One portion on the month screen: a line of status, name, who pays, the amount and a status pill, that opens on a tap to show
 * the facts, the notes and the actions the card has. Whether it is open is read from the screen's store, so opening a row draws
 * the row that opens and the one that closes, and nothing else. The details stay in the page while closed (they are what the
 * height animates), hidden from the keyboard and from screen readers.
 */
function PortionRow({ card, monthKey, defaultDate, store, saving, overdue, onAction }: Props) {
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.get() === card.portionId,
    () => false,
  );
  const panelId = useId();
  const status = rowStatus(card, overdue);
  const pill = rowPill(status);
  const amount = rowAmount(card);
  const noTenant = status === "vacant";
  const count = card.entry?.count ?? card.next?.count;
  const tenant = card.entry?.tenant ?? card.next?.tenant;
  const lastOfCycle = card.cycleLength !== null && count !== undefined && count === card.cycleLength;
  const linkLabel = card.tenancy ? "Details" : card.inactive ? "Tenant page" : "Add details";
  // Only a paid card says how the amount received compares with the rent.
  const rentLine = card.status === "paid" ? cardDifferenceText(card.rentDifference, card.rentReference) : null;
  const chips = card.tenancy ? tenancyChips(card.tenancy, defaultDate) : [];

  return (
    <li className={cx("overflow-hidden rounded-card border bg-surface", open ? "border-accent" : "border-line")}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => store.toggle(card.portionId)}
          className="press grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 p-3 text-left"
        >
          <StatusDot status={status} />
          <span className="min-w-0">
            <span className="block break-words font-semibold leading-tight">{card.name}</span>
            <span className="mt-0.5 block break-words text-sm leading-snug text-muted">{rowSubtitle(card)}</span>
          </span>
          <span className="flex flex-col items-end gap-0.5 text-right">
            {amount && <span className="whitespace-nowrap font-display font-semibold tabular-nums">{amount}</span>}
            <Pill tone={pill.tone}>{pill.label}</Pill>
            {saving && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Spinner />
                Saving
              </span>
            )}
          </span>
        </button>
      </h2>

      <div id={panelId} className="accordion" data-open={open}>
        <div>
          <div className="grid gap-3 px-3 pb-3 pt-0.5">
            {!noTenant && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted">Tenant</dt>
                  <dd className="break-words font-medium">{tenant}</dd>
                </div>
                <div>
                  <dt className="text-muted">Payment</dt>
                  <dd className="font-medium">
                    {count}
                    {card.cycleLength !== null ? ` of ${card.cycleLength}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{card.status === "paid" ? "Received" : "Suggested rent"}</dt>
                  <dd className="font-display font-semibold tabular-nums">{amount}</dd>
                </div>
                {rentLine && (
                  <div>
                    <dt className="text-muted">Compared with rent</dt>
                    <dd className="font-medium">{rentLine}</dd>
                  </div>
                )}
              </dl>
            )}

            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((chip) => (
                  <Pill key={chip} tone="neutral">
                    {chip}
                  </Pill>
                ))}
              </div>
            )}

            {card.inactive && <p className="rounded-chip bg-surface-2 px-3 py-2 text-sm">Switched off in Portion settings.</p>}
            {card.status === "pending" && card.next?.startsNewCycle && (
              <p className="rounded-chip bg-accent-soft px-3 py-2 text-sm">
                New cycle. Suggested rent includes the hike (was {formatRupees(card.next.previousAmount)}).
              </p>
            )}
            {lastOfCycle && <p className="rounded-chip bg-surface-2 px-3 py-2 text-sm">Last payment of this cycle.</p>}
            {card.status === "paid" && card.undoBlockedReason && (
              <p className="rounded-chip bg-surface-2 px-3 py-2 text-sm">{card.undoBlockedReason}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {card.status === "pending" && (
                <Button
                  className="flex-1 basis-36"
                  disabled={saving}
                  onClick={() => onAction({ mode: "log", portionId: card.portionId })}
                >
                  Log payment
                </Button>
              )}
              {card.status === "paid" && (
                <>
                  <Button
                    variant="secondary"
                    className="flex-1 basis-28"
                    disabled={saving}
                    onClick={() => onAction({ mode: "edit", portionId: card.portionId })}
                  >
                    Edit amount
                  </Button>
                  {card.undoBlockedReason === null && (
                    <Button
                      variant="dangerText"
                      disabled={saving}
                      onClick={() => onAction({ mode: "undo", portionId: card.portionId, card })}
                    >
                      Undo
                    </Button>
                  )}
                </>
              )}
              {noTenant && (
                <Button className="flex-1 basis-36" onClick={() => onAction({ mode: "new-tenant", portionId: card.portionId })}>
                  Add tenant
                </Button>
              )}
              {card.status === "vacant" && (
                <ButtonLink
                  variant="secondary"
                  href={tenantsPagePath(card.portionId, monthKey)}
                  aria-label={`Past tenants of ${card.name}`}
                >
                  Past tenants
                </ButtonLink>
              )}
              {/* A switched-off portion takes no new details (the tenant page refuses them), but its page is where a move-out is recorded. */}
              {!noTenant && (
                <ButtonLink
                  variant="secondary"
                  href={tenantsPagePath(card.portionId, monthKey)}
                  aria-label={`${linkLabel} for ${card.name}`}
                >
                  {linkLabel}
                </ButtonLink>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export default memo(PortionRow);

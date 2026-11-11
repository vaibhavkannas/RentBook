"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FilterChip } from "@/components/ui/FilterChip";
import type { PortionCard } from "@/lib/domain/types";
import { createOpenRowStore } from "@/lib/open-row";
import { FILTERS, filterCards, filterCounts, filterLabel, type Filter } from "@/lib/portion-filter";
import { sheetKey } from "@/lib/month-nav";
import { CHIP_ROW } from "@/lib/ui-classes";
import PaymentSheet, { type SheetMode } from "./PaymentSheet";
import PortionRow, { type RowAction } from "./PortionRow";
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

export default function PortionBoard({ monthKey, monthLabel, cards, defaultDate }: Props) {
  const [active, setActive] = useState<Active>(null);
  const [filter, setFilter] = useState<Filter>("all");
  // Which row is open lives in a store the rows read, so a tap on a row does not draw the board again.
  const [openRow] = useState(createOpenRowStore);

  const counts = useMemo(() => filterCounts(cards), [cards]);
  const shown = useMemo(() => filterCards(cards, filter), [cards, filter]);

  const act = useCallback(
    (action: RowAction) =>
      setActive(
        action.mode === "undo"
          ? { mode: "undo", portionId: action.portionId, card: action.card, monthKey, monthLabel }
          : { mode: action.mode, portionId: action.portionId },
      ),
    [monthKey, monthLabel],
  );

  return (
    <>
      {/* The chips scroll sideways when they do not fit, so a swipe that starts on them is theirs, not the month's. */}
      <div role="group" aria-label="Filter portions" data-no-swipe className={`${CHIP_ROW} mt-2`}>
        {FILTERS.map((name) => (
          <FilterChip
            key={name}
            selected={filter === name}
            count={counts[name]}
            onClick={() => {
              openRow.close();
              setFilter(name);
            }}
          >
            {filterLabel(name)}
          </FilterChip>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-7 text-center text-sm text-muted">Nothing here for this filter.</p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((card) => (
            <PortionRow
              key={card.portionId}
              card={card}
              monthKey={monthKey}
              defaultDate={defaultDate}
              store={openRow}
              saving={false}
              onAction={act}
            />
          ))}
        </ul>
      )}

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
    </>
  );
}

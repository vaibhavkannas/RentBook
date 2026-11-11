"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FilterChip } from "@/components/ui/FilterChip";
import type { PortionCard } from "@/lib/domain/types";
import { createOpenRowStore } from "@/lib/open-row";
import { isOverdueCard } from "@/lib/portion-row";
import { FILTERS, filterCards, filterCounts, filterLabel, type Filter } from "@/lib/portion-filter";
import { CHIP_ROW } from "@/lib/ui-classes";
import PortionRow, { type RowAction } from "./PortionRow";

type Props = {
  monthKey: string;
  cards: PortionCard[];
  defaultDate: string;
  /** The portions whose change is on its way to the Sheet and not confirmed yet. */
  saving?: ReadonlySet<string>;
  /** A row asked for a sheet (Log payment, Edit amount, Undo, Add tenant). */
  onAct?: (action: RowAction) => void;
  /** The New tenant button was pressed. */
  onNewTenant?: () => void;
};

const NOBODY = () => {};
const NONE: ReadonlySet<string> = new Set();

/**
 * The month's portions: the filter chips and one row for each portion, and the New tenant button. It draws what it is given and
 * says what was asked for; the sheets, and the changes that are on their way, are the month screen's (so a sheet outlives a
 * switch of month while its request is answered).
 */
export default function PortionBoard({ monthKey, cards, defaultDate, saving = NONE, onAct = NOBODY, onNewTenant = NOBODY }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  // Which row is open lives in a store the rows read, so a tap on a row does not draw the board again.
  const [openRow] = useState(createOpenRowStore);

  const counts = useMemo(() => filterCounts(cards), [cards]);
  const shown = useMemo(() => filterCards(cards, filter), [cards, filter]);

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
              saving={saving.has(card.portionId)}
              overdue={isOverdueCard(card, monthKey, defaultDate)}
              onAction={onAct}
            />
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Button variant="secondary" className="w-full" onClick={onNewTenant}>
          New tenant
        </Button>
      </div>
    </>
  );
}

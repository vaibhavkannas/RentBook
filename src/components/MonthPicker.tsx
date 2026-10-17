"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Sheet } from "@/components/ui/Sheet";
import { parseYmKey } from "@/lib/domain/year-month";
import { monthPickerCells } from "@/lib/month-nav";

type Props = {
  shownKey: string;
  currentKey: string;
  onPick: (key: string) => void;
  onClose: () => void;
};

export default function MonthPicker({ shownKey, currentKey, onPick, onClose }: Props) {
  const [year, setYear] = useState(() => parseYmKey(shownKey)!.year);
  const titleId = useId();

  return (
    <Sheet labelledBy={titleId} onClose={onClose} canClose closeOnBackdrop>
      <h2 id={titleId} className="sr-only">
        Choose month
      </h2>
      <div className="flex items-center justify-between">
        <IconButton label="Previous year" onClick={() => setYear((y) => y - 1)}>
          ‹
        </IconButton>
        <p className="text-lg font-semibold">{year}</p>
        <IconButton label="Next year" onClick={() => setYear((y) => y + 1)}>
          ›
        </IconButton>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {monthPickerCells(year).map((cell) => {
          const shown = cell.key === shownKey;
          const current = cell.key === currentKey;
          return (
            <button
              key={cell.key}
              type="button"
              aria-pressed={shown}
              onClick={() => onPick(cell.key)}
              className={`press min-h-12 rounded-control border px-3 font-medium ${
                shown
                  ? "border-accent bg-accent text-accent-ink"
                  : current
                    ? "border-accent text-foreground"
                    : "border-line"
              }`}
            >
              {cell.label}
              {current && <span className="sr-only"> (this month)</span>}
            </button>
          );
        })}
      </div>

      <Button variant="quiet" className="mt-3 w-full" onClick={onClose}>
        Close
      </Button>
    </Sheet>
  );
}

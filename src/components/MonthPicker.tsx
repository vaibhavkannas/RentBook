"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose month"
        className="w-full max-w-md rounded-t-2xl bg-surface p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous year"
            onClick={() => setYear((y) => y - 1)}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl"
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold">{year}</h2>
          <button
            type="button"
            aria-label="Next year"
            onClick={() => setYear((y) => y + 1)}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl"
          >
            ›
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {monthPickerCells(year).map((cell) => {
            const shown = cell.key === shownKey;
            const current = cell.key === currentKey;
            return (
              <button
                key={cell.key}
                type="button"
                aria-current={shown ? "date" : undefined}
                onClick={() => onPick(cell.key)}
                className={`min-h-12 rounded-xl border px-3 font-medium ${
                  shown
                    ? "border-accent bg-accent text-accent-ink"
                    : current
                      ? "border-accent text-foreground"
                      : "border-line"
                }`}
              >
                {cell.label}
              </button>
            );
          })}
        </div>

        <button type="button" onClick={onClose} className="mt-3 min-h-11 w-full text-muted">
          Close
        </button>
      </div>
    </div>
  );
}

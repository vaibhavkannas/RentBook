"use client";

import { useEffect, useRef, useState } from "react";
import { parseYmKey } from "@/lib/domain/year-month";
import { monthPickerCells, shouldCloseOnBackdrop, trapTabIndex } from "@/lib/month-nav";

type Props = {
  shownKey: string;
  currentKey: string;
  onPick: (key: string) => void;
  onClose: () => void;
};

export default function MonthPicker({ shownKey, currentKey, onPick, onClose }: Props) {
  const [year, setYear] = useState(() => parseYmKey(shownKey)!.year);
  const panelRef = useRef<HTMLDivElement>(null);
  // Where the latest press began and ended, so a drag from the panel onto the backdrop is not a tap on it.
  const press = useRef({ downOnBackdrop: false, upOnBackdrop: false });

  // Move focus into the dialog on open and hand it back to whatever opened it on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
      const next = trapTabIndex(
        buttons.length,
        buttons.indexOf(document.activeElement as HTMLElement),
        event.shiftKey,
      );
      if (next !== null) {
        event.preventDefault();
        buttons[next].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40"
      onPointerDown={(event) => {
        press.current = { downOnBackdrop: event.target === event.currentTarget, upOnBackdrop: false };
      }}
      onPointerUp={(event) => {
        press.current.upOnBackdrop = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const { downOnBackdrop, upOnBackdrop } = press.current;
        press.current = { downOnBackdrop: false, upOnBackdrop: false };
        const clickOnBackdrop = event.target === event.currentTarget;
        if (shouldCloseOnBackdrop({ downOnBackdrop, upOnBackdrop, clickOnBackdrop })) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose month"
        tabIndex={-1}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 focus:outline-none"
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
                aria-pressed={shown}
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
                {current && <span className="sr-only"> (this month)</span>}
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
